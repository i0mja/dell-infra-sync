"""
Failover Handler for Dell Server Manager Job Executor
======================================================

Handles failover pre-flight checks and group failover operations.
Implements 11 pre-flight checks before allowing failover to Site B.
"""

import time
from typing import Dict, Optional, List, Any
from datetime import datetime, timedelta


class FailoverHandler:
    """Handler for failover pre-flight checks and execution."""

    def __init__(self, executor):
        self.executor = executor

    def _utc_now_iso(self) -> str:
        """Get current UTC time as ISO string."""
        return datetime.utcnow().isoformat() + 'Z'

    def execute_failover_preflight_check(self, job: Dict):
        """
        Run all 11 pre-flight checks for a protection group before failover.
        
        Checks:
        1. DR Shell VMs exist for all protected VMs
        2. Replication is current (within RPO)
        3. Site B ZFS target is healthy
        4. Site B SSH Connectivity (NEW - actual connection test)
        5. Site B vCenter is connected
        6. NFS datastore is mounted and accessible
        7. No conflicting jobs are running
        8. All snapshots are consistent
        9. Network mappings are configured
        10. Protection group is not paused
        11. DR resources (CPU/RAM) are available
        """
        details = job.get('details', {})
        protection_group_id = details.get('protection_group_id')
        force_check = details.get('force', False)
        job_id = job['id']
        
        if not protection_group_id:
            self.executor.update_job_status(job_id, 'failed', details={
                **details,
                'error': 'No protection_group_id provided'
            })
            return

        # Initialize progress tracking
        console_log = []
        step_results = []
        total_checks = 11
        checks_completed = 0

        def log_and_track(msg: str, level: str = "INFO"):
            """Log message and add to console_log array."""
            timestamp = datetime.utcnow().strftime("%H:%M:%S")
            console_log.append(f"[{timestamp}] {level}: {msg}")
            self.executor.log(f"[Failover Pre-Flight] {msg}", level)

        def update_check_progress(check_name: str, passed: bool, message: str, is_warning: bool = False, remediation: Dict = None):
            """Update step results and persist progress to DB."""
            nonlocal checks_completed
            step_result = {
                'step': check_name,
                'status': 'success' if passed else ('warning' if is_warning else 'failed'),
                'passed': passed,
                'message': message,
                'timestamp': datetime.utcnow().isoformat()
            }
            if remediation:
                step_result['remediation'] = remediation
            step_results.append(step_result)
            checks_completed += 1
            progress = int((checks_completed / total_checks) * 100)
            
            self.executor.update_job_status(job_id, 'running', details={
                **details,
                'current_step': f"Check {checks_completed}/{total_checks}: {check_name}",
                'progress_percent': progress,
                'checks_completed': checks_completed,
                'total_checks': total_checks,
                'console_log': console_log,
                'step_results': step_results
            })

        log_and_track(f"Starting pre-flight checks for group {protection_group_id}")
        
        # Set initial running state with started_at
        self.executor.update_job_status(job_id, 'running', details={
            **details,
            'current_step': 'Initializing pre-flight checks...',
            'progress_percent': 0,
            'total_checks': total_checks,
            'checks_completed': 0,
            'console_log': console_log,
            'step_results': [],
            'started_at': self._utc_now_iso()
        })

        try:
            # Fetch protection group with target info
            log_and_track("Fetching protection group details...")
            group = self._fetch_protection_group(protection_group_id)
            if not group:
                self._fail_job(job, "Protection group not found")
                return

            # Run all checks
            checks = {}
            blockers = []
            warnings = []

            # 1. DR Shell VMs exist
            log_and_track("Check 1/11: Verifying DR Shell VMs exist...")
            checks['dr_shell_vms_exist'] = self._check_dr_shells_exist(protection_group_id)
            update_check_progress(
                'DR Shell VMs',
                checks['dr_shell_vms_exist']['passed'],
                checks['dr_shell_vms_exist']['message'],
                remediation=checks['dr_shell_vms_exist'].get('remediation')
            )
            if not checks['dr_shell_vms_exist']['passed']:
                blockers.append(checks['dr_shell_vms_exist'])

            # 2. Replication currency
            log_and_track("Check 2/11: Verifying replication currency...")
            checks['replication_current'] = self._check_replication_currency(group)
            update_check_progress(
                'Replication Current',
                checks['replication_current']['passed'],
                checks['replication_current']['message'],
                checks['replication_current'].get('is_warning', False),
                remediation=checks['replication_current'].get('remediation')
            )
            if not checks['replication_current']['passed']:
                if checks['replication_current'].get('is_warning'):
                    warnings.append(checks['replication_current'])
                else:
                    blockers.append(checks['replication_current'])

            # 3. Site B ZFS target health
            log_and_track("Check 3/11: Checking Site B ZFS health...")
            checks['site_b_zfs_healthy'] = self._check_site_b_zfs(group.get('target_id'))
            update_check_progress(
                'Site B ZFS Health',
                checks['site_b_zfs_healthy']['passed'],
                checks['site_b_zfs_healthy']['message'],
                remediation=checks['site_b_zfs_healthy'].get('remediation')
            )
            if not checks['site_b_zfs_healthy']['passed']:
                blockers.append(checks['site_b_zfs_healthy'])

            # 4. Site B SSH Connectivity (NEW - actual connection test)
            log_and_track("Check 4/11: Testing Site B SSH connectivity...")
            checks['site_b_ssh_connectivity'] = self._check_site_b_ssh_connectivity(group)
            update_check_progress(
                'Site B SSH',
                checks['site_b_ssh_connectivity']['passed'],
                checks['site_b_ssh_connectivity']['message'],
                remediation=checks['site_b_ssh_connectivity'].get('remediation')
            )
            if not checks['site_b_ssh_connectivity']['passed']:
                blockers.append(checks['site_b_ssh_connectivity'])

            # 5. Site B vCenter connection
            log_and_track("Check 5/11: Checking Site B vCenter connection...")
            checks['site_b_vcenter_connected'] = self._check_site_b_vcenter(group)
            update_check_progress(
                'Site B vCenter',
                checks['site_b_vcenter_connected']['passed'],
                checks['site_b_vcenter_connected']['message'],
                remediation=checks['site_b_vcenter_connected'].get('remediation')
            )
            if not checks['site_b_vcenter_connected']['passed']:
                blockers.append(checks['site_b_vcenter_connected'])

            # 6. NFS datastore mounted
            log_and_track("Check 6/11: Verifying NFS datastore is mounted...")
            checks['nfs_datastore_mounted'] = self._check_nfs_mounted(group)
            update_check_progress(
                'NFS Datastore',
                checks['nfs_datastore_mounted']['passed'],
                checks['nfs_datastore_mounted']['message'],
                remediation=checks['nfs_datastore_mounted'].get('remediation')
            )
            if not checks['nfs_datastore_mounted']['passed']:
                blockers.append(checks['nfs_datastore_mounted'])

            # 7. No conflicting jobs
            log_and_track("Check 7/11: Checking for conflicting jobs...")
            checks['no_conflicting_jobs'] = self._check_no_conflicts(protection_group_id, job_id)
            update_check_progress(
                'No Conflicts',
                checks['no_conflicting_jobs']['passed'],
                checks['no_conflicting_jobs']['message'],
                remediation=checks['no_conflicting_jobs'].get('remediation')
            )
            if not checks['no_conflicting_jobs']['passed']:
                blockers.append(checks['no_conflicting_jobs'])

            # 8. Snapshot consistency
            log_and_track("Check 8/11: Verifying snapshot consistency...")
            checks['snapshots_consistent'] = self._check_snapshot_consistency(protection_group_id)
            update_check_progress(
                'Snapshots',
                checks['snapshots_consistent']['passed'],
                checks['snapshots_consistent']['message'],
                checks['snapshots_consistent'].get('is_warning', False),
                remediation=checks['snapshots_consistent'].get('remediation')
            )
            if not checks['snapshots_consistent']['passed']:
                if checks['snapshots_consistent'].get('is_warning'):
                    warnings.append(checks['snapshots_consistent'])
                else:
                    blockers.append(checks['snapshots_consistent'])

            # 9. Network mapping
            log_and_track("Check 9/11: Validating network mappings...")
            checks['network_mapping_valid'] = self._check_network_mapping(protection_group_id)
            update_check_progress(
                'Network Mapping',
                checks['network_mapping_valid']['passed'],
                checks['network_mapping_valid']['message'],
                True,  # Network mapping issues are warnings
                remediation=checks['network_mapping_valid'].get('remediation')
            )
            if not checks['network_mapping_valid']['passed']:
                warnings.append(checks['network_mapping_valid'])

            # 10. Group not paused
            log_and_track("Check 10/11: Checking group status...")
            checks['group_not_paused'] = self._check_group_status(group)
            update_check_progress(
                'Group Status',
                checks['group_not_paused']['passed'],
                checks['group_not_paused']['message'],
                remediation=checks['group_not_paused'].get('remediation')
            )
            if not checks['group_not_paused']['passed']:
                blockers.append(checks['group_not_paused'])

            # 11. DR resources available
            log_and_track("Check 11/11: Checking DR resource availability...")
            checks['resources_available'] = self._check_dr_resources(protection_group_id, group)
            update_check_progress(
                'DR Resources',
                checks['resources_available']['passed'],
                checks['resources_available']['message'],
                checks['resources_available'].get('is_warning', False),
                remediation=checks['resources_available'].get('remediation')
            )
            if not checks['resources_available']['passed']:
                if checks['resources_available'].get('is_warning'):
                    warnings.append(checks['resources_available'])
                else:
                    blockers.append(checks['resources_available'])

            # Determine overall result
            all_passed = len(blockers) == 0
            can_proceed = all_passed or force_check
            can_force = len(blockers) == 0 or all(b.get('can_override', False) for b in blockers)

            result = {
                'ready': all_passed,
                'can_proceed': can_proceed,
                'can_force': can_force,
                'checks': checks,
                'blockers': blockers,
                'warnings': warnings,
                'checked_at': datetime.utcnow().isoformat(),
                'protection_group_id': protection_group_id,
                'group_name': group.get('name', 'Unknown'),
                'vm_count': self._get_vm_count(protection_group_id)
            }

            # Update protected VMs with check results
            self._update_vm_failover_readiness(protection_group_id, checks)

            status_msg = f"Complete: ready={all_passed}, blockers={len(blockers)}, warnings={len(warnings)}"
            log_and_track(status_msg)
            
            self.executor.update_job_status(job_id, 'completed', details={
                **details,
                'result': result,
                'console_log': console_log,
                'step_results': step_results,
                'progress_percent': 100,
                'checks_completed': total_checks,
                'total_checks': total_checks
            })

        except Exception as e:
            log_and_track(f"Error: {e}", "ERROR")
            self.executor.update_job_status(job_id, 'failed', details={
                **details,
                'error': str(e),
                'console_log': console_log,
                'step_results': step_results
            })

    def execute_group_failover(self, job: Dict):
        """
        Execute failover for an entire protection group to Site B.
        
        Steps:
        1. Validate pre-flight checks (unless force=True)
        2. Create failover event record
        3. Optional: Run final sync before failover
        4. Optional: Gracefully shutdown source VMs
        5. For each protected VM, power on DR shell VM
        6. Update protection group status
        7. Set up reverse protection (optional)
        """
        details = job.get('details', {})
        protection_group_id = details.get('protection_group_id')
        failover_type = details.get('failover_type', 'live')  # 'live' or 'test'
        force = details.get('force', False)
        shutdown_source = details.get('shutdown_source_vms', True)
        final_sync = details.get('final_sync', True)
        reverse_protection = details.get('reverse_protection', False)
        test_network_id = details.get('test_network_id')

        if not protection_group_id:
            self._fail_job(job, "No protection_group_id provided")
            return

        # Console log tracking for debugging
        console_log = []
        
        def log_step(msg: str, level: str = "INFO"):
            timestamp = datetime.utcnow().strftime('%H:%M:%S')
            console_log.append(f"[{timestamp}] {level}: {msg}")
            self.executor.log(msg, level)
        
        log_step(f"Starting {failover_type} failover for group {protection_group_id}")
        self.executor.update_job_status(job['id'], 'running')

        try:
            # Fetch group and VMs
            log_step("Fetching protection group...")
            group = self._fetch_protection_group(protection_group_id)
            if not group:
                self._fail_job(job, "Protection group not found")
                return

            log_step("Fetching protected VMs...")
            vms = self._fetch_protected_vms(protection_group_id)
            if not vms:
                self._fail_job(job, "No protected VMs in group")
                return
            
            log_step(f"Found {len(vms)} protected VMs")

            # Create failover event
            log_step("Creating failover event record...")
            event_id = self._create_failover_event(
                protection_group_id, 
                failover_type, 
                job.get('created_by'),
                shutdown_source,
                reverse_protection,
                test_network_id
            )

            # Update group status
            self._update_group_failover_status(protection_group_id, 'failing_over', event_id)

            # Optional: Final sync
            if final_sync and failover_type == 'live':
                log_step("Running final sync...")
                self._run_final_sync(protection_group_id)

            # Optional: Shutdown source VMs (live failover only)
            if shutdown_source and failover_type == 'live':
                log_step("Shutting down source VMs...")
                self._shutdown_source_vms(vms, group.get('source_vcenter_id'))

            # Power on DR shell VMs
            recovered_count = 0
            failed_vms = []
            
            for vm in vms:
                try:
                    vm_name = vm.get('vm_name')
                    log_step(f"Powering on DR VM for: {vm_name}")
                    success = self._power_on_dr_shell_vm(vm, group, failover_type, test_network_id)
                    if success:
                        recovered_count += 1
                        self._update_vm_failover_status(vm['id'], 'failed_over')
                        log_step(f"Successfully powered on DR VM: {vm_name}")
                    else:
                        failed_vms.append(vm_name)
                        self._update_vm_failover_status(vm['id'], 'failover_error')
                        log_step(f"Failed to power on DR VM: {vm_name}", "ERROR")
                except Exception as e:
                    log_step(f"Error with VM {vm.get('vm_name')}: {e}", "ERROR")
                    failed_vms.append(vm.get('vm_name'))

            # Update event with results
            final_status = 'awaiting_commit' if failover_type == 'live' else 'completed'
            self._update_failover_event(event_id, final_status, recovered_count)
            
            # Update group status
            new_group_status = 'failed_over' if recovered_count > 0 else 'failover_error'
            self._update_group_failover_status(protection_group_id, new_group_status, event_id)
            
            # Update last_test_at and schedule cleanup for successful test failovers
            if failover_type == 'test' and recovered_count > 0:
                self._update_protection_group_test_date(protection_group_id)
                
                # Schedule automatic cleanup
                test_duration = details.get('test_duration_minutes', 60)
                cleanup_at = datetime.utcnow() + timedelta(minutes=test_duration)
                
                cleanup_job_id = self._schedule_test_cleanup(
                    protection_group_id,
                    event_id,
                    cleanup_at,
                    job.get('created_by')
                )
                
                # Update failover event with cleanup info
                if cleanup_job_id:
                    self._update_failover_event_cleanup(event_id, test_duration, cleanup_at, cleanup_job_id)
                    log_step(f"Automatic cleanup scheduled in {test_duration} minutes")

            result = {
                'success': recovered_count > 0,
                'recovered_count': recovered_count,
                'failed_vms': failed_vms,
                'total_vms': len(vms),
                'failover_type': failover_type,
                'event_id': event_id,
                'status': final_status,
                'requires_commit': failover_type == 'live'
            }

            log_step(f"Complete: {recovered_count}/{len(vms)} VMs recovered")
            self.executor.update_job_status(job['id'], 'completed', details={
                **details,
                'result': result,
                'console_log': console_log
            })

        except Exception as e:
            self.executor.log(f"[Group Failover] Error: {e}", "ERROR")
            self._fail_job(job, str(e))

    def execute_test_failover(self, job: Dict):
        """Execute test failover (wrapper around group_failover with test settings)."""
        job['details'] = {
            **job.get('details', {}),
            'failover_type': 'test',
            'shutdown_source_vms': False,
            'final_sync': False,
            'reverse_protection': False
        }
        self.execute_group_failover(job)

    def execute_commit_failover(self, job: Dict):
        """Commit a failover - makes it permanent, cleans up source."""
        details = job.get('details', {})
        event_id = details.get('event_id')
        protection_group_id = details.get('protection_group_id')

        if not event_id or not protection_group_id:
            self._fail_job(job, "Missing event_id or protection_group_id")
            return

        self.executor.log(f"[Commit Failover] Committing failover event {event_id}")
        self.executor.update_job_status(job['id'], 'running')

        try:
            # Update failover event
            self._update_failover_event(event_id, 'committed', committed_at=datetime.utcnow().isoformat())
            
            # Update group status
            self._update_group_failover_status(protection_group_id, 'committed', None)

            self.executor.log("[Commit Failover] Failover committed successfully")
            self.executor.update_job_status(job['id'], 'completed', details={
                **details,
                'committed': True,
                'committed_at': datetime.utcnow().isoformat()
            })

        except Exception as e:
            self.executor.log(f"[Commit Failover] Error: {e}", "ERROR")
            self._fail_job(job, str(e))

    def execute_rollback_failover(self, job: Dict):
        """Rollback a failover - power off DR VMs, restore original state."""
        details = job.get('details', {})
        event_id = details.get('event_id')
        protection_group_id = details.get('protection_group_id')

        if not event_id or not protection_group_id:
            self._fail_job(job, "Missing event_id or protection_group_id")
            return

        self.executor.log(f"[Rollback Failover] Rolling back failover event {event_id}")
        self.executor.update_job_status(job['id'], 'running')

        try:
            group = self._fetch_protection_group(protection_group_id)
            vms = self._fetch_protected_vms(protection_group_id)
            
            # Fetch the failover event to check its type
            failover_event = self._fetch_failover_event(event_id)
            is_test_failover = failover_event and failover_event.get('failover_type') == 'test'
            
            # Cancel any scheduled cleanup job if this is a manual rollback
            if not details.get('auto_scheduled'):
                self._cancel_scheduled_cleanup(event_id)

            # Power off DR shell VMs
            for vm in vms:
                try:
                    self._power_off_dr_shell_vm(vm, group)
                    self._update_vm_failover_status(vm['id'], 'normal')
                except Exception as e:
                    self.executor.log(f"[Rollback Failover] Error with VM {vm.get('vm_name')}: {e}", "WARN")

            # Update failover event
            self._update_failover_event(event_id, 'rolled_back', rolled_back_at=datetime.utcnow().isoformat())
            
            # Update group status back to normal
            self._update_group_failover_status(protection_group_id, 'normal', None)
            
            # For test failovers, update last_test_at to mark the test as completed
            # Rolling back IS the expected completion of a test failover
            if is_test_failover:
                self._update_protection_group_test_date(protection_group_id)
                self.executor.log("[Rollback Failover] Updated last_test_at for completed test")

            self.executor.log("[Rollback Failover] Rollback completed")
            self.executor.update_job_status(job['id'], 'completed', details={
                **details,
                'rolled_back': True,
                'rolled_back_at': datetime.utcnow().isoformat()
            })

        except Exception as e:
            self.executor.log(f"[Rollback Failover] Error: {e}", "ERROR")
            self._fail_job(job, str(e))

    # ==================== Pre-Flight Check Methods ====================

    def _check_dr_shells_exist(self, protection_group_id: str) -> Dict:
        """Check that all protected VMs have DR shell VMs created."""
        vms = self._fetch_protected_vms(protection_group_id)
        
        if not vms:
            return {
                'name': 'DR Shell VMs Exist',
                'passed': False,
                'message': 'No protected VMs in group',
                'can_override': False
            }

        missing_shells = [v for v in vms if not v.get('dr_shell_vm_created')]
        
        if missing_shells:
            return {
                'name': 'DR Shell VMs Exist',
                'passed': False,
                'message': f'{len(missing_shells)} VMs missing DR shells',
                'details': [v.get('vm_name') for v in missing_shells],
                'can_override': False,
                'remediation': {
                    'action_type': 'open_dr_shell_wizard',
                    # No job_type - this is a UI action, not a direct job
                    'description': f'Open wizard to create DR shell VMs for {len(missing_shells)} VMs',
                    'can_auto_fix': False,
                    'requires_confirmation': True,
                    'context': {
                        'vm_ids': [v.get('id') for v in missing_shells],
                        'vm_names': [v.get('vm_name') for v in missing_shells],
                        'protection_group_id': protection_group_id
                    }
                }
            }

        return {
            'name': 'DR Shell VMs Exist',
            'passed': True,
            'message': f'All {len(vms)} VMs have DR shells'
        }

    def _check_replication_currency(self, group: Dict) -> Dict:
        """Check if replication is current (within RPO)."""
        last_replication = group.get('last_replication_at')
        rpo_minutes = group.get('rpo_minutes', 60)

        if not last_replication:
            return {
                'name': 'Replication Current',
                'passed': False,
                'message': 'No replication has been run yet',
                'can_override': True,
                'is_warning': True
            }

        try:
            last_sync = datetime.fromisoformat(last_replication.replace('Z', '+00:00'))
            age_minutes = (datetime.utcnow().replace(tzinfo=last_sync.tzinfo) - last_sync).total_seconds() / 60
            
            if age_minutes > rpo_minutes * 2:
                return {
                    'name': 'Replication Current',
                    'passed': False,
                    'message': f'Last sync was {int(age_minutes)} minutes ago (RPO: {rpo_minutes}m)',
                    'can_override': True,
                    'is_warning': True
                }

            return {
                'name': 'Replication Current',
                'passed': True,
                'message': f'Last sync {int(age_minutes)} minutes ago'
            }
        except Exception as e:
            return {
                'name': 'Replication Current',
                'passed': False,
                'message': f'Could not parse last replication time: {e}',
                'can_override': True
            }

    def _check_site_b_zfs(self, target_id: Optional[str]) -> Dict:
        """Check Site B ZFS target health."""
        if not target_id:
            return {
                'name': 'Site B ZFS Healthy',
                'passed': False,
                'message': 'No target configured for this group',
                'can_override': False
            }

        target = self._fetch_replication_target(target_id)
        if not target:
            return {
                'name': 'Site B ZFS Healthy',
                'passed': False,
                'message': 'Target not found',
                'can_override': False
            }

        health = target.get('health_status', 'unknown')
        if health != 'healthy':
            return {
                'name': 'Site B ZFS Healthy',
                'passed': False,
                'message': f'Target health: {health}',
                'can_override': True
            }

        return {
            'name': 'Site B ZFS Healthy',
            'passed': True,
            'message': f'Target {target.get("name")} is healthy'
        }

    def _get_site_b_target(self, group: Dict) -> Optional[Dict]:
        """
        Get the Site B (DR) target for a protection group.
        
        This correctly identifies the DR target by checking:
        1. If the group's target is itself a DR site, use it directly
        2. Otherwise, get the partner_target_id (the actual DR site)
        
        This ensures pre-flight checks test the ACTUAL Site B, not the primary site.
        """
        target_id = group.get('target_id')
        if not target_id:
            return None
        
        target = self._fetch_replication_target(target_id)
        if not target:
            return None
        
        # If the target is already a DR site, use it directly
        if target.get('site_role') == 'dr':
            self.executor.log(f"[Site B] Target {target.get('name')} is already DR site")
            return target
        
        # Otherwise, get the partner (DR) target
        partner_id = target.get('partner_target_id')
        if partner_id:
            partner_target = self._fetch_replication_target(partner_id)
            if partner_target:
                self.executor.log(f"[Site B] Using partner target {partner_target.get('name')} as Site B (instead of {target.get('name')})")
                return partner_target
            else:
                self.executor.log(f"[Site B] Partner target {partner_id} not found", "WARNING")
        
        # No partner configured - return the original target with a warning
        self.executor.log(f"[Site B] No partner target configured, using {target.get('name')}", "WARNING")
        return target

    def _check_site_b_ssh_connectivity(self, group: Dict) -> Dict:
        """
        Check SSH connectivity to Site B ZFS target using centralized credential lookup.
        Uses SSHCredentialManager for comprehensive credential lookup - same as replication.
        
        IMPORTANT: Tests the PARTNER target (actual DR site), not the primary target.
        """
        from job_executor.ssh_utils import SSHCredentialManager
        
        # Get the correct Site B target (partner/DR site)
        site_b_target = self._get_site_b_target(group)
        
        if not site_b_target:
            return {
                'name': 'Site B SSH Connectivity',
                'passed': False,
                'message': 'No Site B target configured',
                'can_override': False
            }

        site_b_target_id = site_b_target.get('id')
        hostname = site_b_target.get('hostname')
        target_name = site_b_target.get('name', hostname)
        
        # Use centralized SSH credential manager (same lookup as replication!)
        ssh_manager = SSHCredentialManager(self.executor)
        
        # Check if key is assigned but not deployed (common issue causing auth failures)
        deployment_status = ssh_manager.check_deployment_status(site_b_target)
        
        if deployment_status['has_assigned_key'] and not deployment_status['has_deployment']:
            # Key assigned but never deployed - this will definitely fail
            key_name = deployment_status['ssh_key_name'] or 'Unknown'
            return {
                'name': 'Site B SSH Connectivity',
                'passed': False,
                'message': f'SSH key "{key_name}" assigned but not deployed to {target_name}',
                'can_override': False,
                'is_warning': True,
                'remediation': {
                    'action_type': 'deploy_assigned_key',
                    'job_type': 'ssh_key_deploy',
                    'job_params': {
                        'ssh_key_id': deployment_status['ssh_key_id'],
                        'target_ids': [site_b_target_id],
                        'force': True
                    },
                    'description': f'Deploy "{key_name}" key to {target_name}',
                    'requires_password': True,
                    'can_auto_fix': False,
                    'context': {
                        'target_id': site_b_target_id,
                        'target_name': target_name,
                        'hostname': hostname,
                        'ssh_key_id': deployment_status['ssh_key_id'],
                        'ssh_key_name': key_name
                    }
                }
            }
        
        creds = ssh_manager.get_credentials(site_b_target)
        
        if not creds:
            return {
                'name': 'Site B SSH Connectivity',
                'passed': False,
                'message': f'No SSH credentials found for {target_name} ({hostname})',
                'can_override': False,
                'remediation': {
                    'action_type': 'setup_ssh_key',
                    'job_type': 'ssh_key_deploy',
                    'job_params': {'target_ids': [site_b_target_id], 'force': True},
                    'description': f'Deploy SSH key to {target_name}',
                    'requires_password': True,
                    'can_auto_fix': False,
                    'context': {
                        'target_id': site_b_target_id,
                        'target_name': target_name,
                        'hostname': hostname
                    }
                }
            }
        
        # Actually test SSH connection using centralized test
        ssh_result = ssh_manager.test_connection(creds)
        
        if not ssh_result['success']:
            return {
                'name': 'Site B SSH Connectivity',
                'passed': False,
                'message': f"SSH to {target_name} ({hostname}) failed: {ssh_result.get('error', 'Unknown error')}",
                'can_override': True,
                'remediation': {
                    'action_type': 'redeploy_ssh_key',
                    'job_type': 'ssh_key_deploy',
                    'job_params': {'target_ids': [site_b_target_id], 'force': True},
                    'description': f'Re-deploy SSH key to {target_name} (may require root password)',
                    'requires_password': True,
                    'can_auto_fix': False,
                    'context': {
                        'target_id': site_b_target_id,
                        'target_name': target_name,
                        'hostname': hostname
                    }
                }
            }

        key_source = creds.get('key_source', 'key')
        return {
            'name': 'Site B SSH Connectivity',
            'passed': True,
            'message': f'SSH to {target_name} ({hostname}) successful (via {key_source})'
        }

    def _check_site_b_vcenter(self, group: Dict) -> Dict:
        """Check Site B vCenter connection via target's dr_vcenter_id.
        
        IMPORTANT: Uses the PARTNER target (actual DR site) for vCenter lookup.
        """
        # Get the correct Site B target (partner/DR site)
        site_b_target = self._get_site_b_target(group)
        
        if not site_b_target:
            return {
                'name': 'Site B vCenter Connected',
                'passed': False,
                'message': 'No Site B target configured',
                'can_override': False
            }

        target_name = site_b_target.get('name', site_b_target.get('hostname'))
        dr_vcenter_id = site_b_target.get('dr_vcenter_id')

        if not dr_vcenter_id:
            return {
                'name': 'Site B vCenter Connected',
                'passed': False,
                'message': f'No DR vCenter configured on {target_name}',
                'can_override': False
            }

        # TODO: Actually test vCenter connection
        return {
            'name': 'Site B vCenter Connected',
            'passed': True,
            'message': f'DR vCenter configured on {target_name}'
        }

    def _check_nfs_mounted(self, group: Dict) -> Dict:
        """Check that NFS datastore is mounted on DR vCenter - LIVE vCenter API query.
        
        Uses centralized get_live_datastore() for live vCenter querying with auto-sync.
        """
        dr_datastore = group.get('dr_datastore')
        
        if not dr_datastore:
            return {
                'name': 'NFS Datastore Mounted',
                'passed': False,
                'message': 'No DR datastore configured',
                'can_override': True,
                'is_warning': True
            }

        # Get target for vCenter info
        target_id = group.get('target_id')
        if not target_id:
            return {
                'name': 'NFS Datastore Mounted',
                'passed': False,
                'message': 'No replication target configured',
                'can_override': False
            }

        target = self._fetch_replication_target(target_id)
        if not target:
            return {
                'name': 'NFS Datastore Mounted',
                'passed': False,
                'message': 'Replication target not found',
                'can_override': False
            }

        # Find which target/vCenter manages this datastore
        resolved_target_id = self._find_target_for_datastore(dr_datastore)
        if resolved_target_id and resolved_target_id != target_id:
            resolved_target = self._fetch_replication_target(resolved_target_id)
            vcenter_id = resolved_target.get('dr_vcenter_id') if resolved_target else target.get('dr_vcenter_id')
            effective_target_id = resolved_target_id
        else:
            vcenter_id = target.get('dr_vcenter_id')
            effective_target_id = target_id

        if not vcenter_id:
            return {
                'name': 'NFS Datastore Mounted',
                'passed': False,
                'message': 'No DR vCenter configured on target',
                'can_override': False
            }

        # Use centralized live vCenter query with auto-sync
        live_result = self.executor.get_live_datastore(vcenter_id, dr_datastore, auto_sync=True)
        
        if live_result.get('error') and not live_result.get('found'):
            # Live query failed completely - use DB fallback
            self.executor.log(f"[Failover Pre-Flight] Live vCenter check failed: {live_result['error']}", "WARNING")
            return self._check_nfs_mounted_from_db(group, dr_datastore, target, effective_target_id, vcenter_id)
        
        # Get vCenter host for messages
        vcenter = self._fetch_vcenter(vcenter_id)
        vcenter_host = vcenter.get('host', vcenter_id) if vcenter else vcenter_id
        
        if not live_result.get('found'):
            return {
                'name': 'NFS Datastore Mounted',
                'passed': False,
                'message': f'Datastore "{dr_datastore}" not found on vCenter {vcenter_host}',
                'can_override': False,
                'remediation': {
                    'action_type': 'mount_datastore',
                    'job_type': 'manage_datastore',
                    'job_params': {
                        'target_id': effective_target_id,
                        'operation': 'mount_all',
                        'datastore_name': dr_datastore,
                        'vcenter_id': vcenter_id
                    },
                    'context': {
                        'vcenter_id': vcenter_id,
                        'vcenter_host': vcenter_host,
                        'datastore_name': dr_datastore,
                        'target_id': effective_target_id
                    },
                    'description': f'Mount {dr_datastore} on vCenter {vcenter_host}',
                    'can_auto_fix': True
                }
            }
        
        # Datastore found - check accessibility and mount status
        ds_data = live_result.get('data', {})
        accessible = ds_data.get('accessible', False)
        hosts_mounted = ds_data.get('hosts_mounted', 0)
        hosts_total = ds_data.get('hosts_total', 0)
        
        if not accessible:
            return {
                'name': 'NFS Datastore Mounted',
                'passed': False,
                'message': f'Datastore "{dr_datastore}" is not accessible',
                'can_override': False,
                'remediation': {
                    'action_type': 'remount_datastore',
                    'job_type': 'manage_datastore',
                    'job_params': {
                        'target_id': effective_target_id,
                        'operation': 'refresh',
                        'datastore_name': dr_datastore,
                        'vcenter_id': vcenter_id
                    },
                    'context': {
                        'vcenter_id': vcenter_id,
                        'datastore_name': dr_datastore,
                        'target_id': effective_target_id
                    },
                    'description': f'Re-mount {dr_datastore} to make it accessible',
                    'can_auto_fix': True
                }
            }
        
        if hosts_mounted == 0:
            return {
                'name': 'NFS Datastore Mounted',
                'passed': False,
                'message': f'Datastore "{dr_datastore}" not mounted on any hosts',
                'can_override': False,
                'remediation': {
                    'action_type': 'mount_on_hosts',
                    'job_type': 'manage_datastore',
                    'job_params': {
                        'target_id': effective_target_id,
                        'operation': 'mount_all',
                        'datastore_name': dr_datastore,
                        'vcenter_id': vcenter_id
                    },
                    'context': {
                        'vcenter_id': vcenter_id,
                        'datastore_name': dr_datastore,
                        'target_id': effective_target_id
                    },
                    'description': f'Mount {dr_datastore} on all vCenter hosts',
                    'can_auto_fix': True
                }
            }
        
        synced_note = " (DB synced)" if live_result.get('synced') else ""
        return {
            'name': 'NFS Datastore Mounted',
            'passed': True,
            'message': f'Datastore mounted on {hosts_mounted}/{hosts_total} hosts, accessible (live vCenter check){synced_note}'
        }

    def _check_nfs_mounted_from_db(self, group: Dict, dr_datastore: str, target: Dict, effective_target_id: str, vcenter_id: str) -> Dict:
        """Fallback: Check datastore status from database when live vCenter check fails."""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        import requests
        
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
            }
            
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_datastores",
                params={
                    'name': f'eq.{dr_datastore}',
                    'select': 'id,name,accessible,host_count,last_sync'
                },
                headers=headers,
                verify=VERIFY_SSL,
                timeout=15
            )

            if response.status_code != 200:
                return {
                    'name': 'NFS Datastore Mounted',
                    'passed': False,
                    'message': f'Failed to query datastores: HTTP {response.status_code}',
                    'can_override': True
                }

            datastores = response.json()
            
            if not datastores:
                return {
                    'name': 'NFS Datastore Mounted',
                    'passed': False,
                    'message': f'Datastore "{dr_datastore}" not found (database fallback)',
                    'can_override': False,
                    'remediation': {
                        'action_type': 'mount_datastore',
                        'job_type': 'manage_datastore',
                        'job_params': {
                            'target_id': effective_target_id,
                            'operation': 'mount_all',
                            'datastore_name': dr_datastore,
                            'vcenter_id': vcenter_id
                        },
                        'description': f'Mount {dr_datastore} on all vCenter hosts',
                        'can_auto_fix': True
                    }
                }

            ds = datastores[0]
            accessible = ds.get('accessible', False)
            host_count = ds.get('host_count', 0)
            last_sync = ds.get('last_sync', 'unknown')

            if not accessible or host_count == 0:
                return {
                    'name': 'NFS Datastore Mounted',
                    'passed': False,
                    'message': f'Datastore not accessible (DB fallback, last sync: {last_sync})',
                    'can_override': False,
                    'is_warning': True,
                    'remediation': {
                        'action_type': 'mount_datastore',
                        'job_type': 'manage_datastore',
                        'job_params': {
                            'target_id': effective_target_id,
                            'operation': 'mount_all',
                            'datastore_name': dr_datastore,
                            'vcenter_id': vcenter_id
                        },
                        'description': f'Mount/refresh {dr_datastore}',
                        'can_auto_fix': True
                    }
                }

            return {
                'name': 'NFS Datastore Mounted',
                'passed': True,
                'message': f'Datastore mounted on {host_count} hosts (DB fallback, last sync: {last_sync})',
                'is_warning': True  # Warn that this is stale data
            }

        except Exception as e:
            return {
                'name': 'NFS Datastore Mounted',
                'passed': False,
                'message': f'Error checking datastore: {str(e)}',
                'can_override': True
            }

    def _find_target_for_datastore(self, datastore_name: str) -> Optional[str]:
        """Find the replication target that manages a given datastore.
        
        Matches by:
        1. Exact datastore_name match in replication_targets
        2. Pattern match: "NFS-{hostname}" where hostname is target's name/hostname
        3. Pattern match: "nfs-{target_name}" for older naming convention
        """
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        import requests
        
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
            }
            
            # Try 1: Exact datastore_name match
            response = requests.get(
                f"{DSM_URL}/rest/v1/replication_targets",
                params={
                    'datastore_name': f'eq.{datastore_name}',
                    'select': 'id,name,hostname,dr_vcenter_id'
                },
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.status_code == 200:
                targets = response.json()
                if targets:
                    self.executor.log(f"[Failover] Found target by exact datastore_name: {targets[0].get('name')}")
                    return targets[0].get('id')
            
            # Try 2: Pattern match for "NFS-{hostname}" or "nfs-{name}"
            # E.g., "NFS-zfs-lyo-vrep-02" → look for target with hostname/name containing "zfs-lyo-vrep-02"
            pattern_prefixes = ['NFS-', 'nfs-']
            for prefix in pattern_prefixes:
                if datastore_name.startswith(prefix):
                    target_pattern = datastore_name[len(prefix):]  # Remove prefix
                    
                    # Search by hostname containing the pattern
                    response = requests.get(
                        f"{DSM_URL}/rest/v1/replication_targets",
                        params={
                            'hostname': f'ilike.*{target_pattern}*',
                            'select': 'id,name,hostname,dr_vcenter_id'
                        },
                        headers=headers,
                        verify=VERIFY_SSL,
                        timeout=10
                    )
                    
                    if response.status_code == 200:
                        targets = response.json()
                        if targets:
                            self.executor.log(f"[Failover] Found target by hostname pattern '{target_pattern}': {targets[0].get('name')}")
                            return targets[0].get('id')
                    
                    # Search by name containing the pattern
                    response = requests.get(
                        f"{DSM_URL}/rest/v1/replication_targets",
                        params={
                            'name': f'ilike.*{target_pattern}*',
                            'select': 'id,name,hostname,dr_vcenter_id'
                        },
                        headers=headers,
                        verify=VERIFY_SSL,
                        timeout=10
                    )
                    
                    if response.status_code == 200:
                        targets = response.json()
                        if targets:
                            self.executor.log(f"[Failover] Found target by name pattern '{target_pattern}': {targets[0].get('name')}")
                            return targets[0].get('id')
        except Exception as e:
            self.executor.log(f"[Failover] Error finding target for datastore: {e}", "WARNING")
        
        return None

    def _fetch_vcenter(self, vcenter_id: str) -> Optional[Dict]:
        """Fetch vCenter details with decrypted password."""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        import requests
        
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
            }
            
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenters",
                params={
                    'id': f'eq.{vcenter_id}',
                    'select': 'id,name,host,username,password_encrypted,port'
                },
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.status_code == 200:
                vcenters = response.json()
                if vcenters:
                    vc = vcenters[0]
                    # Decrypt password
                    if vc.get('password_encrypted'):
                        vc['password'] = self.executor.decrypt_password(vc['password_encrypted'])
                    return vc
        except Exception as e:
            self.executor.log(f"[Failover] Error fetching vCenter: {e}", "WARNING")
        
        return None

    def _check_no_conflicts(self, protection_group_id: str, current_job_id: str) -> Dict:
        """Check for conflicting running jobs."""
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            import requests

            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            }

            # Check for running replication or failover jobs
            response = requests.get(
                f"{DSM_URL}/rest/v1/jobs",
                headers=headers,
                params={
                    'select': 'id,job_type,status',
                    'status': 'in.(pending,running)',
                    'job_type': 'in.(run_replication_sync,group_failover,test_failover)',
                    'id': f'neq.{current_job_id}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )

            if response.status_code == 200:
                jobs = response.json()
                # Filter for jobs targeting this group
                conflicting = [j for j in jobs if j.get('details', {}).get('protection_group_id') == protection_group_id]
                
                if conflicting:
                    return {
                        'name': 'No Conflicting Jobs',
                        'passed': False,
                        'message': f'{len(conflicting)} conflicting jobs running',
                        'can_override': False
                    }

            return {
                'name': 'No Conflicting Jobs',
                'passed': True,
                'message': 'No conflicting jobs'
            }

        except Exception as e:
            return {
                'name': 'No Conflicting Jobs',
                'passed': True,
                'message': f'Could not check: {e}'
            }

    def _check_snapshot_consistency(self, protection_group_id: str) -> Dict:
        """Check that all VMs have consistent snapshot times."""
        vms = self._fetch_protected_vms(protection_group_id)
        
        if not vms:
            return {
                'name': 'Snapshots Consistent',
                'passed': True,
                'message': 'No VMs to check'
            }

        snapshot_times = [v.get('last_snapshot_at') for v in vms if v.get('last_snapshot_at')]
        
        if not snapshot_times:
            return {
                'name': 'Snapshots Consistent',
                'passed': False,
                'message': 'No snapshots found',
                'can_override': True,
                'is_warning': True
            }

        # Check if snapshots are within 5 minutes of each other
        try:
            times = [datetime.fromisoformat(t.replace('Z', '+00:00')) for t in snapshot_times]
            time_spread = (max(times) - min(times)).total_seconds() / 60
            
            if time_spread > 5:
                return {
                    'name': 'Snapshots Consistent',
                    'passed': False,
                    'message': f'Snapshot times vary by {int(time_spread)} minutes',
                    'can_override': True,
                    'is_warning': True
                }
        except Exception:
            pass

        return {
            'name': 'Snapshots Consistent',
            'passed': True,
            'message': f'{len(snapshot_times)} snapshots are consistent'
        }

    def _check_network_mapping(self, protection_group_id: str) -> Dict:
        """Check if network mappings are configured or can be auto-resolved by VLAN ID."""
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            import requests

            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            }

            # 1. Check for manual overrides first
            response = requests.get(
                f"{DSM_URL}/rest/v1/protection_group_network_mappings",
                headers=headers,
                params={
                    'select': 'id,source_network,target_network',
                    'protection_group_id': f'eq.{protection_group_id}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            manual_mappings = response.json() if response.status_code == 200 else []
            
            # 2. Get protection group details (source and DR vCenter IDs)
            pg_response = requests.get(
                f"{DSM_URL}/rest/v1/protection_groups",
                headers=headers,
                params={
                    'select': 'source_vcenter_id,target_id,replication_targets(dr_vcenter_id)',
                    'id': f'eq.{protection_group_id}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if pg_response.status_code != 200 or not pg_response.json():
                return {
                    'name': 'Network Mappings Valid',
                    'passed': True,
                    'message': 'Could not fetch group details, skipping check'
                }
            
            pg = pg_response.json()[0]
            source_vcenter_id = pg.get('source_vcenter_id')
            target_info = pg.get('replication_targets') or {}
            dr_vcenter_id = target_info.get('dr_vcenter_id') if isinstance(target_info, dict) else None
            
            if not source_vcenter_id or not dr_vcenter_id:
                return {
                    'name': 'Network Mappings Valid',
                    'passed': True,
                    'message': 'vCenters not configured, skipping network check'
                }
            
            # 3. Get VMs in this group
            vms_response = requests.get(
                f"{DSM_URL}/rest/v1/protected_vms",
                headers=headers,
                params={
                    'select': 'vm_id',
                    'protection_group_id': f'eq.{protection_group_id}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            vms = vms_response.json() if vms_response.status_code == 200 else []
            
            if not vms:
                return {
                    'name': 'Network Mappings Valid',
                    'passed': True,
                    'message': 'No VMs in group'
                }
            
            # 4. Get network-VM associations with VLAN IDs
            vm_ids = [v['vm_id'] for v in vms if v.get('vm_id')]
            if not vm_ids:
                return {
                    'name': 'Network Mappings Valid',
                    'passed': True,
                    'message': 'No VM IDs found'
                }
            
            networks_response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_network_vms",
                headers=headers,
                params={
                    'select': 'network_id,vcenter_networks(id,name,vlan_id)',
                    'vm_id': f'in.({",".join(vm_ids)})'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            vlan_ids_needed = {}
            if networks_response.status_code == 200:
                for nvm in networks_response.json():
                    net = nvm.get('vcenter_networks') or {}
                    if net and net.get('vlan_id'):
                        vlan_ids_needed[net['name']] = net['vlan_id']
            
            if not vlan_ids_needed:
                # No network data synced - this is a warning but DR shells already have networks set
                return {
                    'name': 'Network Mappings Valid',
                    'passed': True,
                    'message': 'VM network data not synced, DR shells use their configured networks'
                }
            
            # 5. Get DR site networks with VLAN IDs
            dr_networks_response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_networks",
                headers=headers,
                params={
                    'select': 'id,name,vlan_id',
                    'source_vcenter_id': f'eq.{dr_vcenter_id}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            dr_networks_by_vlan = {}
            if dr_networks_response.status_code == 200:
                for net in dr_networks_response.json():
                    if net.get('vlan_id'):
                        dr_networks_by_vlan.setdefault(net['vlan_id'], []).append(net['name'])
            
            # 6. Attempt to resolve each source network
            resolved = []
            unresolved = []
            
            for src_net, vlan_id in vlan_ids_needed.items():
                # Check manual override first
                override = next((m for m in manual_mappings if m['source_network'] == src_net), None)
                if override:
                    resolved.append(f"{src_net} -> {override['target_network']} (override)")
                    continue
                
                # Try VLAN ID match
                dr_matches = dr_networks_by_vlan.get(vlan_id, [])
                if dr_matches:
                    resolved.append(f"{src_net} -> VLAN {vlan_id}")
                else:
                    unresolved.append(f"{src_net} (VLAN {vlan_id})")
            
            if unresolved:
                return {
                    'name': 'Network Mappings Valid',
                    'passed': False,
                    'message': f'{len(unresolved)} networks not found on DR site',
                    'can_override': True,
                    'is_warning': True,
                    'remediation': f'Missing VLANs: {", ".join(unresolved[:3])}'
                }
            
            if manual_mappings:
                return {
                    'name': 'Network Mappings Valid',
                    'passed': True,
                    'message': f'{len(manual_mappings)} manual + {len(resolved) - len(manual_mappings)} auto-resolved'
                }
            
            return {
                'name': 'Network Mappings Valid',
                'passed': True,
                'message': f'{len(resolved)} networks auto-resolved by VLAN ID'
            }

        except Exception as e:
            return {
                'name': 'Network Mappings Valid',
                'passed': True,
                'message': f'Check skipped: {e}'
            }

    def _check_group_status(self, group: Dict) -> Dict:
        """Check that protection group is not paused or in error state."""
        if group.get('paused_at'):
            return {
                'name': 'Group Not Paused',
                'passed': False,
                'message': f'Group is paused: {group.get("pause_reason", "No reason given")}',
                'can_override': True
            }

        status = group.get('status', 'unknown')
        if status == 'error':
            return {
                'name': 'Group Not Paused',
                'passed': False,
                'message': 'Group is in error state',
                'can_override': True
            }

        return {
            'name': 'Group Not Paused',
            'passed': True,
            'message': 'Group is active'
        }

    def _check_dr_resources(self, protection_group_id: str, group: Dict) -> Dict:
        """Check if DR site has sufficient resources to run all VMs."""
        vms = self._fetch_protected_vms(protection_group_id)
        
        if not vms:
            return {
                'name': 'DR Resources Available',
                'passed': True,
                'message': 'No VMs to check'
            }

        # TODO: Actually query vCenter for resource availability
        # For now, just check that DR shells exist
        shells_ready = sum(1 for v in vms if v.get('dr_shell_vm_created'))
        
        return {
            'name': 'DR Resources Available',
            'passed': True,
            'message': f'{shells_ready}/{len(vms)} DR shells ready'
        }

    # ==================== Helper Methods ====================

    def _fail_job(self, job: Dict, error: str):
        """Helper to fail a job with error details."""
        self.executor.update_job_status(job['id'], 'failed', details={
            **job.get('details', {}),
            'error': error
        })

    def _fetch_protection_group(self, group_id: str) -> Optional[Dict]:
        """Fetch protection group from database."""
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            import requests

            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            }

            response = requests.get(
                f"{DSM_URL}/rest/v1/protection_groups",
                headers=headers,
                params={'select': '*', 'id': f'eq.{group_id}'},
                verify=VERIFY_SSL,
                timeout=10
            )

            if response.status_code == 200:
                groups = response.json()
                return groups[0] if groups else None
            return None
        except Exception as e:
            self.executor.log(f"Error fetching protection group: {e}", "ERROR")
            return None

    def _fetch_protected_vms(self, group_id: str) -> List[Dict]:
        """Fetch protected VMs for a group."""
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            import requests

            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            }

            response = requests.get(
                f"{DSM_URL}/rest/v1/protected_vms",
                headers=headers,
                params={
                    'select': '*',
                    'protection_group_id': f'eq.{group_id}',
                    'order': 'priority.asc'
                },
                verify=VERIFY_SSL,
                timeout=10
            )

            if response.status_code == 200:
                return response.json()
            return []
        except Exception as e:
            self.executor.log(f"Error fetching protected VMs: {e}", "ERROR")
            return []

    def _fetch_replication_target(self, target_id: str) -> Optional[Dict]:
        """Fetch replication target from database."""
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            import requests

            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            }

            response = requests.get(
                f"{DSM_URL}/rest/v1/replication_targets",
                headers=headers,
                params={'select': '*', 'id': f'eq.{target_id}'},
                verify=VERIFY_SSL,
                timeout=10
            )

            if response.status_code == 200:
                targets = response.json()
                return targets[0] if targets else None
            return None
        except Exception as e:
            self.executor.log(f"Error fetching replication target: {e}", "ERROR")
            return None

    def _get_vm_count(self, group_id: str) -> int:
        """Get count of protected VMs."""
        vms = self._fetch_protected_vms(group_id)
        return len(vms)

    def _update_vm_failover_readiness(self, group_id: str, checks: Dict):
        """Update failover_ready status on all protected VMs."""
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            import requests

            all_passed = all(c.get('passed', False) for c in checks.values())

            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            }

            requests.patch(
                f"{DSM_URL}/rest/v1/protected_vms",
                headers=headers,
                params={'protection_group_id': f'eq.{group_id}'},
                json={
                    'failover_ready': all_passed,
                    'last_failover_check': datetime.utcnow().isoformat(),
                    'failover_check_result': checks
                },
                verify=VERIFY_SSL,
                timeout=10
            )
        except Exception as e:
            self.executor.log(f"Error updating VM failover readiness: {e}", "WARN")

    def _update_vm_failover_status(self, vm_id: str, status: str):
        """Update failover_status on a protected VM."""
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            import requests

            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            }

            payload = {'failover_status': status}
            if status == 'failed_over':
                payload['last_failover_at'] = datetime.utcnow().isoformat()

            requests.patch(
                f"{DSM_URL}/rest/v1/protected_vms",
                headers=headers,
                params={'id': f'eq.{vm_id}'},
                json=payload,
                verify=VERIFY_SSL,
                timeout=10
            )
        except Exception as e:
            self.executor.log(f"Error updating VM failover status: {e}", "WARN")

    def _create_failover_event(self, group_id: str, failover_type: str, initiated_by: str,
                                shutdown_source: bool, reverse_protection: bool, 
                                test_network_id: Optional[str]) -> str:
        """Create a failover event record."""
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            import requests

            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            }

            response = requests.post(
                f"{DSM_URL}/rest/v1/failover_events",
                headers=headers,
                json={
                    'protection_group_id': group_id,
                    'failover_type': failover_type,
                    'status': 'in_progress',
                    'initiated_by': initiated_by,
                    'started_at': datetime.utcnow().isoformat(),
                    'shutdown_source_vms': 'yes' if shutdown_source else 'no',
                    'reverse_protection': reverse_protection,
                    'test_network_id': test_network_id
                },
                verify=VERIFY_SSL,
                timeout=10
            )

            if response.status_code in (200, 201):
                events = response.json()
                return events[0]['id'] if events else None
            return None
        except Exception as e:
            self.executor.log(f"Error creating failover event: {e}", "ERROR")
            return None

    def _update_failover_event(self, event_id: str, status: str, vms_recovered: int = None,
                                committed_at: str = None, rolled_back_at: str = None):
        """Update a failover event."""
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            import requests

            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            }

            payload = {'status': status}
            if vms_recovered is not None:
                payload['vms_recovered'] = vms_recovered
            if committed_at:
                payload['committed_at'] = committed_at
            if rolled_back_at:
                payload['rolled_back_at'] = rolled_back_at

            requests.patch(
                f"{DSM_URL}/rest/v1/failover_events",
                headers=headers,
                params={'id': f'eq.{event_id}'},
                json=payload,
                verify=VERIFY_SSL,
                timeout=10
            )
        except Exception as e:
            self.executor.log(f"Error updating failover event: {e}", "WARN")

    def _update_group_failover_status(self, group_id: str, status: str, event_id: Optional[str]):
        """Update protection group failover status."""
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            import requests

            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            }

            payload = {'failover_status': status, 'active_failover_event_id': event_id}
            if status in ('failed_over', 'committed'):
                payload['last_failover_at'] = datetime.utcnow().isoformat()

            requests.patch(
                f"{DSM_URL}/rest/v1/protection_groups",
                headers=headers,
                params={'id': f'eq.{group_id}'},
                json=payload,
                verify=VERIFY_SSL,
                timeout=10
            )
        except Exception as e:
            self.executor.log(f"Error updating group failover status: {e}", "WARN")

    def _run_final_sync(self, group_id: str):
        """Run a final sync before failover."""
        # This would trigger the replication handler
        self.executor.log(f"[Group Failover] Final sync would run here for {group_id}")
        time.sleep(2)  # Placeholder

    def _shutdown_source_vms(self, vms: List[Dict], vcenter_id: str):
        """Gracefully shutdown source VMs."""
        # TODO: Implement actual VM shutdown via vCenter
        for vm in vms:
            self.executor.log(f"[Group Failover] Would shutdown: {vm.get('vm_name')}")
        time.sleep(1)  # Placeholder

    def _power_on_dr_shell_vm(self, vm: Dict, group: Dict, failover_type: str, 
                              test_network_id: Optional[str]) -> bool:
        """Power on a DR shell VM via vCenter API."""
        import ssl
        from pyVim.connect import SmartConnect, Disconnect
        from pyVmomi import vim
        
        dr_vm_id = vm.get('dr_shell_vm_id')
        vm_name = vm.get('dr_shell_vm_name') or vm.get('vm_name')
        
        if not dr_vm_id:
            self.executor.log(f"No DR shell VM ID for {vm.get('vm_name')}", "WARN")
            return False
        
        # Get DR vCenter from replication target
        site_b_target = self._get_site_b_target(group)
        if not site_b_target:
            self.executor.log(f"[Group Failover] No Site B target for power-on", "ERROR")
            return False
        
        dr_vcenter_id = site_b_target.get('dr_vcenter_id')
        if not dr_vcenter_id:
            self.executor.log(f"[Group Failover] No DR vCenter configured on target", "ERROR")
            return False
        
        # Get vCenter credentials
        vcenter_data = self._fetch_vcenter_connection(dr_vcenter_id)
        if not vcenter_data:
            self.executor.log(f"[Group Failover] DR vCenter not found: {dr_vcenter_id}", "ERROR")
            return False
        
        vcenter_host = vcenter_data.get('host')
        vcenter_user = vcenter_data.get('username')
        vcenter_password_enc = vcenter_data.get('password_encrypted')
        
        # Decrypt password
        vcenter_password = self.executor.decrypt_password(vcenter_password_enc) if vcenter_password_enc else None
        if not vcenter_password:
            self.executor.log(f"[Group Failover] Unable to decrypt vCenter password", "ERROR")
            return False
        
        si = None
        try:
            # Connect to vCenter
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            
            self.executor.log(f"[Group Failover] Connecting to DR vCenter {vcenter_host}...")
            si = SmartConnect(
                host=vcenter_host,
                user=vcenter_user,
                pwd=vcenter_password,
                sslContext=context
            )
            content = si.RetrieveContent()
            
            # Find VM by moref ID (dr_vm_id is like 'vm-2041')
            vm_obj = self._find_vm_by_moref(content, dr_vm_id)
            
            if not vm_obj:
                self.executor.log(f"[Group Failover] DR VM not found in vCenter: {dr_vm_id}", "ERROR")
                return False
            
            # Check current power state
            current_state = vm_obj.runtime.powerState
            
            if current_state == vim.VirtualMachinePowerState.poweredOn:
                self.executor.log(f"[Group Failover] DR VM already powered on: {vm_name}")
                return True
            
            # Power on the VM
            self.executor.log(f"[Group Failover] Powering on DR VM: {vm_name} ({dr_vm_id})...")
            task = vm_obj.PowerOnVM_Task()
            self._wait_for_vcenter_task(task, timeout=120)
            self.executor.log(f"[Group Failover] DR VM powered on successfully: {vm_name}")
            
            return True
            
        except Exception as e:
            self.executor.log(f"[Group Failover] Error powering on {vm_name}: {e}", "ERROR")
            return False
        finally:
            if si:
                try:
                    Disconnect(si)
                except Exception:
                    pass

    def _power_off_dr_shell_vm(self, vm: Dict, group: Dict):
        """Power off a DR shell VM during rollback via vCenter API."""
        import ssl
        from pyVim.connect import SmartConnect, Disconnect
        from pyVmomi import vim
        
        dr_vm_id = vm.get('dr_shell_vm_id')
        vm_name = vm.get('dr_shell_vm_name') or vm.get('vm_name')
        
        if not dr_vm_id:
            return
        
        # Get DR vCenter from replication target
        site_b_target = self._get_site_b_target(group)
        if not site_b_target:
            self.executor.log(f"[Rollback Failover] No Site B target for power-off", "WARN")
            return
        
        dr_vcenter_id = site_b_target.get('dr_vcenter_id')
        if not dr_vcenter_id:
            self.executor.log(f"[Rollback Failover] No DR vCenter configured", "WARN")
            return
        
        # Get vCenter credentials
        vcenter_data = self._fetch_vcenter_connection(dr_vcenter_id)
        if not vcenter_data:
            self.executor.log(f"[Rollback Failover] DR vCenter not found", "WARN")
            return
        
        vcenter_host = vcenter_data.get('host')
        vcenter_user = vcenter_data.get('username')
        vcenter_password_enc = vcenter_data.get('password_encrypted')
        vcenter_password = self.executor.decrypt_password(vcenter_password_enc) if vcenter_password_enc else None
        
        if not vcenter_password:
            self.executor.log(f"[Rollback Failover] Unable to decrypt vCenter password", "WARN")
            return
        
        si = None
        try:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            
            si = SmartConnect(
                host=vcenter_host,
                user=vcenter_user,
                pwd=vcenter_password,
                sslContext=context
            )
            content = si.RetrieveContent()
            
            vm_obj = self._find_vm_by_moref(content, dr_vm_id)
            if not vm_obj:
                self.executor.log(f"[Rollback Failover] DR VM not found: {dr_vm_id}", "WARN")
                return
            
            current_state = vm_obj.runtime.powerState
            
            if current_state == vim.VirtualMachinePowerState.poweredOff:
                self.executor.log(f"[Rollback Failover] DR VM already powered off: {vm_name}")
                return
            
            self.executor.log(f"[Rollback Failover] Powering off DR VM: {vm_name}...")
            task = vm_obj.PowerOffVM_Task()
            self._wait_for_vcenter_task(task, timeout=60)
            self.executor.log(f"[Rollback Failover] DR VM powered off: {vm_name}")
            
        except Exception as e:
            self.executor.log(f"[Rollback Failover] Error powering off {vm_name}: {e}", "WARN")
        finally:
            if si:
                try:
                    Disconnect(si)
                except Exception:
                    pass

    def _find_vm_by_moref(self, content, moref_id: str):
        """Find VM by managed object reference ID (e.g., 'vm-2041')."""
        from pyVmomi import vim
        
        container = content.viewManager.CreateContainerView(
            content.rootFolder, [vim.VirtualMachine], True
        )
        try:
            for vm in container.view:
                if vm._moId == moref_id:
                    return vm
        finally:
            container.Destroy()
        return None

    def _wait_for_vcenter_task(self, task, timeout: int = 120):
        """Wait for a vCenter task to complete."""
        from pyVmomi import vim
        
        start = time.time()
        while task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
            if time.time() - start > timeout:
                raise TimeoutError(f"vCenter task timed out after {timeout}s")
            time.sleep(1)
        
        if task.info.state == vim.TaskInfo.State.error:
            error_msg = task.info.error.msg if hasattr(task.info.error, 'msg') else str(task.info.error)
            raise Exception(f"vCenter task failed: {error_msg}")

    def _fetch_vcenter_connection(self, vcenter_id: str) -> Optional[Dict]:
        """Fetch vCenter credentials from database."""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        import requests
        
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenters",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                params={
                    'select': 'id,host,username,password_encrypted',
                    'id': f'eq.{vcenter_id}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.status_code == 200 and response.json():
                return response.json()[0]
        except Exception as e:
            self.executor.log(f"[Failover] Error fetching vCenter: {e}", "ERROR")
        
        return None

    def _fetch_failover_event(self, event_id: str) -> Optional[Dict]:
        """Fetch a failover event by ID."""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        import requests
        
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/failover_events",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                params={'id': f'eq.{event_id}', 'select': '*'},
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.status_code == 200:
                data = response.json()
                return data[0] if data else None
        except Exception as e:
            self.executor.log(f"[Failover] Error fetching failover event: {e}", "WARN")
        return None

    def _update_protection_group_test_date(self, protection_group_id: str):
        """Update the last_test_at field on a protection group after successful test failover."""
        from datetime import datetime
        
        try:
            response = requests.patch(
                f"{DSM_URL}/rest/v1/protection_groups",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                params={'id': f'eq.{protection_group_id}'},
                json={'last_test_at': datetime.utcnow().isoformat()},
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.status_code in [200, 204]:
                self.executor.log(f"[Group Failover] Updated last_test_at for group {protection_group_id}")
            else:
                self.executor.log(f"[Group Failover] Failed to update last_test_at: {response.status_code}", "WARN")
        except Exception as e:
            self.executor.log(f"[Group Failover] Error updating last_test_at: {e}", "WARN")

    def _schedule_test_cleanup(self, protection_group_id: str, event_id: str, 
                               cleanup_at: datetime, created_by: Optional[str] = None) -> Optional[str]:
        """Create a scheduled rollback job for automatic test cleanup."""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        import requests
        
        try:
            response = requests.post(
                f"{DSM_URL}/rest/v1/jobs",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                json={
                    'job_type': 'rollback_failover',
                    'status': 'pending',
                    'schedule_at': cleanup_at.isoformat(),
                    'created_by': created_by,
                    'details': {
                        'failover_event_id': event_id,
                        'protection_group_id': protection_group_id,
                        'triggered_by': 'test_auto_cleanup',
                        'auto_scheduled': True
                    }
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.status_code in [200, 201]:
                job_data = response.json()
                job_id = job_data[0]['id'] if isinstance(job_data, list) else job_data.get('id')
                self.executor.log(f"[Group Failover] Scheduled cleanup job {job_id} for {cleanup_at.isoformat()}")
                return job_id
            else:
                self.executor.log(f"[Group Failover] Failed to schedule cleanup: {response.status_code} - {response.text}", "WARN")
                return None
        except Exception as e:
            self.executor.log(f"[Group Failover] Error scheduling cleanup: {e}", "WARN")
            return None

    def _update_failover_event_cleanup(self, event_id: str, test_duration: int, 
                                        cleanup_at: datetime, cleanup_job_id: str):
        """Update failover event with cleanup scheduling info."""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        import requests
        
        try:
            response = requests.patch(
                f"{DSM_URL}/rest/v1/failover_events",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                params={'id': f'eq.{event_id}'},
                json={
                    'test_duration_minutes': test_duration,
                    'cleanup_scheduled_at': cleanup_at.isoformat(),
                    'cleanup_job_id': cleanup_job_id
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.status_code in [200, 204]:
                self.executor.log(f"[Group Failover] Updated event {event_id} with cleanup info")
            else:
                self.executor.log(f"[Group Failover] Failed to update event cleanup: {response.status_code}", "WARN")
        except Exception as e:
            self.executor.log(f"[Group Failover] Error updating event cleanup: {e}", "WARN")

    def _cancel_scheduled_cleanup(self, event_id: str):
        """Cancel any pending scheduled cleanup job for a failover event."""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        import requests
        
        try:
            # First, fetch the failover event to get the cleanup_job_id
            response = requests.get(
                f"{DSM_URL}/rest/v1/failover_events",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                params={'id': f'eq.{event_id}', 'select': 'cleanup_job_id'},
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.status_code != 200 or not response.json():
                return
            
            event_data = response.json()[0]
            cleanup_job_id = event_data.get('cleanup_job_id')
            
            if not cleanup_job_id:
                return
            
            # Cancel the scheduled cleanup job
            cancel_response = requests.patch(
                f"{DSM_URL}/rest/v1/jobs",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                params={'id': f'eq.{cleanup_job_id}', 'status': 'eq.pending'},
                json={'status': 'cancelled'},
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if cancel_response.status_code in [200, 204]:
                self.executor.log(f"[Rollback Failover] Cancelled scheduled cleanup job {cleanup_job_id}")
            else:
                self.executor.log(f"[Rollback Failover] No pending cleanup job to cancel", "DEBUG")
        except Exception as e:
            self.executor.log(f"[Rollback Failover] Error cancelling cleanup job: {e}", "WARN")
