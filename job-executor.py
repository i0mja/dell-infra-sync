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
import logging
import requests
import sys
import time
import ipaddress
import hashlib
import concurrent.futures
from typing import List, Dict, Optional
from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim
import atexit
import json
import os
from pathlib import Path
from datetime import datetime
from idrac_throttler import IdracThrottler

# Ensure the supporting job_executor package is discoverable when this script is
# executed directly by external tools that only know about job-executor.py.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


def _require_support_package():
    """Fail fast with a helpful message if helper modules are missing."""

    package_dir = SCRIPT_DIR / "job_executor"
    required_files = [
        package_dir / "config.py",
        package_dir / "connectivity.py",
        package_dir / "scp.py",
        package_dir / "utils.py",
    ]

    missing = [path.name for path in required_files if not path.exists()]
    if missing:
        formatted = ", ".join(missing)
        sys.stderr.write(
            "job-executor.py depends on the bundled job_executor helpers but "
            f"the following files are missing: {formatted}\n"
        )
        sys.stderr.write(
            "Place the job_executor folder next to job-executor.py so the app "
            "can continue calling this entrypoint without modification.\n"
        )
        raise SystemExit(1)


_require_support_package()

from job_executor.config import (
    DSM_URL,
    FIRMWARE_REPO_URL,
    FIRMWARE_UPDATE_TIMEOUT,
    IDRAC_DEFAULT_PASSWORD,
    IDRAC_DEFAULT_USER,
    POLL_INTERVAL,
    SERVICE_ROLE_KEY,
    SUPABASE_URL,
    SYSTEM_ONLINE_CHECK_ATTEMPTS,
    SYSTEM_REBOOT_WAIT,
    VCENTER_HOST,
    VCENTER_PASSWORD,
    VCENTER_USER,
    VERIFY_SSL,
    ISO_DIRECTORY,
    FIRMWARE_DIRECTORY,
    MEDIA_SERVER_PORT,
    MEDIA_SERVER_ENABLED,
)
from job_executor.connectivity import ConnectivityMixin
from job_executor.scp import ScpMixin
from job_executor.mixins.database import DatabaseMixin
from job_executor.mixins.credentials import CredentialsMixin
from job_executor.mixins.vcenter_ops import VCenterMixin
from job_executor.utils import UNICODE_FALLBACKS, _normalize_unicode, _safe_json_parse, _safe_to_stdout
from job_executor.dell_redfish.adapter import DellRedfishAdapter
from job_executor.handlers import (
    IDMHandler, ConsoleHandler, DatastoreHandler, MediaUploadHandler,
    VirtualMediaHandler, PowerHandler, BootHandler, DiscoveryHandler,
    FirmwareHandler, ClusterHandler, ESXiHandler, VCenterHandlers
)

# Import IDM/FreeIPA authentication (conditional)
try:
    from job_executor.ldap_auth import FreeIPAAuthenticator, LDAP3_AVAILABLE
except ImportError:
    LDAP3_AVAILABLE = False
    FreeIPAAuthenticator = None

# Job types that should bypass the normal queue for instant execution
INSTANT_JOB_TYPES = ['console_launch', 'browse_datastore', 'connectivity_test', 'power_control', 'idm_authenticate', 'idm_test_connection']
from job_executor.dell_redfish.operations import DellOperations
from job_executor.esxi.orchestrator import EsxiOrchestrator
from job_executor.media_server import MediaServer

# Best-effort: prefer UTF-8 output if available, but never crash if not
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# UNICODE_FALLBACKS imported from job_executor.utils

# ============================================================================
# Job Executor Class
# ============================================================================

