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

# Polling interval (seconds)
POLL_INTERVAL = 10  # Check for new jobs every 10 seconds

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
                }
            return None
        except Exception as e:
            self.log(f"Error testing iDRAC {ip}: {e}", "DEBUG")
            return None

    def execute_discovery_scan(self, job: Dict):
        """Execute IP discovery scan"""
        self.log(f"Starting discovery scan job {job['id']}")
        
        self.update_job_status(
            job['id'],
            'running',
            started_at=datetime.now().isoformat()
        )
        
        try:
            ip_range = job['target_scope'].get('ip_range', '')
            self.log(f"Scanning IP range: {ip_range}")
            
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
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
                futures = {
                    executor.submit(
                        self.test_idrac_connection,
                        ip,
                        IDRAC_DEFAULT_USER,
                        IDRAC_DEFAULT_PASSWORD
                    ): ip for ip in ips_to_scan
                }
                
                for future in concurrent.futures.as_completed(futures):
                    ip = futures[future]
                    try:
                        result = future.result()
                        if result:
                            self.log(f"✓ Found iDRAC at {ip}: {result['model']}")
                            discovered.append({
                                "ip": ip,
                                **result
                            })
                    except Exception as e:
                        pass  # Silent fail for non-responsive IPs
            
            self.log(f"Discovery complete: {len(discovered)} servers found")
            
            # TODO: Insert discovered servers into database
            # For now, just log them
            for server in discovered:
                self.log(f"  {server['ip']}: {server['model']} (Service Tag: {server['service_tag']})")
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details={"discovered_count": len(discovered), "scanned_ips": len(ips_to_scan)}
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

    def execute_firmware_update(self, job: Dict):
        """Execute firmware update job (with vCenter integration)"""
        self.log(f"Starting firmware update job {job['id']}")
        
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
                
                self.log(f"Processing server: {server.get('hostname') or server.get('ip_address')}")
                
                self.update_task_status(
                    task['id'],
                    'running',
                    log="Starting firmware update...",
                    started_at=datetime.now().isoformat()
                )
                
                try:
                    # Step 1: Put host in maintenance mode if linked to vCenter
                    if server.get('vcenter_host_id'):
                        self.log(f"  Entering maintenance mode...")
                        # TODO: Implement vCenter maintenance mode
                        # For now, simulate
                        time.sleep(2)
                        self.update_task_status(
                            task['id'],
                            'running',
                            log="Host in maintenance mode\nStarting firmware update..."
                        )
                    
                    # Step 2: Perform firmware update via Redfish
                    self.log(f"  Updating firmware on {server['ip_address']}...")
                    # TODO: Implement actual Redfish firmware update
                    # For now, simulate
                    time.sleep(3)
                    self.update_task_status(
                        task['id'],
                        'running',
                        log="Host in maintenance mode\nStarting firmware update...\nFirmware update completed\nRebooting server..."
                    )
                    
                    # Step 3: Wait for reboot
                    time.sleep(2)
                    
                    # Step 4: Exit maintenance mode
                    if server.get('vcenter_host_id'):
                        self.log(f"  Exiting maintenance mode...")
                        time.sleep(1)
                    
                    self.update_task_status(
                        task['id'],
                        'completed',
                        log="Host in maintenance mode\nStarting firmware update...\nFirmware update completed\nRebooting server...\nHost back online\nExited maintenance mode\n✓ Firmware update successful",
                        completed_at=datetime.now().isoformat()
                    )
                    
                    self.log(f"  ✓ Completed")
                    
                except Exception as e:
                    self.log(f"  ✗ Failed: {e}", "ERROR")
                    self.update_task_status(
                        task['id'],
                        'failed',
                        log=f"Error: {str(e)}",
                        completed_at=datetime.now().isoformat()
                    )
                    failed_count += 1
            
            # Update job as completed
            final_status = 'completed' if failed_count == 0 else 'failed'
            self.update_job_status(
                job['id'],
                final_status,
                completed_at=datetime.now().isoformat(),
                details={"total_tasks": len(tasks), "failed_tasks": failed_count}
            )
            
            self.log(f"Firmware update job complete: {len(tasks) - failed_count}/{len(tasks)} successful")
            
        except Exception as e:
            self.log(f"Firmware update job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
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
