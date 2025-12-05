"""Firmware update handlers"""

from typing import Dict
from datetime import datetime, timezone
import time
import requests
from .base import BaseHandler
from job_executor.utils import utc_now_iso


class FirmwareHandler(BaseHandler):
    """Handles firmware update operations"""
    
    def execute_firmware_update(self, job: Dict):
        """Execute firmware update job with support for manual repository and Dell online catalog"""
        from job_executor.config import (
            DSM_URL, SERVICE_ROLE_KEY, FIRMWARE_REPO_URL, 
            FIRMWARE_UPDATE_TIMEOUT, SYSTEM_REBOOT_WAIT, SYSTEM_ONLINE_CHECK_ATTEMPTS, VERIFY_SSL
        )
        from job_executor.utils import _safe_json_parse
        
        self.log(f"Starting firmware update job {job['id']}")
        
        # Get firmware details from job
        details = job.get('details', {})
        firmware_source = details.get('firmware_source', 'manual_repository')
        firmware_uri = details.get('firmware_uri')
        dell_catalog_url = details.get('dell_catalog_url', 'https://downloads.dell.com/catalog/Catalog.xml')
        component = details.get('component', 'BIOS')
        version = details.get('version', 'latest')
        apply_time = details.get('apply_time', 'OnReset')
        auto_select_latest = details.get('auto_select_latest', True)
        
        use_catalog = firmware_source == 'dell_online_catalog'
        
        if use_catalog:
            self.log(f"Using Dell online catalog: {dell_catalog_url}")
            self.log(f"Component filter: {component}")
        else:
            if not firmware_uri:
                firmware_uri = f"{FIRMWARE_REPO_URL}/{component}_{version}.exe"
            self.log(f"Firmware URI: {firmware_uri}")
        
        # Construct firmware URI if not provided
        if not firmware_uri:
            firmware_uri = f"{FIRMWARE_REPO_URL}/{component}_{version}.exe"
        
        self.log(f"Firmware URI: {firmware_uri}")
        self.log(f"Apply time: {apply_time}")
        
        self.update_job_status(
            job['id'],
            'running',
            started_at=utc_now_iso()
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
                    started_at=utc_now_iso()
                )
                
                session_token = None
                
                try:
                    # Step 1: Get server-specific credentials
                    username, password = self.executor.get_server_credentials(server['id'])
                    if not username or not password:
                        raise Exception("No credentials configured for server")

                    # Step 2: Create iDRAC session
                    session_token = self.executor.create_idrac_session(
                        ip, username, password
                    )
                    
                    if not session_token:
                        raise Exception("Failed to authenticate with iDRAC")
                    
                    self.update_task_status(
                        task['id'], 'running',
                        log="✓ Connected to iDRAC\nChecking current firmware..."
                    )
                    
                    # Step 2: Clear stale iDRAC jobs before update (prevents RED014/JCP042 errors)
                    clear_stale_jobs = details.get('clear_stale_jobs_before_update', True)
                    if clear_stale_jobs:
                        self.log(f"  Checking for stale iDRAC jobs...")
                        self.update_task_status(task['id'], 'running',
                            log="✓ Connected to iDRAC\n→ Checking job queue...", progress=5)
                        try:
                            dell_ops = self.executor._get_dell_operations()
                            clear_result = dell_ops.clear_stale_idrac_jobs(
                                ip=ip,
                                username=username,
                                password=password,
                                clear_failed=True,
                                clear_completed_errors=True,
                                clear_old_scheduled=details.get('clear_old_scheduled_jobs', False),
                                stale_age_hours=details.get('stale_job_max_age_hours', 24),
                                server_id=server['id'],
                                job_id=job['id'],
                                user_id=job.get('created_by')
                            )
                            
                            cleared_count = clear_result.get('cleared_count', 0)
                            if cleared_count > 0:
                                self.log(f"  ✓ Cleared {cleared_count} stale job(s) from iDRAC queue")
                            else:
                                self.log(f"  ✓ iDRAC job queue is clean")
                        except Exception as clear_error:
                            self.log(f"  ⚠ Error clearing stale jobs (non-fatal): {clear_error}", "WARN")
                    
                    # Step 3: Get current firmware inventory and capture version before update
                    current_fw = self.executor.get_firmware_inventory(ip, session_token)
                    version_before = self._find_component_version(current_fw, component)
                    
                    # Step 3.5: Check if updates are available BEFORE entering maintenance mode
                    maintenance_mode_enabled = False
                    maintenance_mode_result = None
                    
                    if use_catalog:
                        self.log(f"  Checking for available catalog updates...")
                        self.update_task_status(task['id'], 'running',
                            log="✓ Connected to iDRAC\n→ Checking for available updates...", progress=10)
                        
                        dell_ops = self.executor._get_dell_operations()
                        check_result = dell_ops.check_available_catalog_updates(
                            ip, username, password,
                            catalog_url=dell_catalog_url,
                            server_id=server['id'],
                            job_id=job['id'],
                            user_id=job.get('created_by')
                        )
                        
                        available_updates = check_result.get('available_updates', [])
                        
                        if not available_updates:
                            self.log(f"  ✓ Server is up to date - no updates available")
                        self.update_task_status(task['id'], 'completed',
                            log="✓ Server is up to date\nNo firmware updates required",
                            completed_at=utc_now_iso(),
                            progress=100)
                        continue  # Skip to next server
                        
                        self.log(f"  Found {len(available_updates)} update(s) available")
                        self.update_task_status(task['id'], 'running',
                            log=f"✓ Found {len(available_updates)} update(s) available\n→ Preparing to update...", progress=15)
                    
                    # Step 3: Put host in maintenance mode (if vCenter linked)
                    if server.get('vcenter_host_id'):
                        self.log(f"  Entering maintenance mode for vCenter host...")
                        self.update_task_status(
                            task['id'], 'running',
                            log="✓ Connected to iDRAC\n✓ Updates available\n→ Entering maintenance mode...", progress=20
                        )
                        
                        # Get maintenance timeout from job details, default to 1800s (30 min)
                        maintenance_timeout = job.get('details', {}).get('maintenance_timeout', 1800)
                        
                        # Call actual vCenter maintenance mode function
                        maintenance_mode_result = self.executor.enter_vcenter_maintenance_mode(
                            server['vcenter_host_id'],
                            timeout=maintenance_timeout
                        )
                        
                        if maintenance_mode_result.get('success'):
                            maintenance_mode_enabled = True
                            vms_evacuated = maintenance_mode_result.get('vms_evacuated', 0)
                            time_taken = maintenance_mode_result.get('time_taken_seconds', 0)
                            self.log(f"  [OK] Maintenance mode active ({vms_evacuated} VMs evacuated in {time_taken}s)")
                        else:
                            error_msg = maintenance_mode_result.get('error', 'Unknown error')
                            raise Exception(f"Failed to enter maintenance mode: {error_msg}")
                    
                    # Step 4: Initiate firmware update (catalog or traditional)
                    self.log(f"  Initiating firmware update...")
                    log_msg = "✓ Connected to iDRAC\n✓ Current firmware checked\n"
                    if maintenance_mode_enabled:
                        log_msg += "✓ Maintenance mode active\n"
                    log_msg += "→ Downloading and staging firmware...\n0% complete"
                    
                    self.update_task_status(task['id'], 'running', log=log_msg, progress=0)
                    
                    if use_catalog:
                        # Map component names to Redfish targets
                        target_map = {
                            'BIOS': 'BIOS',
                            'iDRAC': 'iDRAC',
                            'NIC': 'NIC',
                            'RAID': 'RAID',
                            'PSU': 'PSU'
                        }
                        
                        targets = [target_map.get(component, component)] if component and not auto_select_latest else None
                        
                        task_uri = self.executor.initiate_catalog_firmware_update(
                            ip, session_token, dell_catalog_url, targets, apply_time
                        )
                    else:
                        # Traditional ImageURI-based update
                        task_uri = self.executor.initiate_firmware_update(
                            ip, session_token, firmware_uri, apply_time
                        )
                    
                    if not task_uri:
                        raise Exception("Failed to initiate firmware update")
                    
                    # Step 5: Monitor update progress
                    progress = 0
                    start_time = time.time()
                    last_queue_fetch = 0
                    
                    while progress < 100:
                        # Check for cancellation
                        if self.check_cancelled(job['id']):
                            self.log(f"  Job cancelled - clearing iDRAC job queue")
                            dell_ops = self.executor._get_dell_operations()
                            try:
                                dell_ops.clear_idrac_job_queue(ip, username, password, force=True, server_id=server['id'])
                            except Exception as clear_error:
                                self.log(f"  Warning: Failed to clear job queue: {clear_error}", "WARN")
                            
                            self.update_task_status(
                                task['id'], 'failed',
                                log="✗ Job cancelled by user",
                                completed_at=utc_now_iso()
                            )
                            raise Exception("Job cancelled by user")
                        
                        if time.time() - start_time > FIRMWARE_UPDATE_TIMEOUT:
                            raise Exception("Firmware update timed out")
                        
                        time.sleep(10)  # Poll every 10 seconds
                        task_status = self.executor.monitor_update_task(ip, session_token, task_uri)
                        
                        new_progress = task_status.get('PercentComplete', progress)
                        task_state = task_status.get('TaskState', 'Unknown')
                        
                        # Capture iDRAC job queue every 30 seconds for real-time UI display
                        current_time = time.time()
                        if current_time - last_queue_fetch >= 30:
                            last_queue_fetch = current_time
                            try:
                                dell_ops = self.executor._get_dell_operations()
                                idrac_queue = dell_ops.get_idrac_job_queue(
                                    ip, username, password,
                                    server_id=server['id'],
                                    include_details=True
                                )
                                
                                self.update_job_details_field(job['id'], {
                                    'idrac_job_queue': idrac_queue.get('jobs', []),
                                    'idrac_queue_updated_at': utc_now_iso(),
                                    'current_host_ip': ip
                                })
                            except Exception as queue_error:
                                self.log(f"  Warning: Could not fetch iDRAC job queue: {queue_error}", "WARN")
                        
                        if new_progress > progress:
                            progress = new_progress
                            log_msg = "✓ Connected to iDRAC\n✓ Current firmware checked\n"
                            if maintenance_mode_enabled:
                                log_msg += "✓ Maintenance mode active\n"
                            log_msg += f"→ Applying firmware update...\n{progress}% complete"
                            
                            self.update_task_status(task['id'], 'running', log=log_msg, progress=progress)
                            self.log(f"  Firmware update progress: {progress}%")
                        
                        if task_state == 'Exception' or task_state == 'Killed':
                            messages = task_status.get('Messages', [])
                            error_msg = messages[0].get('Message', 'Unknown error') if messages else 'Update failed'
                            raise Exception(f"Update failed: {error_msg}")
                        
                        if task_state == 'Completed':
                            self.log(f"  Firmware staging complete")
                            break
                    
                    # Step 6: Trigger reboot if apply_time requires it
                    reboot_triggered = False
                    if apply_time == 'OnReset':
                        self.log(f"  Checking for pending iDRAC jobs before reboot...")
                        dell_ops = self.executor._get_dell_operations()
                        
                        # Check for pending/scheduled jobs that need a reboot
                        try:
                            pending_result = dell_ops.get_pending_idrac_jobs(
                                ip, username, password,
                                server_id=server['id'],
                                job_id=job['id']
                            )
                            pending_jobs = pending_result.get('jobs', [])
                            scheduled_jobs = [j for j in pending_jobs 
                                            if j.get('status') in ['Scheduled', 'New', 'Downloaded']]
                            running_jobs = [j for j in pending_jobs 
                                          if j.get('status') in ['Running', 'Downloading']]
                            
                            if scheduled_jobs or running_jobs:
                                self.log(f"  Found {len(scheduled_jobs)} scheduled, {len(running_jobs)} running iDRAC jobs")
                                
                                # Only trigger reboot if there are scheduled jobs (not running)
                                if scheduled_jobs and not running_jobs:
                                    self.log(f"  Triggering GracefulRestart to apply staged updates...")
                                    self.update_task_status(task['id'], 'running',
                                        log="✓ Firmware staged\n→ Triggering system reboot...", progress=70)
                                    
                                    reboot_result = dell_ops.graceful_reboot(
                                        ip, username, password,
                                        server_id=server['id'],
                                        job_id=job['id'],
                                        user_id=job.get('created_by')
                                    )
                                    
                                    if reboot_result.get('status') == 'success':
                                        self.log(f"  ✓ GracefulRestart triggered")
                                        reboot_triggered = True
                                    else:
                                        self.log(f"  ⚠ GracefulRestart failed: {reboot_result.get('error')}", "WARN")
                                        reboot_triggered = True  # Still wait, jobs may execute on next boot
                                elif running_jobs:
                                    self.log(f"  Jobs already running - will wait for completion...")
                                    reboot_triggered = True  # Need to wait for running jobs
                            else:
                                self.log(f"  No pending iDRAC jobs - server may already be up to date")
                        except Exception as pending_err:
                            self.log(f"  ⚠ Could not check pending jobs: {pending_err}", "WARN")
                            reboot_triggered = True  # Assume reboot needed as safety
                    
                    # Step 7: Wait for system reboot and iDRAC to come back online
                    if reboot_triggered:
                        self.log(f"  Waiting for system reboot...")
                        self.update_task_status(task['id'], 'running',
                            log="✓ Firmware staged\n✓ Reboot triggered\n→ Waiting for system to come online...", progress=75)
                        
                        time.sleep(180)  # Initial 3 min wait for BIOS POST
                        
                        # Poll for iDRAC to come back online
                        max_attempts = 180  # 30 minutes max (180 * 10s)
                        idrac_online = False
                        
                        for attempt in range(max_attempts):
                            # Check for cancellation during reboot wait
                            if self.check_cancelled(job['id']):
                                raise Exception("Job cancelled during reboot wait")
                            
                            try:
                                test_session = self.executor.create_idrac_session(
                                    ip, username, password,
                                    log_to_db=False, timeout=10
                                )
                                if test_session:
                                    self.executor.close_idrac_session(ip, test_session)
                                    idrac_online = True
                                    self.log(f"  ✓ iDRAC back online (attempt {attempt+1})")
                                    break
                            except:
                                pass
                            
                            # Update iDRAC job queue in job details every 30 seconds
                            if attempt > 0 and attempt % 3 == 0:
                                elapsed = (attempt + 1) * 10
                                self.log(f"  [{elapsed}s] Waiting for iDRAC...")
                            
                            time.sleep(10)
                        
                        if not idrac_online:
                            raise Exception(f"Timeout waiting for iDRAC after {max_attempts * 10}s")
                        
                        # Step 8: Wait for ALL iDRAC jobs to complete
                        self.log(f"  Waiting for all iDRAC jobs to complete...")
                        self.update_task_status(task['id'], 'running',
                            log="✓ Firmware staged\n✓ System rebooted\n→ Waiting for firmware jobs...", progress=85)
                        
                        dell_ops = self.executor._get_dell_operations()
                        jobs_complete_result = dell_ops.wait_for_all_jobs_complete(
                            ip=ip,
                            username=username,
                            password=password,
                            timeout=1200,  # 20 minutes for iDRAC FW updates
                            poll_interval=30,
                            server_id=server['id'],
                            job_id=job['id'],
                            user_id=job.get('created_by')
                        )
                        
                        if not jobs_complete_result.get('success'):
                            pending = jobs_complete_result.get('pending_jobs', [])
                            self.log(f"  ⚠ {len(pending)} job(s) still pending after timeout", "WARN")
                        else:
                            self.log(f"  ✓ All iDRAC jobs completed")
                        
                        # Update iDRAC job queue one final time
                        try:
                            idrac_queue = dell_ops.get_idrac_job_queue(
                                ip, username, password,
                                server_id=server['id'],
                                include_details=True
                            )
                            self.update_job_details_field(job['id'], {
                                'idrac_job_queue': idrac_queue.get('jobs', []),
                                'idrac_queue_updated_at': datetime.now().isoformat(),
                                'current_step': 'Firmware updates complete'
                            })
                        except:
                            pass
                    
                    # Step 9: Exit maintenance mode (ALWAYS runs if enabled, regardless of reboot)
                    if maintenance_mode_enabled and server.get('vcenter_host_id'):
                        self.log(f"  Exiting maintenance mode...")
                        self.update_task_status(task['id'], 'running',
                            log="✓ Firmware update complete\n→ Exiting maintenance mode...", progress=95)
                        
                        try:
                            exit_result = self.executor.exit_vcenter_maintenance_mode(
                                server['vcenter_host_id'],
                                timeout=300
                            )
                            
                            if exit_result.get('success'):
                                self.log(f"  ✓ Exited maintenance mode")
                            else:
                                self.log(f"  ⚠ Failed to exit maintenance mode: {exit_result.get('error')}", "WARN")
                        except Exception as mm_err:
                            self.log(f"  ⚠ Error exiting maintenance mode: {mm_err}", "WARN")
                    
                    # Step 10: Get firmware version after update for audit trail
                    version_after = None
                    try:
                        # Re-authenticate if session expired during reboot
                        post_session = self.executor.create_idrac_session(ip, username, password)
                        if post_session:
                            post_fw = self.executor.get_firmware_inventory(ip, post_session)
                            version_after = self._find_component_version(post_fw, component)
                            self.executor.close_idrac_session(ip, post_session)
                    except Exception as ver_err:
                        self.log(f"  Warning: Could not capture post-update version: {ver_err}", "WARN")
                    
                    # Build completion log with version info for audit
                    completion_log = f"✓ Firmware update successful"
                    if version_before and version_after:
                        completion_log = f"✓ {component}: {version_before} → {version_after}"
                    elif version_after:
                        completion_log = f"✓ {component} updated to {version_after}"
                    
                    self.update_task_status(
                        task['id'], 'completed',
                        log=completion_log,
                        completed_at=datetime.now().isoformat(),
                        progress=100
                    )
                    
                    # Store version info in job details for reporting
                    self._update_job_version_details(job['id'], {
                        'version_before': version_before,
                        'version_after': version_after,
                        'component': component
                    })
                    
                    self.log(f"  ✓ Firmware update completed: {version_before or '?'} → {version_after or '?'}")
                    
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
                        self.executor.close_idrac_session(ip, session_token)
            
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
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        from job_executor.utils import _safe_json_parse
        
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
                        
                        if status_response.status_code == 200:
                            status_data = _safe_json_parse(status_response)
                            if status_data:
                                sub_status = status_data[0]['status']
                                if sub_status == 'completed':
                                    self.log(f"  ✓ {component} update completed")
                                    break
                                elif sub_status == 'failed':
                                    failed_components.append(component)
                                    self.log(f"  ✗ {component} update failed", "ERROR")
                                    break
                        
                        time.sleep(10)
                    
                except Exception as e:
                    self.log(f"  ✗ {component} update failed: {e}", "ERROR")
                    failed_components.append(component)
            
            # Update parent job status
            final_status = 'completed' if not failed_components else 'failed'
            self.update_job_status(
                job['id'], final_status,
                completed_at=datetime.now().isoformat(),
                details={
                    "total_components": len(sub_jobs),
                    "failed_components": failed_components
                }
            )
            
            self.log(f"Full server update complete: {len(sub_jobs) - len(failed_components)}/{len(sub_jobs)} components succeeded")
            
        except Exception as e:
            self.log(f"Full server update job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'], 'failed',
                completed_at=datetime.now().isoformat(),
                details={"error": str(e)}
            )
    
    def _find_component_version(self, firmware_inventory: list, component: str) -> str:
        """Find the version of a specific component in firmware inventory"""
        if not firmware_inventory or not component:
            return None
        
        component_lower = component.lower()
        
        for item in firmware_inventory:
            name = (item.get('Name') or item.get('component_name') or '').lower()
            comp_type = (item.get('component_type') or '').lower()
            
            # Match by component type or name
            if component_lower in name or component_lower in comp_type:
                return item.get('Version') or item.get('version')
            
            # Common mappings
            if component_lower == 'bios' and 'bios' in name:
                return item.get('Version') or item.get('version')
            if component_lower == 'idrac' and ('idrac' in name or 'integrated dell remote access' in name):
                return item.get('Version') or item.get('version')
            if component_lower == 'raid' and ('raid' in name or 'perc' in name):
                return item.get('Version') or item.get('version')
        
        return None
    
    def _update_job_version_details(self, job_id: str, version_info: dict):
        """Update job details with version information for audit reporting"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        import requests
        
        try:
            # First get current job details
            url = f"{DSM_URL}/rest/v1/jobs"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            }
            
            response = requests.get(
                url, 
                params={'id': f'eq.{job_id}', 'select': 'details'},
                headers=headers, 
                verify=VERIFY_SSL
            )
            
            current_details = {}
            if response.status_code == 200:
                data = response.json()
                if data:
                    current_details = data[0].get('details') or {}
            
            # Merge version info
            current_details.update(version_info)
            
            # Update job
            requests.patch(
                url,
                params={'id': f'eq.{job_id}'},
                headers=headers,
                json={'details': current_details},
                verify=VERIFY_SSL
            )
        except Exception as e:
            self.log(f"Warning: Could not update job version details: {e}", "WARN")