class JobExecutor(DatabaseMixin, CredentialsMixin, VCenterMixin, ScpMixin, ConnectivityMixin):
    def __init__(self):
        self.vcenter_conn = None
        self.running = True
        self.encryption_key = None  # Will be fetched on first use
        self.throttler = None  # Will be initialized on first use
        self.activity_settings = {}  # Cache settings
        self.last_settings_fetch = 0  # Timestamp for cache invalidation
        self.dell_operations = None  # Will be initialized on first use
        self._dell_logger = None
        self.media_server = None  # Media HTTP server (ISOs + firmware)
        
        # Initialize job handlers
        self.idm_handler = IDMHandler(self)
        self.console_handler = ConsoleHandler(self)
        self.datastore_handler = DatastoreHandler(self)
        self.media_handler = MediaUploadHandler(self)
        self.virtual_media_handler = VirtualMediaHandler(self)
        self.power_handler = PowerHandler(self)
        self.boot_handler = BootHandler(self)
        self.discovery_handler = DiscoveryHandler(self)
        self.firmware_handler = FirmwareHandler(self)
        self.cluster_handler = ClusterHandler(self)
        self.esxi_handler = ESXiHandler(self)
        self.vcenter_handler = VCenterHandlers(self)

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
    
    def _get_dell_operations(self) -> DellOperations:
        """
        Get or create Dell operations instance with current throttler and logging.
        
        Returns:
            DellOperations: Configured Dell operations instance
        """
        if self.dell_operations is None:
            # Ensure throttler is initialized
            if self.throttler is None:
                self.initialize_throttler()

            # Create adapter with our throttler and Supabase logging
            adapter = DellRedfishAdapter(
                throttler=self.throttler,
                logger=self._get_dell_logger(),
                log_command_fn=self._log_dell_redfish_command,
                verify_ssl=VERIFY_SSL,
            )

            # Create operations instance
            self.dell_operations = DellOperations(adapter)
            self.log("Dell Redfish operations initialized", "INFO")

        return self.dell_operations

    def _get_dell_logger(self) -> logging.Logger:
        """Lazily configure a logger for Dell Redfish operations."""
        if self._dell_logger is None:
            logger = logging.getLogger("dell_redfish_adapter")
            if not logger.handlers:
                handler = logging.StreamHandler()
                formatter = logging.Formatter(
                    fmt="%(asctime)s [%(levelname)s] %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S",
                )
                handler.setFormatter(formatter)
                logger.addHandler(handler)
            logger.setLevel(logging.INFO)
            self._dell_logger = logger
        return self._dell_logger

    def _log_dell_redfish_command(self, log_entry: Dict):
        """Adapt DellRedfishAdapter log entries to the standard iDRAC logger."""
        self.log_idrac_command(
            server_id=log_entry.get("server_id"),
            job_id=log_entry.get("job_id"),
            task_id=None,
            command_type=log_entry.get("command_type"),
            endpoint=log_entry.get("endpoint"),
            full_url=log_entry.get("full_url"),
            request_headers=None,
            request_body=log_entry.get("request_body"),
            status_code=log_entry.get("status_code"),
            response_time_ms=log_entry.get("response_time_ms", 0),
            response_body=log_entry.get("response_body"),
            success=log_entry.get("success", False),
            error_message=log_entry.get("error_message"),
            operation_type=log_entry.get("operation_type", "idrac_api"),
        )
    
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
    
    def get_idm_settings(self) -> Optional[Dict]:
        """Fetch IDM/FreeIPA settings from database."""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            }
            response = requests.get(
                f"{DSM_URL}/rest/v1/idm_settings",
                headers=headers,
                params={'select': '*', 'limit': '1'},
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.status_code == 200:
                settings = _safe_json_parse(response)
                if settings and len(settings) > 0:
                    return settings[0]
            return None
        except Exception as e:
            self.log(f"Error fetching IDM settings: {e}", "ERROR")
            return None
    
    def decrypt_bind_password(self, encrypted_password: str) -> Optional[str]:
        """Decrypt the FreeIPA bind password using encryption key."""
        if not encrypted_password:
            return None
        return self.decrypt_password(encrypted_password)
    
    def create_freeipa_authenticator(self, settings: Dict) -> Optional['FreeIPAAuthenticator']:
        """Create FreeIPAAuthenticator from IDM settings."""
        if not LDAP3_AVAILABLE:
            self.log("ldap3 library not installed - IDM features unavailable", "ERROR")
            self.log("Install with: pip install ldap3>=2.9.1", "ERROR")
            return None
        
        try:
            # Write CA certificate to temp file if provided
            ca_cert_path = None
            if settings.get('ca_certificate'):
                import tempfile
                fd, ca_cert_path = tempfile.mkstemp(suffix='.pem')
                with os.fdopen(fd, 'w') as f:
                    f.write(settings['ca_certificate'])
            
            return FreeIPAAuthenticator(
                server_host=settings['server_host'],
                base_dn=settings['base_dn'],
                user_search_base=settings.get('user_search_base', 'cn=users,cn=accounts'),
                group_search_base=settings.get('group_search_base', 'cn=groups,cn=accounts'),
                use_ldaps=settings.get('use_ldaps', True),
                ldaps_port=settings.get('ldaps_port', 636),
                ldap_port=settings.get('server_port', 389),
                verify_certificate=settings.get('verify_certificate', True),
                ca_certificate=ca_cert_path,
                connection_timeout=settings.get('connection_timeout_seconds', 10),
            )
        except Exception as e:
            self.log(f"Failed to create FreeIPA authenticator: {e}", "ERROR")
            return None
    
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

    # VCenter operations moved to VCenterMixin
    # (log_vcenter_activity, connect_vcenter, check_vcenter_connection,
    #  sync_vcenter_clusters, sync_vcenter_vms, _upsert_vm_batch,
    #  sync_vcenter_datastores, sync_vcenter_alarms, enter_vcenter_maintenance_mode,
    #  exit_vcenter_maintenance_mode, wait_for_vcenter_host_connected,
    #  auto_link_vcenter, get_vcenter_host, get_vcenter_settings)

    # Credential resolution methods moved to CredentialsMixin
    # (get_encryption_key, decrypt_password, ip_in_range, get_credential_sets,
    #  get_credential_sets_for_ip, get_esxi_credentials_for_host,
    #  resolve_credentials_for_server, get_server_credentials, get_credentials_for_server)
        except Exception as e:
            self.log(f"Error resolving credentials for server {server_id}: {str(e)}", "ERROR")
            return (None, None)

    def get_pending_jobs(self, instant_only=False, exclude_instant=False) -> List[Dict]:
        """Fetch pending jobs from the cloud
        
        Args:
            instant_only: Only return instant job types (console_launch, browse_datastore, etc.)
            exclude_instant: Exclude instant job types from results
        """
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
                # Filter by schedule_at and instant status
                ready_jobs = []
                for job in jobs:
                    # Check if scheduled time has passed
                    if job['schedule_at'] and datetime.fromisoformat(job['schedule_at'].replace('Z', '+00:00')) > datetime.now():
                        continue
                    
                    # Filter by instant job type
                    is_instant = job['job_type'] in INSTANT_JOB_TYPES
                    
                    if instant_only and not is_instant:
                        continue
                    if exclude_instant and is_instant:
                        continue
                    
                    ready_jobs.append(job)
                return ready_jobs
            else:
                self.log(f"Error fetching jobs: {response.status_code}", "ERROR")
                return []
        except Exception as e:
            self.log(f"Error fetching jobs: {e}", "ERROR")
            return []

    def get_job_tasks(self, job_id: str) -> List[Dict]:
        """Fetch tasks for a job"""
        try:
            url = f"{DSM_URL}/rest/v1/job_tasks"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}"
            }
            params = {"job_id": f"eq.{job_id}", "select": "*"}
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            
            if response.status_code == 200:
                return _safe_json_parse(response) or []
            else:
                self.log(f"Error fetching job tasks: {response.status_code}", "ERROR")
                return []
        except Exception as e:
            self.log(f"Error fetching job tasks: {e}", "ERROR")
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

    def update_task_status(self, task_id: str, status: str, log: str = None, progress: int = None, **kwargs):
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
            
            if progress is not None:
                payload["task"]["progress"] = progress

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
                "power_state": system_data.get("PowerState", None),  # Add power state
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
                
                # Fetch BIOS attributes for initial snapshot
                bios_data = self._fetch_bios_attributes(ip, username, password, server_id, job_id)
                if bios_data:
                    base_info['bios_attributes'] = bios_data
                    self.log(f"  ✓ BIOS attributes captured", "INFO")
                    
                    # Extract key BIOS fields for server record
                    base_info['cpu_model'] = bios_data.get('Proc1Brand')
                    base_info['cpu_cores_per_socket'] = bios_data.get('Proc1NumCores')
                    base_info['cpu_speed'] = bios_data.get('ProcCoreSpeed')
                    base_info['boot_mode'] = bios_data.get('BootMode')
                    boot_order_str = bios_data.get('SetBootOrderEn', '')
                    base_info['boot_order'] = boot_order_str.split(',') if boot_order_str else None
                    base_info['secure_boot'] = bios_data.get('SecureBoot')
                    base_info['virtualization_enabled'] = bios_data.get('ProcVirtualization') == 'Enabled'
                
                # Fetch storage drives via Dell Redfish API
                drives = self._fetch_storage_drives(ip, username, password, server_id, job_id)
                if drives:
                    base_info['drives'] = drives
                    base_info['total_drives'] = len(drives)
                    total_bytes = sum(d.get('capacity_bytes', 0) for d in drives)
                    base_info['total_storage_tb'] = round(total_bytes / (1024**4), 2) if total_bytes else None
                    self.log(f"  ✓ Discovered {len(drives)} drives ({base_info['total_storage_tb']} TB)", "INFO")
            
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
            'power_healthy': None,
            'power_state': None,
            'temperature_celsius': None,
            'fan_health': None
        }
        
        # First get system info for power state
        try:
            system_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1"
            system_response, system_time = self.throttler.request_with_safety(
                method='GET',
                url=system_url,
                ip=ip,
                logger=self.log,
                auth=(username, password),
                timeout=(2, 15)
            )
            
            if system_response and system_response.status_code == 200:
                system_json = system_response.json()
                health['power_state'] = system_json.get('PowerState')
                self.throttler.record_success(ip)
        except Exception as e:
            self.log(f"  Could not fetch power state: {e}", "WARN")
        
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
                    
                    # Extract additional thermal data
                    if health_type == 'thermal':
                        # Get temperature readings
                        temps = response_json.get('Temperatures', [])
                        if temps:
                            avg_temp = sum(t.get('ReadingCelsius', 0) for t in temps if t.get('ReadingCelsius')) / len([t for t in temps if t.get('ReadingCelsius')])
                            health['temperature_celsius'] = round(avg_temp, 1) if avg_temp else None
                        
                        # Get fan health
                        fans = response_json.get('Fans', [])
                        if fans:
                            all_fans_ok = all(
                                f.get('Status', {}).get('Health') == 'OK' 
                                for f in fans 
                                if f.get('Status', {}).get('Health')
                            )
                            health['fan_health'] = 'OK' if all_fans_ok else 'Warning'
                    
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
        """Fetch recent event logs (SEL + Lifecycle) and store in database"""
        total_logs = 0
        
        # Fetch SEL logs (System Event Log)
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
                log_count = self._store_event_logs(response_json, server_id, log_type='SEL')
                total_logs += log_count
                self.log(f"  Fetched {log_count} SEL logs")
                self.throttler.record_success(ip)
                
        except Exception as e:
            self.log(f"  Could not fetch SEL logs: {e}", "WARN")
        
        # Fetch Lifecycle logs
        try:
            url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Lclog/Entries"
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
                endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Lclog/Entries',
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
                log_count = self._store_event_logs(response_json, server_id, log_type='Lifecycle')
                total_logs += log_count
                self.log(f"  Fetched {log_count} Lifecycle logs")
                self.throttler.record_success(ip)
                
        except Exception as e:
            self.log(f"  Could not fetch Lifecycle logs: {e}", "WARN")
        
        return total_logs

    def _store_event_logs(self, data: Dict, server_id: str, log_type: str = 'SEL') -> int:
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
                    # Differentiate between SEL and Lifecycle log formats
                    category = log_entry.get('EntryType', log_type)
                    
                    log_data = {
                        'server_id': server_id,
                        'event_id': log_entry.get('Id'),
                        'timestamp': log_entry.get('Created', datetime.utcnow().isoformat() + 'Z'),
                        'severity': log_entry.get('Severity'),
                        'message': log_entry.get('Message'),
                        'category': f"{log_type}:{category}" if category else log_type,
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

    def _fetch_bios_attributes(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None) -> Optional[Dict]:
        """Fetch BIOS attributes for initial snapshot"""
        try:
            url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Bios"
            response, response_time = self.throttler.request_with_safety(
                method='GET',
                url=url,
                ip=ip,
                logger=self.log,
                auth=(username, password),
                timeout=(2, 15)
            )
            
            response_json = None
            if response and response.content:
                try:
                    response_json = response.json()
                except json.JSONDecodeError:
                    pass
            
            # Log the request
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Systems/System.Embedded.1/Bios',
                full_url=url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=response.status_code if response else None,
                response_time_ms=response_time,
                response_body=response_json,
                success=(response and response.status_code == 200 and response_json is not None),
                error_message=None if (response and response.status_code == 200) else f"HTTP {response.status_code}" if response else "Request failed",
                operation_type='idrac_api'
            )
            
            if response and response.status_code == 200 and response_json:
                return response_json.get('Attributes', {})
            
            return None
            
        except Exception as e:
            self.log(f"  Could not fetch BIOS attributes: {e}", "DEBUG")
            return None
    
    def _fetch_storage_drives(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None) -> List[Dict]:
        """
        Fetch drive inventory using Dell Redfish Storage API.
        
        Dell Redfish Pattern:
        1. GET /redfish/v1/Systems/System.Embedded.1/Storage → list controllers
        2. For each controller, GET Drives collection
        3. For each drive, extract: Manufacturer, Model, SerialNumber, MediaType, 
           CapacityBytes, Protocol, Status, PhysicalLocation
        """
        drives = []
        
        try:
            # Get storage controllers
            storage_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Storage"
            storage_response, storage_time = self.throttler.request_with_safety(
                method='GET',
                url=storage_url,
                ip=ip,
                logger=self.log,
                auth=(username, password),
                timeout=(2, 15)
            )
            
            if not storage_response or storage_response.status_code != 200:
                return drives
            
            storage_data = storage_response.json()
            controllers = storage_data.get('Members', [])
            
            for controller_ref in controllers:
                try:
                    controller_url = f"https://{ip}{controller_ref['@odata.id']}"
                    ctrl_resp, ctrl_time = self.throttler.request_with_safety(
                        method='GET',
                        url=controller_url,
                        ip=ip,
                        logger=self.log,
                        auth=(username, password),
                        timeout=(2, 15)
                    )
                    
                    if not ctrl_resp or ctrl_resp.status_code != 200:
                        continue
                        
                    ctrl_data = ctrl_resp.json()
                    controller_name = ctrl_data.get('Id', 'Unknown')
                    
                    # Get drives collection
                    drives_refs = ctrl_data.get('Drives', [])
                    for drive_ref in drives_refs:
                        try:
                            drive_url = f"https://{ip}{drive_ref['@odata.id']}"
                            drive_resp, drive_time = self.throttler.request_with_safety(
                                method='GET',
                                url=drive_url,
                                ip=ip,
                                logger=self.log,
                                auth=(username, password),
                                timeout=(2, 15)
                            )
                            
                            if not drive_resp or drive_resp.status_code != 200:
                                continue
                                
                            drive_data = drive_resp.json()
                            
                            # Extract drive info per Dell Redfish schema
                            capacity_bytes = drive_data.get('CapacityBytes', 0)
                            physical_location = drive_data.get('PhysicalLocation', {}).get('PartLocation', {})
                            
                            drives.append({
                                'name': drive_data.get('Id') or drive_data.get('Name'),
                                'manufacturer': drive_data.get('Manufacturer'),
                                'model': drive_data.get('Model'),
                                'serial_number': drive_data.get('SerialNumber'),
                                'part_number': drive_data.get('PartNumber'),
                                'media_type': drive_data.get('MediaType'),  # HDD, SSD
                                'protocol': drive_data.get('Protocol'),      # SATA, SAS, NVMe
                                'capacity_bytes': capacity_bytes,
                                'capacity_gb': round(capacity_bytes / (1024**3), 2) if capacity_bytes else None,
                                'slot': str(physical_location.get('LocationOrdinalValue')) if physical_location.get('LocationOrdinalValue') is not None else None,
                                'enclosure': physical_location.get('ServiceLabel'),
                                'controller': controller_name,
                                'health': drive_data.get('Status', {}).get('Health'),
                                'status': drive_data.get('Status', {}).get('State'),
                                'predicted_failure': drive_data.get('PredictedMediaLifeLeftPercent', 100) < 10 if drive_data.get('PredictedMediaLifeLeftPercent') else False,
                                'life_remaining_percent': drive_data.get('PredictedMediaLifeLeftPercent'),
                                'firmware_version': drive_data.get('Revision'),
                                'rotation_speed_rpm': drive_data.get('RotationSpeedRPM'),
                                'capable_speed_gbps': drive_data.get('CapableSpeedGbs'),
                            })
                        except Exception as e:
                            self.log(f"  Error fetching drive {drive_ref.get('@odata.id', 'unknown')}: {e}", "DEBUG")
                            continue
                except Exception as e:
                    self.log(f"  Error fetching controller {controller_ref.get('@odata.id', 'unknown')}: {e}", "DEBUG")
                    continue
            
            return drives
            
        except Exception as e:
            self.log(f"  Could not fetch storage drives: {e}", "DEBUG")
            return []
    
    def _sync_server_drives(self, server_id: str, drives: List[Dict]):
        """Sync drive inventory to server_drives table"""
        try:
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            
            for drive in drives:
                if not drive.get('serial_number'):
                    continue  # Skip drives without serial numbers
                
                drive_data = {
                    'server_id': server_id,
                    'name': drive.get('name'),
                    'manufacturer': drive.get('manufacturer'),
                    'model': drive.get('model'),
                    'serial_number': drive.get('serial_number'),
                    'part_number': drive.get('part_number'),
                    'media_type': drive.get('media_type'),
                    'protocol': drive.get('protocol'),
                    'capacity_bytes': drive.get('capacity_bytes'),
                    'capacity_gb': drive.get('capacity_gb'),
                    'slot': drive.get('slot'),
                    'enclosure': drive.get('enclosure'),
                    'controller': drive.get('controller'),
                    'health': drive.get('health'),
                    'status': drive.get('status'),
                    'predicted_failure': drive.get('predicted_failure'),
                    'life_remaining_percent': drive.get('life_remaining_percent'),
                    'firmware_version': drive.get('firmware_version'),
                    'rotation_speed_rpm': drive.get('rotation_speed_rpm'),
                    'capable_speed_gbps': drive.get('capable_speed_gbps'),
                    'last_sync': datetime.utcnow().isoformat() + 'Z',
                }
                
                # Upsert drive (update if exists, insert if new)
                upsert_url = f"{DSM_URL}/rest/v1/server_drives"
                upsert_params = {
                    "on_conflict": "server_id,serial_number",
                    "resolution": "merge-duplicates"
                }
                requests.post(upsert_url, headers=headers, json=drive_data, params=upsert_params, verify=VERIFY_SSL)
                
        except Exception as e:
            self.log(f"  Error syncing drives for server {server_id}: {e}", "WARN")
    
    def _create_server_audit_entry(self, server_id: str, job_id: str, action: str, summary: str, details: Dict = None):
        """Create audit trail entry for server operations"""
        try:
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            
            # Get job creator
            job_url = f"{DSM_URL}/rest/v1/jobs?id=eq.{job_id}&select=created_by"
            job_response = requests.get(job_url, headers=headers, verify=VERIFY_SSL)
            created_by = None
            if job_response.status_code == 200:
                jobs = _safe_json_parse(job_response)
                if jobs:
                    created_by = jobs[0].get('created_by')
            
            audit_entry = {
                'action': action,
                'details': {
                    'server_id': server_id,
                    'summary': summary,
                    **(details or {})
                },
                'user_id': created_by
            }
            
            insert_url = f"{DSM_URL}/rest/v1/audit_logs"
            requests.post(insert_url, headers=headers, json=audit_entry, verify=VERIFY_SSL)
            
        except Exception as e:
            self.log(f"  Could not create audit entry: {e}", "DEBUG")
    
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

    def _execute_inline_scp_export(self, server_id: str, ip: str, username: str, password: str, backup_name: str, job_id: str) -> bool:
        """Execute SCP export inline without creating a separate job"""
        try:
            # Use simpler SCP export for initial sync
            export_url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration"
            
            # Export all components in XML format
            payload = {
                "ExportFormat": "XML",
                "ShareParameters": {
                    "Target": "BIOS,IDRAC,NIC,RAID"
                },
                "ExportUse": "Clone",
                "IncludeInExport": "Default"
            }
            
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
                job_id=job_id,
                task_id=None,
                command_type='POST',
                endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration',
                full_url=export_url,
                request_headers={'Authorization': '[REDACTED]'},
                request_body=payload,
                response_body=_safe_json_parse(response),
                status_code=response.status_code,
                response_time_ms=response_time_ms,
                success=response.status_code in [200, 202],
                operation_type='idrac_api'
            )
            
            if response.status_code not in [200, 202]:
                self.log(f"    SCP export failed: {response.status_code}", "WARN")
                return False
            
            # Wait for export to complete and get content
            if response.status_code == 202:
                scp_content = self._wait_for_scp_export(
                    ip,
                    username,
                    password,
                    response.headers,
                    _safe_json_parse(response),
                    {'id': job_id},  # Minimal job dict
                    server_id
                )
            else:
                export_data = _safe_json_parse(response)
                scp_content = self._extract_scp_content(export_data) or export_data
            
            if not scp_content:
                self.log(f"    SCP export returned no content", "WARN")
                return False
            
            # Save to database
            if isinstance(scp_content, (dict, list)):
                serialized_content = json.dumps(scp_content, indent=2)
                checksum_content = json.dumps(scp_content, separators=(',', ':'))
            else:
                serialized_content = str(scp_content)
                checksum_content = serialized_content
            
            file_size = len(serialized_content.encode('utf-8'))
            checksum = hashlib.sha256(checksum_content.encode()).hexdigest()
            
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            backup_data = {
                'server_id': server_id,
                'export_job_id': job_id,
                'backup_name': backup_name,
                'description': 'Automatic backup during initial server sync',
                'scp_content': scp_content,
                'scp_file_size_bytes': file_size,
                'include_bios': True,
                'include_idrac': True,
                'include_nic': True,
                'include_raid': True,
                'scp_checksum': checksum,
                'is_valid': True
            }
            
            insert_url = f"{DSM_URL}/rest/v1/scp_backups"
            backup_response = requests.post(insert_url, headers=headers, json=backup_data, verify=VERIFY_SSL)
            
            return backup_response.status_code in [200, 201]
            
        except Exception as e:
            self.log(f"    Inline SCP export error: {e}", "WARN")
            return False

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
                    "success": True,
                    "idrac_detected": True,
                    "manufacturer": data.get("Manufacturer", "Unknown"),
                    "model": data.get("Model", "Unknown"),
                    "service_tag": data.get("SKU", None),
                    "serial": data.get("SerialNumber", None),
                    "hostname": data.get("HostName", None),
                    "username": username,
                    "password": password,
                }
            elif response and response.status_code in [401, 403]:
                # Authentication failure BUT iDRAC exists - this is key!
                self.throttler.record_failure(ip, response.status_code, self.log)
                return {
                    "success": False,
                    "idrac_detected": True,  # iDRAC is present, just auth failed
                    "auth_failed": True
                }
            else:
                # Other HTTP error - not a confirmed iDRAC
                return {
                    "success": False,
                    "idrac_detected": False,
                    "auth_failed": False
                }
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
            # Connection error - no iDRAC detected
            return {
                "success": False,
                "idrac_detected": False,
                "auth_failed": False
            }

    # More credential methods moved to CredentialsMixin
    # (resolve_credentials_for_server, get_credentials_for_server)
    # get_server_by_id moved to DatabaseMixin

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
            
            # Fetch job tasks to track progress
            tasks = self.get_job_tasks(job['id'])
            task_by_server = {t['server_id']: t for t in tasks if t.get('server_id')}
            
            total_servers = len(servers)
            refreshed_count = 0
            failed_count = 0
            update_errors = []
            
            for index, server in enumerate(servers):
                ip = server['ip_address']
                task = task_by_server.get(server['id'])
                
                # Calculate base progress percentage for this server
                base_progress = int((index / total_servers) * 100) if total_servers > 0 else 0
                
                # Update task to running
                if task:
                    self.update_task_status(
                        task['id'],
                        'running',
                        log=f"Querying iDRAC at {ip}...",
                        progress=base_progress,
                        started_at=datetime.now().isoformat()
                    )
                
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
                    
                    # Mark task as failed
                    if task:
                        self.update_task_status(
                            task['id'],
                            'failed',
                            log=f"✗ Cannot decrypt credentials for {ip}",
                            progress=100,
                            completed_at=datetime.now().isoformat()
                        )
                    
                    failed_count += 1
                    continue
                
                if not username or not password:
                    self.log(f"  ✗ No credentials available for {ip}", "WARN")
                    
                    # Mark task as failed
                    if task:
                        self.update_task_status(
                            task['id'],
                            'failed',
                            log=f"✗ No credentials available for {ip}",
                            progress=100,
                            completed_at=datetime.now().isoformat()
                        )
                    
                    failed_count += 1
                    continue
                
                # Query iDRAC for comprehensive info
                info = self.get_comprehensive_server_info(ip, username, password, server_id=server['id'], job_id=job['id'])
                
                if info:
                    # Define allowed server columns for update
                    allowed_fields = {
                        "manufacturer", "model", "product_name", "service_tag", "hostname",
                        "bios_version", "cpu_count", "memory_gb", "idrac_firmware",
                        "manager_mac_address", "redfish_version", "supported_endpoints",
                        "cpu_model", "cpu_cores_per_socket", "cpu_speed",
                        "boot_mode", "boot_order", "secure_boot", "virtualization_enabled",
                        "total_drives", "total_storage_tb", "power_state"
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
                    
                    # Add health fields from health_status if available
                    if info.get('health_status'):
                        health_status = info['health_status']
                        
                        # Calculate overall_health
                        all_healthy = all([
                            health_status.get('storage_healthy', True) != False,
                            health_status.get('thermal_healthy', True) != False,
                            health_status.get('power_healthy', True) != False
                        ])
                        update_data['overall_health'] = 'OK' if all_healthy else 'Warning'
                        update_data['last_health_check'] = datetime.utcnow().isoformat() + 'Z'
                    
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
                        
                        # Insert health record to server_health table if health data exists
                        if info.get('health_status'):
                            health_status = info['health_status']
                            health_record = {
                                'server_id': server['id'],
                                'timestamp': datetime.utcnow().isoformat() + 'Z',
                                'overall_health': update_data.get('overall_health', 'Unknown'),
                                'power_state': health_status.get('power_state') or info.get('power_state'),
                                'storage_health': 'OK' if health_status.get('storage_healthy') else ('Warning' if health_status.get('storage_healthy') == False else None),
                                'fan_health': health_status.get('fan_health'),
                                'psu_health': 'OK' if health_status.get('power_healthy') else ('Warning' if health_status.get('power_healthy') == False else None),
                                'temperature_celsius': health_status.get('temperature_celsius'),
                                'sensors': {}
                            }
                            
                            try:
                                health_url = f"{DSM_URL}/rest/v1/server_health"
                                health_response = requests.post(
                                    health_url,
                                    headers=headers,
                                    json=health_record,
                                    verify=VERIFY_SSL
                                )
                                if health_response.status_code in [200, 201]:
                                    self.log(f"  ✓ Health record saved to server_health table", "DEBUG")
                                else:
                                    self.log(f"  Warning: Could not save health record: {health_response.status_code}", "WARN")
                            except Exception as health_err:
                                self.log(f"  Warning: Failed to save health record: {health_err}", "WARN")
                        
                        # Sync drives to server_drives table
                        if info.get('drives'):
                            self._sync_server_drives(server['id'], info['drives'])
                        
                        # Try auto-linking to vCenter if service_tag was updated
                        if info.get('service_tag'):
                            self.auto_link_vcenter(server['id'], info.get('service_tag'))
                        
                        # Mark task as completed
                        if task:
                            self.update_task_status(
                                task['id'],
                                'completed',
                                log=f"✓ Refreshed {ip}: {info.get('model')} - {info.get('hostname')}",
                                progress=100,
                                completed_at=datetime.now().isoformat()
                            )
                        
                        # Create audit trail entry for server discovery
                        self._create_server_audit_entry(
                            server_id=server['id'],
                            job_id=job['id'],
                            action='server_discovery',
                            summary=f"Server discovered: {info.get('model', 'Unknown')} ({info.get('service_tag', 'N/A')})",
                            details={
                                'bios_version': info.get('bios_version'),
                                'idrac_firmware': info.get('idrac_firmware'),
                                'health_status': info.get('health_status'),
                                'event_logs_fetched': info.get('event_log_count', 0)
                            }
                        )
                        
                        # Create inline SCP backup for newly synced servers
                        self.log(f"  📦 Creating initial SCP backup for {ip}...")
                        try:
                            scp_success = self._execute_inline_scp_export(
                                server_id=server['id'],
                                ip=ip,
                                username=username,
                                password=password,
                                backup_name=f'Initial-{datetime.now().strftime("%Y%m%d-%H%M%S")}',
                                job_id=job['id']
                            )
                            if scp_success:
                                self.log(f"  ✓ SCP backup created for {ip}")
                                refreshed_count += 1
                            else:
                                self.log(f"  ⚠ SCP backup skipped for {ip}", "WARN")
                        except Exception as scp_err:
                            self.log(f"  ⚠ SCP backup failed for {ip}: {scp_err}", "WARN")
                    else:
                        error_detail = {
                            'ip': ip,
                            'status': update_response.status_code,
                            'body': update_response.text[:500]
                        }
                        update_errors.append(error_detail)
                        self.log(f"  ✗ Failed to update DB for {ip}: {update_response.status_code} {update_response.text}", "ERROR")
                        
                        # Mark task as failed
                        if task:
                            self.update_task_status(
                                task['id'],
                                'failed',
                                log=f"✗ Failed to update DB for {ip}",
                                progress=100,
                                completed_at=datetime.now().isoformat()
                            )
                        
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
                    
                    # Mark task as failed
                    if task:
                        self.update_task_status(
                            task['id'],
                            'failed',
                            log=f"✗ Failed to connect to {ip}",
                            progress=100,
                            completed_at=datetime.now().isoformat()
                        )
                    
                    failed_count += 1
            
            # Complete the job
            summary = f"Synced {refreshed_count} server(s)"
            if failed_count > 0:
                summary += f", {failed_count} failed"
            
            job_details = {
                'summary': summary,
                'synced': refreshed_count,
                'failed': failed_count,
                'scp_backups_created': refreshed_count  # All successful syncs include SCP backup
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

    # get_credential_sets moved to CredentialsMixin


    def _quick_port_check(self, ip: str, port: int = 443, timeout: float = 1.0) -> bool:
        """
        Stage 1: Quick TCP port check to identify live IPs.
        Returns True if port is open, False otherwise.
        """
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            result = sock.connect_ex((ip, port))
            sock.close()
            return result == 0
        except:
            return False
    
    def _detect_idrac(self, ip: str, timeout: float = 2.0) -> bool:
        """
        Stage 2: Quick iDRAC detection via unauthenticated request to /redfish/v1.
        Dell iDRACs respond with 401/403 and specific headers.
        Returns True if iDRAC detected, False otherwise.
        """
        try:
            url = f"https://{ip}/redfish/v1"
            response = requests.get(
                url,
                verify=False,
                timeout=timeout,
                allow_redirects=False
            )
            
            # Dell iDRACs typically return 401/403 for unauthenticated requests
            # or 200 with Redfish service root
            if response.status_code in [200, 401, 403]:
                # Check for Dell/iDRAC indicators in headers or response
                server_header = response.headers.get('Server', '').lower()
                content_type = response.headers.get('Content-Type', '').lower()
                
                # Dell iDRAC indicators
                if 'idrac' in server_header or 'dell' in server_header:
                    return True
                
                # Redfish service root check (200 response)
                if response.status_code == 200 and 'application/json' in content_type:
                    try:
                        data = response.json()
                        # Check for Redfish identifiers
                        if 'RedfishVersion' in data or '@odata.context' in data:
                            return True
                    except:
                        pass
                
                # 401/403 with WWW-Authenticate suggests Redfish API
                if response.status_code in [401, 403]:
                    www_auth = response.headers.get('WWW-Authenticate', '').lower()
                    if 'basic' in www_auth or 'digest' in www_auth:
                        return True
            
            return False
        except:
            return False
    
    def discover_single_ip(self, ip: str, credential_sets: List[Dict], job_id: str) -> Dict:
        """
        3-Stage optimized IP discovery:
        Stage 1: Quick TCP port check (443)
        Stage 2: Unauthenticated iDRAC detection (/redfish/v1)
        Stage 3: Full authentication only on confirmed iDRACs
        
        Priority:
          1. Credential sets matching IP ranges (highest priority)
          2. Global credential sets selected in the discovery job
        """
        
        # Stage 1: Quick port check - skip IPs with closed port 443
        port_open = self._quick_port_check(ip, port=443, timeout=1.0)
        if not port_open:
            return {
                'success': False,
                'ip': ip,
                'idrac_detected': False,
                'auth_failed': False,
                'port_open': False
            }
        
        # Stage 2: Quick iDRAC detection - skip non-iDRAC devices
        if not self._detect_idrac(ip, timeout=2.0):
            return {
                'success': False,
                'ip': ip,
                'idrac_detected': False,
                'auth_failed': False,
                'port_open': True
            }
        
        # Stage 3: Full authentication on confirmed iDRACs
        self.log(f"iDRAC detected at {ip}, attempting authentication...", "INFO")
        
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
        
        # Track if any response indicated an iDRAC exists (401/403 response)
        idrac_detected = False
        
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
                    # Track if iDRAC was detected by ANY credential attempt
                    if result.get('idrac_detected'):
                        idrac_detected = True
                    
                    # If successful, return immediately
                    if result.get('success'):
                        return {
                            'success': True,
                            'ip': ip,
                            'idrac_detected': True,
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
            'idrac_detected': idrac_detected,  # Only True if we got 401/403
            'auth_failed': idrac_detected  # Only mark auth_failed if iDRAC exists
        }

    def insert_discovered_server(self, server: Dict, job_id: str):
        """Insert discovered server into database with credential info"""
        try:
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            
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
                # Link to credential set directly - don't store plaintext passwords
                'credential_set_id': server.get('credential_set_id'),
                'credential_test_status': 'valid',
                'credential_last_tested': datetime.now().isoformat(),
                'discovered_by_credential_set_id': server.get('credential_set_id'),
                'discovery_job_id': job_id,
                'cpu_model': server.get('cpu_model'),
                'cpu_cores_per_socket': server.get('cpu_cores_per_socket'),
                'cpu_speed': server.get('cpu_speed'),
                'boot_mode': server.get('boot_mode'),
                'boot_order': server.get('boot_order'),
                'secure_boot': server.get('secure_boot'),
                'virtualization_enabled': server.get('virtualization_enabled'),
                'total_drives': server.get('total_drives'),
                'total_storage_tb': server.get('total_storage_tb'),
            }
            
            if existing.status_code == 200 and _safe_json_parse(existing):
                # Update existing server
                server_id = _safe_json_parse(existing)[0]['id']
                update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}"
                requests.patch(update_url, headers=headers, json=server_data, verify=VERIFY_SSL)
                self.log(f"Updated existing server: {server['ip']}")
                
                # Sync drives to server_drives table
                if server.get('drives'):
                    self._sync_server_drives(server_id, server['drives'])
                
                # Try auto-linking to vCenter
                if server.get('service_tag'):
                    self.auto_link_vcenter(server_id, server.get('service_tag'))
            else:
                # Insert new server
                server_data['ip_address'] = server['ip']
                insert_url = f"{DSM_URL}/rest/v1/servers"
                response = requests.post(insert_url, headers=headers, json=server_data, verify=VERIFY_SSL)
                self.log(f"Inserted new server: {server['ip']}")
                
                # Try auto-linking to vCenter for new server
                if response.status_code in [200, 201]:
                    new_server = _safe_json_parse(response)
                    if new_server:
                        server_id = new_server[0]['id'] if isinstance(new_server, list) else new_server['id']
                        
                        # Sync drives for new server
                        if server.get('drives'):
                            self._sync_server_drives(server_id, server['drives'])
                        
                        if server.get('service_tag'):
                            self.auto_link_vcenter(server_id, server.get('service_tag'))
        except Exception as e:
            self.log(f"Error inserting server {server['ip']}: {e}", "ERROR")

    def insert_auth_failed_server(self, ip: str, job_id: str):
        """Insert server that was discovered but authentication failed"""
        try:
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            
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

    # execute_discovery_scan moved to DiscoveryHandler

    # connect_vcenter moved to VCenterMixin
    # check_vcenter_connection moved to VCenterMixin

    # All execute_* methods have been moved to their respective handler classes:
    # - execute_vcenter_sync -> VCenterHandlers
    # - execute_firmware_update -> FirmwareHandler
    # - execute_full_server_update -> FirmwareHandler
    # - execute_test_credentials -> DiscoveryHandler
    # - execute_power_action -> PowerHandler
    # - execute_health_check -> DiscoveryHandler
    # - execute_fetch_event_logs -> DiscoveryHandler
    # - execute_boot_configuration -> BootHandler
    # - execute_virtual_media_mount -> VirtualMediaHandler
    # - execute_virtual_media_unmount -> VirtualMediaHandler
    # - execute_bios_config_read -> BootHandler
    # - execute_openmanage_sync -> VCenterHandlers
    # - execute_bios_config_write -> BootHandler
    # - execute_prepare_host_for_update -> ClusterHandler
    # - execute_verify_host_after_update -> ClusterHandler
    # - execute_rolling_cluster_update -> ClusterHandler
    # - execute_idm_authenticate -> IDMHandler
    # - execute_idm_test_connection -> IDMHandler
    # - execute_idm_sync_users -> IDMHandler
    # - execute_console_launch -> ConsoleHandler
    # - execute_iso_upload -> MediaUploadHandler
    # - execute_scan_local_isos -> MediaUploadHandler
    # - execute_register_iso_url -> MediaUploadHandler
    # - execute_cluster_safety_check -> ClusterHandler
    # - execute_server_group_safety_check -> ClusterHandler
    # - execute_esxi_upgrade -> ESXiHandler
    # - execute_esxi_then_firmware -> ESXiHandler
    # - execute_firmware_then_esxi -> ESXiHandler
    # - execute_esxi_preflight_check -> ESXiHandler
    # - execute_browse_datastore -> DatastoreHandler
    # - execute_firmware_upload -> MediaUploadHandler
    # - execute_catalog_sync -> MediaUploadHandler
    # - execute_vcenter_connectivity_test -> VCenterHandlers

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
            'bios_config_read', 'bios_config_write',
            'prepare_host_for_update', 'verify_host_after_update', 'rolling_cluster_update',
            'esxi_upgrade', 'esxi_then_firmware', 'firmware_then_esxi'
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
        
        # Dispatch to handler
        handler_map = {
            'discovery_scan': self.discovery_handler.execute_discovery_scan,
            'firmware_update': self.firmware_handler.execute_firmware_update,
            'full_server_update': self.firmware_handler.execute_full_server_update,
            'test_credentials': self.discovery_handler.execute_test_credentials,
            'power_action': self.power_handler.execute_power_action,
            'health_check': self.discovery_handler.execute_health_check,
            'fetch_event_logs': self.discovery_handler.execute_fetch_event_logs,
            'boot_configuration': self.boot_handler.execute_boot_configuration,
            'virtual_media_mount': self.virtual_media_handler.execute_virtual_media_mount,
            'virtual_media_unmount': self.virtual_media_handler.execute_virtual_media_unmount,
            'scp_export': self.execute_scp_export,
            'scp_import': self.execute_scp_import,
            'bios_config_read': self.boot_handler.execute_bios_config_read,
            'bios_config_write': self.boot_handler.execute_bios_config_write,
            'vcenter_sync': self.vcenter_handler.execute_vcenter_sync,
            'vcenter_connectivity_test': self.vcenter_handler.execute_vcenter_connectivity_test,
            'openmanage_sync': self.vcenter_handler.execute_openmanage_sync,
            'cluster_safety_check': self.cluster_handler.execute_cluster_safety_check,
            'server_group_safety_check': self.cluster_handler.execute_server_group_safety_check,
            'prepare_host_for_update': self.cluster_handler.execute_prepare_host_for_update,
            'verify_host_after_update': self.cluster_handler.execute_verify_host_after_update,
            'rolling_cluster_update': self.cluster_handler.execute_rolling_cluster_update,
            'iso_upload': self.media_handler.execute_iso_upload,
            'scan_local_isos': self.media_handler.execute_scan_local_isos,
            'register_iso_url': self.media_handler.execute_register_iso_url,
            'firmware_upload': self.media_handler.execute_firmware_upload,
            'catalog_sync': self.media_handler.execute_catalog_sync,
            'console_launch': self.console_handler.execute_console_launch,
            'esxi_upgrade': self.esxi_handler.execute_esxi_upgrade,
            'esxi_then_firmware': self.esxi_handler.execute_esxi_then_firmware,
            'firmware_then_esxi': self.esxi_handler.execute_firmware_then_esxi,
            'browse_datastore': self.datastore_handler.execute_browse_datastore,
            'esxi_preflight_check': self.esxi_handler.execute_esxi_preflight_check,
            'idm_authenticate': self.idm_handler.execute_idm_authenticate,
            'idm_test_connection': self.idm_handler.execute_idm_test_connection,
            'idm_sync_users': self.idm_handler.execute_idm_sync_users,
        }
        
        handler = handler_map.get(job_type)
        if handler:
            handler(job)
        else:
            self.log(f"Unknown job type: {job_type}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={"error": f"Unsupported job type: {job_type}"}
            )
    
    # SCP operations implemented in ScpMixin

    # Connectivity tests implemented in ConnectivityMixin

    # Connectivity test job implemented in ConnectivityMixin





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
        
        # Start media server if enabled (serves ISOs + firmware DUPs)
        if MEDIA_SERVER_ENABLED:
            try:
                self.media_server = MediaServer(ISO_DIRECTORY, FIRMWARE_DIRECTORY, MEDIA_SERVER_PORT)
                self.media_server.start()
                self.log("="*70)
                self.log(f"MEDIA SERVER STARTED: http://{self.get_local_ip()}:{MEDIA_SERVER_PORT}")
                self.log(f"ISO Directory: {ISO_DIRECTORY}")
                self.log(f"Firmware Directory: {FIRMWARE_DIRECTORY}")
                self.log("="*70)
            except Exception as e:
                self.log(f"Warning: Could not start media server: {e}", "WARN")
        
        try:
            while self.running:
                try:
                    # FAST-TRACK: Process instant jobs immediately (console, datastore browsing, etc.)
                    instant_jobs = self.get_pending_jobs(instant_only=True)
                    if instant_jobs:
                        self.log(f"[FAST-TRACK] Found {len(instant_jobs)} instant job(s)")
                        for job in instant_jobs:
                            self.log(f"[FAST-TRACK] Executing instant job {job['id']} ({job['job_type']})")
                            self.execute_job(job)
                    
                    # Regular jobs - process one at a time to avoid overwhelming the system
                    regular_jobs = self.get_pending_jobs(exclude_instant=True)
                    if regular_jobs:
                        job = regular_jobs[0]  # Process one regular job per cycle
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
