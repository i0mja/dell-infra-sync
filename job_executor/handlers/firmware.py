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
                    dell_ops = self.executor._get_dell_operations()
                    current_fw = dell_ops.get_firmware_inventory(ip, username, password, server_id=server['id'])
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
                                    self.executor.delete_idrac_session(test_session, ip=ip)
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
                        dell_ops = self.executor._get_dell_operations()
                        post_fw = dell_ops.get_firmware_inventory(ip, username, password, server_id=server['id'])
                        version_after = self._find_component_version(post_fw, component)
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
                        self.executor.delete_idrac_session(session_token, ip=ip)
            
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
    
    def _check_local_repository_updates(
        self, 
        current_inventory: list, 
        server_model: str,
        server_id: str
    ) -> list:
        """
        Compare installed firmware against uploaded packages in firmware_packages table.
        Returns list of available updates in the same format as Dell catalog updates.
        
        Args:
            current_inventory: List of firmware components from iDRAC
            server_model: Server model string (e.g., 'PowerEdge R750')
            server_id: Server UUID for logging
            
        Returns:
            List of available update dicts with component_name, available_version, etc.
        """
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        import requests
        
        available_updates = []
        
        try:
            # Query completed firmware packages from database
            response = requests.get(
                f"{DSM_URL}/rest/v1/firmware_packages",
                headers={
                    'apikey': SERVICE_ROLE_KEY, 
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                params={
                    'select': '*',
                    'upload_status': 'eq.completed',
                    'order': 'dell_version.desc'
                },
                verify=VERIFY_SSL,
                timeout=30
            )
            
            if response.status_code != 200:
                self.log(f"    ⚠ Could not query firmware packages: {response.status_code}", "WARN")
                return []
            
            packages = response.json()
            
            if not packages:
                self.log(f"    No firmware packages in local repository", "DEBUG")
                return []
            
            self.log(f"    Comparing against {len(packages)} local package(s)")
            
            for pkg in packages:
                # Check model applicability if specified
                applicable_models = pkg.get('applicable_models') or []
                
                if applicable_models and server_model:
                    model_matches = False
                    for model in applicable_models:
                        if model.lower() in server_model.lower() or server_model.lower() in model.lower():
                            model_matches = True
                            break
                    
                    if not model_matches:
                        continue
                
                pkg_type = (pkg.get('component_type') or '').upper()
                pkg_version = pkg.get('dell_version', '')
                pkg_name_pattern = pkg.get('component_name_pattern') or pkg.get('filename', '')
                
                # Find matching component in installed inventory
                for installed in current_inventory:
                    installed_name = (installed.get('Name') or installed.get('component_name') or '').lower()
                    installed_type = (installed.get('component_type') or '').upper()
                    installed_version = installed.get('Version') or installed.get('version') or ''
                    
                    # Match by component type
                    type_match = False
                    if pkg_type and installed_type:
                        type_match = pkg_type == installed_type
                    
                    # Match by name pattern
                    name_match = False
                    if pkg_name_pattern:
                        pattern_lower = pkg_name_pattern.lower()
                        if pattern_lower in installed_name or installed_name in pattern_lower:
                            name_match = True
                    
                    # Match by component type in name (fallback)
                    if not type_match and not name_match:
                        if pkg_type.lower() in installed_name:
                            name_match = True
                    
                    if type_match or name_match:
                        # Compare versions - simple string comparison 
                        # (Dell uses version strings like "2.8.1.0" that compare lexicographically)
                        if self._is_newer_version(pkg_version, installed_version):
                            available_updates.append({
                                'component_name': installed.get('Name') or installed.get('component_name'),
                                'component_type': installed_type or pkg_type,
                                'current_version': installed_version,
                                'available_version': pkg_version,
                                'criticality': pkg.get('criticality', 'optional'),
                                'reboot_required': pkg.get('reboot_required', True),
                                'package_id': pkg.get('id'),
                                'source': 'local_repository'
                            })
                            break  # Only one update per component
            
            if available_updates:
                self.log(f"    Found {len(available_updates)} update(s) in local repository")
            
        except Exception as e:
            self.log(f"    ⚠ Error checking local repository: {e}", "WARN")
        
        return available_updates
    
    def _is_newer_version(self, new_version: str, current_version: str) -> bool:
        """
        Compare Dell firmware version strings.
        Returns True if new_version is newer than current_version.
        
        Handles versions like "2.8.1.0", "8.00.00.00", "1.4.2" etc.
        """
        if not new_version or not current_version:
            return False
        
        if new_version == current_version:
            return False
        
        try:
            # Split into parts and compare numerically
            new_parts = [int(p) for p in new_version.split('.') if p.isdigit()]
            cur_parts = [int(p) for p in current_version.split('.') if p.isdigit()]
            
            # Pad shorter list with zeros
            max_len = max(len(new_parts), len(cur_parts))
            new_parts.extend([0] * (max_len - len(new_parts)))
            cur_parts.extend([0] * (max_len - len(cur_parts)))
            
            for new_p, cur_p in zip(new_parts, cur_parts):
                if new_p > cur_p:
                    return True
                if new_p < cur_p:
                    return False
            
            return False  # Equal versions
            
        except (ValueError, AttributeError):
            # Fall back to string comparison
            return new_version > current_version
    
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
    
    def execute_firmware_inventory_scan(self, job: Dict):
        """
        Execute firmware inventory scan job to check for available updates.
        Scans iDRAC firmware inventory and compares against Dell catalog or local repository.
        """
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        from job_executor.utils import utc_now_iso
        
        job_id = job['id']
        target_scope = job.get('target_scope', {}) or {}
        details = job.get('details', {}) or {}
        
        scan_id = target_scope.get('scan_id')
        server_ids = target_scope.get('server_ids', [])
        vcenter_host_ids = target_scope.get('vcenter_host_ids', [])
        firmware_source = details.get('firmware_source', 'dell_online_catalog')
        dell_catalog_url = details.get('dell_catalog_url', 'https://downloads.dell.com/catalog/Catalog.xml')
        
        self.log(f"Starting firmware inventory scan job {job_id}")
        self.log(f"  Scan ID: {scan_id}")
        self.log(f"  Server IDs: {len(server_ids)}, vCenter Host IDs: {len(vcenter_host_ids)}")
        self.log(f"  Firmware source: {firmware_source}")
        
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
        }
        
        # Update scan status to running
        if scan_id:
            try:
                requests.patch(
                    f"{DSM_URL}/rest/v1/update_availability_scans",
                    params={'id': f'eq.{scan_id}'},
                    headers=headers,
                    json={'status': 'running', 'started_at': utc_now_iso()},
                    verify=VERIFY_SSL,
                    timeout=10
                )
            except Exception as e:
                self.log(f"Warning: Could not update scan status: {e}", "WARN")
        
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        # Resolve servers to scan
        servers_to_scan = []
        
        # Add servers from server_ids
        if server_ids:
            try:
                response = requests.get(
                    f"{DSM_URL}/rest/v1/servers",
                    params={
                        'id': f'in.({",".join(server_ids)})',
                        'select': 'id,hostname,ip_address,service_tag,model,vcenter_host_id'
                    },
                    headers=headers,
                    verify=VERIFY_SSL,
                    timeout=30
                )
                if response.ok:
                    servers_to_scan.extend(response.json())
            except Exception as e:
                self.log(f"Error fetching servers: {e}", "ERROR")
        
        # Add servers from vcenter_host_ids (lookup via vcenter_hosts -> servers)
        if vcenter_host_ids:
            try:
                response = requests.get(
                    f"{DSM_URL}/rest/v1/vcenter_hosts",
                    params={
                        'id': f'in.({",".join(vcenter_host_ids)})',
                        'select': 'id,name,server_id,serial_number'
                    },
                    headers=headers,
                    verify=VERIFY_SSL,
                    timeout=30
                )
                if response.ok:
                    hosts = response.json()
                    linked_server_ids = [h['server_id'] for h in hosts if h.get('server_id')]
                    if linked_server_ids:
                        srv_response = requests.get(
                            f"{DSM_URL}/rest/v1/servers",
                            params={
                                'id': f'in.({",".join(linked_server_ids)})',
                                'select': 'id,hostname,ip_address,service_tag,model,vcenter_host_id'
                            },
                            headers=headers,
                            verify=VERIFY_SSL,
                            timeout=30
                        )
                        if srv_response.ok:
                            # Avoid duplicates
                            existing_ids = {s['id'] for s in servers_to_scan}
                            for srv in srv_response.json():
                                if srv['id'] not in existing_ids:
                                    servers_to_scan.append(srv)
            except Exception as e:
                self.log(f"Error fetching vCenter hosts: {e}", "ERROR")
        
        if not servers_to_scan:
            self.log("No servers to scan", "ERROR")
            self.update_job_status(
                job_id, 'failed',
                completed_at=utc_now_iso(),
                details={'error': 'No servers found to scan'}
            )
            if scan_id:
                requests.patch(
                    f"{DSM_URL}/rest/v1/update_availability_scans",
                    params={'id': f'eq.{scan_id}'},
                    headers=headers,
                    json={'status': 'failed', 'completed_at': utc_now_iso()},
                    verify=VERIFY_SSL,
                    timeout=10
                )
            return
        
        self.log(f"Scanning {len(servers_to_scan)} servers...")
        
        # Create job tasks for each server
        task_map = {}
        for server in servers_to_scan:
            try:
                task_response = requests.post(
                    f"{DSM_URL}/rest/v1/job_tasks",
                    headers={**headers, 'Prefer': 'return=representation'},
                    json={
                        'job_id': job_id,
                        'server_id': server['id'],
                        'status': 'pending',
                        'log': f"Pending scan: {server.get('hostname') or server['ip_address']}"
                    },
                    verify=VERIFY_SSL,
                    timeout=10
                )
                if task_response.ok and task_response.json():
                    task_map[server['id']] = task_response.json()[0]['id']
            except Exception as te:
                self.log(f"Warning: Could not create task for {server['id']}: {te}", "WARN")
        
        # Scan each server
        results = []
        successful_hosts = 0
        failed_hosts = 0
        total_updates = 0
        total_critical = 0
        total_components = 0
        
        for idx, server in enumerate(servers_to_scan):
            server_id = server['id']
            hostname = server.get('hostname') or server.get('ip_address', 'Unknown')
            ip = server.get('ip_address')
            task_id = task_map.get(server_id)
            
            self.log(f"  [{idx+1}/{len(servers_to_scan)}] Scanning {hostname} ({ip})...")
            
            # Update progress in job details
            progress = int((idx / len(servers_to_scan)) * 100)
            self.update_job_details_field(job_id, {
                'hosts_scanned': idx,
                'hosts_total': len(servers_to_scan),
                'current_host': hostname,
                'updates_found': total_updates,
                'critical_found': total_critical,
            })
            
            if task_id:
                self.update_task_status(task_id, 'running', log=f"Scanning {hostname}...", started_at=utc_now_iso())
            
            try:
                # Get credentials
                username, password = self.executor.get_server_credentials(server_id)
                if not username or not password:
                    raise Exception("No credentials configured")
                
                # Get firmware inventory via Dell operations
                dell_ops = self.executor._get_dell_operations()
                
                # Always fetch firmware inventory first - this ensures we have component data
                # regardless of what the catalog check returns
                current_inventory = dell_ops.get_firmware_inventory(
                    ip, username, password,
                    server_id=server_id,
                    user_id=job.get('created_by')
                )
                self.log(f"    Retrieved {len(current_inventory)} firmware components from {hostname}")
                
                # Check for updates using catalog or local repository
                if firmware_source == 'dell_online_catalog':
                    check_result = dell_ops.check_available_catalog_updates(
                        ip, username, password,
                        catalog_url=dell_catalog_url,
                        server_id=server_id,
                        job_id=job_id,
                        user_id=job.get('created_by')
                    )
                    available_updates = check_result.get('available_updates', [])
                else:
                    # For local repository, compare against uploaded firmware packages
                    available_updates = self._check_local_repository_updates(
                        current_inventory, 
                        server.get('model'),
                        server_id
                    )
                
                # Build firmware components list
                components = []
                updates_count = 0
                critical_count = 0
                
                def normalize_name(name: str) -> str:
                    """Remove MAC addresses and disk numbers for matching."""
                    import re
                    # Remove MAC addresses like "- B4:83:51:11:A3:48"
                    name = re.sub(r'\s*-\s*([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\s*$', '', name)
                    # Normalize disk names: "Disk 10 in Backplane..." → "Disk in Backplane..."
                    name = re.sub(r'Disk \d+', 'Disk', name)
                    return name.lower().strip()
                
                def get_component_category(dell_type: str, name: str) -> str:
                    """Map Dell component type codes to human-readable categories."""
                    name_lower = (name or '').lower()
                    
                    if 'bios' in name_lower:
                        return 'BIOS'
                    if 'idrac' in name_lower or 'remote access' in name_lower:
                        return 'iDRAC'
                    if 'lifecycle' in name_lower:
                        return 'Lifecycle Controller'
                    if 'nic' in name_lower or 'ethernet' in name_lower or 'network' in name_lower or 'x710' in name_lower or 'bcm' in name_lower:
                        return 'Network'
                    if 'fibre channel' in name_lower or 'fc adapter' in name_lower or 'lpe' in name_lower:
                        return 'Fibre Channel'
                    if 'raid' in name_lower or 'perc' in name_lower or 'backplane' in name_lower or 'boss' in name_lower:
                        return 'Storage Controller'
                    if 'disk' in name_lower or 'ssd' in name_lower or 'hdd' in name_lower:
                        return 'Drive'
                    if 'power' in name_lower or 'psu' in name_lower:
                        return 'Power Supply'
                    if 'cpld' in name_lower:
                        return 'System CPLD'
                    if 'tpm' in name_lower:
                        return 'TPM'
                    if 'diagnostics' in name_lower:
                        return 'Diagnostics'
                    if 'driver' in name_lower:
                        return 'Driver'
                    
                    # Fall back to Dell type code
                    dell_type = (dell_type or '').upper()
                    type_map = {'BIOS': 'BIOS', 'FRMW': 'Firmware', 'APAC': 'Application', 'DRVR': 'Driver'}
                    return type_map.get(dell_type, 'Firmware')
                
                def get_firmware_family(name: str) -> str:
                    """Identify firmware family for cross-component matching.
                    
                    Components in the same family often share firmware packages.
                    Returns None if component doesn't belong to a known shared-firmware family.
                    """
                    name_lower = name.lower()
                    
                    # iDRAC and Lifecycle Controller share the same firmware package
                    if 'idrac' in name_lower or 'remote access' in name_lower or 'lifecycle controller' in name_lower:
                        return 'idrac_lifecycle'
                    
                    # Intel X710 variants (all port configurations share firmware)
                    if 'x710' in name_lower:
                        return 'intel_x710'
                    
                    # Broadcom BCM5720 / NetXtreme Gigabit variants
                    if 'bcm5720' in name_lower or 'netxtreme gigabit' in name_lower:
                        return 'broadcom_bcm5720'
                    
                    # Broadcom 10G variants
                    if 'broadcom' in name_lower and '10g' in name_lower:
                        return 'broadcom_10g'
                    
                    # Emulex / Fibre Channel adapters
                    if 'emulex' in name_lower or 'lpe31' in name_lower:
                        return 'emulex_fc'
                    
                    return None  # Not part of a known firmware family

                for item in current_inventory:
                    component_name = item.get('Name') or item.get('component_name', 'Unknown')
                    current_version = item.get('Version') or item.get('version', 'Unknown')
                    # Fix: Check PascalCase from Dell API first, then snake_case
                    component_type = item.get('ComponentType') or item.get('component_type', 'Unknown')
                    
                    # Check if there's an update for this component
                    # Fix: Use 'name' field (not 'component_name') and exact matching
                    normalized_inventory_name = normalize_name(component_name)
                    update_info = next(
                        (u for u in available_updates 
                         if normalize_name(u.get('name', '')) == normalized_inventory_name),
                        None
                    )
                    
                    component_data = {
                        'componentName': component_name,
                        'componentType': get_component_category(component_type, component_name),
                        'currentVersion': current_version,
                        'availableVersion': update_info.get('available_version') if update_info else None,
                        'criticality': update_info.get('criticality', 'optional') if update_info else None,
                        'updateAvailable': bool(update_info),
                        'rebootRequired': update_info.get('reboot_required', True) if update_info else None,
                        'updateInferred': False,
                    }
                    components.append(component_data)
                    
                    if update_info:
                        updates_count += 1
                        # Fix: Case-insensitive criticality check
                        criticality_value = (update_info.get('criticality') or '').lower()
                        if criticality_value in ('urgent', 'critical'):
                            critical_count += 1
                
                # === SECOND PASS: Infer updates for unmatched components ===
                # Build lookup: {(family, installed_version): update_info}
                family_updates = {}
                for comp in components:
                    if comp.get('updateAvailable') and comp.get('availableVersion'):
                        family = get_firmware_family(comp['componentName'])
                        if family:
                            key = (family, comp['currentVersion'])
                            if key not in family_updates:
                                family_updates[key] = {
                                    'available_version': comp['availableVersion'],
                                    'criticality': comp.get('criticality'),
                                    'reboot_required': comp.get('rebootRequired'),
                                }

                # Apply inferred updates to unmatched components
                inferred_count = 0
                for comp in components:
                    if not comp.get('updateAvailable'):
                        family = get_firmware_family(comp['componentName'])
                        if family:
                            key = (family, comp['currentVersion'])
                            inferred = family_updates.get(key)
                            if inferred:
                                comp['availableVersion'] = inferred['available_version']
                                comp['criticality'] = inferred['criticality']
                                comp['updateAvailable'] = True
                                comp['rebootRequired'] = inferred['reboot_required']
                                comp['updateInferred'] = True
                                
                                updates_count += 1
                                inferred_count += 1
                                if (inferred.get('criticality') or '').lower() in ('urgent', 'critical'):
                                    critical_count += 1

                if inferred_count > 0:
                    self.log(f"    ℹ Inferred {inferred_count} additional update(s) from related components")
                
                total_updates += updates_count
                total_critical += critical_count
                total_components += len(components)
                
                # Create result record
                result_record = {
                    'scan_id': scan_id,
                    'server_id': server_id,
                    'vcenter_host_id': server.get('vcenter_host_id'),
                    'hostname': hostname,
                    'server_model': server.get('model'),
                    'service_tag': server.get('service_tag'),
                    'firmware_components': components,
                    'total_components': len(components),
                    'updates_available': updates_count,
                    'critical_updates': critical_count,
                    'up_to_date': len(components) - updates_count,
                    'not_in_catalog': 0,
                    'scan_status': 'completed',
                    'scanned_at': utc_now_iso(),
                }
                
                # Insert result into database
                try:
                    requests.post(
                        f"{DSM_URL}/rest/v1/update_availability_results",
                        headers=headers,
                        json=result_record,
                        verify=VERIFY_SSL,
                        timeout=30
                    )
                except Exception as db_err:
                    self.log(f"Warning: Could not save result for {hostname}: {db_err}", "WARN")
                
                results.append(result_record)
                successful_hosts += 1
                
                if task_id:
                    self.update_task_status(
                        task_id, 'completed',
                        log=f"✓ {hostname}: {updates_count} updates available",
                        completed_at=utc_now_iso(),
                        progress=100
                    )
                
                self.log(f"    ✓ {len(components)} components, {updates_count} updates available")
                
            except Exception as e:
                self.log(f"    ✗ Failed: {e}", "ERROR")
                failed_hosts += 1
                
                if task_id:
                    self.update_task_status(
                        task_id, 'failed',
                        log=f"✗ {hostname}: {str(e)}",
                        completed_at=utc_now_iso()
                    )
                
                # Save failed result
                try:
                    requests.post(
                        f"{DSM_URL}/rest/v1/update_availability_results",
                        headers=headers,
                        json={
                            'scan_id': scan_id,
                            'server_id': server_id,
                            'vcenter_host_id': server.get('vcenter_host_id'),
                            'hostname': hostname,
                            'server_model': server.get('model'),
                            'service_tag': server.get('service_tag'),
                            'scan_status': 'failed',
                            'error_message': str(e),
                            'scanned_at': utc_now_iso(),
                        },
                        verify=VERIFY_SSL,
                        timeout=30
                    )
                except Exception:
                    pass
        
        # Update scan summary
        summary = {
            'hostsScanned': len(servers_to_scan),
            'hostsSuccessful': successful_hosts,
            'hostsFailed': failed_hosts,
            'totalComponents': total_components,
            'updatesAvailable': total_updates,
            'criticalUpdates': total_critical,
            'upToDate': total_components - total_updates,
        }
        
        if scan_id:
            try:
                requests.patch(
                    f"{DSM_URL}/rest/v1/update_availability_scans",
                    params={'id': f'eq.{scan_id}'},
                    headers=headers,
                    json={
                        'status': 'completed' if failed_hosts == 0 else 'completed_with_errors',
                        'completed_at': utc_now_iso(),
                        'summary': summary,
                    },
                    verify=VERIFY_SSL,
                    timeout=10
                )
            except Exception as e:
                self.log(f"Warning: Could not update scan summary: {e}", "WARN")
        
        # Update job status
        final_status = 'completed' if failed_hosts == 0 else 'failed'
        self.update_job_status(
            job_id, final_status,
            completed_at=utc_now_iso(),
            details={
                **summary,
                'scan_id': scan_id,
            }
        )
        
        self.log(f"Firmware inventory scan complete: {successful_hosts}/{len(servers_to_scan)} hosts scanned, {total_updates} updates found")
