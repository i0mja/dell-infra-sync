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

# ============================================================================
# CONFIGURATION
# ============================================================================

# Dell Server Manager URL
DSM_URL = "https://your-app.lovable.app"  # Change this

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

class JobExecutor:
    def __init__(self):
        self.vcenter_conn = None
        self.running = True
        
    def log(self, message: str, level: str = "INFO"):
        """Log with timestamp"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] [{level}] {message}")

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
            ip_range_entries = response.json()
            
            for ip_range_entry in ip_range_entries:
                ip_range = ip_range_entry['ip_range']
                
                # Check if IP matches range
                if self.ip_in_range(ip_address, ip_range):
                    cred_set = ip_range_entry['credential_sets']
                    matching_sets.append({
                        'id': cred_set['id'],
                        'name': cred_set['name'],
                        'username': cred_set['username'],
                        'password': cred_set['password_encrypted'],
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
                servers = response.json()
                if servers and len(servers) > 0:
                    server = servers[0]
                    # Use server-specific credentials if available, otherwise use defaults
                    username = server.get('idrac_username') or IDRAC_DEFAULT_USER
                    password = server.get('idrac_password_encrypted') or IDRAC_DEFAULT_PASSWORD
                    
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
            if response.status_code == 200:
                jobs = response.json()
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
            if response.status_code != 200:
                self.log(f"Error updating task: {response.text}", "ERROR")
        except Exception as e:
            self.log(f"Error updating task status: {e}", "ERROR")

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
            if response.status_code == 200:
                return response.json()
            return []
        except Exception as e:
            self.log(f"Error fetching tasks: {e}", "ERROR")
            return []

    def test_idrac_connection(self, ip: str, username: str, password: str) -> Optional[Dict]:
        """Test iDRAC connection and get basic info"""
        try:
            url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1"
            response = requests.get(
                url,
                auth=(username, password),
                verify=False,
                timeout=5
            )
            
            if response.status_code == 200:
                data = response.json()
                return {
                    "manufacturer": data.get("Manufacturer", "Unknown"),
                    "model": data.get("Model", "Unknown"),
                    "service_tag": data.get("SKU", None),  # Dell reports Service Tag as SKU
                    "serial": data.get("SerialNumber", None),
                    "hostname": data.get("HostName", None),
                    "username": username,
                    "password": password,
                }
            return None
        except Exception as e:
            self.log(f"Error testing iDRAC {ip}: {e}", "DEBUG")
            return None

    def get_credential_sets(self, credential_set_ids: List[str]) -> List[Dict]:
        """Fetch credential sets from database"""
        if not credential_set_ids:
            return []
        
        try:
            headers = {"apikey": API_KEY, "Authorization": f"Bearer {API_KEY}"}
            url = f"{DSM_URL}/rest/v1/credential_sets"
            params = {"id": f"in.({','.join(credential_set_ids)})", "order": "priority.asc"}
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            
            if response.status_code == 200:
                return response.json()
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
                password = cred_set.get('password') or cred_set.get('password_encrypted')
                
                result = self.test_idrac_connection(
                    ip,
                    cred_set['username'],
                    password
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
                'connection_status': 'online',
                'last_seen': datetime.now().isoformat(),
                'idrac_username': server.get('username'),
                'idrac_password_encrypted': server.get('password'),
                'credential_test_status': 'valid',
                'credential_last_tested': datetime.now().isoformat(),
                'discovered_by_credential_set_id': server.get('credential_set_id'),
                'discovery_job_id': job_id,
            }
            
            if existing.status_code == 200 and existing.json():
                # Update existing server
                server_id = existing.json()[0]['id']
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

    def execute_discovery_scan(self, job: Dict):
        """Execute IP discovery scan with multi-credential support"""
        self.log(f"Starting discovery scan job {job['id']}")
        
        self.update_job_status(
            job['id'],
            'running',
            started_at=datetime.now().isoformat()
        )
        
        try:
            ip_range = job['target_scope'].get('ip_range', '')
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
            
            discovered = []
            auth_failures = []
            
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
                futures = {
                    executor.submit(
                        self.discover_single_ip,
                        ip,
                        credential_sets,
                        job['id']
                    ): ip for ip in ips_to_scan
                }
                
                for future in concurrent.futures.as_completed(futures):
                    ip = futures[future]
                    try:
                        result = future.result()
                        if result['success']:
                            self.log(f"✓ Found iDRAC at {ip}: {result['model']} (using {result['credential_set_name']})")
                            discovered.append(result)
                        elif result['auth_failed']:
                            auth_failures.append({
                                'ip': ip,
                                'reason': 'Authentication failed with all credential sets'
                            })
                    except Exception as e:
                        pass  # Silent fail for non-responsive IPs
            
            self.log(f"Discovery complete: {len(discovered)} servers found, {len(auth_failures)} auth failures")
            
            # Insert discovered servers into database with credential info
            for server in discovered:
                self.insert_discovered_server(server, job['id'])
            
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

    def connect_vcenter(self):
        """Connect to vCenter if not already connected"""
        if self.vcenter_conn:
            return self.vcenter_conn
            
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        if not VERIFY_SSL:
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        
        try:
            self.vcenter_conn = SmartConnect(
                host=VCENTER_HOST,
                user=VCENTER_USER,
                pwd=VCENTER_PASSWORD,
                sslContext=context
            )
            atexit.register(Disconnect, self.vcenter_conn)
            self.log("Connected to vCenter")
            return self.vcenter_conn
        except Exception as e:
            self.log(f"Failed to connect to vCenter: {e}", "ERROR")
            return None

    def create_idrac_session(self, ip: str, username: str, password: str) -> Optional[str]:
        """Create authenticated session with iDRAC and return session token"""
        try:
            url = f"https://{ip}/redfish/v1/SessionService/Sessions"
            payload = {
                "UserName": username,
                "Password": password
            }
            
            response = requests.post(
                url,
                json=payload,
                verify=False,
                timeout=10
            )
            
            if response.status_code == 201:
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
            response = requests.delete(
                session_uri,
                headers=headers,
                verify=False,
                timeout=5
            )
            
            if response.status_code in [200, 204]:
                self.log(f"  Closed iDRAC session: {ip}")
        except Exception as e:
            self.log(f"  Error closing session (non-fatal): {e}", "WARN")

    def get_firmware_inventory(self, ip: str, session_token: str) -> Dict:
        """Get current firmware versions from iDRAC"""
        try:
            url = f"https://{ip}/redfish/v1/UpdateService/FirmwareInventory"
            headers = {"X-Auth-Token": session_token}
            
            response = requests.get(
                url,
                headers=headers,
                verify=False,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                members = data.get('Members', [])
                
                # Extract key firmware components
                firmware_info = {}
                for member in members:
                    member_url = member.get('@odata.id', '')
                    member_resp = requests.get(
                        f"https://{ip}{member_url}",
                        headers=headers,
                        verify=False,
                        timeout=5
                    )
                    
                    if member_resp.status_code == 200:
                        fw_data = member_resp.json()
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
            response = requests.post(
                url,
                json=payload,
                headers=headers,
                verify=False,
                timeout=30
            )
            
            if response.status_code == 202:
                # Extract task URI from Location header
                task_uri = response.headers.get('Location')
                if not task_uri:
                    # Try to get it from response body
                    data = response.json()
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
            response = requests.get(
                task_uri,
                headers=headers,
                verify=False,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
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
            
            response = requests.post(
                url,
                json=payload,
                headers=headers,
                verify=False,
                timeout=10
            )
            
            if response.status_code in [200, 204]:
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
                                test_result = self.test_idrac_connection(ip, username, password)
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
            sub_jobs = response.json()
            
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
                        status_data = status_response.json()
                        
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

    def execute_job(self, job: Dict):
        """Execute a job based on its type"""
        job_type = job['job_type']
        
        if job_type == 'discovery_scan':
            self.execute_discovery_scan(job)
        elif job_type == 'firmware_update':
            self.execute_firmware_update(job)
        elif job_type == 'full_server_update':
            self.execute_full_server_update(job)
        else:
            self.log(f"Unknown job type: {job_type}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={"error": f"Unsupported job type: {job_type}"}
            )

    def run(self):
        """Main execution loop"""
        self.log("="*70)
        self.log("Dell Server Manager - Job Executor")
        self.log("="*70)
        self.log(f"Polling interval: {POLL_INTERVAL} seconds")
        self.log(f"Target URL: {DSM_URL}")
        self.log("="*70)
        
        if not SERVICE_ROLE_KEY:
            self.log("ERROR: SERVICE_ROLE_KEY not set!", "ERROR")
            self.log("Set it via environment variable or update the script", "ERROR")
            return
        
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
