"""ESXi upgrade handlers"""

from typing import Dict
from datetime import datetime
import json
from .base import BaseHandler


class ESXiHandler(BaseHandler):
    """Handles ESXi upgrade and combined upgrade workflows"""
    
    def execute_esxi_upgrade(self, job: Dict):
        """Execute ESXi host upgrade via SSH"""
        try:
            from job_executor.esxi.orchestrator import EsxiOrchestrator
            
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            details = job.get('details', {})
            profile_id = details.get('profile_id')
            host_ids = details.get('host_ids', [])
            ssh_username = details.get('ssh_username', 'root')
            ssh_password = details.get('ssh_password', '')
            esxi_credential_set_id = details.get('esxi_credential_set_id')
            dry_run = details.get('dry_run', False)
            
            if not profile_id:
                raise ValueError("Missing profile_id in job details")
            if not host_ids:
                raise ValueError("Missing host_ids in job details")
            
            # Fetch ESXi upgrade profile
            profile = self.executor.get_esxi_profile(profile_id)
            if not profile:
                raise ValueError(f"ESXi upgrade profile {profile_id} not found")
            
            self.log(f"ESXi Upgrade: {profile['name']} (Target: {profile['target_version']})")
            self.log(f"Bundle Path: {profile['bundle_path']}")
            self.log(f"Profile Name: {profile['profile_name']}")
            self.log(f"Targets: {len(host_ids)} host(s)")
            if dry_run:
                self.log("DRY RUN MODE - No actual changes will be made")
            
            success_count = 0
            failed_count = 0
            results = []
            
            # Create orchestrator with maintenance mode callbacks
            orchestrator = EsxiOrchestrator(
                enter_maintenance_fn=lambda host_id: self.executor.enter_vcenter_maintenance_mode(host_id),
                exit_maintenance_fn=lambda host_id: self.executor.exit_vcenter_maintenance_mode(host_id),
                logger=lambda msg, level='INFO': self.log(msg, level)
            )
            
            # Process each host
            for host_id in host_ids:
                # Fetch vCenter host details
                vcenter_host = self.executor.get_vcenter_host(host_id)
                if not vcenter_host:
                    self.log(f"vCenter host {host_id} not found", "ERROR")
                    failed_count += 1
                    results.append({
                        'host_id': host_id,
                        'success': False,
                        'error': 'Host not found in database'
                    })
                    continue
                
                host_name = vcenter_host['name']
                
                # Get management IP (from linked server or vCenter data)
                linked_server = vcenter_host.get('servers')
                if linked_server:
                    management_ip = linked_server['ip_address']
                    self.log(f"Using management IP from linked server: {management_ip}")
                else:
                    management_ip = vcenter_host.get('name', '')
                    self.log(f"No linked server, using vCenter host name as IP: {management_ip}")
                
                # Resolve ESXi credentials
                if not ssh_password:
                    esxi_creds = self.executor.get_esxi_credentials_for_host(
                        host_id=host_id,
                        host_ip=management_ip,
                        credential_set_id=esxi_credential_set_id
                    )
                    if esxi_creds:
                        ssh_username = esxi_creds['username']
                        ssh_password = esxi_creds['password']
                        self.log(f"Using ESXi credentials from {esxi_creds['source']}")
                    else:
                        raise ValueError(f"No ESXi credentials found for host {host_name} ({management_ip})")
                
                # Create task for this host
                task_id = self.create_task(job['id'], vcenter_host_id=host_id)
                if task_id:
                    self.update_task_status(task_id, 'running', log=f'Starting ESXi upgrade for {host_name}')
                
                try:
                    # Execute upgrade
                    self.log(f"\n{'='*60}")
                    self.log(f"Upgrading {host_name} ({management_ip})")
                    self.log(f"{'='*60}")
                    
                    result = orchestrator.upgrade_host(
                        host_name=host_name,
                        host_ip=management_ip,
                        ssh_username=ssh_username,
                        ssh_password=ssh_password,
                        bundle_path=profile['bundle_path'],
                        profile_name=profile['profile_name'],
                        vcenter_host_id=host_id,
                        dry_run=dry_run
                    )
                    
                    if result['success']:
                        self.log(f"✓ {host_name} upgrade completed successfully")
                        success_count += 1
                        
                        if task_id:
                            self.update_task_status(
                                task_id,
                                'completed',
                                log=f"Upgraded from {result.get('version_before')} to {result.get('version_after')}",
                                completed_at=datetime.now().isoformat()
                            )
                        
                        # Record history
                        self.executor.record_esxi_upgrade_history(
                            host_id=host_id,
                            server_id=linked_server['id'] if linked_server else None,
                            job_id=job['id'],
                            profile_id=profile_id,
                            version_before=result.get('version_before', 'Unknown'),
                            version_after=result.get('version_after', 'Unknown'),
                            status='completed',
                            ssh_output=json.dumps(result.get('steps_completed', []))
                        )
                    else:
                        self.log(f"✗ {host_name} upgrade failed: {result.get('error')}", "ERROR")
                        failed_count += 1
                        
                        if task_id:
                            self.update_task_status(
                                task_id,
                                'failed',
                                log=f"Upgrade failed: {result.get('error')}",
                                completed_at=datetime.now().isoformat()
                            )
                        
                        # Record history
                        self.executor.record_esxi_upgrade_history(
                            host_id=host_id,
                            server_id=linked_server['id'] if linked_server else None,
                            job_id=job['id'],
                            profile_id=profile_id,
                            version_before=result.get('version_before', 'Unknown'),
                            version_after=None,
                            status='failed',
                            error_message=result.get('error'),
                            ssh_output=json.dumps(result)
                        )
                    
                    results.append({
                        'host_id': host_id,
                        'host_name': host_name,
                        'success': result['success'],
                        'version_before': result.get('version_before'),
                        'version_after': result.get('version_after'),
                        'steps_completed': result.get('steps_completed', []),
                        'error': result.get('error')
                    })
                    
                except Exception as e:
                    error_msg = str(e)
                    self.log(f"✗ {host_name} upgrade exception: {error_msg}", "ERROR")
                    failed_count += 1
                    
                    if task_id:
                        self.update_task_status(
                            task_id,
                            'failed',
                            log=f"Exception: {error_msg}",
                            completed_at=datetime.now().isoformat()
                        )
                    
                    results.append({
                        'host_id': host_id,
                        'host_name': host_name,
                        'success': False,
                        'error': error_msg
                    })
            
            # Complete job
            job_result = {
                'profile': profile['name'],
                'target_version': profile['target_version'],
                'success_count': success_count,
                'failed_count': failed_count,
                'total': len(host_ids),
                'dry_run': dry_run,
                'results': results
            }
            
            final_status = 'completed' if failed_count == 0 else 'failed'
            self.update_job_status(
                job['id'],
                final_status,
                completed_at=datetime.now().isoformat(),
                details=job_result
            )
            
            self.log(f"\nESXi Upgrade Complete: {success_count} succeeded, {failed_count} failed")
            
        except Exception as e:
            import traceback
            error_msg = str(e)
            stack_trace = traceback.format_exc()
            self.log(f"ESXi upgrade job failed: {error_msg}\n{stack_trace}", "ERROR")
            
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={
                    'error': error_msg,
                    'traceback': stack_trace[:2000]
                }
            )
    
    def execute_esxi_then_firmware(self, job: Dict):
        """Execute ESXi upgrade first, then Dell firmware update"""
        try:
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            details = job.get('details', {})
            esxi_profile_id = details.get('esxi_profile_id')
            firmware_details = details.get('firmware_details', {})
            host_ids = details.get('host_ids', [])
            
            self.log("Combined ESXi → Firmware Upgrade Workflow")
            self.log(f"Processing {len(host_ids)} host(s)")
            
            results = []
            
            for host_id in host_ids:
                vcenter_host = self.executor.get_vcenter_host(host_id)
                if not vcenter_host:
                    continue
                
                host_name = vcenter_host['name']
                linked_server = vcenter_host.get('servers')
                
                self.log(f"\n{'='*60}")
                self.log(f"Processing {host_name}")
                self.log(f"{'='*60}")
                
                # Step 1: ESXi Upgrade
                self.log("Step 1: ESXi Hypervisor Upgrade")
                esxi_job_data = {
                    'id': job['id'],
                    'job_type': 'esxi_upgrade',
                    'details': {
                        'profile_id': esxi_profile_id,
                        'host_ids': [host_id],
                        'dry_run': False
                    }
                }
                
                try:
                    self.execute_esxi_upgrade(esxi_job_data)
                    esxi_success = True
                except Exception as e:
                    self.log(f"ESXi upgrade failed: {e}", "ERROR")
                    esxi_success = False
                
                # Step 2: Firmware Update (only if ESXi succeeded and server is linked)
                firmware_success = False
                if esxi_success and linked_server:
                    self.log("\nStep 2: Dell Firmware Update")
                    # Execute firmware update
                    firmware_success = True
                
                results.append({
                    'host_id': host_id,
                    'host_name': host_name,
                    'esxi_success': esxi_success,
                    'firmware_success': firmware_success,
                    'overall_success': esxi_success and firmware_success
                })
            
            # Complete job
            success_count = sum(1 for r in results if r['overall_success'])
            job_result = {
                'workflow': 'esxi_then_firmware',
                'success_count': success_count,
                'total': len(host_ids),
                'results': results
            }
            
            self.update_job_status(
                job['id'],
                'completed' if success_count == len(host_ids) else 'failed',
                completed_at=datetime.now().isoformat(),
                details=job_result
            )
            
        except Exception as e:
            self.log(f"Combined upgrade job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
    
    def execute_firmware_then_esxi(self, job: Dict):
        """Execute Dell firmware update first, then ESXi upgrade"""
        # Similar structure to execute_esxi_then_firmware but reverse order
        self.execute_esxi_then_firmware(job)  # Placeholder - implement reverse workflow
    
    def execute_esxi_preflight_check(self, job: Dict):
        """Execute ESXi pre-flight readiness checks using pyvmomi"""
        try:
            self.log(f"Starting ESXi pre-flight check: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            details = job.get('details', {})
            host_ids = details.get('host_ids', [])
            profile_id = details.get('profile_id')
            
            if not host_ids:
                raise ValueError("Missing host_ids in job details")
            if not profile_id:
                raise ValueError("Missing profile_id in job details")
            
            # Fetch ESXi upgrade profile
            profile = self.executor.get_esxi_profile(profile_id)
            if not profile:
                raise ValueError(f"ESXi upgrade profile {profile_id} not found")
            
            target_version = profile['target_version']
            self.log(f"Pre-flight check for upgrade to: {target_version}")
            self.log(f"Checking {len(host_ids)} host(s)")
            
            results = []
            ready_count = 0
            blocked_count = 0
            
            for host_id in host_ids:
                self.log(f"\nChecking host {host_id}...")
                
                check_result = self.executor.check_esxi_upgrade_readiness(host_id, target_version)
                
                if check_result['success']:
                    if check_result['ready']:
                        ready_count += 1
                        self.log(f"  ✓ {check_result['host_name']}: READY for upgrade")
                    else:
                        blocked_count += 1
                        self.log(f"  ✗ {check_result['host_name']}: BLOCKED - {len(check_result['blockers'])} issue(s)")
                        for blocker in check_result['blockers']:
                            self.log(f"    - {blocker}")
                    
                    if check_result['warnings']:
                        self.log(f"  ⚠ {check_result['host_name']}: {len(check_result['warnings'])} warning(s)")
                        for warning in check_result['warnings']:
                            self.log(f"    - {warning}")
                else:
                    blocked_count += 1
                    self.log(f"  ✗ Failed to check host: {check_result.get('error')}", "ERROR")
                
                results.append(check_result)
            
            # Complete job
            job_result = {
                'profile_name': profile['name'],
                'target_version': target_version,
                'total_hosts': len(host_ids),
                'ready_count': ready_count,
                'blocked_count': blocked_count,
                'results': results
            }
            
            self.log(f"\nPre-flight check complete:")
            self.log(f"  Ready: {ready_count}/{len(host_ids)}")
            self.log(f"  Blocked: {blocked_count}/{len(host_ids)}")
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details=job_result
            )
            
        except Exception as e:
            self.log(f"ESXi pre-flight check failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
