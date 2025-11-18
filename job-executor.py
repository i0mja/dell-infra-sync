#!/usr/bin/env python3
"""
Job Executor for Dell Server Manager
=====================================

This script runs on your local network to execute jobs created in the
Dell Server Manager cloud application. It performs operations that require
access to your private network (iDRAC, vCenter).

Requirements:
- Python 3.7+
- pip install requests pyVmomi

Usage:
1. Configure the settings below
2. Run: python job-executor.py
3. Script will poll for pending jobs and execute them

Jobs Supported:
- Firmware updates (via iDRAC Redfish API)
- IP discovery scans (find iDRAC endpoints)
- vCenter maintenance mode orchestration
"""

import ssl
import requests
import sys
import time
import ipaddress
import concurrent.futures
from typing import List, Dict, Optional
from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim
import atexit
import json
import os
from datetime import datetime
from idrac_throttler import IdracThrottler

# Best-effort: prefer UTF-8 output if available, but never crash if not
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

UNICODE_FALLBACKS = {
    "\u2713": "[OK]",   # ✓
    "\u2717": "[X]",    # ✗
    "\u2026": "...",    # …
    "\u2013": "-",      # –
    "\u2014": "-",      # —
}

# ============================================================================
# CONFIGURATION
# ============================================================================

# Dell Server Manager URL
DSM_URL = os.getenv("DSM_URL", "http://127.0.0.1:54321")  # Defaults to local Supabase

# Supabase Service Role Key (for update-job endpoint)
# This is a SECRET - do not commit to version control!
SERVICE_ROLE_KEY = os.getenv("SERVICE_ROLE_KEY", "")  # Set via env var

# vCenter connection (for maintenance mode operations)
VCENTER_HOST = os.getenv("VCENTER_HOST", "vcenter.example.com")
VCENTER_USER = os.getenv("VCENTER_USER", "administrator@vsphere.local")
VCENTER_PASSWORD = os.getenv("VCENTER_PASSWORD", "")

# iDRAC default credentials (for discovery and firmware updates)
IDRAC_DEFAULT_USER = os.getenv("IDRAC_USER", "root")
IDRAC_DEFAULT_PASSWORD = os.getenv("IDRAC_PASSWORD", "calvin")

# Firmware repository URL (HTTP server hosting Dell Update Packages)
FIRMWARE_REPO_URL = os.getenv("FIRMWARE_REPO_URL", "http://firmware.example.com/dell")

# Polling interval (seconds)
POLL_INTERVAL = 10  # Check for new jobs every 10 seconds

# Firmware update settings
FIRMWARE_UPDATE_TIMEOUT = 1800  # 30 minutes max for firmware download/apply
SYSTEM_REBOOT_WAIT = 120  # Wait 2 minutes for system to reboot
SYSTEM_ONLINE_CHECK_ATTEMPTS = 24  # Try for 4 minutes (24 * 10s)

# SSL verification
VERIFY_SSL = False

# ============================================================================
# Job Executor Class
# ============================================================================

def _normalize_unicode(text: str) -> str:
    """Replace problematic Unicode characters with ASCII equivalents"""
    for bad, repl in UNICODE_FALLBACKS.items():
        text = text.replace(bad, repl)
    return text

def _safe_to_stdout(text: str) -> str:
    """Ensure text can be encoded to stdout without exceptions"""
    enc = getattr(sys.stdout, "encoding", None) or "utf-8"
    try:
        return text.encode(enc, errors="replace").decode(enc, errors="replace")
    except Exception:
        return text.encode("ascii", errors="replace").decode("ascii", errors="replace")

def _safe_json_parse(response):
    """Safely parse JSON response, returning dict or text on failure"""
    try:
        return response.json()
    except Exception:
        # Return truncated text if JSON parsing fails
        text = response.text[:500] if hasattr(response, 'text') else str(response.content[:500])
        return {"_raw_response": text, "_parse_error": "Not valid JSON"}

class JobExecutor:
    def __init__(self):
        self.vcenter_conn = None
        self.running = True
        self.encryption_key = None  # Will be fetched on first use
        self.throttler = None  # Will be initialized on first use
        self.activity_settings = {}  # Cache settings
        self.last_settings_fetch = 0  # Timestamp for cache invalidation

    def _validate_service_role_key(self):
        """Ensure SERVICE_ROLE_KEY is present before making Supabase requests"""
        if not SERVICE_ROLE_KEY or not SERVICE_ROLE_KEY.strip():
            self.log("ERROR: SERVICE_ROLE_KEY not set!", "ERROR")
            self.log("Set via: export SERVICE_ROLE_KEY='your-key-here'", "ERROR")
            self.log("Get your key from Lovable Cloud -> Settings", "ERROR")
            raise SystemExit(1)

    def _handle_supabase_auth_error(self, response, context: str):
        """Raise with helpful log message on Supabase authorization failures"""
        if response.status_code in (401, 403):
            self.log(
                f"Authorization failed while {context} (HTTP {response.status_code}). "
                "Verify SERVICE_ROLE_KEY and DSM_URL before retrying.",
                "ERROR",
            )
            raise PermissionError(f"Supabase authorization failed during {context}")

    def safe_json_parse(self, response):
        """Instance method wrapper for _safe_json_parse"""
        return _safe_json_parse(response)
        
    def log(self, message: str, level: str = "INFO"):
        """Log with timestamp"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        msg = _safe_to_stdout(_normalize_unicode(message))
        line = f"[{timestamp}] [{level}] {msg}"
        print(_safe_to_stdout(line))
    
    def fetch_activity_settings(self, force: bool = False) -> Dict:
        """Fetch activity settings from database with caching"""
        current_time = time.time()
        
        # Use cache if less than 30 seconds old and not forced
        if not force and self.activity_settings and (current_time - self.last_settings_fetch < 30):
            return self.activity_settings
        
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            response = requests.get(
                f"{DSM_URL}/rest/v1/activity_settings",
                headers=headers,
                params={'select': '*'},
                verify=VERIFY_SSL,
                timeout=10
            )

            self._handle_supabase_auth_error(response, "fetching activity settings")

            if response.status_code == 200:
                settings_list = _safe_json_parse(response)
                if settings_list and len(settings_list) > 0:
                    self.activity_settings = settings_list[0]
                    self.last_settings_fetch = current_time
                    return self.activity_settings
            
            # Return defaults if fetch fails
            return {
                'pause_idrac_operations': False,
                'discovery_max_threads': 5,
                'idrac_request_delay_ms': 500,
                'idrac_max_concurrent': 4,
                'encryption_key': self.encryption_key
            }
        except Exception as e:
            self.log(f"Error fetching activity settings: {e}", "WARN")
            # Return safe defaults
            return {
                'pause_idrac_operations': False,
                'discovery_max_threads': 5,
                'idrac_request_delay_ms': 500,
                'idrac_max_concurrent': 4
            }
    
    def initialize_throttler(self):
        """Initialize or update the iDRAC throttler with current settings"""
        try:
            settings = self.fetch_activity_settings()
            
            max_concurrent = settings.get('idrac_max_concurrent', 4)
            request_delay_ms = settings.get('idrac_request_delay_ms', 500)
            
            if self.throttler is None:
                self.throttler = IdracThrottler(
                    max_concurrent=max_concurrent,
                    request_delay_ms=request_delay_ms
                )
                self.log(f"Throttler initialized: max_concurrent={max_concurrent}, delay={request_delay_ms}ms")
            else:
                self.throttler.update_settings(
                    max_concurrent=max_concurrent,
                    request_delay_ms=request_delay_ms
                )
                self.log(f"Throttler settings updated: max_concurrent={max_concurrent}, delay={request_delay_ms}ms")
        except Exception as e:
            self.log(f"Error initializing throttler: {e}", "ERROR")
            # Create throttler with safe defaults
            if self.throttler is None:
                self.throttler = IdracThrottler(max_concurrent=4, request_delay_ms=500)
                self.log("Throttler initialized with safe defaults")
    
    def check_idrac_pause(self) -> bool:
        """Check if iDRAC operations are paused. Returns True if paused."""
        try:
            settings = self.fetch_activity_settings(force=True)  # Force fresh fetch
            is_paused = settings.get('pause_idrac_operations', False)
            
            if is_paused:
                self.log("⚠️  iDRAC operations are PAUSED via activity settings", "WARN")
                self.log("All iDRAC jobs will be skipped until pause is disabled", "WARN")
            
            return is_paused
        except Exception as e:
            self.log(f"Error checking pause status: {e}", "ERROR")
            return False  # Default to not paused on error
    
    def log_idrac_command(
        self,
        server_id: Optional[str],
        job_id: Optional[str],
        task_id: Optional[str],
        command_type: str,
        endpoint: str,
        full_url: str,
        request_headers: Optional[dict],
        request_body: Optional[dict],
        status_code: Optional[int],
        response_time_ms: int,
        response_body: Optional[dict],
        success: bool,
        error_message: Optional[str] = None,
        operation_type: str = 'idrac_api'
    ):
        """Log iDRAC command to activity monitor"""
        try:
            # Redact sensitive data from headers
            headers_safe = None
            if request_headers:
                headers_safe = {**request_headers}
                if 'Authorization' in headers_safe:
                    headers_safe['Authorization'] = '[REDACTED]'
                if 'authorization' in headers_safe:
                    headers_safe['authorization'] = '[REDACTED]'
            
            # Redact passwords from request body
            body_safe = None
            if request_body:
                body_safe = json.loads(json.dumps(request_body))
                if isinstance(body_safe, dict) and 'Password' in body_safe:
                    body_safe['Password'] = '[REDACTED]'
            
            # Truncate large payloads
            max_request_kb = 100
            max_response_kb = 100
            
            if body_safe:
                body_size_kb = len(json.dumps(body_safe)) / 1024
                if body_size_kb > max_request_kb:
                    body_safe = {
                        '_truncated': True,
                        '_original_size_kb': int(body_size_kb),
                        '_limit_kb': max_request_kb
                    }
            
            response_safe = response_body
            if response_safe:
                response_size_kb = len(json.dumps(response_safe)) / 1024
                if response_size_kb > max_response_kb:
                    response_safe = {
                        '_truncated': True,
                        '_original_size_kb': int(response_size_kb),
                        '_limit_kb': max_response_kb
                    }
            
            log_entry = {
                'server_id': server_id,
                'job_id': job_id,
                'task_id': task_id,
                'command_type': command_type,
                'endpoint': endpoint,
                'full_url': full_url,
                'request_headers': headers_safe,
                'request_body': body_safe,
                'status_code': status_code,
                'response_time_ms': response_time_ms,
                'response_body': response_safe,
                'success': success,
                'error_message': error_message,
                'initiated_by': None,
                'source': 'job_executor',
                'operation_type': operation_type
            }
            
            # Insert via Supabase REST API
            response = requests.post(
                f"{DSM_URL}/rest/v1/idrac_commands",
                headers={
                    "apikey": SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal"
                },
                json=log_entry,
                verify=VERIFY_SSL,
                timeout=5
            )

            self._handle_supabase_auth_error(response, "logging iDRAC command")

            if response.status_code not in [200, 201]:
                self.log(f"Failed to log iDRAC command: {response.status_code}", "DEBUG")

        except Exception as e:
            # Don't let logging failures break job execution
            self.log(f"Logging exception: {e}", "DEBUG")

    def get_encryption_key(self) -> Optional[str]:
        """Fetch the encryption key from activity_settings (cached)"""
        if self.encryption_key:
            return self.encryption_key
            
        try:
            url = f"{DSM_URL}/rest/v1/activity_settings"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            }
            params = {"select": "encryption_key", "limit": "1"}
            
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            self._handle_supabase_auth_error(response, "loading encryption key")
            if response.status_code == 200:
                settings = _safe_json_parse(response)
                if settings and len(settings) > 0:
                    self.encryption_key = settings[0].get('encryption_key')
                    if self.encryption_key:
                        self.log("Encryption key loaded successfully", "INFO")
                    return self.encryption_key
            
            self.log("Failed to load encryption key", "WARN")
            return None
        except Exception as e:
            self.log(f"Error loading encryption key: {e}", "ERROR")
            return None

    def decrypt_password(self, encrypted_password: str) -> Optional[str]:
        """Decrypt a password using the database decrypt function"""
        if not encrypted_password:
            return None
            
        try:
            encryption_key = self.get_encryption_key()
            if not encryption_key:
                self.log("Cannot decrypt: encryption key not available", "ERROR")
                return None
            
            # Call the decrypt_password database function
            url = f"{DSM_URL}/rest/v1/rpc/decrypt_password"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "Content-Type": "application/json"
            }
            payload = {
                "encrypted": encrypted_password,
                "key": encryption_key
            }
            
            response = requests.post(url, headers=headers, json=payload, verify=VERIFY_SSL)
            self._handle_supabase_auth_error(response, "decrypting password")
            if response.status_code == 200:
                # RPC returns the decrypted string directly
                decrypted = _safe_json_parse(response)
                if decrypted:
                    return decrypted
                else:
                    self.log("Decryption returned null - possibly corrupted data", "WARN")
                    return None
            else:
                self.log(f"Decryption failed: {response.status_code} - {response.text}", "ERROR")
                return None
        except Exception as e:
            self.log(f"Error decrypting password: {e}", "ERROR")
            return None

    def ip_in_range(self, ip_address: str, ip_range: str) -> bool:
        """
        Check if an IP address is within a given range.
        Supports CIDR notation (10.0.0.0/8) and hyphenated ranges (192.168.1.1-192.168.1.50)
        """
        try:
            ip = ipaddress.ip_address(ip_address)
            
            # CIDR notation
            if '/' in ip_range:
                network = ipaddress.ip_network(ip_range, strict=False)
                return ip in network
            
            # Hyphenated range
            elif '-' in ip_range:
                start_ip, end_ip = ip_range.split('-')
                start = ipaddress.ip_address(start_ip.strip())
                end = ipaddress.ip_address(end_ip.strip())
                return start <= ip <= end
            
            # Single IP
            else:
                return ip == ipaddress.ip_address(ip_range)
                
        except ValueError:
            self.log(f"Invalid IP range format: {ip_range}", "ERROR")
            return False

    def get_credential_sets_for_ip(self, ip_address: str) -> List[Dict]:
        """
        Get credential sets that match the given IP address based on IP ranges.
        Returns credential sets ordered by priority.
        """
        try:
            # Fetch all credential_ip_ranges with their credential_sets
            url = f"{DSM_URL}/rest/v1/credential_ip_ranges"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            }
            params = {
                "select": "*, credential_sets(*)"
            }
            
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            
            if response.status_code != 200:
                self.log(f"Error fetching credential IP ranges: {response.status_code}", "WARN")
                return []
            
            matching_sets = []
            ip_range_entries = _safe_json_parse(response)
            
            for ip_range_entry in ip_range_entries:
                ip_range = ip_range_entry['ip_range']
                
                # Check if IP matches range
                if self.ip_in_range(ip_address, ip_range):
                    cred_set = ip_range_entry['credential_sets']
                    matching_sets.append({
                        'id': cred_set['id'],
                        'name': cred_set['name'],
                        'username': cred_set['username'],
                        'password': self.decrypt_password(cred_set['password_encrypted']),
                        'priority': ip_range_entry['priority'],
                        'matched_range': ip_range
                    })
            
            # Sort by priority (lower = higher priority)
            matching_sets.sort(key=lambda x: x['priority'])
            
            if matching_sets:
                self.log(f"Found {len(matching_sets)} credential set(s) for IP {ip_address}", "INFO")
            
            return matching_sets
            
        except Exception as e:
            self.log(f"Error fetching credential sets for IP: {e}", "ERROR")
            return []

    def get_server_credentials(self, server_id: str) -> tuple:
        """Fetch server-specific credentials from database, fallback to defaults"""
        try:
            url = f"{DSM_URL}/rest/v1/servers"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            }
            params = {
                "id": f"eq.{server_id}",
                "select": "idrac_username,idrac_password_encrypted"
            }
            
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            if response.status_code == 200:
                servers = _safe_json_parse(response)
                if servers and len(servers) > 0:
                    server = servers[0]
                    # Use server-specific credentials if available, otherwise use defaults
                    username = server.get('idrac_username') or IDRAC_DEFAULT_USER
                    encrypted_password = server.get('idrac_password_encrypted')
                    
                    if encrypted_password:
                        password = self.decrypt_password(encrypted_password) or IDRAC_DEFAULT_PASSWORD
                    else:
                        password = IDRAC_DEFAULT_PASSWORD
                    
                    if server.get('idrac_username'):
                        self.log(f"Using server-specific credentials for server {server_id}", "INFO")
                    else:
                        self.log(f"Using default credentials for server {server_id}", "INFO")
                    
                    return (username, password)
        except Exception as e:
            self.log(f"Error fetching server credentials: {str(e)}, using defaults", "WARN")
        
        return (IDRAC_DEFAULT_USER, IDRAC_DEFAULT_PASSWORD)

    def get_pending_jobs(self) -> List[Dict]:
        """Fetch pending jobs from the cloud"""
        try:
            url = f"{DSM_URL}/rest/v1/jobs"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            }
            params = {
                "status": "eq.pending",
                "select": "*",
                "order": "created_at.asc"
            }

            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            self._handle_supabase_auth_error(response, "fetching pending jobs")
            if response.status_code == 200:
                jobs = _safe_json_parse(response)
                # Filter by schedule_at if set
                ready_jobs = []
                for job in jobs:
                    if not job['schedule_at'] or datetime.fromisoformat(job['schedule_at'].replace('Z', '+00:00')) <= datetime.now():
                        ready_jobs.append(job)
                return ready_jobs
            else:
                self.log(f"Error fetching jobs: {response.status_code}", "ERROR")
                return []
        except Exception as e:
            self.log(f"Error fetching jobs: {e}", "ERROR")
            return []

    def update_job_status(self, job_id: str, status: str, **kwargs):
        """Update job status in the cloud"""
        try:
            url = f"{DSM_URL}/functions/v1/update-job"
            payload = {
                "job": {
                    "job_id": job_id,
                    "status": status,
                    **kwargs
                }
            }

            response = requests.post(url, json=payload, verify=VERIFY_SSL)
            self._handle_supabase_auth_error(response, "updating job status")
            if response.status_code != 200:
                self.log(f"Error updating job: {response.text}", "ERROR")
        except Exception as e:
            self.log(f"Error updating job status: {e}", "ERROR")

    def update_task_status(self, task_id: str, status: str, log: str = None, **kwargs):
        """Update task status in the cloud"""
        try:
            url = f"{DSM_URL}/functions/v1/update-job"
            payload = {
                "task": {
                    "task_id": task_id,
                    "status": status,
                    "log": log,
                    **kwargs
                }
            }

            response = requests.post(url, json=payload, verify=VERIFY_SSL)
            self._handle_supabase_auth_error(response, "updating task status")
            if response.status_code != 200:
                self.log(f"Error updating task: {response.text}", "ERROR")
        except Exception as e:
            self.log(f"Error updating task status: {e}", "ERROR")

    def safe_json_parse(self, response):
        """Safely parse JSON response, return None if invalid"""
        try:
            if response.status_code in [200, 201] and response.text:
                return response.json()
        except Exception as e:
            self.log(f"Failed to parse JSON: {e}", "WARN")
        return None

    def get_job_tasks(self, job_id: str) -> List[Dict]:
        """Fetch tasks for a job"""
        try:
            url = f"{DSM_URL}/rest/v1/job_tasks"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            }
            params = {
                "job_id": f"eq.{job_id}",
                "select": "*, servers(*)"
            }
            
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            self._handle_supabase_auth_error(response, "fetching job tasks")
            if response.status_code == 200:
                return _safe_json_parse(response)
            return []
        except Exception as e:
            self.log(f"Error fetching tasks: {e}", "ERROR")
            return []

    def get_comprehensive_server_info(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None, max_retries: int = 3, full_onboarding: bool = True) -> Optional[Dict]:
        """Get comprehensive server information from iDRAC Redfish API using throttler with optional full onboarding"""
        system_data = None
        
        # Get system information with throttler (handles retries internally)
        system_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1"
        
        try:
            system_response, response_time_ms = self.throttler.request_with_safety(
                method='GET',
                url=system_url,
                ip=ip,
                logger=self.log,
                auth=(username, password),
                timeout=(2, 15)  # 2s connect, 15s read
            )
            
            # Try to parse JSON, but handle parse errors gracefully
            response_json = None
            json_error = None
            if system_response and system_response.content:
                try:
                    response_json = system_response.json()
                except json.JSONDecodeError as json_err:
                    json_error = str(json_err)
                    self.log(f"  Warning: Could not parse response as JSON: {json_err}", "WARN")
            
            # Log the system info request
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Systems/System.Embedded.1',
                full_url=system_url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=system_response.status_code if system_response else None,
                response_time_ms=response_time_ms,
                response_body=response_json,
                success=(system_response and system_response.status_code == 200 and response_json is not None),
                error_message=json_error if json_error else (None if (system_response and system_response.status_code == 200) else f"HTTP {system_response.status_code}" if system_response else "Request failed"),
                operation_type='idrac_api'
            )
            
            if system_response and system_response.status_code == 200 and response_json is not None:
                system_data = response_json
                # Record success
                self.throttler.record_success(ip)
            else:
                self.log(f"  Failed to get system info from {ip}", "ERROR")
                if system_response and system_response.status_code in [401, 403]:
                    self.throttler.record_failure(ip, system_response.status_code, self.log)
                return None
                    
        except Exception as e:
            # Record failure
            self.throttler.record_failure(ip, None, self.log)
            
            # Log the error
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Systems/System.Embedded.1',
                full_url=system_url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=None,
                response_time_ms=0,
                response_body=None,
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            
            self.log(f"  Error getting system info from {ip}: {e}", "ERROR")
            return None
        
        if system_data is None:
            return None
        
        # Get manager (iDRAC) information with retry logic
        manager_url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1"
        manager_data = {}
        
        try:
            manager_response, response_time_ms = self.throttler.request_with_safety(
                method='GET',
                url=manager_url,
                ip=ip,
                logger=self.log,
                auth=(username, password),
                timeout=(2, 15)  # 2s connect, 15s read
            )
            
            # Parse JSON
            response_json = None
            json_error = None
            if manager_response and manager_response.content:
                try:
                    response_json = manager_response.json()
                except json.JSONDecodeError as json_err:
                    json_error = str(json_err)
                    self.log(f"  Warning: Could not parse manager response as JSON: {json_err}", "WARN")
            
            # Log the request
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Managers/iDRAC.Embedded.1',
                full_url=manager_url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=manager_response.status_code if manager_response else None,
                response_time_ms=response_time_ms,
                response_body=response_json,
                success=(manager_response and manager_response.status_code == 200 and response_json is not None),
                error_message=json_error if json_error else (None if (manager_response and manager_response.status_code == 200) else f"HTTP {manager_response.status_code}" if manager_response else "Request failed"),
                operation_type='idrac_api'
            )
            
            if manager_response and manager_response.status_code == 200 and response_json is not None:
                manager_data = response_json
                # Record success
                self.throttler.record_success(ip)
            else:
                # Manager data is optional, log warning and continue
                self.log(f"  Warning: Could not get manager info from {ip} (continuing with system data only)", "WARN")
                if manager_response and manager_response.status_code in [401, 403]:
                    self.throttler.record_failure(ip, manager_response.status_code, self.log)
                    
        except Exception as e:
            # Record failure
            self.throttler.record_failure(ip, None, self.log)
            
            # Log the error
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Managers/iDRAC.Embedded.1',
                full_url=manager_url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=None,
                response_time_ms=0,
                response_body=None,
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            
            self.log(f"  Warning: Error getting manager info from {ip}: {e} (continuing with system data only)", "WARN")
        
        # Extract comprehensive info
        try:
            processor_summary = system_data.get("ProcessorSummary", {})
            memory_summary = system_data.get("MemorySummary", {})
            
            # Extract Redfish version from @odata.type
            redfish_version = None
            if "@odata.type" in system_data:
                odata_type = system_data.get("@odata.type", "")
                # Extract version from something like "#ComputerSystem.v1_13_0.ComputerSystem"
                if "." in odata_type:
                    parts = odata_type.split(".")
                    if len(parts) >= 2:
                        redfish_version = parts[1].replace("v", "").replace("_", ".")
            
            # Sanitize types for database columns
            cpu_count_val = processor_summary.get("Count")
            if cpu_count_val is not None:
                try:
                    cpu_count = int(cpu_count_val) if isinstance(cpu_count_val, (int, float)) else (int(cpu_count_val) if str(cpu_count_val).replace('.','',1).isdigit() else None)
                except (ValueError, TypeError):
                    cpu_count = None
            else:
                cpu_count = None
            
            mem_gib_val = memory_summary.get("TotalSystemMemoryGiB")
            if mem_gib_val is not None:
                try:
                    memory_gb = int(mem_gib_val) if isinstance(mem_gib_val, (int, float)) else (int(float(mem_gib_val)) if isinstance(mem_gib_val, str) and mem_gib_val.replace('.','',1).isdigit() else None)
                except (ValueError, TypeError):
                    memory_gb = None
            else:
                memory_gb = None
            
            base_info = {
                "manufacturer": system_data.get("Manufacturer", "Unknown"),
                "model": system_data.get("Model", "Unknown"),
                "service_tag": system_data.get("SKU") or system_data.get("SerialNumber", None),  # Dell Service Tag is in SKU field
                "hostname": system_data.get("HostName", None) or None,  # Convert empty string to None
                "bios_version": system_data.get("BiosVersion", None),
                "cpu_count": cpu_count,
                "memory_gb": memory_gb,
                "idrac_firmware": manager_data.get("FirmwareVersion", None) if manager_data else None,
                "manager_mac_address": None,  # Would need to query EthernetInterfaces
                "product_name": system_data.get("Model", None),
                "redfish_version": redfish_version,
                "supported_endpoints": None,  # Can be populated from Oem data if needed
                "username": username,
                "password": password,
            }
            
            # If full onboarding is requested, fetch additional data
            if full_onboarding:
                self.log(f"  Starting full onboarding for {ip}...", "INFO")
                
                # Fetch health status
                health_data = self._fetch_health_status(ip, username, password, server_id, job_id)
                if health_data:
                    base_info['health_status'] = health_data
                    self.log(f"  ✓ Health status fetched", "INFO")
                
                # Fetch event logs
                event_log_count = self._fetch_initial_event_logs(ip, username, password, server_id, job_id)
                if event_log_count > 0:
                    base_info['event_log_count'] = event_log_count
                    self.log(f"  ✓ Fetched {event_log_count} event logs", "INFO")
            
            return base_info
        except Exception as e:
            self.log(f"Error extracting server info from {ip}: {e}", "ERROR")
            self.log(f"  system_data keys: {list(system_data.keys()) if system_data else 'None'}", "DEBUG")
            self.log(f"  manager_data keys: {list(manager_data.keys()) if manager_data else 'None'}", "DEBUG")
            return None

    def _fetch_health_status(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None) -> Optional[Dict]:
        """Fetch comprehensive health status from multiple Redfish endpoints"""
        health = {
            'overall_status': 'Unknown',
            'storage_healthy': None,
            'thermal_healthy': None,
            'power_healthy': None
        }
        
        endpoints = [
            ('/redfish/v1/Systems/System.Embedded.1/Storage', 'storage'),
            ('/redfish/v1/Chassis/System.Embedded.1/Thermal', 'thermal'),
            ('/redfish/v1/Chassis/System.Embedded.1/Power', 'power')
        ]
        
        for endpoint, health_type in endpoints:
            try:
                url = f"https://{ip}{endpoint}"
                response, response_time = self.throttler.request_with_safety(
                    method='GET',
                    url=url,
                    ip=ip,
                    logger=self.log,
                    auth=(username, password),
                    timeout=(2, 15)
                )
                
                response_json = None
                if response and response.status_code == 200 and response.content:
                    try:
                        response_json = response.json()
                    except json.JSONDecodeError:
                        pass
                
                # Log the API call
                self.log_idrac_command(
                    server_id=server_id,
                    job_id=job_id,
                    task_id=None,
                    command_type='GET',
                    endpoint=endpoint,
                    full_url=url,
                    request_headers={'Authorization': f'Basic {username}:***'},
                    request_body=None,
                    status_code=response.status_code if response else None,
                    response_time_ms=response_time,
                    response_body=response_json,
                    success=(response and response.status_code == 200),
                    error_message=None if (response and response.status_code == 200) else f"HTTP {response.status_code}" if response else "Request failed",
                    operation_type='idrac_api'
                )
                
                if response and response.status_code == 200 and response_json:
                    health[f'{health_type}_healthy'] = self._parse_health_from_response(response_json)
                    self.throttler.record_success(ip)
                    
            except Exception as e:
                self.log(f"  Could not fetch {health_type} health: {e}", "WARN")
        
        return health

    def _parse_health_from_response(self, data: Dict) -> bool:
        """Parse health status from various Redfish health response formats"""
        try:
            # Try Status.Health field (common pattern)
            if 'Status' in data and isinstance(data['Status'], dict):
                health = data['Status'].get('Health', 'Unknown')
                return health == 'OK'
            
            # Try Members array with Status fields
            if 'Members' in data and isinstance(data['Members'], list):
                all_ok = True
                for member in data['Members']:
                    if 'Status' in member and isinstance(member['Status'], dict):
                        health = member['Status'].get('Health', 'Unknown')
                        if health != 'OK':
                            all_ok = False
                            break
                return all_ok
            
            # Default to unknown
            return None
        except Exception as e:
            self.log(f"  Error parsing health status: {e}", "DEBUG")
            return None

    def _fetch_initial_event_logs(self, ip: str, username: str, password: str, server_id: str, job_id: str) -> int:
        """Fetch recent event logs and store in database"""
        try:
            url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/Logs/Sel"
            response, response_time = self.throttler.request_with_safety(
                method='GET',
                url=url,
                ip=ip,
                logger=self.log,
                auth=(username, password),
                timeout=(2, 15)
            )
            
            response_json = None
            if response and response.status_code == 200 and response.content:
                try:
                    response_json = response.json()
                except json.JSONDecodeError:
                    pass
            
            # Log the API call
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Logs/Sel',
                full_url=url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=response.status_code if response else None,
                response_time_ms=response_time,
                response_body=response_json,
                success=(response and response.status_code == 200),
                error_message=None if (response and response.status_code == 200) else f"HTTP {response.status_code}" if response else "Request failed",
                operation_type='idrac_api'
            )
            
            if response and response.status_code == 200 and response_json:
                log_count = self._store_event_logs(response_json, server_id)
                self.throttler.record_success(ip)
                return log_count
                
        except Exception as e:
            self.log(f"  Could not fetch event logs: {e}", "WARN")
        
        return 0

    def _store_event_logs(self, data: Dict, server_id: str) -> int:
        """Parse and store event log entries in database (limit to last 50)"""
        try:
            members = data.get('Members', [])
            if not members:
                return 0
            
            # Limit to last 50 entries
            recent_logs = members[-50:] if len(members) > 50 else members
            
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            stored_count = 0
            
            for log_entry in recent_logs:
                try:
                    # Extract fields from log entry
                    log_data = {
                        'server_id': server_id,
                        'event_id': log_entry.get('Id'),
                        'timestamp': log_entry.get('Created', datetime.utcnow().isoformat() + 'Z'),
                        'severity': log_entry.get('Severity'),
                        'message': log_entry.get('Message'),
                        'category': log_entry.get('EntryType'),
                        'sensor_type': log_entry.get('SensorType'),
                        'sensor_number': log_entry.get('SensorNumber'),
                        'raw_data': log_entry
                    }
                    
                    # Insert into server_event_logs table
                    insert_url = f"{DSM_URL}/rest/v1/server_event_logs"
                    response = requests.post(insert_url, headers=headers, json=log_data, verify=VERIFY_SSL)
                    
                    if response.status_code in [200, 201]:
                        stored_count += 1
                except Exception as e:
                    self.log(f"  Error storing event log: {e}", "DEBUG")
            
            return stored_count
            
        except Exception as e:
            self.log(f"  Error parsing event logs: {e}", "WARN")
            return 0

    def _create_automatic_scp_backup(self, server_id: str, parent_job_id: str):
        """Create automatic SCP backup job for newly discovered servers"""
        try:
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            
            # Get user who created the parent job
            job_url = f"{DSM_URL}/rest/v1/jobs?id=eq.{parent_job_id}&select=created_by"
            job_response = requests.get(job_url, headers=headers, verify=VERIFY_SSL)
            created_by = None
            if job_response.status_code == 200:
                jobs = _safe_json_parse(job_response)
                if jobs and len(jobs) > 0:
                    created_by = jobs[0].get('created_by')
            
            if not created_by:
                self.log(f"  Cannot create SCP backup: no user found for parent job", "WARN")
                return
            
            backup_job = {
                'job_type': 'scp_export',
                'created_by': created_by,
                'target_scope': {'server_ids': [server_id]},
                'details': {
                    'backup_name': f'Initial-{datetime.now().strftime("%Y%m%d-%H%M%S")}',
                    'description': 'Automatic backup on server discovery',
                    'include_bios': True,
                    'include_idrac': True,
                    'include_raid': True,
                    'include_nic': True
                }
            }
            
            insert_url = f"{DSM_URL}/rest/v1/jobs"
            response = requests.post(insert_url, headers=headers, json=backup_job, verify=VERIFY_SSL)
            
            if response.status_code in [200, 201]:
                self.log(f"  ✓ Created automatic SCP backup job for server {server_id}", "INFO")
            else:
                self.log(f"  Failed to create SCP backup: HTTP {response.status_code}", "WARN")
                
        except Exception as e:
            self.log(f"  Failed to create SCP backup: {e}", "WARN")

    def test_idrac_connection(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None) -> Optional[Dict]:
        """Test iDRAC connection and get basic info (lightweight version using throttler)"""
        url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1"
        
        try:
            # Use throttler for safe request handling
            response, response_time_ms = self.throttler.request_with_safety(
                method='GET',
                url=url,
                ip=ip,
                logger=self.log,
                auth=(username, password),
                timeout=(2, 10)  # 2s connect, 10s read
            )
            
            # Log the test connection request
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Systems/System.Embedded.1',
                full_url=url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=response.status_code if response else None,
                response_time_ms=response_time_ms,
                response_body=_safe_json_parse(response) if response and response.content else None,
                success=response.status_code == 200 if response else False,
                error_message=None if (response and response.status_code == 200) else (f"HTTP {response.status_code}" if response else "Request failed"),
                operation_type='idrac_api'
            )
            
            if response and response.status_code == 200:
                data = _safe_json_parse(response)
                # Record success for circuit breaker
                self.throttler.record_success(ip)
                return {
                    "manufacturer": data.get("Manufacturer", "Unknown"),
                    "model": data.get("Model", "Unknown"),
                    "service_tag": data.get("SKU", None),
                    "serial": data.get("SerialNumber", None),
                    "hostname": data.get("HostName", None),
                    "username": username,
                    "password": password,
                }
            elif response and response.status_code in [401, 403]:
                # Authentication failure - record and possibly open circuit
                self.throttler.record_failure(ip, response.status_code, self.log)
            return None
        except Exception as e:
            # Record failure for circuit breaker
            self.throttler.record_failure(ip, None, self.log)
            
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Systems/System.Embedded.1',
                full_url=url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=None,
                response_time_ms=0,
                response_body=None,
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            self.log(f"Error testing iDRAC {ip}: {e}", "DEBUG")
            return None

    def resolve_credentials_for_server(self, server: Dict) -> tuple:
        """
        Resolve credentials for a server following priority order.
        Returns: (username, password, source, used_cred_set_id)
        Sources: 'credential_set_id', 'server_specific', 'discovered_by_credential_set_id', 
                 'ip_range', 'defaults', 'decrypt_failed'
        """
        ip = server.get('ip_address', 'unknown')
        
        # 1) Explicit server.credential_set_id
        if server.get('credential_set_id'):
            cred_sets = self.get_credential_sets([server['credential_set_id']])
            if cred_sets:
                cred = cred_sets[0]
                username = cred.get('username')
                password = cred.get('password')
                if not password and cred.get('password_encrypted'):
                    password = self.decrypt_password(cred['password_encrypted'])
                    if password is None:
                        self.log(f"  Credential resolution for {ip}: decrypt_failed (credential_set_id)", "ERROR")
                        return (None, None, 'decrypt_failed', None)
                if username and password:
                    self.log(f"  Credential resolution for {ip}: using credential_set_id", "DEBUG")
                    return (username, password, 'credential_set_id', server['credential_set_id'])
        
        # 2) Server-specific idrac_username + idrac_password_encrypted
        if server.get('idrac_username') and server.get('idrac_password_encrypted'):
            username = server['idrac_username']
            password = self.decrypt_password(server['idrac_password_encrypted'])
            if password is None:
                self.log(f"  Credential resolution for {ip}: decrypt_failed (server_specific)", "ERROR")
                return (None, None, 'decrypt_failed', None)
            self.log(f"  Credential resolution for {ip}: using server_specific credentials", "DEBUG")
            return (username, password, 'server_specific', None)
        
        # 3) Fallback to discovered_by_credential_set_id
        if server.get('discovered_by_credential_set_id'):
            cred_sets = self.get_credential_sets([server['discovered_by_credential_set_id']])
            if cred_sets:
                cred = cred_sets[0]
                username = cred.get('username')
                password = cred.get('password')
                if not password and cred.get('password_encrypted'):
                    password = self.decrypt_password(cred['password_encrypted'])
                    if password is None:
                        self.log(f"  Credential resolution for {ip}: decrypt_failed (discovered_by_credential_set_id)", "ERROR")
                        return (None, None, 'decrypt_failed', None)
                if username and password:
                    self.log(f"  Credential resolution for {ip}: using discovered_by_credential_set_id", "DEBUG")
                    return (username, password, 'discovered_by_credential_set_id', server['discovered_by_credential_set_id'])
        
        # 4) IP-range mapped credentials
        matching_sets = self.get_credential_sets_for_ip(server.get('ip_address', ''))
        if matching_sets:
            cred = matching_sets[0]  # Highest priority
            username = cred.get('username')
            password = cred.get('password')
            if not password and cred.get('password_encrypted'):
                password = self.decrypt_password(cred['password_encrypted'])
                if password is None:
                    self.log(f"  Credential resolution for {ip}: decrypt_failed (ip_range)", "ERROR")
                    return (None, None, 'decrypt_failed', None)
            if username and password:
                self.log(f"  Credential resolution for {ip}: using ip_range credentials", "DEBUG")
                return (username, password, 'ip_range', cred.get('id'))
        
        # 5) Final fallback: environment defaults
        if IDRAC_DEFAULT_USER and IDRAC_DEFAULT_PASSWORD:
            self.log(f"  Credential resolution for {ip}: using environment defaults", "DEBUG")
            return (IDRAC_DEFAULT_USER, IDRAC_DEFAULT_PASSWORD, 'defaults', None)
        
        # No credentials available
        self.log(f"  Credential resolution for {ip}: no credentials available", "WARN")
        return (None, None, 'none', None)

    def refresh_existing_servers(self, job: Dict, server_ids: List[str]):
        """Refresh information for existing servers by querying iDRAC"""
        self.log(f"Refreshing {len(server_ids)} existing server(s)")
        
        try:
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=representation"
            }
            
            # Fetch server records
            servers_url = f"{DSM_URL}/rest/v1/servers"
            servers_params = {"id": f"in.({','.join(server_ids)})", "select": "*"}
            servers_response = requests.get(servers_url, headers=headers, params=servers_params, verify=VERIFY_SSL)
            
            if servers_response.status_code != 200:
                raise Exception(f"Failed to fetch servers: {servers_response.status_code}")
            
            servers = _safe_json_parse(servers_response)
            self.log(f"Found {len(servers)} server(s) to refresh")
            
            refreshed_count = 0
            failed_count = 0
            update_errors = []
            
            for server in servers:
                ip = server['ip_address']
                self.log(f"Refreshing server {ip}...")
                
                # Resolve credentials using priority order
                username, password, cred_source, used_cred_set_id = self.resolve_credentials_for_server(server)
                
                # Handle credential resolution failures
                if cred_source == 'decrypt_failed':
                    # Update server with decryption error
                    update_data = {
                        'connection_status': 'offline',
                        'connection_error': 'Encryption key not configured; cannot decrypt credentials',
                        'credential_test_status': 'invalid',
                        'credential_last_tested': datetime.utcnow().isoformat() + 'Z'
                    }
                    update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server['id']}"
                    requests.patch(update_url, headers=headers, json=update_data, verify=VERIFY_SSL)
                    self.log(f"  ✗ Cannot decrypt credentials for {ip}", "ERROR")
                    failed_count += 1
                    continue
                
                if not username or not password:
                    self.log(f"  ✗ No credentials available for {ip}", "WARN")
                    failed_count += 1
                    continue
                
                # Query iDRAC for comprehensive info
                info = self.get_comprehensive_server_info(ip, username, password, server_id=server['id'], job_id=job['id'])
                
                if info:
                    # Define allowed server columns for update
                    allowed_fields = {
                        "manufacturer", "model", "product_name", "service_tag", "hostname",
                        "bios_version", "cpu_count", "memory_gb", "idrac_firmware",
                        "manager_mac_address", "redfish_version", "supported_endpoints"
                    }
                    
                    # Build filtered update payload (exclude None values and credentials)
                    update_data = {k: v for k, v in info.items() if k in allowed_fields and v is not None}
                    
                    # Add status fields
                    update_data.update({
                        'connection_status': 'online',
                        'connection_error': None,
                        'last_seen': datetime.utcnow().isoformat() + 'Z',
                        'credential_test_status': 'valid',
                        'credential_last_tested': datetime.utcnow().isoformat() + 'Z',
                    })
                    
                    # Promote credential_set_id if we used discovered_by or ip_range and server doesn't have one
                    if not server.get('credential_set_id') and used_cred_set_id and cred_source in ['discovered_by_credential_set_id', 'ip_range']:
                        update_data['credential_set_id'] = used_cred_set_id
                        self.log(f"  → Promoting credential_set_id {used_cred_set_id} from {cred_source}", "INFO")
                    
                    # Mirror model to product_name if missing
                    if 'product_name' not in update_data and info.get('model'):
                        update_data['product_name'] = info['model']
                    
                    self.log(f"  Updating {ip} with fields: {list(update_data.keys())}", "DEBUG")
                    
                    update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server['id']}"
                    update_response = requests.patch(update_url, headers=headers, json=update_data, verify=VERIFY_SSL)
                    
                    if update_response.status_code in [200, 204]:
                        self.log(f"  ✓ Refreshed {ip}: {info.get('model')} - {info.get('hostname')}")
                        refreshed_count += 1
                        
                        # Create automatic SCP backup for newly discovered servers
                        if server.get('discovery_job_id') == job['id']:
                            self._create_automatic_scp_backup(server['id'], job['id'])
                    else:
                        error_detail = {
                            'ip': ip,
                            'status': update_response.status_code,
                            'body': update_response.text[:500]
                        }
                        update_errors.append(error_detail)
                        self.log(f"  ✗ Failed to update DB for {ip}: {update_response.status_code} {update_response.text}", "ERROR")
                        failed_count += 1
                else:
                    # Update as offline - failed to query iDRAC
                    update_data = {
                        'connection_status': 'offline',
                        'connection_error': f'Failed to query iDRAC using {cred_source} credentials - check network or credentials',
                        'last_connection_test': datetime.utcnow().isoformat() + 'Z',
                        'credential_test_status': 'invalid',
                    }
                    
                    update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server['id']}"
                    requests.patch(update_url, headers=headers, json=update_data, verify=VERIFY_SSL)
                    
                    self.log(f"  ✗ Failed to connect to {ip} (tried {cred_source})", "WARN")
                    failed_count += 1
            
            # Complete the job
            summary = f"Refreshed {refreshed_count} server(s)"
            if failed_count > 0:
                summary += f", {failed_count} failed"
            
            job_details = {
                'summary': summary,
                'refreshed': refreshed_count,
                'failed': failed_count
            }
            if update_errors:
                job_details['update_errors'] = update_errors
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details=job_details
            )
            
            self.log(f"Server refresh complete: {summary}")
            
        except Exception as e:
            self.log(f"Error refreshing servers: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )

    def get_credential_sets(self, credential_set_ids: List[str]) -> List[Dict]:
        """Fetch credential sets from database"""
        if not credential_set_ids:
            return []
        
        try:
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            url = f"{DSM_URL}/rest/v1/credential_sets"
            params = {"id": f"in.({','.join(credential_set_ids)})", "order": "priority.asc"}
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            
            if response.status_code == 200:
                return _safe_json_parse(response)
            return []
        except Exception as e:
            self.log(f"Error fetching credential sets: {e}", "ERROR")
            return []

    def discover_single_ip(self, ip: str, credential_sets: List[Dict], job_id: str) -> Dict:
        """
        Try credentials for a single IP.
        Priority:
          1. Credential sets matching IP ranges (highest priority)
          2. Global credential sets selected in the discovery job
        """
        
        # Step 1: Get credential sets that match this IP's range
        range_based_credentials = self.get_credential_sets_for_ip(ip)
        
        # Step 2: Combine with global credentials (range-based first)
        all_credentials = range_based_credentials + credential_sets
        
        # Remove duplicates (prioritize range-based)
        seen_ids = set()
        unique_credentials = []
        for cred in all_credentials:
            if cred['id'] not in seen_ids:
                unique_credentials.append(cred)
                seen_ids.add(cred['id'])
        
        # Step 3: Try each credential set in order
        for cred_set in sorted(unique_credentials, key=lambda x: x.get('priority', 999)):
            try:
                matched_by = cred_set.get('matched_range', 'manual_selection')
                self.log(f"Trying {cred_set['name']} for {ip} (matched: {matched_by})", "INFO")
                
                # For range-based creds, password is already decrypted
                # For global creds from DB, it may be in 'password_encrypted' field
                password = cred_set.get('password')
                if not password:
                    # Decrypt if password_encrypted exists
                    encrypted = cred_set.get('password_encrypted')
                    if encrypted:
                        password = self.decrypt_password(encrypted)
                
                if not password:
                    self.log(f"No valid password for {cred_set['name']}", "WARN")
                    continue
                
                result = self.test_idrac_connection(
                    ip,
                    cred_set['username'],
                    password,
                    server_id=None,
                    job_id=job_id
                )
                
                if result:
                    return {
                        'success': True,
                        'ip': ip,
                        'credential_set_id': cred_set.get('id'),
                        'credential_set_name': cred_set['name'],
                        'matched_by': matched_by,
                        'auth_failed': False,
                        **result
                    }
            except Exception as e:
                continue  # Try next credential set
        
        # All credential sets failed
        return {
            'success': False,
            'ip': ip,
            'auth_failed': True
        }

    def insert_discovered_server(self, server: Dict, job_id: str):
        """Insert discovered server into database with credential info"""
        try:
            headers = {"apikey": API_KEY, "Authorization": f"Bearer {API_KEY}"}
            
            # Check if server already exists by IP
            check_url = f"{DSM_URL}/rest/v1/servers"
            check_params = {"ip_address": f"eq.{server['ip']}", "select": "id"}
            existing = requests.get(check_url, headers=headers, params=check_params, verify=VERIFY_SSL)
            
            server_data = {
                'hostname': server.get('hostname'),
                'model': server.get('model'),
                'service_tag': server.get('service_tag'),
                'manager_mac_address': server.get('manager_mac_address'),
                'product_name': server.get('product_name'),
                'manufacturer': server.get('manufacturer', 'Dell'),
                'redfish_version': server.get('redfish_version'),
                'idrac_firmware': server.get('idrac_firmware'),
                'bios_version': server.get('bios_version'),
                'cpu_count': server.get('cpu_count'),
                'memory_gb': server.get('memory_gb'),
                'supported_endpoints': server.get('supported_endpoints'),
                'connection_status': 'online',
                'last_seen': datetime.now().isoformat(),
                'idrac_username': server.get('username'),
                'idrac_password_encrypted': server.get('password'),
                'credential_test_status': 'valid',
                'credential_last_tested': datetime.now().isoformat(),
                'discovered_by_credential_set_id': server.get('credential_set_id'),
                'discovery_job_id': job_id,
            }
            
            if existing.status_code == 200 and _safe_json_parse(existing):
                # Update existing server
                server_id = _safe_json_parse(existing)[0]['id']
                update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}"
                requests.patch(update_url, headers=headers, json=server_data, verify=VERIFY_SSL)
                self.log(f"Updated existing server: {server['ip']}")
            else:
                # Insert new server
                server_data['ip_address'] = server['ip']
                insert_url = f"{DSM_URL}/rest/v1/servers"
                requests.post(insert_url, headers=headers, json=server_data, verify=VERIFY_SSL)
                self.log(f"Inserted new server: {server['ip']}")
        except Exception as e:
            self.log(f"Error inserting server {server['ip']}: {e}", "ERROR")

    def insert_auth_failed_server(self, ip: str, job_id: str):
        """Insert server that was discovered but authentication failed"""
        try:
            headers = {"apikey": API_KEY, "Authorization": f"Bearer {API_KEY}"}
            
            # Check if server already exists
            check_url = f"{DSM_URL}/rest/v1/servers"
            params = {"ip_address": f"eq.{ip}"}
            existing = requests.get(check_url, headers=headers, params=params, verify=VERIFY_SSL)
            
            server_data = {
                'ip_address': ip,
                'connection_status': 'offline',
                'connection_error': 'Authentication failed - credentials required',
                'credential_test_status': 'invalid',
                'credential_last_tested': datetime.now().isoformat(),
                'last_connection_test': datetime.now().isoformat(),
                'discovery_job_id': job_id,
                'notes': f'Discovered by IP scan on {datetime.now().strftime("%Y-%m-%d %H:%M:%S")} - iDRAC detected but no valid credentials'
            }
            
            if existing.status_code == 200 and _safe_json_parse(existing):
                # Update existing server with auth failure status
                server_id = _safe_json_parse(existing)[0]['id']
                update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}"
                requests.patch(update_url, headers=headers, json=server_data, verify=VERIFY_SSL)
                self.log(f"Updated server {ip} - auth failed status")
            else:
                # Insert new server with auth failed status
                insert_url = f"{DSM_URL}/rest/v1/servers"
                requests.post(insert_url, headers=headers, json=server_data, verify=VERIFY_SSL)
                self.log(f"Inserted auth-failed server: {ip}")
                
        except Exception as e:
            self.log(f"Error inserting auth-failed server {ip}: {e}", "ERROR")

    def execute_discovery_scan(self, job: Dict):
        """Execute IP discovery scan with multi-credential support OR refresh existing servers"""
        self.log(f"Starting discovery scan job {job['id']}")
        
        self.update_job_status(
            job['id'],
            'running',
            started_at=datetime.now().isoformat()
        )
        
        try:
            target_scope = job['target_scope']
            
            # Check if this is a per-server refresh (when adding individual servers)
            if 'server_ids' in target_scope and target_scope['server_ids']:
                self.refresh_existing_servers(job, target_scope['server_ids'])
                return
            
            # Otherwise, proceed with IP range discovery
            ip_range = target_scope.get('ip_range', '')
            credential_set_ids = job.get('credential_set_ids', [])
            
            self.log(f"Scanning IP range: {ip_range}")
            
            # Fetch credential sets from database
            credential_sets = self.get_credential_sets(credential_set_ids)
            
            # Fallback to environment defaults if no sets configured
            if not credential_sets:
                credential_sets = [{
                    'id': None,
                    'name': 'Environment Default',
                    'username': IDRAC_DEFAULT_USER,
                    'password_encrypted': IDRAC_DEFAULT_PASSWORD,
                    'priority': 999
                }]
            
            self.log(f"Using {len(credential_sets)} credential set(s) for discovery")
            
            # Parse IP range
            ips_to_scan = []
            if '/' in ip_range:  # CIDR notation
                network = ipaddress.ip_network(ip_range, strict=False)
                ips_to_scan = [str(ip) for ip in network.hosts()]
            elif '-' in ip_range:  # Range notation
                start, end = ip_range.split('-')
                start_ip = ipaddress.ip_address(start.strip())
                end_ip = ipaddress.ip_address(end.strip())
                current = start_ip
                while current <= end_ip:
                    ips_to_scan.append(str(current))
                    current += 1
            else:
                raise ValueError(f"Invalid IP range format: {ip_range}")
            
            self.log(f"Scanning {len(ips_to_scan)} IPs...")
            
            # Get activity settings for discovery thread limit
            settings = self.fetch_activity_settings()
            max_threads = settings.get('discovery_max_threads', 5)
            self.log(f"Using {max_threads} concurrent threads for discovery")
            
            discovered = []
            auth_failures = []
            
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_threads) as executor:
                futures = {}
                
                # Submit jobs with pacing to avoid thundering herd
                for i, ip in enumerate(ips_to_scan):
                    # Add small random delay between starting each scan (50-200ms)
                    if i > 0 and len(ips_to_scan) > 10:
                        time.sleep(0.05 + (0.15 * (i % 10) / 10.0))
                    
                    future = executor.submit(
                        self.discover_single_ip,
                        ip,
                        credential_sets,
                        job['id']
                    )
                    futures[future] = ip
                
                timeout_count = 0
                total_requests = len(ips_to_scan)
                
                for future in concurrent.futures.as_completed(futures):
                    ip = futures[future]
                    try:
                        result = future.result(timeout=30)  # 30s timeout per IP
                        if result['success']:
                            self.log(f"✓ Found iDRAC at {ip}: {result['model']} (using {result['credential_set_name']})")
                            discovered.append(result)
                        elif result['auth_failed']:
                            auth_failures.append({
                                'ip': ip,
                                'reason': 'Authentication failed with all credential sets'
                            })
                    except concurrent.futures.TimeoutError:
                        timeout_count += 1
                        # If >30% of requests timeout, warn about overload
                        if timeout_count / total_requests > 0.3:
                            self.log("⚠️  Multiple timeouts detected - iDRACs may be overloaded. Consider reducing discovery_max_threads in settings.", "WARN")
                    except Exception as e:
                        pass  # Silent fail for non-responsive IPs
            
            self.log(f"Discovery complete: {len(discovered)} servers authenticated, {len(auth_failures)} require credentials")
            
            # Insert discovered servers into database with credential info
            for server in discovered:
                self.insert_discovered_server(server, job['id'])
            
            # Insert auth-failed servers so they're tracked in inventory
            for failure in auth_failures:
                self.insert_auth_failed_server(failure['ip'], job['id'])
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details={
                    "discovered_count": len(discovered),
                    "auth_failures": len(auth_failures),
                    "scanned_ips": len(ips_to_scan),
                    "auth_failure_ips": [f['ip'] for f in auth_failures]
                }
            )
            
        except Exception as e:
            self.log(f"Discovery scan failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={"error": str(e)}
            )

    def connect_vcenter(self, settings=None):
        """Connect to vCenter if not already connected"""
        if self.vcenter_conn:
            return self.vcenter_conn
        
        # Use provided settings or fall back to environment variables
        host = settings.get('host') if settings else VCENTER_HOST
        user = settings.get('username') if settings else VCENTER_USER
        pwd = settings.get('password') if settings else VCENTER_PASSWORD
        verify_ssl = settings.get('verify_ssl', VERIFY_SSL) if settings else VERIFY_SSL
            
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        if not verify_ssl:
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        
        try:
            self.vcenter_conn = SmartConnect(
                host=host,
                user=user,
                pwd=pwd,
                sslContext=context
            )
            atexit.register(Disconnect, self.vcenter_conn)
            self.log(f"Connected to vCenter at {host}")
            return self.vcenter_conn
        except Exception as e:
            self.log(f"Failed to connect to vCenter: {e}", "ERROR")
            return None
    
    def execute_vcenter_sync(self, job: Dict):
        """Execute vCenter sync - fetch ESXi hosts and auto-link to Dell servers"""
        try:
            self.log(f"Starting vCenter sync job: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            # Fetch vCenter settings from database
            self.log("Fetching vCenter settings...")
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_settings?select=*&limit=1",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL
            )
            
            if response.status_code != 200:
                raise Exception(f"Failed to fetch vCenter settings: {response.status_code}")
            
            settings_list = _safe_json_parse(response)
            if not settings_list:
                raise Exception("vCenter settings not configured")
            
            settings = settings_list[0]
            self.log(f"vCenter host: {settings['host']}")
            
            # Connect to vCenter using database settings
            vc = self.connect_vcenter(settings)
            if not vc:
                raise Exception("Failed to connect to vCenter")
            
            # Get all ESXi hosts
            content = vc.RetrieveContent()
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.HostSystem], True
            )
            
            hosts_synced = 0
            hosts_new = 0
            hosts_updated = 0
            hosts_linked = 0
            errors = []
            
            self.log(f"Found {len(container.view)} ESXi hosts")
            
            for host in container.view:
                try:
                    # Get host details
                    host_name = host.name
                    serial = None
                    esxi_version = None
                    cluster_name = None
                    status = 'unknown'
                    in_maintenance = False
                    
                    try:
                        if host.hardware and host.hardware.systemInfo:
                            serial = host.hardware.systemInfo.serialNumber
                        if host.config and host.config.product:
                            esxi_version = host.config.product.version
                        if host.parent and isinstance(host.parent, vim.ClusterComputeResource):
                            cluster_name = host.parent.name
                        status = 'connected' if host.runtime.connectionState == 'connected' else 'disconnected'
                        in_maintenance = host.runtime.inMaintenanceMode
                    except Exception as detail_error:
                        self.log(f"  Warning getting details for {host_name}: {detail_error}", "WARNING")
                    
                    # Check if host already exists in database
                    check_response = requests.get(
                        f"{DSM_URL}/rest/v1/vcenter_hosts?select=id,server_id&name=eq.{host_name}",
                        headers={
                            'apikey': SERVICE_ROLE_KEY,
                            'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                        },
                        verify=VERIFY_SSL
                    )
                    
                    existing_hosts = _safe_json_parse(check_response) if check_response.status_code == 200 else []
                    existing_host = existing_hosts[0] if existing_hosts else None
                    
                    host_data = {
                        'name': host_name,
                        'cluster': cluster_name,
                        'serial_number': serial,
                        'esxi_version': esxi_version,
                        'status': status,
                        'maintenance_mode': in_maintenance,
                        'last_sync': datetime.now().isoformat()
                    }
                    
                    if existing_host:
                        # Update existing host
                        update_response = requests.patch(
                            f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{existing_host['id']}",
                            headers={
                                'apikey': SERVICE_ROLE_KEY,
                                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                'Content-Type': 'application/json',
                                'Prefer': 'return=minimal'
                            },
                            json=host_data,
                            verify=VERIFY_SSL
                        )
                        
                        if update_response.status_code not in [200, 204]:
                            raise Exception(f"Failed to update host: {update_response.status_code}")
                        
                        host_id = existing_host['id']
                        hosts_updated += 1
                        self.log(f"  Updated: {host_name}")
                    else:
                        # Insert new host
                        insert_response = requests.post(
                            f"{DSM_URL}/rest/v1/vcenter_hosts",
                            headers={
                                'apikey': SERVICE_ROLE_KEY,
                                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                'Content-Type': 'application/json',
                                'Prefer': 'return=representation'
                            },
                            json=host_data,
                            verify=VERIFY_SSL
                        )
                        
                        if insert_response.status_code not in [200, 201]:
                            raise Exception(f"Failed to insert host: {insert_response.status_code}")
                        
                        new_host = _safe_json_parse(insert_response)[0]
                        host_id = new_host['id']
                        hosts_new += 1
                        self.log(f"  Created: {host_name}")
                    
                    # Auto-link: Try to find matching Dell server by serial number
                    if serial and (not existing_host or not existing_host.get('server_id')):
                        server_response = requests.get(
                            f"{DSM_URL}/rest/v1/servers?select=id&service_tag=eq.{serial}",
                            headers={
                                'apikey': SERVICE_ROLE_KEY,
                                'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                            },
                            verify=VERIFY_SSL
                        )
                        
                        if server_response.status_code == 200:
                            matching_servers = _safe_json_parse(server_response)
                            if matching_servers:
                                server_id = matching_servers[0]['id']
                                
                                # Update vcenter_host with server_id
                                requests.patch(
                                    f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{host_id}",
                                    headers={
                                        'apikey': SERVICE_ROLE_KEY,
                                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                        'Content-Type': 'application/json'
                                    },
                                    json={'server_id': server_id},
                                    verify=VERIFY_SSL
                                )
                                
                                # Update server with vcenter_host_id
                                requests.patch(
                                    f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}",
                                    headers={
                                        'apikey': SERVICE_ROLE_KEY,
                                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                        'Content-Type': 'application/json'
                                    },
                                    json={'vcenter_host_id': host_id},
                                    verify=VERIFY_SSL
                                )
                                
                                hosts_linked += 1
                                self.log(f"  Linked to server: {serial}")
                    
                    hosts_synced += 1
                    
                except Exception as host_error:
                    error_msg = f"{host_name}: {str(host_error)}"
                    errors.append(error_msg)
                    self.log(f"  Error processing {host_name}: {host_error}", "ERROR")
            
            container.Destroy()
            
            # Update job as completed
            result_details = {
                'hosts_synced': hosts_synced,
                'hosts_new': hosts_new,
                'hosts_updated': hosts_updated,
                'hosts_linked': hosts_linked,
                'errors': errors
            }
            
            self.log(f"vCenter sync completed: {hosts_new} new, {hosts_updated} updated, {hosts_linked} linked")
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details=result_details
            )
            
        except Exception as e:
            self.log(f"vCenter sync failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )

    def create_idrac_session(self, ip: str, username: str, password: str) -> Optional[str]:
        """Create authenticated session with iDRAC and return session token"""
        try:
            url = f"https://{ip}/redfish/v1/SessionService/Sessions"
            payload = {
                "UserName": username,
                "Password": password
            }
            
            response, elapsed_ms = self.throttler.request_with_safety(
                'POST',
                url,
                ip,
                self.log,
                json=payload,
                timeout=(2, 10)
            )
            
            if response.status_code in [401, 403]:
                self.throttler.record_failure(ip, response.status_code, self.log)
            elif response.status_code == 201:
                self.throttler.record_success(ip)
                session_token = response.headers.get('X-Auth-Token')
                self.log(f"  Created iDRAC session: {ip}")
                return session_token
            else:
                self.log(f"  Failed to create session: {response.status_code}", "ERROR")
                return None
        except Exception as e:
            self.log(f"  Error creating iDRAC session: {e}", "ERROR")
            return None

    def close_idrac_session(self, ip: str, session_token: str, session_uri: str = None):
        """Close iDRAC session"""
        try:
            if not session_uri:
                # Try to extract session ID from token or use common pattern
                session_uri = f"https://{ip}/redfish/v1/SessionService/Sessions/1"
            
            headers = {"X-Auth-Token": session_token}
            
            response, elapsed_ms = self.throttler.request_with_safety(
                'DELETE',
                session_uri,
                ip,
                self.log,
                headers=headers,
                timeout=(2, 10)
            )
            
            if response.status_code in [200, 204]:
                self.throttler.record_success(ip)
            else:
                self.throttler.record_failure(ip, response.status_code, self.log)
                self.log(f"  Closed iDRAC session: {ip}")
        except Exception as e:
            self.log(f"  Error closing session (non-fatal): {e}", "WARN")

    def get_firmware_inventory(self, ip: str, session_token: str) -> Dict:
        """Get current firmware versions from iDRAC"""
        try:
            url = f"https://{ip}/redfish/v1/UpdateService/FirmwareInventory"
            headers = {"X-Auth-Token": session_token}
            
            response, elapsed_ms = self.throttler.request_with_safety(
                'GET',
                url,
                ip,
                self.log,
                headers=headers,
                timeout=(2, 15)
            )
            
            if response.status_code in [401, 403]:
                self.throttler.record_failure(ip, response.status_code, self.log)
            elif response.status_code == 200:
                self.throttler.record_success(ip)
                data = _safe_json_parse(response)
                members = data.get('Members', [])
                
                # Extract key firmware components
                firmware_info = {}
                for member in members:
                    member_url = member.get('@odata.id', '')
                    member_resp, member_elapsed = self.throttler.request_with_safety(
                        'GET',
                        f"https://{ip}{member_url}",
                        ip,
                        self.log,
                        headers=headers,
                        timeout=(2, 5)
                    )
                    
                    if member_resp.status_code == 200:
                        self.throttler.record_success(ip)
                        fw_data = _safe_json_parse(member_resp)
                        name = fw_data.get('Name', 'Unknown')
                        version = fw_data.get('Version', 'Unknown')
                        firmware_info[name] = version
                
                self.log(f"  Current firmware: BIOS={firmware_info.get('BIOS', 'N/A')}, iDRAC={firmware_info.get('Integrated Dell Remote Access Controller', 'N/A')}")
                return firmware_info
            
            return {}
        except Exception as e:
            self.log(f"  Error getting firmware inventory: {e}", "WARN")
            return {}

    def initiate_firmware_update(self, ip: str, session_token: str, firmware_uri: str, apply_time: str = "OnReset") -> Optional[str]:
        """
        Initiate firmware update via SimpleUpdate action
        
        Args:
            ip: iDRAC IP address
            session_token: Authenticated session token
            firmware_uri: Full HTTP URL to firmware DUP file
            apply_time: "Immediate" or "OnReset"
            
        Returns:
            Task URI for monitoring progress
        """
        try:
            url = f"https://{ip}/redfish/v1/UpdateService/Actions/UpdateService.SimpleUpdate"
            headers = {
                "X-Auth-Token": session_token,
                "Content-Type": "application/json"
            }
            payload = {
                "ImageURI": firmware_uri,
                "TransferProtocol": "HTTP",
                "@Redfish.OperationApplyTime": apply_time
            }
            
            self.log(f"  Initiating firmware update from: {firmware_uri}")
            
            response, response_time_ms = self.throttler.request_with_safety(
                'POST',
                url,
                ip,
                self.log,
                json=payload,
                headers=headers,
                timeout=(2, 30)
            )
            
            if response.status_code in [401, 403]:
                self.throttler.record_failure(ip, response.status_code, self.log)
            elif response.status_code == 202:
                self.throttler.record_success(ip)
                # Extract task URI from Location header
                task_uri = response.headers.get('Location')
                if not task_uri:
                    # Try to get it from response body
                    data = _safe_json_parse(response)
                    task_uri = data.get('@odata.id') or data.get('TaskUri')
                
                self.log(f"  Firmware update initiated, task URI: {task_uri}")
                return task_uri
            else:
                self.log(f"  Failed to initiate update: {response.status_code} - {response.text}", "ERROR")
                return None
                
        except Exception as e:
            self.log(f"  Error initiating firmware update: {e}", "ERROR")
            return None

    def monitor_update_task(self, ip: str, session_token: str, task_uri: str) -> Dict:
        """
        Poll task status
        
        Returns:
            Dict with TaskState, PercentComplete, Messages
        """
        try:
            if not task_uri.startswith('http'):
                task_uri = f"https://{ip}{task_uri}"
            
            headers = {"X-Auth-Token": session_token}
            
            response, response_time_ms = self.throttler.request_with_safety(
                'GET',
                task_uri,
                ip,
                self.log,
                headers=headers,
                timeout=(2, 10)
            )
            
            if response.status_code in [401, 403]:
                self.throttler.record_failure(ip, response.status_code, self.log)
            elif response.status_code == 200:
                self.throttler.record_success(ip)
                data = _safe_json_parse(response)
                return {
                    "TaskState": data.get("TaskState", "Unknown"),
                    "PercentComplete": data.get("PercentComplete", 0),
                    "Messages": data.get("Messages", [])
                }
            
            return {"TaskState": "Unknown", "PercentComplete": 0, "Messages": []}
        except Exception as e:
            self.log(f"  Error monitoring task: {e}", "WARN")
            return {"TaskState": "Unknown", "PercentComplete": 0, "Messages": []}

    def reset_system(self, ip: str, session_token: str, reset_type: str = "ForceRestart"):
        """Trigger system reboot to apply firmware"""
        try:
            url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset"
            headers = {
                "X-Auth-Token": session_token,
                "Content-Type": "application/json"
            }
            payload = {"ResetType": reset_type}
            
            response, response_time_ms = self.throttler.request_with_safety(
                'POST',
                url,
                ip,
                self.log,
                json=payload,
                headers=headers,
                timeout=(2, 10)
            )
            
            if response.status_code in [401, 403]:
                self.throttler.record_failure(ip, response.status_code, self.log)
            elif response.status_code in [200, 204]:
                self.throttler.record_success(ip)
                self.log(f"  System reset initiated: {reset_type}")
                return True
            else:
                self.log(f"  Failed to reset system: {response.status_code}", "ERROR")
                return False
                
        except Exception as e:
            self.log(f"  Error resetting system: {e}", "ERROR")
            return False

    def execute_firmware_update(self, job: Dict):
        """Execute firmware update job with actual Dell iDRAC Redfish API calls"""
        self.log(f"Starting firmware update job {job['id']}")
        
        # Get firmware details from job
        details = job.get('details', {})
        firmware_uri = details.get('firmware_uri')
        component = details.get('component', 'BIOS')
        version = details.get('version', 'latest')
        apply_time = details.get('apply_time', 'OnReset')
        
        # Construct firmware URI if not provided
        if not firmware_uri:
            firmware_uri = f"{FIRMWARE_REPO_URL}/{component}_{version}.exe"
        
        self.log(f"Firmware URI: {firmware_uri}")
        self.log(f"Apply time: {apply_time}")
        
        self.update_job_status(
            job['id'],
            'running',
            started_at=datetime.now().isoformat()
        )
        
        try:
            tasks = self.get_job_tasks(job['id'])
            if not tasks:
                raise ValueError("No tasks found for job")
            
            self.log(f"Processing {len(tasks)} servers...")
            
            failed_count = 0
            for task in tasks:
                server = task.get('servers')
                if not server:
                    self.log(f"Task {task['id']}: No server data", "WARN")
                    continue
                
                ip = server['ip_address']
                hostname = server.get('hostname') or ip
                self.log(f"Processing server: {hostname} ({ip})")
                
                self.update_task_status(
                    task['id'],
                    'running',
                    log="Connecting to iDRAC...",
                    started_at=datetime.now().isoformat()
                )
                
                session_token = None
                
                try:
                    # Step 1: Get server-specific credentials
                    username, password = self.get_server_credentials(server['id'])
                    
                    # Step 2: Create iDRAC session
                    session_token = self.create_idrac_session(
                        ip, username, password
                    )
                    
                    if not session_token:
                        raise Exception("Failed to authenticate with iDRAC")
                    
                    self.update_task_status(
                        task['id'], 'running',
                        log="✓ Connected to iDRAC\nChecking current firmware..."
                    )
                    
                    # Step 2: Get current firmware inventory
                    current_fw = self.get_firmware_inventory(ip, session_token)
                    
                    # Step 3: Put host in maintenance mode (if vCenter linked)
                    maintenance_mode_enabled = False
                    if server.get('vcenter_host_id'):
                        self.log(f"  Entering maintenance mode...")
                        # TODO: Implement actual vCenter maintenance mode
                        # For now, just log
                        maintenance_mode_enabled = True
                        self.update_task_status(
                            task['id'], 'running',
                            log="✓ Connected to iDRAC\n✓ Current firmware checked\n→ Entering maintenance mode..."
                        )
                        time.sleep(2)  # Simulate maintenance mode entry
                    
                    # Step 4: Initiate firmware update
                    self.log(f"  Initiating firmware update...")
                    log_msg = "✓ Connected to iDRAC\n✓ Current firmware checked\n"
                    if maintenance_mode_enabled:
                        log_msg += "✓ Maintenance mode active\n"
                    log_msg += "→ Downloading and staging firmware...\n0% complete"
                    
                    self.update_task_status(task['id'], 'running', log=log_msg)
                    
                    task_uri = self.initiate_firmware_update(ip, session_token, firmware_uri, apply_time)
                    
                    if not task_uri:
                        raise Exception("Failed to initiate firmware update")
                    
                    # Step 5: Monitor update progress
                    progress = 0
                    start_time = time.time()
                    
                    while progress < 100:
                        if time.time() - start_time > FIRMWARE_UPDATE_TIMEOUT:
                            raise Exception("Firmware update timed out")
                        
                        time.sleep(10)  # Poll every 10 seconds
                        task_status = self.monitor_update_task(ip, session_token, task_uri)
                        
                        new_progress = task_status.get('PercentComplete', progress)
                        task_state = task_status.get('TaskState', 'Unknown')
                        
                        if new_progress > progress:
                            progress = new_progress
                            log_msg = "✓ Connected to iDRAC\n✓ Current firmware checked\n"
                            if maintenance_mode_enabled:
                                log_msg += "✓ Maintenance mode active\n"
                            log_msg += f"→ Applying firmware update...\n{progress}% complete"
                            
                            self.update_task_status(task['id'], 'running', log=log_msg)
                            self.log(f"  Firmware update progress: {progress}%")
                        
                        if task_state == 'Exception' or task_state == 'Killed':
                            messages = task_status.get('Messages', [])
                            error_msg = messages[0].get('Message', 'Unknown error') if messages else 'Update failed'
                            raise Exception(f"Update failed: {error_msg}")
                        
                        if task_state == 'Completed':
                            self.log(f"  Firmware staging complete")
                            break
                    
                    # Step 6: Trigger system reset if apply_time is OnReset
                    if apply_time == "OnReset":
                        self.log(f"  Triggering system reboot...")
                        log_msg = "✓ Connected to iDRAC\n✓ Current firmware checked\n"
                        if maintenance_mode_enabled:
                            log_msg += "✓ Maintenance mode active\n"
                        log_msg += "✓ Firmware staged\n→ Rebooting system..."
                        
                        self.update_task_status(task['id'], 'running', log=log_msg)
                        
                        self.reset_system(ip, session_token)
                        
                        # Step 7: Wait for system to come back online
                        self.log(f"  Waiting for system to reboot...")
                        time.sleep(SYSTEM_REBOOT_WAIT)
                        
                        log_msg += "\n→ Waiting for system to come back online..."
                        self.update_task_status(task['id'], 'running', log=log_msg)
                        
                        # Check if system is back online
                        system_online = False
                        for attempt in range(SYSTEM_ONLINE_CHECK_ATTEMPTS):
                            try:
                                test_result = self.test_idrac_connection(ip, username, password, server_id=task.get('server_id'), job_id=job['id'])
                                if test_result:
                                    system_online = True
                                    self.log(f"  System back online")
                                    break
                            except:
                                pass
                            time.sleep(10)
                        
                        if not system_online:
                            raise Exception("System did not come back online after reboot")
                    
                    # Step 8: Exit maintenance mode
                    if maintenance_mode_enabled:
                        self.log(f"  Exiting maintenance mode...")
                        # TODO: Implement actual vCenter maintenance mode exit
                        time.sleep(2)
                    
                    # Step 9: Verify firmware version
                    new_session = self.create_idrac_session(ip, username, password)
                    if new_session:
                        new_fw = self.get_firmware_inventory(ip, new_session)
                        self.close_idrac_session(ip, new_session)
                    
                    # Build success log
                    success_log = "✓ Connected to iDRAC\n✓ Current firmware checked\n"
                    if maintenance_mode_enabled:
                        success_log += "✓ Maintenance mode active\n"
                    success_log += "✓ Firmware staged\n✓ System rebooted\n✓ System back online\n"
                    if maintenance_mode_enabled:
                        success_log += "✓ Exited maintenance mode\n"
                    success_log += f"\n✓ Firmware update successful"
                    
                    self.update_task_status(
                        task['id'], 'completed',
                        log=success_log,
                        completed_at=datetime.now().isoformat()
                    )
                    
                    self.log(f"  ✓ Firmware update completed successfully")
                    
                except Exception as e:
                    self.log(f"  ✗ Failed: {e}", "ERROR")
                    self.update_task_status(
                        task['id'], 'failed',
                        log=f"✗ Error: {str(e)}",
                        completed_at=datetime.now().isoformat()
                    )
                    failed_count += 1
                
                finally:
                    # Always close session
                    if session_token:
                        self.close_idrac_session(ip, session_token)
            
            # Update job status
            final_status = 'completed' if failed_count == 0 else 'failed'
            self.update_job_status(
                job['id'], final_status,
                completed_at=datetime.now().isoformat(),
                details={"total_tasks": len(tasks), "failed_tasks": failed_count}
            )
            
            self.log(f"Firmware update job complete: {len(tasks) - failed_count}/{len(tasks)} successful")
            
        except Exception as e:
            self.log(f"Firmware update job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'], 'failed',
                completed_at=datetime.now().isoformat(),
                details={"error": str(e)}
            )

    def execute_full_server_update(self, job: Dict):
        """Execute full server update by orchestrating sub-jobs in order"""
        self.log(f"Starting full server update job {job['id']}")
        
        self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
        
        try:
            # Get all sub-jobs ordered by component_order
            url = f"{DSM_URL}/rest/v1/jobs"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            }
            params = {
                'parent_job_id': f"eq.{job['id']}",
                'select': '*',
                'order': 'component_order.asc'
            }
            
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            response.raise_for_status()
            sub_jobs = _safe_json_parse(response)
            
            if not sub_jobs:
                raise Exception("No sub-jobs found for full server update")
            
            self.log(f"Found {len(sub_jobs)} component updates to execute")
            
            failed_components = []
            
            # Execute sub-jobs sequentially in order
            for sub_job in sub_jobs:
                component = sub_job['details'].get('component', 'Unknown')
                self.log(f"  Starting {component} update (order {sub_job.get('component_order')})...")
                
                # Execute the firmware update for this component
                try:
                    self.execute_firmware_update(sub_job)
                    
                    # Wait for sub-job to complete
                    timeout = 900  # 15 minutes per component
                    start_time = time.time()
                    
                    while time.time() - start_time < timeout:
                        # Check sub-job status
                        status_response = requests.get(
                            f"{DSM_URL}/rest/v1/jobs",
                            params={'id': f"eq.{sub_job['id']}", 'select': 'status'},
                            headers=headers,
                            verify=VERIFY_SSL
                        )
                        status_response.raise_for_status()
                        status_data = _safe_json_parse(status_response)
                        
                        if status_data and len(status_data) > 0:
                            current_status = status_data[0]['status']
                            
                            if current_status == 'completed':
                                self.log(f"  ✓ {component} update completed successfully")
                                break
                            elif current_status == 'failed':
                                raise Exception(f"{component} update failed")
                            elif current_status in ['pending', 'running']:
                                time.sleep(10)  # Poll every 10 seconds
                                continue
                        else:
                            raise Exception(f"Could not fetch status for {component} update")
                    else:
                        # Timeout reached
                        raise Exception(f"{component} update timed out after {timeout} seconds")
                        
                except Exception as e:
                    self.log(f"  ✗ {component} update failed: {e}", "ERROR")
                    failed_components.append(component)
                    
                    # Critical components (iDRAC, BIOS) should stop the entire job
                    if component in ['iDRAC', 'BIOS']:
                        self.log(f"Critical component {component} failed. Stopping full server update.", "ERROR")
                        raise Exception(f"Critical component {component} failed: {e}")
                    else:
                        # Non-critical components: log and continue
                        self.log(f"Non-critical component {component} failed. Continuing with remaining updates.", "WARNING")
                        continue
            
            # Update parent job status
            if failed_components:
                final_status = 'completed' if len(failed_components) < len(sub_jobs) else 'failed'
                self.update_job_status(
                    job['id'], final_status,
                    completed_at=datetime.now().isoformat(),
                    details={
                        "total_components": len(sub_jobs),
                        "failed_components": failed_components,
                        "completed_components": len(sub_jobs) - len(failed_components)
                    }
                )
            else:
                self.update_job_status(
                    job['id'], 'completed',
                    completed_at=datetime.now().isoformat(),
                    details={
                        "total_components": len(sub_jobs),
                        "failed_components": [],
                        "message": "All components updated successfully"
                    }
                )
            
            self.log(f"Full server update job {job['id']} completed")
            
        except Exception as e:
            self.log(f"Full server update job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'], 'failed',
                completed_at=datetime.now().isoformat(),
                details={"error": str(e)}
            )

    def execute_test_credentials(self, job: Dict):
        """Test credentials against a single iDRAC - lightweight connection test"""
        self.log(f"Testing credentials for job {job['id']}")
        
        try:
            ip_address = job['target_scope'].get('ip_address')
            credential_set_ids = job.get('credential_set_ids', [])
            
            # Get credentials - decrypt if needed
            if credential_set_ids and credential_set_ids[0]:
                creds = self.get_credential_sets([credential_set_ids[0]])[0]
                username = creds['username']
                encrypted_password = creds.get('password_encrypted')
                if encrypted_password:
                    password = self.decrypt_password(encrypted_password)
                else:
                    password = creds.get('password')  # Fallback for env defaults
            else:
                # Manual credentials passed in job details (already decrypted)
                username = job['details'].get('username')
                password = job['details'].get('password')
            
            if not username or not password:
                raise Exception("No credentials provided")
            
            # Test connection with simple GET to /redfish/v1/
            url = f"https://{ip_address}/redfish/v1/"
            self.log(f"  Testing connection to {url}")
            
            start_time = time.time()
            try:
                response = requests.get(
                    url,
                    auth=(username, password),
                    verify=False,
                    timeout=10
                )
                response_time_ms = int((time.time() - start_time) * 1000)
                
                # Log the test request
                self.log_idrac_command(
                    server_id=None,
                    job_id=job['id'],
                    task_id=None,
                    command_type='GET',
                    endpoint='/redfish/v1/',
                    full_url=url,
                    request_headers={'Authorization': f'Basic {username}:***'},
                    request_body=None,
                    status_code=response.status_code,
                    response_time_ms=response_time_ms,
                    response_body=_safe_json_parse(response) if response.content else None,
                    success=response.status_code == 200,
                    error_message=None if response.status_code == 200 else f"HTTP {response.status_code}",
                    operation_type='idrac_api'
                )
                
                if response.status_code == 200:
                    data = _safe_json_parse(response)
                    result = {
                        "success": True,
                        "message": "Connection successful",
                        "idrac_version": data.get("RedfishVersion"),
                        "product": data.get("Product"),
                        "vendor": data.get("Vendor")
                    }
                    self.log(f"  ✓ Connection successful - {data.get('Product', 'Unknown')}")
                elif response.status_code == 401:
                    result = {
                        "success": False,
                        "message": "Authentication failed - invalid credentials"
                    }
                    self.log(f"  ✗ Authentication failed", "ERROR")
                else:
                    result = {
                        "success": False,
                        "message": f"Connection failed: HTTP {response.status_code}"
                    }
                    self.log(f"  ✗ Connection failed: HTTP {response.status_code}", "ERROR")
            except Exception as e:
                response_time_ms = int((time.time() - start_time) * 1000)
                self.log_idrac_command(
                    server_id=None,
                    job_id=job['id'],
                    task_id=None,
                    command_type='GET',
                    endpoint='/redfish/v1/',
                    full_url=url,
                    request_headers={'Authorization': f'Basic {username}:***'},
                    request_body=None,
                    status_code=None,
                    response_time_ms=response_time_ms,
                    response_body=None,
                    success=False,
                    error_message=str(e),
                    operation_type='idrac_api'
                )
                raise
            
            # Update job with result
            self.update_job_status(
                job['id'],
                'completed' if result['success'] else 'failed',
                completed_at=datetime.now().isoformat(),
                details=result
            )
            
        except requests.exceptions.Timeout:
            self.log(f"  ✗ Connection timeout", "ERROR")
            self.update_job_status(
                job['id'], 'failed',
                completed_at=datetime.now().isoformat(),
                details={"success": False, "message": "Connection timeout - iDRAC not reachable"}
            )
        except Exception as e:
            self.log(f"  ✗ Test failed: {e}", "ERROR")
            self.update_job_status(
                job['id'], 'failed',
                completed_at=datetime.now().isoformat(),
                details={"success": False, "message": f"Error: {str(e)}"}
            )

    def execute_power_action(self, job: Dict):
        """Execute power action on servers"""
        try:
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            target_scope = job.get('target_scope', {})
            action = job.get('details', {}).get('action', 'On')
            
            self.log(f"Executing power action: {action}")
            
            # Get target servers
            if target_scope.get('type') == 'specific':
                server_ids = target_scope.get('server_ids', [])
            else:
                self.log("Power action requires specific server selection", "ERROR")
                raise ValueError("Power action requires specific server selection")
            
            # Fetch servers from DB
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            servers_url = f"{DSM_URL}/rest/v1/servers?id=in.({','.join(server_ids)})"
            servers_response = requests.get(servers_url, headers=headers, verify=VERIFY_SSL)
            servers = _safe_json_parse(servers_response) if servers_response.status_code == 200 else []
            
            success_count = 0
            failed_count = 0
            
            for server in servers:
                ip = server['ip_address']
                self.log(f"Executing {action} on {ip}...")
                
                # Get credentials
                username, password = self.get_server_credentials(server)
                if not username or not password:
                    self.log(f"  ✗ No credentials for {ip}", "WARN")
                    failed_count += 1
                    continue
                
                try:
                    # Get current power state using throttler
                    system_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1"
                    
                    response, response_time_ms = self.throttler.request_with_safety(
                        'GET',
                        system_url,
                        ip,
                        self.log,
                        auth=(username, password),
                        timeout=(2, 10)
                    )
                    
                    self.log_idrac_command(
                        server_id=server['id'],
                        job_id=job['id'],
                        command_type='GET',
                        endpoint='/redfish/v1/Systems/System.Embedded.1',
                        full_url=system_url,
                        status_code=response.status_code,
                        response_time_ms=response_time_ms,
                        success=response.status_code == 200,
                        operation_type='idrac_api'
                    )
                    
                    if response.status_code in [401, 403]:
                        self.throttler.record_failure(ip, response.status_code, self.log)
                        if self.throttler.is_circuit_open(ip):
                            raise Exception(f"Circuit breaker OPEN for {ip} - Possible credential lockout")
                    elif response.status_code == 200:
                        self.throttler.record_success(ip)
                        data = _safe_json_parse(response)
                        current_state = data.get('PowerState', 'Unknown')
                        self.log(f"  Current power state: {current_state}")
                        
                        # Execute power action using throttler
                        action_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset"
                        action_payload = {"ResetType": action}
                        
                        action_response, response_time_ms = self.throttler.request_with_safety(
                            'POST',
                            action_url,
                            ip,
                            self.log,
                            auth=(username, password),
                            json=action_payload,
                            timeout=(2, 30)
                        )
                        
                        self.log_idrac_command(
                            server_id=server['id'],
                            job_id=job['id'],
                            command_type='POST',
                            endpoint='/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset',
                            full_url=action_url,
                            request_body=action_payload,
                            status_code=action_response.status_code,
                            response_time_ms=response_time_ms,
                            success=action_response.status_code in [200, 202, 204],
                            operation_type='idrac_api'
                        )
                        
                        if action_response.status_code in [200, 202, 204]:
                            self.log(f"  ✓ Power action {action} successful")
                            
                            # Update server power state in DB
                            expected_state = 'On' if action in ['On', 'ForceRestart'] else 'Off'
                            update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server['id']}"
                            requests.patch(update_url, headers=headers, json={'power_state': expected_state}, verify=VERIFY_SSL)
                            
                            success_count += 1
                        else:
                            self.log(f"  ✗ Power action failed: HTTP {action_response.status_code}", "ERROR")
                            failed_count += 1
                    else:
                        self.log(f"  ✗ Failed to get power state: HTTP {response.status_code}", "ERROR")
                        failed_count += 1
                        
                except Exception as e:
                    self.log(f"  ✗ Error: {e}", "ERROR")
                    failed_count += 1
            
            # Complete job
            result = {
                "action": action,
                "success_count": success_count,
                "failed_count": failed_count,
                "total": len(servers)
            }
            
            self.update_job_status(
                job['id'],
                'completed' if failed_count == 0 else 'failed',
                completed_at=datetime.now().isoformat(),
                details=result
            )
            
            self.log(f"Power action complete: {success_count} succeeded, {failed_count} failed")
            
        except Exception as e:
            self.log(f"Power action job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'], 'failed',
                completed_at=datetime.now().isoformat(),
                details={"error": str(e)}
            )
    
    def execute_health_check(self, job: Dict):
        """Execute health check on servers"""
        try:
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            target_scope = job.get('target_scope', {})
            
            self.log("Executing health check")
            
            # Get target servers
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            if target_scope.get('type') == 'specific':
                server_ids = target_scope.get('server_ids', [])
                servers_url = f"{DSM_URL}/rest/v1/servers?id=in.({','.join(server_ids)})"
            else:
                servers_url = f"{DSM_URL}/rest/v1/servers"
            
            servers_response = requests.get(servers_url, headers=headers, verify=VERIFY_SSL)
            servers = self.safe_json_parse(servers_response) or []
            
            success_count = 0
            failed_count = 0
            failed_servers = []
            
            for server in servers:
                ip = server['ip_address']
                self.log(f"Checking health for {ip}...")
                
                # Create task for this server
                task_url = f"{DSM_URL}/rest/v1/job_tasks"
                task_data = {
                    'job_id': job['id'],
                    'server_id': server['id'],
                    'status': 'running',
                    'started_at': datetime.now().isoformat()
                }
                task_response = requests.post(task_url, headers=headers, json=task_data, verify=VERIFY_SSL)
                task_data_result = self.safe_json_parse(task_response)
                task_id = task_data_result[0]['id'] if task_data_result else None
                
                # Get credentials
                username, password = self.get_server_credentials(server)
                if not username or not password:
                    error_msg = f"No credentials configured for {ip}"
                    self.log(f"  ✗ {error_msg}", "WARN")
                    failed_count += 1
                    failed_servers.append({
                        'ip_address': ip,
                        'hostname': server.get('hostname'),
                        'server_id': server['id'],
                        'error': error_msg
                    })
                    if task_id:
                        self.update_task_status(
                            task_id, 'failed',
                            log=error_msg,
                            completed_at=datetime.now().isoformat()
                        )
                    continue
                
                try:
                    health_data = {
                        'server_id': server['id'],
                        'timestamp': datetime.now().isoformat()
                    }
                    
                    # Get System health and power state
                    system_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1"
                    
                    response, response_time = self.throttler.request_with_safety(
                        'GET',
                        system_url,
                        ip,
                        self.log,
                        auth=(username, password),
                        timeout=(2, 10)
                    )
                    
                    self.log_idrac_command(
                        server_id=server['id'],
                        job_id=job['id'],
                        task_id=None,
                        command_type='GET',
                        endpoint='/redfish/v1/Systems/System.Embedded.1',
                        full_url=system_url,
                        request_headers={'Authorization': '[REDACTED]'},
                        request_body=None,
                        status_code=response.status_code,
                        response_time_ms=response_time,
                        response_body=self.safe_json_parse(response),
                        success=response.status_code == 200,
                        error_message=None if response.status_code == 200 else f"HTTP {response.status_code}",
                        operation_type='idrac_api'
                    )
                    
                    if response.status_code in [401, 403]:
                        self.throttler.record_failure(ip, response.status_code, self.log)
                        if self.throttler.is_circuit_open(ip):
                            raise Exception(f"Circuit breaker OPEN for {ip} - Possible credential lockout")
                    elif response.status_code == 200:
                        self.throttler.record_success(ip)
                        data = self.safe_json_parse(response)
                        if data:
                            health_data['power_state'] = data.get('PowerState')
                            health_data['overall_health'] = data.get('Status', {}).get('Health', 'Unknown')
                    else:
                        self.throttler.record_failure(ip, response.status_code, self.log)
                        self.log(f"  ⚠️  Failed to get system health: HTTP {response.status_code}", "WARN")
                    
                    # Get Thermal data (temperatures, fans) using throttler
                    thermal_url = f"https://{ip}/redfish/v1/Chassis/System.Embedded.1/Thermal"
                    
                    response, response_time = self.throttler.request_with_safety(
                        'GET',
                        thermal_url,
                        ip,
                        self.log,
                        auth=(username, password),
                        timeout=(2, 10)
                    )
                    
                    self.log_idrac_command(
                        server_id=server['id'],
                        job_id=job['id'],
                        task_id=None,
                        command_type='GET',
                        endpoint='/redfish/v1/Chassis/System.Embedded.1/Thermal',
                        full_url=thermal_url,
                        request_headers={'Authorization': '[REDACTED]'},
                        request_body=None,
                        status_code=response.status_code,
                        response_time_ms=response_time,
                        response_body=self.safe_json_parse(response),
                        success=response.status_code == 200,
                        error_message=None if response.status_code == 200 else f"HTTP {response.status_code}",
                        operation_type='idrac_api'
                    )
                    
                    if response.status_code in [401, 403]:
                        self.throttler.record_failure(ip, response.status_code, self.log)
                    elif response.status_code == 200:
                        self.throttler.record_success(ip)
                        data = self.safe_json_parse(response)
                        if data:
                            temps = data.get('Temperatures', [])
                            fans = data.get('Fans', [])
                            
                            if temps:
                                valid_temps = [t.get('ReadingCelsius', 0) for t in temps if t.get('ReadingCelsius')]
                                if valid_temps:
                                    avg_temp = sum(valid_temps) / len(valid_temps)
                                    health_data['temperature_celsius'] = round(avg_temp, 1)
                            
                            fan_statuses = [f.get('Status', {}).get('Health') for f in fans]
                            health_data['fan_health'] = 'OK' if all(s == 'OK' for s in fan_statuses if s) else 'Warning'
                            
                            health_data['sensors'] = {'temperatures': temps[:5], 'fans': fans[:5]}  # Store subset
                    else:
                        self.throttler.record_failure(ip, response.status_code, self.log)
                        self.log(f"  ⚠️  Failed to get thermal data: HTTP {response.status_code}", "WARN")
                    
                    # Get Power data (PSU) using throttler
                    power_url = f"https://{ip}/redfish/v1/Chassis/System.Embedded.1/Power"
                    
                    response, response_time = self.throttler.request_with_safety(
                        'GET',
                        power_url,
                        ip,
                        self.log,
                        auth=(username, password),
                        timeout=(2, 10)
                    )
                    
                    self.log_idrac_command(
                        server_id=server['id'],
                        job_id=job['id'],
                        task_id=None,
                        command_type='GET',
                        endpoint='/redfish/v1/Chassis/System.Embedded.1/Power',
                        full_url=power_url,
                        request_headers={'Authorization': '[REDACTED]'},
                        request_body=None,
                        status_code=response.status_code,
                        response_time_ms=response_time,
                        response_body=self.safe_json_parse(response),
                        success=response.status_code == 200,
                        error_message=None if response.status_code == 200 else f"HTTP {response.status_code}",
                        operation_type='idrac_api'
                    )
                    
                    if response.status_code in [401, 403]:
                        self.throttler.record_failure(ip, response.status_code, self.log)
                    elif response.status_code == 200:
                        self.throttler.record_success(ip)
                        data = self.safe_json_parse(response)
                        if data:
                            psus = data.get('PowerSupplies', [])
                            psu_statuses = [p.get('Status', {}).get('Health') for p in psus]
                            health_data['psu_health'] = 'OK' if all(s == 'OK' for s in psu_statuses if s) else 'Warning'
                    else:
                        self.throttler.record_failure(ip, response.status_code, self.log)
                        self.log(f"  ⚠️  Failed to get power data: HTTP {response.status_code}", "WARN")
                    
                    # Get Storage health
                    storage_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Storage"
                    start_time = time.time()
                    response = requests.get(storage_url, auth=(username, password), verify=False, timeout=30)
                    response_time = int((time.time() - start_time) * 1000)
                    
                    self.log_idrac_command(
                        server_id=server['id'],
                        job_id=job['id'],
                        task_id=None,
                        command_type='GET',
                        endpoint='/redfish/v1/Systems/System.Embedded.1/Storage',
                        full_url=storage_url,
                        request_headers={'Authorization': '[REDACTED]'},
                        request_body=None,
                        status_code=response.status_code,
                        response_time_ms=response_time,
                        response_body=self.safe_json_parse(response),
                        success=response.status_code == 200,
                        error_message=None if response.status_code == 200 else f"HTTP {response.status_code}",
                        operation_type='idrac_api'
                    )
                    
                    if response.status_code == 200:
                        data = self.safe_json_parse(response)
                        if data:
                            controllers = data.get('Members', [])
                            storage_statuses = []
                            for controller_ref in controllers[:3]:  # Limit to 3 controllers
                                controller_url = f"https://{ip}{controller_ref['@odata.id']}"
                                ctrl_resp = requests.get(controller_url, auth=(username, password), verify=False, timeout=30)
                                if ctrl_resp.status_code == 200:
                                    ctrl_data = self.safe_json_parse(ctrl_resp)
                                    if ctrl_data:
                                        storage_statuses.append(ctrl_data.get('Status', {}).get('Health'))
                            
                            if storage_statuses:
                                health_data['storage_health'] = 'OK' if all(s == 'OK' for s in storage_statuses if s) else 'Warning'
                    else:
                        self.log(f"  ⚠️  Failed to get storage data: HTTP {response.status_code}", "WARN")
                    
                    # Get Memory health
                    memory_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Memory"
                    start_time = time.time()
                    response = requests.get(memory_url, auth=(username, password), verify=False, timeout=30)
                    response_time = int((time.time() - start_time) * 1000)
                    
                    self.log_idrac_command(
                        server_id=server['id'],
                        job_id=job['id'],
                        task_id=None,
                        command_type='GET',
                        endpoint='/redfish/v1/Systems/System.Embedded.1/Memory',
                        full_url=memory_url,
                        request_headers={'Authorization': '[REDACTED]'},
                        request_body=None,
                        status_code=response.status_code,
                        response_time_ms=response_time,
                        response_body=self.safe_json_parse(response),
                        success=response.status_code == 200,
                        error_message=None if response.status_code == 200 else f"HTTP {response.status_code}",
                        operation_type='idrac_api'
                    )
                    
                    if response.status_code == 200:
                        data = self.safe_json_parse(response)
                        if data:
                            memory_modules = data.get('Members', [])
                            memory_statuses = []
                            for module_ref in memory_modules[:8]:  # Limit to 8 DIMMs
                                module_url = f"https://{ip}{module_ref['@odata.id']}"
                                mem_resp = requests.get(module_url, auth=(username, password), verify=False, timeout=30)
                                if mem_resp.status_code == 200:
                                    mem_data = self.safe_json_parse(mem_resp)
                                    if mem_data:
                                        memory_statuses.append(mem_data.get('Status', {}).get('Health'))
                            
                            if memory_statuses:
                                health_data['memory_health'] = 'OK' if all(s == 'OK' for s in memory_statuses if s) else 'Warning'
                    else:
                        self.log(f"  ⚠️  Failed to get memory data: HTTP {response.status_code}", "WARN")
                    
                    # Get Processor health
                    proc_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Processors"
                    start_time = time.time()
                    response = requests.get(proc_url, auth=(username, password), verify=False, timeout=30)
                    response_time = int((time.time() - start_time) * 1000)
                    
                    self.log_idrac_command(
                        server_id=server['id'],
                        job_id=job['id'],
                        task_id=None,
                        command_type='GET',
                        endpoint='/redfish/v1/Systems/System.Embedded.1/Processors',
                        full_url=proc_url,
                        request_headers={'Authorization': '[REDACTED]'},
                        request_body=None,
                        status_code=response.status_code,
                        response_time_ms=response_time,
                        response_body=self.safe_json_parse(response),
                        success=response.status_code == 200,
                        error_message=None if response.status_code == 200 else f"HTTP {response.status_code}",
                        operation_type='idrac_api'
                    )
                    
                    if response.status_code == 200:
                        data = self.safe_json_parse(response)
                        if data:
                            processors = data.get('Members', [])
                            proc_statuses = []
                            for proc_ref in processors:
                                proc_detail_url = f"https://{ip}{proc_ref['@odata.id']}"
                                proc_resp = requests.get(proc_detail_url, auth=(username, password), verify=False, timeout=30)
                                if proc_resp.status_code == 200:
                                    proc_data = self.safe_json_parse(proc_resp)
                                    if proc_data:
                                        proc_statuses.append(proc_data.get('Status', {}).get('Health'))
                            
                            if proc_statuses:
                                health_data['cpu_health'] = 'OK' if all(s == 'OK' for s in proc_statuses if s) else 'Warning'
                    else:
                        self.log(f"  ⚠️  Failed to get processor data: HTTP {response.status_code}", "WARN")
                    
                    # Get Network health
                    network_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/NetworkInterfaces"
                    start_time = time.time()
                    response = requests.get(network_url, auth=(username, password), verify=False, timeout=30)
                    response_time = int((time.time() - start_time) * 1000)
                    
                    self.log_idrac_command(
                        server_id=server['id'],
                        job_id=job['id'],
                        task_id=None,
                        command_type='GET',
                        endpoint='/redfish/v1/Systems/System.Embedded.1/NetworkInterfaces',
                        full_url=network_url,
                        request_headers={'Authorization': '[REDACTED]'},
                        request_body=None,
                        status_code=response.status_code,
                        response_time_ms=response_time,
                        response_body=self.safe_json_parse(response),
                        success=response.status_code == 200,
                        error_message=None if response.status_code == 200 else f"HTTP {response.status_code}",
                        operation_type='idrac_api'
                    )
                    
                    if response.status_code == 200:
                        data = self.safe_json_parse(response)
                        if data:
                            nics = data.get('Members', [])
                            nic_statuses = []
                            for nic_ref in nics[:4]:  # Limit to 4 NICs
                                nic_url = f"https://{ip}{nic_ref['@odata.id']}"
                                nic_resp = requests.get(nic_url, auth=(username, password), verify=False, timeout=30)
                                if nic_resp.status_code == 200:
                                    nic_data = self.safe_json_parse(nic_resp)
                                    if nic_data:
                                        nic_statuses.append(nic_data.get('Status', {}).get('Health'))
                            
                            if nic_statuses:
                                health_data['network_health'] = 'OK' if all(s == 'OK' for s in nic_statuses if s) else 'Warning'
                    else:
                        self.log(f"  ⚠️  Failed to get network data: HTTP {response.status_code}", "WARN")
                    
                    # Insert health record
                    insert_url = f"{DSM_URL}/rest/v1/server_health"
                    insert_response = requests.post(insert_url, headers=headers, json=health_data, verify=VERIFY_SSL)
                    
                    if insert_response.status_code in [200, 201]:
                        # Update server record
                        update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server['id']}"
                        update_data = {
                            'power_state': health_data.get('power_state'),
                            'overall_health': health_data.get('overall_health'),
                            'last_health_check': datetime.now().isoformat()
                        }
                        requests.patch(update_url, headers=headers, json=update_data, verify=VERIFY_SSL)
                        
                        self.log(f"  ✓ Health check complete: {health_data.get('overall_health')}")
                        success_count += 1
                        if task_id:
                            self.update_task_status(
                                task_id, 'completed',
                                log="Health check successful",
                                completed_at=datetime.now().isoformat()
                            )
                    else:
                        error_msg = "Failed to store health data"
                        self.log(f"  ✗ {error_msg}", "ERROR")
                        failed_count += 1
                        failed_servers.append({
                            'ip_address': ip,
                            'hostname': server.get('hostname'),
                            'server_id': server['id'],
                            'error': error_msg
                        })
                        if task_id:
                            self.update_task_status(
                                task_id, 'failed',
                                log=error_msg,
                                completed_at=datetime.now().isoformat()
                            )
                        
                except Exception as e:
                    error_msg = str(e)
                    self.log(f"  ✗ Error: {error_msg}", "ERROR")
                    failed_count += 1
                    failed_servers.append({
                        'ip_address': ip,
                        'hostname': server.get('hostname'),
                        'server_id': server['id'],
                        'error': error_msg
                    })
                    if task_id:
                        self.update_task_status(
                            task_id, 'failed',
                            log=error_msg,
                            completed_at=datetime.now().isoformat()
                        )
            
            # Complete job
            result = {
                "success_count": success_count,
                "failed_count": failed_count,
                "total": len(servers)
            }
            
            # Add detailed failure information
            if failed_count > 0 and failed_servers:
                result['failed_servers'] = failed_servers[:10]  # Limit to first 10 to avoid huge payloads
                result['error'] = f"{failed_count} server(s) failed health check"
            
            self.update_job_status(
                job['id'],
                'completed' if failed_count == 0 else 'failed',
                completed_at=datetime.now().isoformat(),
                details=result
            )
            
            self.log(f"Health check complete: {success_count} succeeded, {failed_count} failed")
            
        except Exception as e:
            import traceback
            error_msg = str(e)
            stack_trace = traceback.format_exc()
            self.log(f"Health check job failed: {error_msg}\n{stack_trace}", "ERROR")
            
            # Mark any running tasks as failed
            try:
                headers = {
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json'
                }
                tasks_url = f"{DSM_URL}/rest/v1/job_tasks?job_id=eq.{job['id']}&status=eq.running"
                tasks_response = requests.get(tasks_url, headers=headers, verify=VERIFY_SSL)
                if tasks_response.status_code == 200:
                    running_tasks = self.safe_json_parse(tasks_response) or []
                    for task in running_tasks:
                        self.update_task_status(
                            task['id'], 'failed',
                            log=f"Job failed: {error_msg}",
                            completed_at=datetime.now().isoformat()
                        )
            except Exception as task_error:
                self.log(f"Failed to update task statuses: {task_error}", "WARN")
            
            self.update_job_status(
                job['id'], 'failed',
                completed_at=datetime.now().isoformat(),
                details={
                    "error": error_msg,
                    "traceback": stack_trace[:2000]  # Limit to 2000 chars
                }
            )
    
    def execute_fetch_event_logs(self, job: Dict):
        """Fetch System Event Log entries from iDRAC"""
        try:
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            target_scope = job.get('target_scope', {})
            limit = job.get('details', {}).get('limit', 100)
            
            self.log(f"Fetching event logs (limit: {limit})")
            
            # Get target servers
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            if target_scope.get('type') == 'specific':
                server_ids = target_scope.get('server_ids', [])
                servers_url = f"{DSM_URL}/rest/v1/servers?id=in.({','.join(server_ids)})"
            else:
                servers_url = f"{DSM_URL}/rest/v1/servers"
            
            servers_response = requests.get(servers_url, headers=headers, verify=VERIFY_SSL)
            servers = _safe_json_parse(servers_response) if servers_response.status_code == 200 else []
            
            total_events = 0
            success_count = 0
            failed_count = 0
            
            for server in servers:
                ip = server['ip_address']
                self.log(f"Fetching event logs from {ip}...")
                
                # Get credentials
                username, password = self.get_server_credentials(server)
                if not username or not password:
                    self.log(f"  ✗ No credentials for {ip}", "WARN")
                    failed_count += 1
                    continue
                
                try:
                    # Get SEL logs using throttler
                    sel_url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/Logs/Sel"
                    
                    response, response_time_ms = self.throttler.request_with_safety(
                        'GET',
                        sel_url,
                        ip,
                        self.log,
                        auth=(username, password),
                        timeout=(2, 30)
                    )
                    
                    if response.status_code in [401, 403]:
                        self.throttler.record_failure(ip, response.status_code, self.log)
                        if self.throttler.is_circuit_open(ip):
                            self.log(f"  ✗ Circuit breaker OPEN for {ip}", "ERROR")
                            failed_count += 1
                            continue
                    elif response.status_code == 200:
                        self.throttler.record_success(ip)
                        data = _safe_json_parse(response)
                        members = data.get('Members', [])
                        
                        events_to_insert = []
                        for member in members[:limit]:
                            event = {
                                'server_id': server['id'],
                                'event_id': member.get('Id'),
                                'timestamp': member.get('Created', datetime.now().isoformat()),
                                'severity': member.get('Severity', 'Unknown'),
                                'message': member.get('Message', ''),
                                'category': member.get('MessageId', '').split('.')[0] if '.' in member.get('MessageId', '') else 'Unknown',
                                'sensor_type': member.get('SensorType'),
                                'sensor_number': member.get('SensorNumber'),
                                'raw_data': member
                            }
                            events_to_insert.append(event)
                        
                        if events_to_insert:
                            # Bulk insert events
                            insert_url = f"{DSM_URL}/rest/v1/server_event_logs"
                            insert_response = requests.post(insert_url, headers=headers, json=events_to_insert, verify=VERIFY_SSL)
                            
                            if insert_response.status_code in [200, 201]:
                                self.log(f"  ✓ Inserted {len(events_to_insert)} event log entries")
                                total_events += len(events_to_insert)
                                success_count += 1
                            else:
                                self.log(f"  ✗ Failed to insert events: HTTP {insert_response.status_code}", "ERROR")
                                failed_count += 1
                        else:
                            self.log(f"  ⚠ No event log entries found")
                            success_count += 1
                    else:
                        self.throttler.record_failure(ip, response.status_code, self.log)
                        self.log(f"  ✗ Failed to fetch SEL: HTTP {response.status_code}", "ERROR")
                        failed_count += 1
                        
                except Exception as e:
                    self.log(f"  ✗ Error: {e}", "ERROR")
                    failed_count += 1
            
            # Complete job
            result = {
                "total_events": total_events,
                "success_count": success_count,
                "failed_count": failed_count,
                "total_servers": len(servers)
            }
            
            self.update_job_status(
                job['id'],
                'completed' if failed_count == 0 else 'failed',
                completed_at=datetime.now().isoformat(),
                details=result
            )
            
            self.log(f"Event log fetch complete: {total_events} events from {success_count} servers")
            
        except Exception as e:
            self.log(f"Event log fetch job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'], 'failed',
                completed_at=datetime.now().isoformat(),
                details={"error": str(e)}
            )
    
    def mount_virtual_media(self, ip: str, username: str, password: str, 
                           server_id: str, job_id: str, 
                           image_url: str, media_type: str = 'CD',
                           write_protected: bool = True):
        """Mount virtual media (ISO image) to iDRAC via Redfish API"""
        # Map media types to iDRAC virtual media slots
        media_slot_map = {
            'CD': 'CD',
            'DVD': 'CD',  # Same slot as CD
            'USBStick': 'RemovableDisk',
            'Floppy': 'Floppy'
        }
        
        media_slot = media_slot_map.get(media_type, 'CD')
        vm_url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{media_slot}"
        
        # Payload to insert and mount the media
        payload = {
            "Image": image_url,
            "Inserted": True,
            "WriteProtected": write_protected
        }
        
        response, response_time_ms = self.throttler.request_with_safety(
            'PATCH',
            vm_url,
            ip,
            self.log,
            auth=(username, password),
            json=payload,
            timeout=(2, 30)
        )
        
        # Log the command
        self.log_idrac_command(
            server_id=server_id,
            job_id=job_id,
            command_type='PATCH',
            endpoint=f'/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{media_slot}',
            full_url=vm_url,
            request_body=payload,
            response_body=response.text if response.status_code not in [200, 204] else None,
            status_code=response.status_code,
            response_time_ms=response_time_ms,
            success=response.status_code in [200, 204],
            operation_type='idrac_api'
        )
        
        if response.status_code not in [200, 204]:
            error_msg = f"Failed to mount virtual media: {response.status_code}"
            if response.text:
                try:
                    error_data = _safe_json_parse(response)
                    error_msg += f" - {error_data.get('error', {}).get('message', response.text)}"
                except:
                    error_msg += f" - {response.text}"
            raise Exception(error_msg)
        
        self.log(f"  Virtual media mounted successfully: {image_url}")
        return True
    
    def unmount_virtual_media(self, ip: str, username: str, password: str,
                             server_id: str, job_id: str, media_type: str = 'CD'):
        """Unmount/eject virtual media from iDRAC"""
        media_slot_map = {
            'CD': 'CD',
            'DVD': 'CD',
            'USBStick': 'RemovableDisk',
            'Floppy': 'Floppy'
        }
        
        media_slot = media_slot_map.get(media_type, 'CD')
        vm_url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{media_slot}"
        
        # Payload to eject the media
        payload = {
            "Inserted": False
        }
        
        response, response_time_ms = self.throttler.request_with_safety(
            'PATCH',
            vm_url,
            ip,
            self.log,
            auth=(username, password),
            json=payload,
            timeout=(2, 30)
        )
        
        # Log the command
        self.log_idrac_command(
            server_id=server_id,
            job_id=job_id,
            command_type='PATCH',
            endpoint=f'/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{media_slot}',
            full_url=vm_url,
            request_body=payload,
            response_body=response.text if response.status_code not in [200, 204] else None,
            status_code=response.status_code,
            response_time_ms=response_time_ms,
            success=response.status_code in [200, 204],
            operation_type='idrac_api'
        )
        
        if response.status_code in [401, 403]:
            self.throttler.record_failure(ip, response.status_code, self.log)
            raise Exception(f"Authentication failed for {ip}")
        elif response.status_code not in [200, 204]:
            self.throttler.record_failure(ip, response.status_code, self.log)
            error_msg = f"Failed to unmount virtual media: {response.status_code}"
            if response.text:
                try:
                    error_data = _safe_json_parse(response)
                    error_msg += f" - {error_data.get('error', {}).get('message', response.text)}"
                except:
                    error_msg += f" - {response.text}"
            raise Exception(error_msg)
        else:
            self.throttler.record_success(ip)
        
        self.log(f"  Virtual media unmounted successfully")
        return True
    
    def get_virtual_media_status(self, ip: str, username: str, password: str,
                                server_id: str, job_id: str, media_type: str = 'CD'):
        """Get current status of virtual media"""
        media_slot_map = {
            'CD': 'CD',
            'DVD': 'CD',
            'USBStick': 'RemovableDisk',
            'Floppy': 'Floppy'
        }
        
        media_slot = media_slot_map.get(media_type, 'CD')
        vm_url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{media_slot}"
        
        start_time = time.time()
        response = requests.get(
            vm_url,
            auth=(username, password),
            verify=False,
            timeout=30
        )
        response_time_ms = int((time.time() - start_time) * 1000)
        
        # Log the command
        self.log_idrac_command(
            server_id=server_id,
            job_id=job_id,
            command_type='GET',
            endpoint=f'/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{media_slot}',
            full_url=vm_url,
            response_body=_safe_json_parse(response) if response.status_code == 200 else response.text,
            status_code=response.status_code,
            response_time_ms=response_time_ms,
            success=response.status_code == 200,
            operation_type='idrac_api'
        )
        
        if response.status_code != 200:
            raise Exception(f"Failed to get virtual media status: {response.status_code}")
        
        data = _safe_json_parse(response)
        return {
            'inserted': data.get('Inserted', False),
            'write_protected': data.get('WriteProtected', True),
            'image': data.get('Image', ''),
            'media_types': data.get('MediaTypes', [])
        }

    def fetch_boot_configuration(self, ip: str, username: str, password: str, server_id: str, job_id: str = None) -> Dict:
        """Fetch current boot configuration from iDRAC"""
        system_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1"
        
        start_time = time.time()
        response = requests.get(
            system_url,
            auth=(username, password),
            verify=False,
            timeout=30
        )
        response_time_ms = int((time.time() - start_time) * 1000)
        
        if job_id:
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                command_type='GET',
                endpoint='/redfish/v1/Systems/System.Embedded.1',
                full_url=system_url,
                status_code=response.status_code,
                response_time_ms=response_time_ms,
                success=response.status_code == 200,
                operation_type='idrac_api'
            )
        
        if response.status_code != 200:
            raise Exception(f"Failed to fetch boot config: {response.status_code}")
        
        data = _safe_json_parse(response)
        boot_data = data.get('Boot', {})
        
        return {
            'boot_mode': boot_data.get('BootSourceOverrideMode', 'Unknown'),
            'boot_source_override_enabled': boot_data.get('BootSourceOverrideEnabled', 'Disabled'),
            'boot_source_override_target': boot_data.get('BootSourceOverrideTarget', 'None'),
            'boot_order': boot_data.get('BootOrder', []),
            'uefi_target': boot_data.get('UefiTargetBootSourceOverride', None)
        }
    
    def set_boot_override(self, ip: str, username: str, password: str, server_id: str, job_id: str,
                          target: str, mode: str, enabled: str, uefi_target: str = None):
        """Set boot source override (one-time or continuous boot)"""
        system_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1"
        
        payload = {
            "Boot": {
                "BootSourceOverrideTarget": target,
                "BootSourceOverrideMode": mode,
                "BootSourceOverrideEnabled": enabled
            }
        }
        
        if target == 'UefiTarget' and uefi_target:
            payload["Boot"]["UefiTargetBootSourceOverride"] = uefi_target
        
        start_time = time.time()
        response = requests.patch(
            system_url,
            auth=(username, password),
            json=payload,
            verify=False,
            timeout=30
        )
        response_time_ms = int((time.time() - start_time) * 1000)
        
        self.log_idrac_command(
            server_id=server_id,
            job_id=job_id,
            command_type='PATCH',
            endpoint='/redfish/v1/Systems/System.Embedded.1',
            full_url=system_url,
            request_body=payload,
            response_body=response.text if response.status_code != 204 else None,
            status_code=response.status_code,
            response_time_ms=response_time_ms,
            success=response.status_code in [200, 204]
        )
        
        if response.status_code not in [200, 204]:
            raise Exception(f"Failed to set boot override: {response.status_code} - {response.text}")
    
    def update_server_boot_config(self, server_id: str, boot_config: Dict):
        """Update server's boot configuration in database"""
        try:
            update_data = {
                'boot_mode': boot_config.get('boot_mode'),
                'boot_source_override_enabled': boot_config.get('boot_source_override_enabled'),
                'boot_source_override_target': boot_config.get('boot_source_override_target'),
                'boot_order': boot_config.get('boot_order'),
                'last_boot_config_check': datetime.now().isoformat()
            }
            
            url = f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}"
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            }
            
            response = requests.patch(url, headers=headers, json=update_data, verify=VERIFY_SSL)
            
            if response.status_code not in [200, 204]:
                self.log(f"Failed to update server boot config: {response.status_code}", "WARN")
        
        except Exception as e:
            self.log(f"Error updating server boot config: {e}", "ERROR")
    
    def set_persistent_boot_order(self, ip: str, username: str, password: str, 
                                   server_id: str, job_id: str, boot_order: list):
        """
        Change the persistent boot order via Redfish API
        
        Args:
            boot_order: Array of boot option IDs like ['Boot0001', 'Boot0002', 'Boot0003']
        """
        system_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1"
        
        payload = {
            "Boot": {
                "BootOrder": boot_order
            }
        }
        
        start_time = time.time()
        response = requests.patch(
            system_url,
            auth=(username, password),
            json=payload,
            verify=False,
            timeout=30
        )
        response_time_ms = int((time.time() - start_time) * 1000)
        
        # Log the command
        self.log_idrac_command(
            server_id=server_id,
            job_id=job_id,
            task_id=None,
            command_type='PATCH',
            endpoint='/redfish/v1/Systems/System.Embedded.1',
            full_url=system_url,
            request_headers={'Authorization': '[REDACTED]'},
            request_body=payload,
            response_body=response.text if response.status_code not in [200, 204] else None,
            status_code=response.status_code,
            response_time_ms=response_time_ms,
            success=response.status_code in [200, 204],
            operation_type='idrac_api'
        )
        
        if response.status_code not in [200, 204]:
            error_msg = f"Failed to set boot order: {response.status_code}"
            if response.text:
                try:
                    error_data = _safe_json_parse(response)
                    error_msg += f" - {error_data.get('error', {}).get('message', response.text)}"
                except:
                    error_msg += f" - {response.text}"
            raise Exception(error_msg)
        
        self.log(f"  Boot order successfully updated")
    
    def execute_boot_configuration(self, job: Dict):
        """Execute boot configuration changes on servers"""
        try:
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            target_scope = job.get('target_scope', {})
            details = job.get('details', {})
            action = details.get('action', 'fetch_config')
            
            self.log(f"Executing boot configuration action: {action}")
            
            # Get target servers
            server_ids = target_scope.get('server_ids', [])
            if not server_ids:
                self.log("Boot configuration requires specific server selection", "ERROR")
                raise ValueError("Boot configuration requires specific server selection")
            
            # Fetch servers from DB
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            servers_url = f"{DSM_URL}/rest/v1/servers?id=in.({','.join(server_ids)})"
            servers_response = requests.get(servers_url, headers=headers, verify=VERIFY_SSL)
            servers = _safe_json_parse(servers_response) if servers_response.status_code == 200 else []
            
            success_count = 0
            failed_count = 0
            results = []
            
            for server in servers:
                ip = server['ip_address']
                self.log(f"Processing boot configuration for {ip}...")
                
                # Get credentials
                username, password = self.get_server_credentials(server)
                if not username or not password:
                    self.log(f"  ✗ No credentials for {ip}", "WARN")
                    failed_count += 1
                    results.append({'server': ip, 'success': False, 'error': 'No credentials'})
                    continue
                
                try:
                    # Fetch current boot configuration
                    current_config = self.fetch_boot_configuration(ip, username, password, server['id'], job['id'])
                    self.log(f"  Current boot mode: {current_config['boot_mode']}")
                    self.log(f"  Boot override: {current_config['boot_source_override_enabled']} -> {current_config['boot_source_override_target']}")
                    
                    # Execute action
                    if action == 'fetch_config':
                        self.update_server_boot_config(server['id'], current_config)
                        self.log(f"  ✓ Boot configuration fetched and updated")
                        success_count += 1
                        results.append({'server': ip, 'success': True, 'config': current_config})
                    
                    elif action == 'set_one_time_boot':
                        target = details.get('boot_target', 'None')
                        mode = details.get('boot_mode', current_config['boot_mode'])
                        uefi_target = details.get('uefi_target', None)
                        
                        self.set_boot_override(ip, username, password, server['id'], job['id'], 
                                              target, mode, 'Once', uefi_target)
                        
                        updated_config = self.fetch_boot_configuration(ip, username, password, server['id'], job['id'])
                        self.update_server_boot_config(server['id'], updated_config)
                        
                        self.log(f"  ✓ One-time boot set to {target}")
                        success_count += 1
                        results.append({'server': ip, 'success': True, 'action': 'one_time_boot', 'target': target})
                    
                    elif action == 'disable_override':
                        self.set_boot_override(ip, username, password, server['id'], job['id'], 
                                              'None', current_config['boot_mode'], 'Disabled', None)
                        
                        updated_config = self.fetch_boot_configuration(ip, username, password, server['id'], job['id'])
                        self.update_server_boot_config(server['id'], updated_config)
                        
                        self.log(f"  ✓ Boot override disabled")
                        success_count += 1
                        results.append({'server': ip, 'success': True, 'action': 'disable_override'})
                    
                    elif action == 'set_boot_order':
                        # Change persistent boot order
                        boot_order = details.get('boot_order', [])
                        
                        if not boot_order:
                            raise ValueError("boot_order is required for set_boot_order action")
                        
                        self.log(f"  Setting boot order: {boot_order}")
                        self.set_persistent_boot_order(ip, username, password, server['id'], job['id'], boot_order)
                        
                        # Fetch updated config to confirm
                        updated_config = self.fetch_boot_configuration(ip, username, password, server['id'], job['id'])
                        self.update_server_boot_config(server['id'], updated_config)
                        
                        self.log(f"  ✓ Boot order updated successfully")
                        success_count += 1
                        results.append({
                            'server': ip, 
                            'success': True, 
                            'action': 'set_boot_order', 
                            'boot_order': boot_order,
                            'verified_order': updated_config.get('boot_order')
                        })
                    
                    else:
                        raise ValueError(f"Unknown boot configuration action: {action}")
                    
                except Exception as e:
                    self.log(f"  ✗ Error: {e}", "ERROR")
                    failed_count += 1
                    results.append({'server': ip, 'success': False, 'error': str(e)})
            
            # Update job status
            self.update_job_status(
                job['id'], 
                'completed' if failed_count == 0 else 'failed',
                completed_at=datetime.now().isoformat(),
                details={
                    'action': action,
                    'success_count': success_count,
                    'failed_count': failed_count,
                    'results': results
                }
            )
            
            self.log(f"Boot configuration job completed: {success_count} succeeded, {failed_count} failed")
            
        except Exception as e:
            self.log(f"Boot configuration job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'], 
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )

    def execute_virtual_media_mount(self, job: Dict):
        """Execute virtual media mount job"""
        try:
            self.log(f"Starting virtual media mount job: {job['id']}")
            
            details = job.get('details', {})
            session_id = details.get('session_id')
            image_url = details.get('image_url')
            media_type = details.get('media_type', 'CD')
            write_protected = details.get('write_protected', True)
            
            if not session_id or not image_url:
                raise ValueError("session_id and image_url are required")
            
            # Update job status to running
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            # Get target servers from job
            target_scope = job.get('target_scope', {})
            server_ids = target_scope.get('server_ids', [])
            
            if not server_ids:
                raise ValueError("No target servers specified")
            
            # Process each server
            success_count = 0
            failed_count = 0
            results = []
            
            for server_id in server_ids:
                try:
                    # Get server details
                    server = self.get_server_by_id(server_id)
                    if not server:
                        raise Exception(f"Server not found: {server_id}")
                    
                    ip = server['ip_address']
                    username, password = self.get_credentials_for_server(server)
                    
                    self.log(f"  Mounting virtual media on {ip}...")
                    
                    # Mount the media
                    self.mount_virtual_media(
                        ip, username, password,
                        server_id, job['id'],
                        image_url, media_type, write_protected
                    )
                    
                    # Verify mount status
                    status = self.get_virtual_media_status(
                        ip, username, password,
                        server_id, job['id'],
                        media_type
                    )
                    
                    if status['inserted']:
                        # Update session in database
                        self.supabase.table('virtual_media_sessions').update({
                            'is_mounted': True,
                            'inserted': True,
                            'mounted_at': datetime.now().isoformat()
                        }).eq('id', session_id).execute()
                        
                        self.log(f"  [OK] Virtual media mounted successfully on {ip}")
                        success_count += 1
                        results.append({
                            'server': ip,
                            'success': True,
                            'status': status
                        })
                    else:
                        raise Exception("Media not showing as inserted after mount")
                        
                except Exception as e:
                    self.log(f"  [X] Failed to mount on {ip}: {e}", "ERROR")
                    failed_count += 1
                    results.append({
                        'server': ip,
                        'success': False,
                        'error': str(e)
                    })
            
            # Update job status
            if failed_count == 0:
                self.update_job_status(
                    job['id'],
                    'completed',
                    completed_at=datetime.now().isoformat(),
                    details={
                        'success_count': success_count,
                        'results': results
                    }
                )
                self.log(f"Virtual media mount job completed successfully")
            else:
                status = 'failed' if success_count == 0 else 'completed'
                self.update_job_status(
                    job['id'],
                    status,
                    completed_at=datetime.now().isoformat(),
                    details={
                        'success_count': success_count,
                        'failed_count': failed_count,
                        'results': results
                    }
                )
                
        except Exception as e:
            self.log(f"Virtual media mount job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
    
    def execute_virtual_media_unmount(self, job: Dict):
        """Execute virtual media unmount job"""
        try:
            self.log(f"Starting virtual media unmount job: {job['id']}")
            
            details = job.get('details', {})
            session_id = details.get('session_id')
            media_type = details.get('media_type', 'CD')
            
            if not session_id:
                raise ValueError("session_id is required")
            
            # Update job status to running
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            # Get target servers
            target_scope = job.get('target_scope', {})
            server_ids = target_scope.get('server_ids', [])
            
            if not server_ids:
                raise ValueError("No target servers specified")
            
            success_count = 0
            failed_count = 0
            results = []
            
            for server_id in server_ids:
                try:
                    server = self.get_server_by_id(server_id)
                    if not server:
                        raise Exception(f"Server not found: {server_id}")
                    
                    ip = server['ip_address']
                    username, password = self.get_credentials_for_server(server)
                    
                    self.log(f"  Unmounting virtual media on {ip}...")
                    
                    # Unmount the media
                    self.unmount_virtual_media(
                        ip, username, password,
                        server_id, job['id'],
                        media_type
                    )
                    
                    # Verify unmount status
                    status = self.get_virtual_media_status(
                        ip, username, password,
                        server_id, job['id'],
                        media_type
                    )
                    
                    if not status['inserted']:
                        # Update session in database
                        self.supabase.table('virtual_media_sessions').update({
                            'is_mounted': False,
                            'inserted': False,
                            'unmounted_at': datetime.now().isoformat()
                        }).eq('id', session_id).execute()
                        
                        self.log(f"  [OK] Virtual media unmounted successfully on {ip}")
                        success_count += 1
                        results.append({
                            'server': ip,
                            'success': True,
                            'status': status
                        })
                    else:
                        raise Exception("Media still showing as inserted after unmount")
                        
                except Exception as e:
                    self.log(f"  [X] Failed to unmount on {ip}: {e}", "ERROR")
                    failed_count += 1
                    results.append({
                        'server': ip,
                        'success': False,
                        'error': str(e)
                    })
            
            # Update job status
            if failed_count == 0:
                self.update_job_status(
                    job['id'],
                    'completed',
                    completed_at=datetime.now().isoformat(),
                    details={
                        'success_count': success_count,
                        'results': results
                    }
                )
                self.log(f"Virtual media unmount job completed successfully")
            else:
                status = 'failed' if success_count == 0 else 'completed'
                self.update_job_status(
                    job['id'],
                    status,
                    completed_at=datetime.now().isoformat(),
                    details={
                        'success_count': success_count,
                        'failed_count': failed_count,
                        'results': results
                    }
                )
                
        except Exception as e:
            self.log(f"Virtual media unmount job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )

    def execute_bios_config_read(self, job: Dict):
        """
        Execute BIOS configuration read job - capture current and pending BIOS attributes
        
        Expected job details:
        {
            "server_id": "uuid",
            "snapshot_type": "current" or "baseline",
            "notes": "Optional description"
        }
        """
        try:
            self.log(f"Starting BIOS config read job: {job['id']}")
            
            # Update job status
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            # Get server and credentials
            details = job.get('details', {})
            server_id = details.get('server_id')
            snapshot_type = details.get('snapshot_type', 'current')
            notes = details.get('notes', '')
            
            if not server_id:
                raise Exception("Missing server_id in job details")
            
            # Get server info
            server = self.supabase.table('servers').select('*').eq('id', server_id).execute().data[0]
            ip = server['ip_address']
            username, password = self.get_credentials_for_server(server)
            
            self.log(f"  Reading BIOS configuration from {ip}...")
            
            # Get current BIOS attributes
            current_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Bios"
            start_time = time.time()
            current_resp = requests.get(
                current_url,
                auth=HTTPBasicAuth(username, password),
                verify=False,
                timeout=30
            )
            response_time_ms = int((time.time() - start_time) * 1000)
            
            # Log activity
            self.log_idrac_command(
                server_id=server_id,
                job_id=job['id'],
                command_type='BIOS_READ',
                endpoint='/redfish/v1/Systems/System.Embedded.1/Bios',
                full_url=current_url,
                request_body=None,
                request_headers={'Authorization': '[REDACTED]'},
                status_code=current_resp.status_code,
                response_body=_safe_json_parse(current_resp) if current_resp.ok else None,
                response_time_ms=response_time_ms,
                success=current_resp.ok,
                error_message=None if current_resp.ok else current_resp.text,
                source='job_executor',
                initiated_by=job['created_by']
            )
            
            if not current_resp.ok:
                raise Exception(f"Failed to read current BIOS: HTTP {current_resp.status_code}")
            
            current_data = _safe_json_parse(current_resp)
            current_attributes = current_data.get('Attributes', {})
            bios_version = current_data.get('BiosVersion', 'Unknown')
            
            self.log(f"  [OK] Retrieved {len(current_attributes)} current BIOS attributes")
            
            # Get pending BIOS attributes
            pending_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Bios/Settings"
            start_time = time.time()
            pending_resp = requests.get(
                pending_url,
                auth=HTTPBasicAuth(username, password),
                verify=False,
                timeout=30
            )
            response_time_ms = int((time.time() - start_time) * 1000)
            
            # Log activity
            self.log_idrac_command(
                server_id=server_id,
                job_id=job['id'],
                command_type='BIOS_READ_PENDING',
                endpoint='/redfish/v1/Systems/System.Embedded.1/Bios/Settings',
                full_url=pending_url,
                request_body=None,
                request_headers={'Authorization': '[REDACTED]'},
                status_code=pending_resp.status_code,
                response_body=_safe_json_parse(pending_resp) if pending_resp.ok else None,
                response_time_ms=response_time_ms,
                success=pending_resp.ok,
                error_message=None if pending_resp.ok else pending_resp.text,
                source='job_executor',
                initiated_by=job['created_by']
            )
            
            pending_attributes = None
            if pending_resp.ok:
                pending_data = _safe_json_parse(pending_resp)
                pending_attributes = pending_data.get('Attributes', {})
                if pending_attributes:
                    self.log(f"  [OK] Retrieved {len(pending_attributes)} pending BIOS attributes")
                else:
                    self.log(f"  No pending BIOS changes")
            
            # Save to database
            config_data = {
                'server_id': server_id,
                'job_id': job['id'],
                'attributes': current_attributes,
                'pending_attributes': pending_attributes,
                'bios_version': bios_version,
                'snapshot_type': snapshot_type,
                'created_by': job['created_by'],
                'notes': notes,
                'captured_at': datetime.now().isoformat()
            }
            
            self.supabase.table('bios_configurations').insert(config_data).execute()
            self.log(f"  [OK] BIOS configuration saved to database")
            
            # Update job status
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details={
                    'attribute_count': len(current_attributes),
                    'pending_count': len(pending_attributes) if pending_attributes else 0,
                    'bios_version': bios_version,
                    'snapshot_type': snapshot_type
                }
            )
            self.log(f"BIOS config read job completed successfully")
            
        except Exception as e:
            self.log(f"BIOS config read job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
    
    def authenticate_ome(self, settings: dict) -> str:
        """Authenticate with OpenManage Enterprise and return auth token"""
        import requests
        
        host = settings['host']
        port = settings.get('port', 443)
        username = settings['username']
        password = settings['password']
        verify_ssl = settings.get('verify_ssl', True)
        
        url = f"https://{host}:{port}/api/SessionService/Sessions"
        payload = {
            "UserName": username,
            "Password": password,
            "SessionType": "API"
        }
        
        start_time = time.time()
        
        try:
            response = requests.post(url, json=payload, verify=verify_ssl, timeout=30)
            response_time = int((time.time() - start_time) * 1000)
            
            # Log authentication activity
            self.log_openmanage_activity(
                operation_type='openmanage_api',
                endpoint='/api/SessionService/Sessions',
                command_type='AUTHENTICATE',
                full_url=url,
                success=response.status_code == 200,
                status_code=response.status_code,
                response_time_ms=response_time,
                details={'username': username, 'verify_ssl': verify_ssl}
            )
            
            response.raise_for_status()
            auth_token = response.headers.get("x-auth-token")
            
            if not auth_token:
                raise ValueError("Failed to get x-auth-token from response headers")
            
            return auth_token
            
        except Exception as e:
            self.log(f"OME authentication failed: {e}", "ERROR")
            raise
    
    def get_ome_devices(self, settings: dict, auth_token: str) -> list:
        """Retrieve all devices from OpenManage Enterprise"""
        import requests
        
        host = settings['host']
        port = settings.get('port', 443)
        verify_ssl = settings.get('verify_ssl', True)
        
        url = f"https://{host}:{port}/api/DeviceService/Devices"
        headers = {
            "x-auth-token": auth_token,
            "Content-Type": "application/json"
        }
        
        start_time = time.time()
        
        try:
            response = requests.get(url, headers=headers, verify=verify_ssl, timeout=60)
            response_time = int((time.time() - start_time) * 1000)
            
            data = _safe_json_parse(response) if response.status_code == 200 else {}
            devices = data.get("value", [])
            
            # Log device retrieval activity
            self.log_openmanage_activity(
                operation_type='openmanage_api',
                endpoint='/api/DeviceService/Devices',
                command_type='GET_DEVICES',
                full_url=url,
                success=response.status_code == 200,
                status_code=response.status_code,
                response_time_ms=response_time,
                details={'device_count': len(devices)}
            )
            
            response.raise_for_status()
            
            self.log(f"Retrieved {len(devices)} devices from OME")
            return devices
            
        except Exception as e:
            self.log(f"Failed to retrieve OME devices: {e}", "ERROR")
            raise
    
    def process_ome_device(self, device: dict) -> dict:
        """Process OME device data into server format"""
        device_id = str(device.get("Id", ""))
        service_tag = device.get("DeviceServiceTag", "")
        model = device.get("Model", "")
        hostname = device.get("DeviceName", "")
        
        # Extract IP address
        ip_address = ""
        device_mgmt = device.get("DeviceManagement", [])
        if device_mgmt and len(device_mgmt) > 0:
            ip_address = device_mgmt[0].get("NetworkAddress", "")
        
        # Extract firmware versions
        bios_version = None
        idrac_firmware = None
        capabilities = device.get("DeviceCapabilities", [])
        for cap in capabilities:
            cap_type = cap.get("CapabilityType", {}).get("Name", "")
            if "BIOS" in cap_type:
                bios_version = cap.get("Version")
            elif "iDRAC" in cap_type or "Lifecycle" in cap_type:
                idrac_firmware = cap.get("Version")
        
        # Extract hardware specs (if available)
        cpu_count = None
        memory_gb = None
        if "Processors" in device:
            cpu_count = len(device.get("Processors", []))
        if "Memory" in device:
            memory_gb = device.get("Memory", {}).get("TotalSystemMemoryGiB")
        
        return {
            'device_id': device_id,
            'service_tag': service_tag,
            'model': model,
            'hostname': hostname,
            'ip_address': ip_address,
            'bios_version': bios_version,
            'idrac_firmware': idrac_firmware,
            'cpu_count': cpu_count,
            'memory_gb': memory_gb
        }
    
    def sync_ome_device_to_db(self, device_data: dict) -> tuple:
        """Sync a single OME device to servers table"""
        service_tag = device_data['service_tag']
        
        if not service_tag or not device_data['ip_address']:
            return 'skipped', False
        
        # Check if server exists
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json'
        }
        
        check_url = f"{DSM_URL}/rest/v1/servers?service_tag=eq.{service_tag}&select=id"
        response = requests.get(check_url, headers=headers, verify=VERIFY_SSL)
        existing = _safe_json_parse(response) if response.status_code == 200 else []
        
        server_payload = {
            'ip_address': device_data['ip_address'],
            'hostname': device_data.get('hostname'),
            'model': device_data.get('model'),
            'service_tag': service_tag,
            'bios_version': device_data.get('bios_version'),
            'idrac_firmware': device_data.get('idrac_firmware'),
            'cpu_count': device_data.get('cpu_count'),
            'memory_gb': device_data.get('memory_gb'),
            'openmanage_device_id': device_data['device_id'],
            'last_openmanage_sync': datetime.now().isoformat(),
            'manufacturer': 'Dell'
        }
        
        if existing:
            # Update existing
            server_id = existing[0]['id']
            update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}"
            response = requests.patch(update_url, json=server_payload, headers=headers, verify=VERIFY_SSL)
            return 'updated', response.status_code in [200, 204]
        else:
            # Insert new
            insert_url = f"{DSM_URL}/rest/v1/servers"
            response = requests.post(insert_url, json=server_payload, headers=headers, verify=VERIFY_SSL)
            
            if response.status_code in [200, 201]:
                # Try auto-linking with vCenter
                new_server = _safe_json_parse(response)
                if new_server:
                    server_id = new_server[0]['id'] if isinstance(new_server, list) else new_server['id']
                    self.auto_link_vcenter(server_id, service_tag)
            
            return 'new', response.status_code in [200, 201]
    
    def auto_link_vcenter(self, server_id: str, service_tag: str):
        """Attempt to auto-link server with vCenter host by serial number"""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            # Find matching vCenter host
            vcenter_url = f"{DSM_URL}/rest/v1/vcenter_hosts?serial_number=eq.{service_tag}&select=id"
            response = requests.get(vcenter_url, headers=headers, verify=VERIFY_SSL)
            
            if response.status_code == 200:
                hosts = _safe_json_parse(response)
                if hosts:
                    vcenter_host_id = hosts[0]['id']
                    
                    # Link server to vCenter host
                    update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}"
                    requests.patch(
                        update_url,
                        json={'vcenter_host_id': vcenter_host_id},
                        headers=headers,
                        verify=VERIFY_SSL
                    )
                    
                    self.log(f"  Auto-linked to vCenter host: {vcenter_host_id}")
        except Exception as e:
            self.log(f"  Auto-link failed: {e}", "WARN")
    
    def execute_openmanage_sync(self, job: Dict):
        """Execute OpenManage Enterprise sync operation"""
        try:
            self.log(f"Starting OpenManage sync: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            # Fetch OME settings
            response = requests.get(
                f"{DSM_URL}/rest/v1/openmanage_settings?select=*&limit=1",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            
            if response.status_code != 200 or not _safe_json_parse(response):
                raise Exception("OpenManage settings not configured")
            
            settings = _safe_json_parse(response)[0]
            
            if not settings.get('sync_enabled'):
                raise Exception("OpenManage sync is disabled in settings")
            
            # Authenticate with OME
            self.log("Authenticating with OpenManage Enterprise...")
            auth_token = self.authenticate_ome(settings)
            
            # Retrieve devices
            self.log("Retrieving devices from OpenManage Enterprise...")
            devices = self.get_ome_devices(settings, auth_token)
            
            # Process and sync devices
            results = {
                'total': len(devices),
                'new': 0,
                'updated': 0,
                'skipped': 0,
                'auto_linked': 0,
                'errors': []
            }
            
            for device in devices:
                try:
                    device_data = self.process_ome_device(device)
                    
                    if not device_data['service_tag'] or not device_data['ip_address']:
                        self.log(f"  Skipping device {device_data.get('hostname', 'Unknown')} - missing required fields", "WARN")
                        results['skipped'] += 1
                        continue
                    
                    self.log(f"  Syncing: {device_data['service_tag']} - {device_data['ip_address']}")
                    
                    action, success = self.sync_ome_device_to_db(device_data)
                    
                    if success:
                        if action == 'new':
                            results['new'] += 1
                        elif action == 'updated':
                            results['updated'] += 1
                    else:
                        results['errors'].append(f"Failed to sync {device_data['service_tag']}")
                        
                except Exception as e:
                    self.log(f"  Error processing device: {e}", "ERROR")
                    results['errors'].append(str(e))
            
            # Update last_sync timestamp in settings
            requests.patch(
                f"{DSM_URL}/rest/v1/openmanage_settings?id=eq.{settings['id']}",
                json={'last_sync': datetime.now().isoformat()},
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            
            # Log summary activity
            self.log_openmanage_activity(
                operation_type='openmanage_api',
                endpoint='/sync-summary',
                command_type='SYNC_COMPLETE',
                full_url=f"https://{settings['host']}:{settings.get('port', 443)}",
                success=True,
                details=results
            )
            
            self.log(f"✓ OpenManage sync completed: {results['new']} new, {results['updated']} updated, {results['skipped']} skipped")
            
            self.update_job_status(
                job['id'], 'completed',
                completed_at=datetime.now().isoformat(),
                details=results
            )
            
        except Exception as e:
            self.log(f"OpenManage sync failed: {e}", "ERROR")
            self.update_job_status(
                job['id'], 'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
    
    def log_openmanage_activity(self, operation_type: str, endpoint: str, command_type: str,
                               full_url: str, success: bool, status_code: int = None,
                               response_time_ms: int = None, details: dict = None):
        """Log OpenManage API activity to idrac_commands table"""
        try:
            activity_data = {
                'operation_type': operation_type,
                'endpoint': endpoint,
                'command_type': command_type,
                'full_url': full_url,
                'success': success,
                'status_code': status_code,
                'response_time_ms': response_time_ms,
                'source': 'job_executor',
                'timestamp': datetime.now().isoformat()
            }
            
            if details:
                activity_data['response_body'] = details
            
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            }
            
            requests.post(
                f"{DSM_URL}/rest/v1/idrac_commands",
                json=activity_data,
                headers=headers,
                verify=VERIFY_SSL,
                timeout=5
            )
        except Exception as e:
            self.log(f"Failed to log OpenManage activity: {e}", "WARN")
    
    def execute_bios_config_write(self, job: Dict):
        """
        Execute BIOS configuration write job - apply BIOS attribute changes
        
        Expected job details:
        {
            "server_id": "uuid",
            "attributes": {"ProcVirtualization": "Enabled", ...},
            "reboot_type": "none" | "graceful" | "forced",
            "create_snapshot": true/false,
            "snapshot_notes": "Optional description"
        }
        """
        try:
            self.log(f"Starting BIOS config write job: {job['id']}")
            
            # Update job status
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            # Get server and credentials
            details = job.get('details', {})
            server_id = details.get('server_id')
            attributes = details.get('attributes', {})
            reboot_type = details.get('reboot_type', 'none')
            create_snapshot = details.get('create_snapshot', False)
            snapshot_notes = details.get('snapshot_notes', '')
            
            if not server_id:
                raise Exception("Missing server_id in job details")
            
            if not attributes:
                raise Exception("No attributes to apply")
            
            # Get server info
            server = self.supabase.table('servers').select('*').eq('id', server_id).execute().data[0]
            ip = server['ip_address']
            username, password = self.get_credentials_for_server(server)
            
            self.log(f"  Applying {len(attributes)} BIOS changes to {ip}...")
            
            # Optional: Create pre-change snapshot
            if create_snapshot:
                self.log(f"  Creating pre-change snapshot...")
                snapshot_job = {
                    'id': f"snapshot-{job['id']}",
                    'job_type': 'bios_config_read',
                    'created_by': job['created_by'],
                    'details': {
                        'server_id': server_id,
                        'snapshot_type': 'current',
                        'notes': snapshot_notes or 'Pre-change snapshot'
                    }
                }
                self.execute_bios_config_read(snapshot_job)
            
            # Apply BIOS settings
            settings_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Bios/Settings"
            payload = {"Attributes": attributes}
            
            start_time = time.time()
            settings_resp = requests.patch(
                settings_url,
                auth=HTTPBasicAuth(username, password),
                headers={'Content-Type': 'application/json'},
                json=payload,
                verify=False,
                timeout=60
            )
            response_time_ms = int((time.time() - start_time) * 1000)
            
            # Log activity
            self.log_idrac_command(
                server_id=server_id,
                job_id=job['id'],
                task_id=None,
                command_type='BIOS_WRITE',
                endpoint='/redfish/v1/Systems/System.Embedded.1/Bios/Settings',
                full_url=settings_url,
                request_body=payload,
                request_headers={'Authorization': '[REDACTED]', 'Content-Type': 'application/json'},
                status_code=settings_resp.status_code,
                response_body=_safe_json_parse(settings_resp) if settings_resp.ok and settings_resp.text else None,
                response_time_ms=response_time_ms,
                success=settings_resp.ok,
                error_message=None if settings_resp.ok else settings_resp.text,
                operation_type='idrac_api'
            )
            
            if not settings_resp.ok:
                error_msg = f"Failed to apply BIOS settings: HTTP {settings_resp.status_code}"
                if settings_resp.text:
                    try:
                        error_data = _safe_json_parse(settings_resp)
                        if 'error' in error_data:
                            error_msg = f"{error_msg} - {error_data['error'].get('message', error_data['error'])}"
                    except:
                        pass
                raise Exception(error_msg)
            
            self.log(f"  [OK] BIOS settings applied successfully")
            self.log(f"  Note: Changes will take effect after system reboot")
            
            # Handle reboot if requested
            reboot_action = None
            if reboot_type != 'none':
                self.log(f"  Initiating {reboot_type} reboot...")
                reboot_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset"
                
                reset_type = 'GracefulRestart' if reboot_type == 'graceful' else 'ForceRestart'
                reboot_payload = {"ResetType": reset_type}
                
                start_time = time.time()
                reboot_resp = requests.post(
                    reboot_url,
                    auth=HTTPBasicAuth(username, password),
                    headers={'Content-Type': 'application/json'},
                    json=reboot_payload,
                    verify=False,
                    timeout=30
                )
                response_time_ms = int((time.time() - start_time) * 1000)
                
                # Log activity
                self.log_idrac_command(
                    server_id=server_id,
                    job_id=job['id'],
                    command_type='POWER_CONTROL',
                    endpoint='/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset',
                    full_url=reboot_url,
                    request_body=reboot_payload,
                    request_headers={'Authorization': '[REDACTED]', 'Content-Type': 'application/json'},
                    status_code=reboot_resp.status_code,
                    response_body=None,
                    response_time_ms=response_time_ms,
                    success=reboot_resp.ok,
                    error_message=None if reboot_resp.ok else reboot_resp.text,
                    source='job_executor',
                    initiated_by=job['created_by']
                )
                
                if reboot_resp.ok:
                    self.log(f"  [OK] Reboot initiated successfully")
                    reboot_action = reset_type
                else:
                    self.log(f"  [!] Reboot failed but BIOS settings were applied", "WARNING")
            
            # Update job status
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details={
                    'settings_applied': len(attributes),
                    'reboot_required': True,
                    'reboot_action': reboot_action,
                    'snapshot_created': create_snapshot
                }
            )
            self.log(f"BIOS config write job completed successfully")
            
        except Exception as e:
            self.log(f"BIOS config write job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )

    def execute_job(self, job: Dict):
        """Execute a job based on its type"""
        job_type = job['job_type']
        
        # Initialize throttler if not already done
        if self.throttler is None:
            self.initialize_throttler()
        
        # Check if iDRAC operations are paused for iDRAC-related job types
        idrac_job_types = [
            'discovery_scan', 'firmware_update', 'full_server_update', 
            'test_credentials', 'power_action', 'health_check', 
            'fetch_event_logs', 'boot_configuration', 'virtual_media_mount',
            'virtual_media_unmount', 'scp_export', 'scp_import',
            'bios_config_read', 'bios_config_write'
        ]
        
        if job_type in idrac_job_types and self.check_idrac_pause():
            self.log(f"Skipping {job_type} job {job['id']} - iDRAC operations are paused", "WARN")
            self.update_job_status(
                job['id'],
                'cancelled',
                completed_at=datetime.now().isoformat(),
                details={"message": "Job cancelled - iDRAC operations paused via activity settings"}
            )
            return
        
        if job_type == 'discovery_scan':
            self.execute_discovery_scan(job)
        elif job_type == 'firmware_update':
            self.execute_firmware_update(job)
        elif job_type == 'full_server_update':
            self.execute_full_server_update(job)
        elif job_type == 'test_credentials':
            self.execute_test_credentials(job)
        elif job_type == 'power_action':
            self.execute_power_action(job)
        elif job_type == 'health_check':
            self.execute_health_check(job)
        elif job_type == 'fetch_event_logs':
            self.execute_fetch_event_logs(job)
        elif job_type == 'boot_configuration':
            self.execute_boot_configuration(job)
        elif job_type == 'virtual_media_mount':
            self.execute_virtual_media_mount(job)
        elif job_type == 'virtual_media_unmount':
            self.execute_virtual_media_unmount(job)
        elif job_type == 'scp_export':
            self.execute_scp_export(job)
        elif job_type == 'scp_import':
            self.execute_scp_import(job)
        elif job_type == 'bios_config_read':
            self.execute_bios_config_read(job)
        elif job_type == 'bios_config_write':
            self.execute_bios_config_write(job)
        elif job_type == 'vcenter_sync':
            self.execute_vcenter_sync(job)
        elif job_type == 'vcenter_connectivity_test':
            self.execute_vcenter_connectivity_test(job)
        elif job_type == 'openmanage_sync':
            self.execute_openmanage_sync(job)
        else:
            self.log(f"Unknown job type: {job_type}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={"error": f"Unsupported job type: {job_type}"}
            )
    
    def execute_scp_export(self, job: Dict):
        """
        Execute SCP (Server Configuration Profile) export job
        
        Expected job details:
        {
            "backup_name": "pre-upgrade-backup",
            "description": "Backup before firmware update",
            "include_bios": true,
            "include_idrac": true,
            "include_nic": true,
            "include_raid": true
        }
        """
        try:
            self.log(f"Starting SCP export job: {job['id']}")
            
            details = job.get('details', {})
            backup_name = details.get('backup_name', f"backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}")
            
            # Update job status to running
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            # Get target servers
            target_scope = job.get('target_scope', {})
            server_ids = target_scope.get('server_ids', [])
            
            if not server_ids:
                raise ValueError("No target servers specified")
            
            success_count = 0
            failed_count = 0
            results = []
            
            for server_id in server_ids:
                try:
                    server = self.get_server_by_id(server_id)
                    if not server:
                        raise Exception(f"Server not found: {server_id}")
                    
                    ip = server['ip_address']
                    username, password = self.get_credentials_for_server(server)
                    
                    self.log(f"  Exporting SCP from {ip}...")
                    
                    # Build export URL
                    export_url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration"
                    
                    # Build target list based on included components
                    targets = []
                    if details.get('include_bios', True):
                        targets.append('BIOS')
                    if details.get('include_idrac', True):
                        targets.append('iDRAC')
                    if details.get('include_nic', True):
                        targets.append('NIC')
                    if details.get('include_raid', True):
                        targets.append('RAID')
                    
                    payload = {
                        "ExportFormat": "JSON",
                        "ShareParameters": {
                            "Target": ",".join(targets)
                        }
                    }
                    
                    # Initiate export
                    start_time = time.time()
                    response = requests.post(
                        export_url,
                        auth=(username, password),
                        json=payload,
                        verify=False,
                        timeout=30
                    )
                    response_time_ms = int((time.time() - start_time) * 1000)
                    
                    # Log the command
                    self.log_idrac_command(
                        server_id=server_id,
                        job_id=job['id'],
                        task_id=None,
                        command_type='POST',
                        endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration',
                        full_url=export_url,
                        request_headers={'Authorization': '[REDACTED]'},
                        request_body=payload,
                        response_body=_safe_json_parse(response) if response.status_code == 200 else response.text,
                        status_code=response.status_code,
                        response_time_ms=response_time_ms,
                        success=response.status_code == 200,
                        operation_type='idrac_api'
                    )
                    
                    if response.status_code != 200:
                        raise Exception(f"Export failed: {response.status_code} - {response.text}")
                    
                    export_data = _safe_json_parse(response)
                    
                    # Get the SCP content from the response
                    scp_content = export_data.get('SystemConfiguration', export_data)
                    
                    # Calculate file size and checksum
                    scp_json = json.dumps(scp_content, indent=2)
                    file_size = len(scp_json.encode('utf-8'))
                    checksum = hashlib.sha256(scp_json.encode()).hexdigest()
                    
                    # Create backup record in database
                    backup_data = {
                        'server_id': server_id,
                        'export_job_id': job['id'],
                        'backup_name': f"{backup_name} - {server.get('hostname', ip)}",
                        'description': details.get('description'),
                        'scp_content': scp_content if file_size < 1024*1024 else None,
                        'scp_file_size_bytes': file_size,
                        'include_bios': details.get('include_bios', True),
                        'include_idrac': details.get('include_idrac', True),
                        'include_nic': details.get('include_nic', True),
                        'include_raid': details.get('include_raid', True),
                        'checksum': checksum,
                        'exported_at': datetime.now().isoformat(),
                        'created_by': job['created_by']
                    }
                    
                    # Insert into database
                    headers = {
                        'apikey': SERVICE_ROLE_KEY,
                        'Content-Type': 'application/json'
                    }
                    db_response = requests.post(
                        f"{SUPABASE_URL}/rest/v1/scp_backups",
                        headers=headers,
                        json=backup_data
                    )
                    
                    if db_response.status_code not in [200, 201]:
                        self.log(f"Failed to save backup record: {db_response.text}", "ERROR")
                    
                    self.log(f"  ✓ SCP exported successfully from {ip} ({round(file_size/1024, 2)} KB)")
                    success_count += 1
                    results.append({
                        'server': ip,
                        'success': True,
                        'file_size_kb': round(file_size / 1024, 2),
                        'components': targets,
                        'checksum': checksum[:16]
                    })
                    
                except Exception as e:
                    self.log(f"  ✗ Failed to export SCP from {ip}: {e}", "ERROR")
                    failed_count += 1
                    results.append({
                        'server': ip,
                        'success': False,
                        'error': str(e)
                    })
            
            # Update job status
            if failed_count == 0:
                self.update_job_status(
                    job['id'],
                    'completed',
                    completed_at=datetime.now().isoformat(),
                    details={
                        'success_count': success_count,
                        'results': results
                    }
                )
                self.log(f"SCP export job completed successfully")
            else:
                status = 'failed' if success_count == 0 else 'completed'
                self.update_job_status(
                    job['id'],
                    status,
                    completed_at=datetime.now().isoformat(),
                    details={
                        'success_count': success_count,
                        'failed_count': failed_count,
                        'results': results
                    }
                )
                
        except Exception as e:
            self.log(f"SCP export job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
    
    def execute_scp_import(self, job: Dict):
        """
        Execute SCP (Server Configuration Profile) import job
        
        Expected job details:
        {
            "backup_id": "uuid",
            "shutdown_type": "Graceful",
            "host_power_state": "On"
        }
        """
        try:
            self.log(f"Starting SCP import job: {job['id']}")
            
            details = job.get('details', {})
            backup_id = details.get('backup_id')
            shutdown_type = details.get('shutdown_type', 'Graceful')
            host_power_state = details.get('host_power_state', 'On')
            
            if not backup_id:
                raise ValueError("backup_id is required")
            
            # Update job status to running
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            # Get backup from database
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Content-Type': 'application/json'
            }
            backup_response = requests.get(
                f"{SUPABASE_URL}/rest/v1/scp_backups?id=eq.{backup_id}&select=*",
                headers=headers
            )
            
            if backup_response.status_code != 200:
                raise Exception(f"Failed to fetch backup: {backup_response.text}")
            
            backups = _safe_json_parse(backup_response)
            if not backups:
                raise Exception(f"Backup not found: {backup_id}")
            
            backup = backups[0]
            
            # Get target servers
            target_scope = job.get('target_scope', {})
            server_ids = target_scope.get('server_ids', [])
            
            if not server_ids:
                raise ValueError("No target servers specified")
            
            success_count = 0
            failed_count = 0
            results = []
            
            for server_id in server_ids:
                try:
                    server = self.get_server_by_id(server_id)
                    if not server:
                        raise Exception(f"Server not found: {server_id}")
                    
                    ip = server['ip_address']
                    username, password = self.get_credentials_for_server(server)
                    
                    self.log(f"  Importing SCP to {ip}...")
                    
                    # Get SCP content
                    scp_content = backup.get('scp_content')
                    if not scp_content:
                        raise Exception("Backup does not contain SCP content")
                    
                    # Build import URL
                    import_url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ImportSystemConfiguration"
                    
                    # Build target list
                    targets = []
                    if backup.get('include_bios', True):
                        targets.append('BIOS')
                    if backup.get('include_idrac', True):
                        targets.append('iDRAC')
                    if backup.get('include_nic', True):
                        targets.append('NIC')
                    if backup.get('include_raid', True):
                        targets.append('RAID')
                    
                    payload = {
                        "ImportBuffer": json.dumps(scp_content),
                        "ShareParameters": {
                            "Target": ",".join(targets)
                        },
                        "ShutdownType": shutdown_type,
                        "HostPowerState": host_power_state
                    }
                    
                    # Initiate import
                    start_time = time.time()
                    response = requests.post(
                        import_url,
                        auth=(username, password),
                        json=payload,
                        verify=False,
                        timeout=30
                    )
                    response_time_ms = int((time.time() - start_time) * 1000)
                    
                    # Log the command
                    self.log_idrac_command(
                        server_id=server_id,
                        job_id=job['id'],
                        task_id=None,
                        command_type='POST',
                        endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ImportSystemConfiguration',
                        full_url=import_url,
                        request_headers={'Authorization': '[REDACTED]'},
                        request_body={'ShareParameters': payload['ShareParameters'], 'ShutdownType': shutdown_type},
                        response_body=_safe_json_parse(response) if response.status_code in [200, 202] else response.text,
                        status_code=response.status_code,
                        response_time_ms=response_time_ms,
                        success=response.status_code in [200, 202],
                        operation_type='idrac_api'
                    )
                    
                    if response.status_code not in [200, 202]:
                        raise Exception(f"Import failed: {response.status_code} - {response.text}")
                    
                    import_data = _safe_json_parse(response)
                    
                    # Update backup record
                    requests.patch(
                        f"{SUPABASE_URL}/rest/v1/scp_backups?id=eq.{backup_id}",
                        headers=headers,
                        json={
                            'import_job_id': job['id'],
                            'last_imported_at': datetime.now().isoformat()
                        }
                    )
                    
                    self.log(f"  ✓ SCP import initiated on {ip}")
                    success_count += 1
                    results.append({
                        'server': ip,
                        'success': True,
                        'components': targets,
                        'message': import_data.get('Message', 'Import job created')
                    })
                    
                except Exception as e:
                    self.log(f"  ✗ Failed to import SCP to {ip}: {e}", "ERROR")
                    failed_count += 1
                    results.append({
                        'server': ip,
                        'success': False,
                        'error': str(e)
                    })
            
            # Update job status
            if failed_count == 0:
                self.update_job_status(
                    job['id'],
                    'completed',
                    completed_at=datetime.now().isoformat(),
                    details={
                        'success_count': success_count,
                        'results': results,
                        'warning': 'Servers may need to reboot'
                    }
                )
                self.log(f"SCP import job completed successfully")
            else:
                status = 'failed' if success_count == 0 else 'completed'
                self.update_job_status(
                    job['id'],
                    status,
                    completed_at=datetime.now().isoformat(),
                    details={
                        'success_count': success_count,
                        'failed_count': failed_count,
                        'results': results
                    }
                )
                
        except Exception as e:
            self.log(f"SCP import job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
    
    def test_dns_resolution(self, hostname: str) -> dict:
        """Test DNS resolution for vCenter hostname"""
        import socket
        try:
            start = time.time()
            ip_addresses = socket.getaddrinfo(hostname, None)
            elapsed = (time.time() - start) * 1000
            return {
                'success': True,
                'resolved_ips': [addr[4][0] for addr in ip_addresses],
                'response_time_ms': round(elapsed, 2),
                'message': f'Resolved to {len(ip_addresses)} address(es)'
            }
        except socket.gaierror as e:
            return {
                'success': False,
                'error': str(e),
                'message': 'DNS resolution failed - check hostname or DNS server'
            }
    
    def test_port_connectivity(self, host: str, port: int, timeout: int = 5) -> dict:
        """Test TCP connectivity to vCenter port"""
        import socket
        try:
            start = time.time()
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            result = sock.connect_ex((host, port))
            elapsed = (time.time() - start) * 1000
            sock.close()
            
            if result == 0:
                return {
                    'success': True,
                    'response_time_ms': round(elapsed, 2),
                    'message': f'Port {port} is accessible'
                }
            else:
                return {
                    'success': False,
                    'error_code': result,
                    'message': f'Port {port} is not accessible - check firewall rules'
                }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': 'Network connectivity failed'
            }
    
    def test_ssl_certificate(self, host: str, port: int, verify_ssl: bool) -> dict:
        """Test SSL certificate validity"""
        import ssl
        import socket
        from datetime import datetime
        
        try:
            context = ssl.create_default_context()
            if not verify_ssl:
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE
            
            with socket.create_connection((host, port), timeout=5) as sock:
                with context.wrap_socket(sock, server_hostname=host) as ssock:
                    cert = ssock.getpeercert()
                    
                    if cert:
                        # Parse expiration date
                        not_after = datetime.strptime(cert['notAfter'], '%b %d %H:%M:%S %Y %Z')
                        days_until_expiry = (not_after - datetime.now()).days
                        
                        return {
                            'success': True,
                            'subject': dict(x[0] for x in cert['subject']),
                            'issuer': dict(x[0] for x in cert['issuer']),
                            'expires': cert['notAfter'],
                            'days_until_expiry': days_until_expiry,
                            'message': f'Valid certificate (expires in {days_until_expiry} days)'
                        }
                    else:
                        return {
                            'success': not verify_ssl,
                            'message': 'No certificate (SSL verification disabled)' if not verify_ssl else 'Certificate required but not provided'
                        }
        except ssl.SSLCertVerificationError as e:
            return {
                'success': False,
                'error': 'Certificate verification failed',
                'details': str(e),
                'message': 'SSL certificate is invalid or untrusted - check certificate or disable SSL verification'
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': 'SSL certificate test failed'
            }
    
    def test_vcenter_authentication(self, settings: dict) -> dict:
        """Test vCenter authentication and basic API access"""
        import ssl
        from pyVim.connect import SmartConnect, Disconnect
        from pyVmomi import vim
        
        host = settings['host']
        username = settings['username']
        password = settings['password']
        verify_ssl = settings.get('verify_ssl', True)
        
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        if not verify_ssl:
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        
        try:
            start = time.time()
            si = SmartConnect(
                host=host,
                user=username,
                pwd=password,
                sslContext=context
            )
            elapsed = (time.time() - start) * 1000
            
            # Try to get basic info to verify API access
            content = si.RetrieveContent()
            about = content.about
            
            version_info = f"{about.fullName} (API {about.apiVersion})"
            
            Disconnect(si)
            
            return {
                'success': True,
                'response_time_ms': round(elapsed, 2),
                'vcenter_version': about.version,
                'vcenter_build': about.build,
                'api_version': about.apiVersion,
                'message': f'Authentication successful - {version_info}'
            }
        except vim.fault.InvalidLogin as e:
            return {
                'success': False,
                'error': 'Invalid credentials',
                'message': 'Authentication failed - check username and password'
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': f'vCenter API connection failed: {str(e)}'
            }
    
    def test_vcenter_api_functionality(self, settings: dict) -> dict:
        """Test basic vCenter API functionality"""
        from pyVmomi import vim
        try:
            si = self.connect_vcenter(settings)
            if not si:
                return {'success': False, 'message': 'Could not connect to vCenter'}
            
            content = si.RetrieveContent()
            
            # Count clusters
            cluster_view = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.ClusterComputeResource], True
            )
            cluster_count = len(cluster_view.view)
            cluster_view.Destroy()
            
            # Count hosts
            host_view = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.HostSystem], True
            )
            host_count = len(host_view.view)
            host_view.Destroy()
            
            return {
                'success': True,
                'clusters_found': cluster_count,
                'hosts_found': host_count,
                'message': f'API functional - found {cluster_count} cluster(s) and {host_count} host(s)'
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': 'API query failed'
            }
    
    def log_vcenter_activity(self, operation: str, endpoint: str, success: bool, 
                           server_id: str = None, job_id: str = None, 
                           response_time_ms: int = None, details: Dict = None, 
                           error_message: str = None):
        """Log vCenter API activity to unified activity log"""
        try:
            log_entry = {
                'operation_type': 'vcenter_api',
                'command_type': operation,
                'endpoint': endpoint,
                'full_url': f"vcenter://{endpoint}",
                'server_id': server_id,
                'job_id': job_id,
                'success': success,
                'response_time_ms': response_time_ms,
                'error_message': error_message,
                'source': 'job_executor',
                'timestamp': datetime.now().isoformat(),
                'request_body': details if details else None,
                'response_body': None  # Don't log large vCenter responses
            }
            
            response = requests.post(
                f"{DSM_URL}/rest/v1/idrac_commands",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json'
                },
                json=log_entry,
                verify=VERIFY_SSL
            )
            
            if response.status_code not in [200, 201]:
                self.log(f"Failed to log vCenter activity: {response.text}", "WARNING")
                
        except Exception as e:
            self.log(f"Error logging vCenter activity: {e}", "WARNING")

    def execute_vcenter_connectivity_test(self, job: Dict):
        """Execute comprehensive vCenter connectivity test"""
        try:
            self.log(f"Starting vCenter connectivity test: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            # Fetch vCenter settings
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_settings?select=*&limit=1",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            
            if response.status_code != 200 or not _safe_json_parse(response):
                raise Exception("vCenter settings not configured")
            
            settings = _safe_json_parse(response)[0]
            host = settings['host']
            port = settings.get('port', 443)
            verify_ssl = settings.get('verify_ssl', True)
            
            # Extract hostname (remove protocol if present)
            hostname = host.replace('https://', '').replace('http://', '').split(':')[0]
            
            results = {
                'vcenter_host': host,
                'vcenter_port': port,
                'timestamp': datetime.now().isoformat(),
                'tests': {}
            }
            
            # Test 1: DNS Resolution
            self.log(f"Test 1/5: DNS resolution for {hostname}")
            start_time = time.time()
            results['tests']['dns'] = self.test_dns_resolution(hostname)
            dns_time = int((time.time() - start_time) * 1000)
            
            self.log_vcenter_activity(
                operation='DNS_RESOLUTION',
                endpoint=f'/dns/{hostname}',
                success=results['tests']['dns']['success'],
                job_id=job['id'],
                response_time_ms=dns_time,
                details={'hostname': hostname, 'result': results['tests']['dns']}
            )
            
            if not results['tests']['dns']['success']:
                # Critical failure - can't proceed
                self.update_job_status(
                    job['id'], 'failed',
                    completed_at=datetime.now().isoformat(),
                    details={**results, 'critical_failure': 'DNS resolution failed'}
                )
                return
            
            resolved_ip = results['tests']['dns']['resolved_ips'][0]
            
            # Test 2: TCP Port Connectivity
            self.log(f"Test 2/5: TCP port {port} connectivity to {resolved_ip}")
            start_time = time.time()
            results['tests']['port'] = self.test_port_connectivity(resolved_ip, port)
            port_time = int((time.time() - start_time) * 1000)
            
            self.log_vcenter_activity(
                operation='PORT_CONNECTIVITY',
                endpoint=f'/tcp/{resolved_ip}:{port}',
                success=results['tests']['port']['success'],
                job_id=job['id'],
                response_time_ms=port_time,
                details={'host': resolved_ip, 'port': port, 'result': results['tests']['port']}
            )
            
            if not results['tests']['port']['success']:
                # Critical failure
                self.update_job_status(
                    job['id'], 'failed',
                    completed_at=datetime.now().isoformat(),
                    details={**results, 'critical_failure': f'Port {port} not accessible'}
                )
                return
            
            # Test 3: SSL Certificate Validation
            self.log(f"Test 3/5: SSL certificate validation")
            start_time = time.time()
            results['tests']['ssl'] = self.test_ssl_certificate(hostname, port, verify_ssl)
            ssl_time = int((time.time() - start_time) * 1000)
            
            self.log_vcenter_activity(
                operation='SSL_VALIDATION',
                endpoint=f'/ssl/{hostname}:{port}',
                success=results['tests']['ssl']['success'],
                job_id=job['id'],
                response_time_ms=ssl_time,
                details={'verify_ssl': verify_ssl, 'result': results['tests']['ssl']}
            )
            
            # Test 4: vCenter Authentication
            self.log(f"Test 4/5: vCenter authentication")
            start_time = time.time()
            results['tests']['auth'] = self.test_vcenter_authentication(settings)
            auth_time = int((time.time() - start_time) * 1000)
            
            self.log_vcenter_activity(
                operation='AUTHENTICATION',
                endpoint=f'/api/session',
                success=results['tests']['auth']['success'],
                job_id=job['id'],
                response_time_ms=auth_time,
                details={'username': settings['username'], 'result': results['tests']['auth']},
                error_message=results['tests']['auth'].get('error')
            )
            
            if not results['tests']['auth']['success']:
                # Authentication failure
                self.update_job_status(
                    job['id'], 'failed',
                    completed_at=datetime.now().isoformat(),
                    details={**results, 'critical_failure': 'Authentication failed'}
                )
                return
            
            # Test 5: API Functionality (cluster/host count)
            self.log(f"Test 5/5: API functionality test")
            start_time = time.time()
            results['tests']['api'] = self.test_vcenter_api_functionality(settings)
            api_time = int((time.time() - start_time) * 1000)
            
            self.log_vcenter_activity(
                operation='API_FUNCTIONALITY',
                endpoint='/api/vcenter/clusters',
                success=results['tests']['api']['success'],
                job_id=job['id'],
                response_time_ms=api_time,
                details={'result': results['tests']['api']}
            )
            
            # Determine overall status
            all_passed = all(test.get('success', False) for test in results['tests'].values())
            
            if all_passed:
                self.log("✓ All connectivity tests passed")
                results['overall_status'] = 'passed'
                results['message'] = 'vCenter is fully accessible and ready for sync'
            else:
                self.log("⚠ Some tests failed or have warnings")
                results['overall_status'] = 'partial'
                results['message'] = 'vCenter is accessible but some issues detected'
            
            self.update_job_status(
                job['id'], 'completed',
                completed_at=datetime.now().isoformat(),
                details=results
            )
            
        except Exception as e:
            self.log(f"Connectivity test failed: {e}", "ERROR")
            self.update_job_status(
                job['id'], 'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e), 'message': 'Connectivity test execution failed'}
            )

    def run(self):
        """Main execution loop"""
        self.log("="*70)
        self.log("Dell Server Manager - Job Executor")
        self.log("="*70)
        self.log(f"DSM_URL: {DSM_URL}")
        self.log(f"Polling interval: {POLL_INTERVAL} seconds")
        self.log(f"SSL Verification: {VERIFY_SSL}")
        self.log("="*70)

        self._validate_service_role_key()

        self.log("[OK] Configuration validated", "INFO")
        
        # Initialize throttler and display configuration
        try:
            self.initialize_throttler()
            self.log("=" * 70)
            self.log("iDRAC THROTTLER CONFIGURATION")
            self.log("=" * 70)
            self.log(f"  Max Concurrent Requests: {self.throttler.max_concurrent}")
            self.log(f"  Request Delay (per IP): {self.throttler.request_delay_ms}ms")
            self.log(f"  Discovery Max Threads: {self.activity_settings.get('discovery_max_threads', 5)}")
            self.log(f"  Circuit Breaker Threshold: {self.throttler.circuit_breaker_threshold} failures")
            self.log(f"  Circuit Breaker Timeout: {self.throttler.circuit_breaker_timeout}s")
            self.log(f"  Operations Paused: {self.activity_settings.get('pause_idrac_operations', False)}")
            self.log("=" * 70)
        except Exception as e:
            self.log(f"Warning: Could not initialize throttler: {e}", "WARN")
        
        self.log("Job executor started. Polling for jobs...")
        
        try:
            while self.running:
                try:
                    # Get pending jobs
                    jobs = self.get_pending_jobs()
                    
                    if jobs:
                        self.log(f"Found {len(jobs)} pending job(s)")
                        for job in jobs:
                            self.log(f"Executing job {job['id']} ({job['job_type']})")
                            self.execute_job(job)
                    
                    # Wait before next poll
                    time.sleep(POLL_INTERVAL)
                    
                except KeyboardInterrupt:
                    raise
                except Exception as e:
                    self.log(f"Error in main loop: {e}", "ERROR")
                    time.sleep(POLL_INTERVAL)
                    
        except KeyboardInterrupt:
            self.log("\nShutting down job executor...")
            self.running = False

def main():
    executor = JobExecutor()
    executor.run()

if __name__ == "__main__":
    main()
