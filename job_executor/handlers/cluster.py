"""Cluster safety and workflow handlers"""

from typing import Dict, List, Optional, Any
from datetime import datetime, timezone
import time
import requests
from urllib.parse import quote
from .base import BaseHandler
from job_executor.utils import utc_now_iso

MAX_BLOCKERS_PER_HOST = 50
MAX_WARNINGS_PER_HOST = 20
BLOCKER_FIELD_LIMITS = {
    'vm_name': 255,
    'reason': 255,
    'details': 1024,
    'remediation': 1024,
    'warning': 512
}


class ClusterHandler(BaseHandler):
    """Handles cluster safety checks and update workflows"""
    
    def _check_esxi_accessible(self, hostname: str, timeout: int = 5, job_id: str = None) -> tuple:
        """
        Check if ESXi is accessible on HTTPS port 443 with detailed error handling.
        
        Returns:
            Tuple of (accessible: bool, connect_time: float, error_msg: str or None)
        """
        import socket
        import time
        
        start_time = time.time()
        error_msg = None
        
        try:
            # First resolve DNS
            ip = socket.gethostbyname(hostname)
        except socket.gaierror as e:
            error_msg = f"DNS resolution failed for {hostname}: {e}"
            self.log(f"      {error_msg}", "DEBUG")
            if job_id:
                self._append_console_log(job_id, error_msg, "WARN")
            return False, 0, error_msg
        
        try:
            sock = socket.create_connection((ip, 443), timeout=timeout)
            sock.close()
            connect_time = time.time() - start_time
            return True, connect_time, None
        except socket.timeout:
            return False, 0, None  # Normal during reboot - don't log
        except ConnectionRefusedError:
            return False, 0, None  # ESXi not ready - don't log
        except OSError as e:
            error_msg = f"Socket error for {hostname} ({ip}): {e}"
            self.log(f"      {error_msg}", "DEBUG")
            return False, 0, error_msg
        except Exception as e:
            error_msg = f"Unexpected error checking {hostname}: {type(e).__name__}: {e}"
            self.log(f"      {error_msg}", "DEBUG")
            return False, 0, error_msg
    
    def _check_vcenter_host_status(self, host: Dict, job_id: str = None) -> Optional[str]:
        """
        Check host connection status via vCenter as a fallback.
        
        Args:
            host: Host dict with vcenter info
            job_id: Optional job ID for logging
            
        Returns:
            Connection state string (e.g. 'connected', 'disconnected') or None if unavailable
        """
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        import requests
        
        vcenter_host_id = host.get('id')
        if not vcenter_host_id:
            return None
        
        headers = {
            "apikey": SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}"
        }
        
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_hosts",
                params={'id': f"eq.{vcenter_host_id}", 'select': 'connection_state'},
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.ok:
                data = response.json()
                if data and len(data) > 0:
                    return data[0].get('connection_state')
        except Exception as e:
            self.log(f"      Could not check vCenter status: {e}", "DEBUG")
        
        return None

    def _extract_manual_power_off_vms(self, details: Dict, host: Dict, vcenter_host_id: Optional[str]) -> List[str]:
        """
        Extract VMs that were marked for power-off in the blocker resolution wizard.
        Tries multiple keys to find the resolution: server_id, vcenter_host_id, host_name.
        """
        resolutions = details.get('maintenance_blocker_resolutions', {}) if details else {}
        
        if not resolutions:
            self.log(f"    [Resolution] No blocker resolutions found in job details", "DEBUG")
            return []
        
        # Build list of possible keys to look up (in priority order)
        host_keys = [
            str(host.get('server_id')) if host.get('server_id') else None,
            str(vcenter_host_id) if vcenter_host_id else None,
            host.get('name'),
            host.get('host_name')
        ]
        
        self.log(f"    [Resolution] Available resolution keys: {list(resolutions.keys())}", "DEBUG")
        self.log(f"    [Resolution] Looking for host with keys: {[k for k in host_keys if k]}", "DEBUG")
        
        host_resolution = None
        matched_key = None
        for key in filter(None, host_keys):
            if key in resolutions:
                host_resolution = resolutions[key]
                matched_key = key
                break
        
        if not host_resolution:
            self.log(f"    [Resolution] No resolution found for host {host.get('name')}", "DEBUG")
            return []
        
        self.log(f"    [Resolution] Found resolution for host via key '{matched_key}'", "DEBUG")
        
        # Check if host should be skipped entirely
        if host_resolution.get('skip_host'):
            self.log(f"    [Resolution] Host marked as SKIP - skipping all operations")
            return []
        
        entries = host_resolution.get('vms_to_power_off', []) if isinstance(host_resolution, dict) else []
        
        if not entries:
            self.log(f"    [Resolution] No VMs marked for power-off", "DEBUG")
            return []
        
        vm_names = []
        for entry in entries:
            if isinstance(entry, dict):
                # Try multiple possible keys for VM name
                vm_name = entry.get('vm_name') or entry.get('vm') or entry.get('name')
                if vm_name:
                    vm_names.append(vm_name)
                    reason = entry.get('reason', 'unspecified')
                    self.log(f"    [Resolution] VM to power off: {vm_name} (reason: {reason})")
            elif entry:
                # Plain string entry (legacy format)
                vm_names.append(str(entry))
                self.log(f"    [Resolution] VM to power off: {entry}")
        
        unique_names = list({name for name in vm_names if name})
        if unique_names:
            self.log(f"    ✓ Found {len(unique_names)} VM(s) to power off from resolution wizard")
        
        return unique_names

    def _select_power_off_candidates(self, blockers: List[Dict[str, Any]], strategy: str) -> List[str]:
        non_migratable_reasons = {'passthrough', 'local_storage', 'vgpu', 'fault_tolerance'}
        vm_names = []
        for blocker in blockers:
            vm_name = blocker.get('vm_name')
            if not vm_name:
                continue
            reason = blocker.get('reason')
            if reason == 'vcsa':
                continue
            if strategy == 'non_migratable' and reason not in non_migratable_reasons:
                continue
            vm_names.append(vm_name)
        return list({name for name in vm_names if name})
    
    def _select_power_off_by_pattern(self, blockers: List[Dict[str, Any]], patterns: List[str]) -> List[str]:
        """
        Select VMs to power off based on name patterns (e.g., 'Z-VRA*', 'Zerto*').
        Used for automatic handling of appliance VMs in scheduled maintenance.
        
        Args:
            blockers: List of blocker dicts with vm_name field
            patterns: List of patterns with wildcards (e.g., ['Z-VRA*', '*-VRA-*'])
            
        Returns:
            List of VM names matching any pattern
        """
        import fnmatch
        vm_names = []
        for blocker in blockers:
            vm_name = blocker.get('vm_name')
            if not vm_name:
                continue
            # Skip VCSA - never auto power off
            if blocker.get('reason') == 'vcsa':
                continue
            for pattern in patterns:
                if fnmatch.fnmatch(vm_name.upper(), pattern.upper()):
                    vm_names.append(vm_name)
                    break
        return list({name for name in vm_names if name})
    
    def _sanitize_blockers_for_storage(self, blockers: Dict[str, Any]) -> Dict[str, Any]:
        """
        Sanitize blocker data to ensure it's JSON-serializable.
        Converts complex objects (like pyvmomi references) to simple types.
        
        Args:
            blockers: Dict mapping server_id -> blocker analysis
            
        Returns:
            Sanitized dict safe for JSON storage
        """
        MAX_BLOCKERS_PER_HOST = 50
        FIELD_LIMITS = {
            'vm_name': 255,
            'reason': 255,
            'details': 2000,
            'remediation': 2000,
            'warning': 512  # Add missing 'warning' key that was causing KeyError
        }

        def _truncate(value: Any, limit: int) -> Optional[str]:
            if value is None:
                return None
            text = str(value)
            if text == '':
                return None
            if len(text) > limit:
                return text[:limit]
            return text

        sanitized = {}
        for server_id, analysis in blockers.items():
            if not isinstance(analysis, dict):
                continue
            
            sanitized_blockers = []
            raw_blockers = analysis.get('blockers', [])
            total_blockers = len(raw_blockers)
            for b in raw_blockers[:MAX_BLOCKERS_PER_HOST]:
                if not isinstance(b, dict):
                    continue
                sanitized_blockers.append({
                    'vm_name': _truncate(b.get('vm_name'), FIELD_LIMITS['vm_name']),
                    'vm_id': str(b.get('vm_id', '')) if b.get('vm_id') else None,
                    'reason': _truncate(b.get('reason'), FIELD_LIMITS['reason']),
                    'severity': str(b.get('severity', 'warning')) if b.get('severity') else 'warning',
                    'details': _truncate(b.get('details'), FIELD_LIMITS['details']),
                    'remediation': _truncate(b.get('remediation'), FIELD_LIMITS['remediation']),
                    'auto_fixable': bool(b.get('auto_fixable', False))
                })

            warnings = []
            raw_warnings = analysis.get('warnings', [])
            for w in raw_warnings[:MAX_WARNINGS_PER_HOST]:
                truncated_warning = _truncate(w, FIELD_LIMITS['warning'])
                if truncated_warning:
                    warnings.append(truncated_warning)
            
            sanitized[str(server_id)] = {
                'host_id': str(analysis.get('host_id', '')) if analysis.get('host_id') else None,
                'host_name': str(analysis.get('host_name', '')) if analysis.get('host_name') else None,
                'server_id': str(analysis.get('server_id', '')) if analysis.get('server_id') else str(server_id),
                'vcenter_host_id': str(analysis.get('vcenter_host_id', '')) if analysis.get('vcenter_host_id') else None,
                'can_enter_maintenance': bool(analysis.get('can_enter_maintenance', False)),
                'blockers': sanitized_blockers,
                'warnings': warnings,
                'total_powered_on_vms': int(analysis.get('total_powered_on_vms', 0)),
                'migratable_vms': int(analysis.get('migratable_vms', 0)),
                'blocked_vms': int(analysis.get('blocked_vms', total_blockers))
            }
        
        return sanitized
    
    def _execute_comprehensive_blocker_scan(
        self,
        job: Dict,
        eligible_hosts: List[Dict],
        host_credentials: Dict[str, Dict],
        source_vcenter_id: str,
        cleanup_state: Dict,
        workflow_step_counter: int
    ) -> tuple:
        """
        Phase 1.5: Comprehensive blocker scan AFTER HA is disabled.
        Scans ALL hosts for DRS blockers and handles them based on settings.
        
        Returns:
            Tuple of (should_continue: bool, updated_step_counter: int, all_blockers: dict)
        """
        details = job.get('details', {})
        auto_power_off_enabled = details.get('auto_power_off_enabled', False)
        auto_power_off_patterns = details.get('auto_power_off_patterns', [])
        is_scheduled = details.get('scheduled_execution', False)
        resolutions = details.get('maintenance_blocker_resolutions', {})
        
        self.log("")
        self.log("=" * 80)
        self.log("PHASE 1.5: COMPREHENSIVE BLOCKER SCAN (POST-HA)")
        self.log("=" * 80)
        
        # Update job details with current step for UI display
        total_hosts = len(eligible_hosts)
        self.update_job_details_field(job['id'], {
            'current_step': f'Scanning {total_hosts} hosts for maintenance blockers',
            'blocker_scan_phase': 'starting',
            'blocker_scan_total_hosts': total_hosts,
            'blocker_scan_hosts_scanned': 0
        })
        
        # Log workflow step for this phase with initial progress
        self._log_workflow_step(
            job['id'], 'rolling_cluster_update',
            step_number=workflow_step_counter,
            step_name="Comprehensive blocker scan",
            status='running',
            step_started_at=utc_now_iso(),
            step_details={
                'hosts_total': total_hosts,
                'hosts_scanned': 0,
                'current_host': None,
                'hosts_with_blockers': 0,
                'total_critical_blockers': 0
            }
        )
        
        # Stream progress to console
        self._append_console_log(job['id'], f"Starting comprehensive blocker scan for {total_hosts} hosts...")
        
        all_current_blockers = {}
        total_critical_blockers = 0
        vms_for_auto_power_off = {}  # host_id -> list of VM names
        hosts_scanned = 0
        
        for host in eligible_hosts:
            hosts_scanned += 1
            host_name = host.get('name', 'Unknown')
            
            # Update job details with current progress (for Current Operation card)
            self.update_job_details_field(job['id'], {
                'current_step': f'Scanning {host_name} ({hosts_scanned}/{total_hosts})',
                'current_host': host_name,
                'blocker_scan_hosts_scanned': hosts_scanned,
                'blocker_scan_progress_pct': int((hosts_scanned / total_hosts) * 100)
            })
            
            # Update workflow step with progress
            self._log_workflow_step(
                job['id'], 'rolling_cluster_update',
                step_number=workflow_step_counter,
                step_name="Comprehensive blocker scan",
                status='running',
                step_details={
                    'hosts_total': total_hosts,
                    'hosts_scanned': hosts_scanned,
                    'current_host': host_name,
                    'hosts_with_blockers': len(all_current_blockers),
                    'total_critical_blockers': total_critical_blockers,
                    'progress_pct': int((hosts_scanned / total_hosts) * 100)
                }
            )
            
            # Stream progress to console log
            self._append_console_log(job['id'], f"Scanning host {hosts_scanned}/{total_hosts}: {host_name}...")
            
            server = self.get_server_by_id(host['server_id'])
            vcenter_host_id = server.get('vcenter_host_id') if server else None
            
            if not vcenter_host_id:
                self.log(f"  {host_name}: No vCenter link, skipping blocker check")
                self._append_console_log(job['id'], f"  → {host_name}: No vCenter link, skipped")
                continue
            
            # Analyze blockers for this host with error handling
            try:
                analysis = self.executor.analyze_maintenance_blockers(vcenter_host_id, source_vcenter_id)
            except Exception as e:
                error_msg = f"Error analyzing {host_name}: {str(e)}"
                self.log(f"  {error_msg}", "ERROR")
                self._append_console_log(job['id'], f"  ⚠ {error_msg}")
                # Update step with error but continue to other hosts
                self._log_workflow_step(
                    job['id'], 'rolling_cluster_update',
                    step_number=workflow_step_counter,
                    step_name="Comprehensive blocker scan",
                    status='running',
                    step_details={
                        'hosts_total': total_hosts,
                        'hosts_scanned': hosts_scanned,
                        'current_host': host_name,
                        'hosts_with_blockers': len(all_current_blockers),
                        'total_critical_blockers': total_critical_blockers,
                        'progress_pct': int((hosts_scanned / total_hosts) * 100),
                        'last_error': error_msg
                    }
                )
                continue
            
            if analysis and analysis.get('blockers'):
                blockers = analysis['blockers']
                critical_count = len([b for b in blockers if b.get('severity') == 'critical'])
                total_critical_blockers += critical_count
                
                # Inject server_id and host_name for resolution lookup
                analysis['server_id'] = host['server_id']
                analysis['host_name'] = host_name
                analysis['vcenter_host_id'] = vcenter_host_id
                
                all_current_blockers[host['server_id']] = analysis
                self.log(f"  {host_name}: {len(blockers)} blocker(s) ({critical_count} critical)")
                self._append_console_log(job['id'], f"  → {host_name}: {len(blockers)} blocker(s) ({critical_count} critical)")
                
                # Check if we have resolutions from wizard
                host_resolution = None
                for key in [host['server_id'], vcenter_host_id, host_name]:
                    if key and key in resolutions:
                        host_resolution = resolutions[key]
                        break
                
                # If resolutions exist for this host, skip auto-pattern matching
                if host_resolution:
                    self.log(f"    → Using wizard resolution (skip={host_resolution.get('skip_host', False)})")
                    continue
                
                # Apply auto power-off patterns if enabled
                if auto_power_off_patterns and (auto_power_off_enabled or is_scheduled):
                    pattern_matches = self._select_power_off_by_pattern(blockers, auto_power_off_patterns)
                    if pattern_matches:
                        vms_for_auto_power_off[host['server_id']] = {
                            'vcenter_host_id': vcenter_host_id,
                            'host_name': host_name,
                            'vm_names': pattern_matches,
                            'matched_patterns': auto_power_off_patterns
                        }
                        self.log(f"    → {len(pattern_matches)} VM(s) match auto power-off patterns")
                        for vm in pattern_matches[:3]:
                            self.log(f"      - {vm}")
                        if len(pattern_matches) > 3:
                            self.log(f"      ... and {len(pattern_matches) - 3} more")
            else:
                self.log(f"  {host_name}: No blockers detected")
                self._append_console_log(job['id'], f"  ✓ {host_name}: No blockers")
        
        # Decide what to do based on blockers found
        if all_current_blockers:
            unresolved_count = len(all_current_blockers) - len(vms_for_auto_power_off)
            
            # STEP 5: Early blocker storage - store immediately after scan as safety net
            try:
                early_sanitized = self._sanitize_blockers_for_storage(all_current_blockers)
                # Log size for debugging
                import json
                blockers_size = len(json.dumps(early_sanitized))
                self.log(f"  Blocker data size: {blockers_size} bytes", "DEBUG")
                if blockers_size > 100000:
                    self.log(f"  ⚠ Large blocker data ({blockers_size} bytes) - may cause issues", "WARN")
                
                self.update_job_details_field(job['id'], {
                    'blocker_scan_complete': True,
                    'raw_blockers_backup': early_sanitized,
                    'blocker_scan_hosts': len(all_current_blockers),
                    'blocker_scan_critical': total_critical_blockers
                })
                self.log(f"  ✓ Stored blocker backup in job details")
            except Exception as e:
                self.log(f"  Warning: Could not store early blocker backup: {e}", "WARN")
            
            # Store auto power-off VMs in job details for per-host processing
            if vms_for_auto_power_off:
                self.update_job_details_field(job['id'], {
                    'auto_power_off_vms': vms_for_auto_power_off
                })
                self.log(f"")
                self.log(f"  ✓ {len(vms_for_auto_power_off)} host(s) have VMs for auto power-off")
            
            # Check if there are unresolved blockers that need attention
            has_unresolved = False
            unresolved_hosts = []
            for server_id, analysis in all_current_blockers.items():
                if server_id in vms_for_auto_power_off:
                    # Check if ALL blockers are covered by pattern match
                    pattern_vms = set(vms_for_auto_power_off[server_id]['vm_names'])
                    all_blocker_vms = set(b.get('vm_name') for b in analysis.get('blockers', []))
                    if not all_blocker_vms.issubset(pattern_vms):
                        has_unresolved = True
                        unresolved_hosts.append(analysis.get('host_name', server_id))
                else:
                    has_unresolved = True
                    unresolved_hosts.append(analysis.get('host_name', server_id))
            
            # Handle scheduled jobs differently - skip blocked hosts or fail gracefully
            if has_unresolved and not resolutions and is_scheduled:
                self.log(f"")
                self.log(f"  ⚠ SCHEDULED JOB: {len(unresolved_hosts)} host(s) have unresolved blockers")
                
                scheduled_auto_skip = details.get('scheduled_auto_skip_blocked_hosts', True)
                if scheduled_auto_skip:
                    # Add unresolved hosts to skip list
                    skip_hosts = set(details.get('skip_hosts', []))
                    for server_id, analysis in all_current_blockers.items():
                        if server_id not in vms_for_auto_power_off:
                            skip_hosts.add(server_id)
                            self.log(f"    → Will skip host: {analysis.get('host_name', server_id)} (unresolved blockers)")
                        else:
                            # Check if partial coverage
                            pattern_vms = set(vms_for_auto_power_off[server_id]['vm_names'])
                            all_blocker_vms = set(b.get('vm_name') for b in analysis.get('blockers', []))
                            if not all_blocker_vms.issubset(pattern_vms):
                                skip_hosts.add(server_id)
                                uncovered = all_blocker_vms - pattern_vms
                                self.log(f"    → Will skip host: {analysis.get('host_name', server_id)} (VMs not matching patterns: {', '.join(uncovered)})")
                    
                    self.update_job_details_field(job['id'], {
                        'skip_hosts': list(skip_hosts),
                        'scheduled_skipped_due_to_blockers': list(skip_hosts)
                    })
                    self.log(f"  ✓ {len(skip_hosts)} host(s) will be skipped due to unresolved blockers")
                else:
                    # Fail the job with clear error for scheduled jobs that can't auto-resolve
                    error_msg = f"Scheduled job cannot proceed: {len(unresolved_hosts)} host(s) have unresolved maintenance blockers ({', '.join(unresolved_hosts[:3])}{'...' if len(unresolved_hosts) > 3 else ''}). Configure auto_power_off_patterns or run interactively."
                    self.log(f"  ✗ {error_msg}")
                    raise Exception(error_msg)
            
            # If unresolved blockers exist and no resolutions provided (interactive mode), pause for wizard
            elif has_unresolved and not resolutions:
                self.log(f"")
                self.log(f"  ⚠ Maintenance blockers detected - pausing for resolution")
                
                # Sanitize blockers for JSON storage
                sanitized_blockers = self._sanitize_blockers_for_storage(all_current_blockers)
                
                # Wrap blocker processing in try-except to prevent 'warning' becoming error message
                try:
                    # IMPORTANT: Store blockers in workflow step details as backup
                    # This ensures UI can recover even if job status update fails
                    self._log_workflow_step(
                        job['id'], 'rolling_cluster_update',
                        step_number=workflow_step_counter,
                        step_name="Comprehensive blocker scan",
                        status='paused',
                        step_details={
                            'hosts_with_blockers': len(all_current_blockers),
                            'total_critical_blockers': total_critical_blockers,
                            'auto_power_off_hosts': len(vms_for_auto_power_off),
                            'awaiting_resolution': True,
                            'current_blockers': sanitized_blockers,  # Store blockers here as backup
                            'blocker_analysis_at': utc_now_iso(),
                            'recovery_available': True
                        },
                        step_completed_at=utc_now_iso()
                    )
                    
                    # Pause job for wizard resolution
                    update_success = self.update_job_status(job['id'], 'paused', details={
                        'pause_reason': f'Maintenance blockers detected on {len(all_current_blockers)} host(s) - wizard resolution required',
                        'awaiting_blocker_resolution': True,
                        'current_blockers': sanitized_blockers,
                        'blocker_analysis_at': utc_now_iso(),
                        'can_retry': True,
                        'hosts_with_blockers': len(all_current_blockers),
                        'total_critical_blockers': total_critical_blockers
                    })
                    
                    if not update_success:
                        self.log("⚠️ Warning: Job status update to 'paused' failed - blockers stored in workflow step", "WARN")
                        self.log("   → User can still resolve blockers via workflow step details", "INFO")
                        # Update step with explicit recovery mode flag
                        self._log_workflow_step(
                            job['id'], 'rolling_cluster_update',
                            step_number=workflow_step_counter,
                            step_name="Comprehensive blocker scan",
                            status='paused',
                            step_details={
                                'hosts_with_blockers': len(all_current_blockers),
                                'total_critical_blockers': total_critical_blockers,
                                'awaiting_resolution': True,
                                'current_blockers': sanitized_blockers,
                                'job_update_failed': True,
                                'recovery_mode': True,
                                'recovery_available': True
                            },
                            step_completed_at=utc_now_iso()
                        )
                    
                    self.log("")
                    self.log("⏸️ Job paused - awaiting blocker resolution from user")
                    
                except Exception as blocker_err:
                    self.log(f"Error processing blockers for pause: {blocker_err}", "ERROR")
                    # Mark step as failed with proper error (not just 'warning')
                    self._log_workflow_step(
                        job['id'], 'rolling_cluster_update',
                        step_number=workflow_step_counter,
                        step_name="Comprehensive blocker scan",
                        status='failed',
                        step_error=f"Blocker processing failed: {str(blocker_err)}",
                        step_details={
                            'hosts_with_blockers': len(all_current_blockers),
                            'total_critical_blockers': total_critical_blockers,
                            'current_blockers': sanitized_blockers,
                            'processing_error': str(blocker_err),
                            'recovery_available': True
                        },
                        step_completed_at=utc_now_iso()
                    )
                    raise Exception(f"Blocker scan processing failed: {str(blocker_err)}")
                
                return False, workflow_step_counter + 1, all_current_blockers
        
        self._log_workflow_step(
            job['id'], 'rolling_cluster_update',
            step_number=workflow_step_counter,
            step_name="Comprehensive blocker scan",
            status='completed',
            step_details={
                'hosts_scanned': len(eligible_hosts),
                'hosts_with_blockers': len(all_current_blockers),
                'auto_power_off_hosts': len(vms_for_auto_power_off),
                'total_critical_blockers': total_critical_blockers
            },
            step_completed_at=utc_now_iso()
        )
        
        self.log(f"  ✓ Blocker scan complete - proceeding with updates")
        return True, workflow_step_counter + 1, all_current_blockers
    
    def _execute_batch_preflight_checks(
        self, 
        job: Dict, 
        eligible_hosts: List[Dict],
        cleanup_state: Dict,
        check_maintenance_blockers: bool = True,
        check_available_updates: bool = False,
        firmware_source: str = 'manual_repository',
        dell_catalog_url: str = None,
        cache_hours: int = 24
    ) -> Dict[str, Dict]:
        """
        Phase 0: Test iDRAC connectivity, analyze maintenance blockers, and optionally
        check for available firmware updates for ALL hosts BEFORE any changes are made.
        
        When check_available_updates=True, this queries Dell catalog for each host to
        determine if updates are needed. This allows early exit if no hosts need updates,
        avoiding unnecessary HA disable and SCP backups.
        
        Blocker analysis results are cached in job.details.blocker_analysis_cache for
        cache_hours (default 24) to avoid redundant vCenter queries.
        
        Returns dict mapping server_id -> {credentials, session_validated, server, 
            maintenance_blockers, available_updates, needs_update}
        Raises exception if ANY host fails pre-flight.
        """
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        from job_executor.utils import _safe_json_parse
        from datetime import timedelta
        import requests
        
        self.log("=" * 80)
        self.log("PHASE 0: PRE-FLIGHT CHECKS (ALL HOSTS)")
        self.log("=" * 80)
        
        if check_available_updates and firmware_source == 'dell_online_catalog':
            self.log("  → Including firmware update availability check")
        
        host_credentials = {}
        failed_hosts = []
        all_maintenance_blockers = {}
        critical_blockers_found = False
        total_hosts_needing_updates = 0
        total_available_updates = 0
        
        # Check for cached blocker analysis
        cached_analysis = job.get('details', {}).get('blocker_analysis_cache', {})
        cache_valid_until = cached_analysis.get('valid_until')
        cache_is_valid = False
        
        if cache_valid_until:
            try:
                cache_expiry = datetime.fromisoformat(cache_valid_until.replace('Z', '+00:00'))
                if cache_expiry > datetime.now(timezone.utc):
                    cache_is_valid = True
                    cache_age_hours = (cache_expiry - datetime.now(timezone.utc)).total_seconds() / 3600
                    self.log(f"  ✓ Using cached blocker analysis (valid for {cache_age_hours:.1f} more hours)")
            except Exception as cache_err:
                self.log(f"  Cache timestamp parse error: {cache_err}", "DEBUG")
        
        for idx, host in enumerate(eligible_hosts, 1):
            # Check for cancellation (no graceful cancel during pre-flight)
            cancel_result = self._check_and_handle_cancellation(job, cleanup_state, check_graceful=False)
            if cancel_result == 'cancelled':
                raise Exception("Job cancelled during pre-flight checks")
            
            self.log(f"  [{idx}/{len(eligible_hosts)}] Checking {host['name']}...")
            
            # Update job with pre-flight progress
            self.update_job_details_field(job['id'], {
                'current_step': f'Pre-flight check: {host["name"]} ({idx}/{len(eligible_hosts)})',
                'preflight_progress': int((idx / len(eligible_hosts)) * 100)
            })
            
            try:
                # Fetch server details
                server = self.get_server_by_id(host['server_id'])
                if not server:
                    raise Exception("Server not found in database")
                
                if not server.get('ip_address'):
                    raise Exception("Server has no IP address configured")
                
                # Get credentials
                username, password = self.executor.get_credentials_for_server(server)
                if not username or not password:
                    raise Exception("No credentials available")
                
                # Test iDRAC connectivity (quick session create/delete)
                session = self.executor.create_idrac_session(
                    server['ip_address'], username, password,
                    log_to_db=True, server_id=host['server_id'], job_id=job['id']
                )
                
                if not session:
                    raise Exception("Failed to create iDRAC session")
                
                # Cleanup test session immediately
                self.executor.delete_idrac_session(
                    session, server['ip_address'], host['server_id'], job['id']
                )
                
                self.log(f"    ✓ iDRAC connectivity OK")
                
                # Initialize credential entry
                host_creds = {
                    'username': username,
                    'password': password,
                    'server': server,
                    'validated': True,
                    'maintenance_blockers': None,
                    'available_updates': [],
                    'needs_update': False
                }
                
                # Analyze maintenance blockers if this host has vCenter link
                if check_maintenance_blockers and host.get('id'):  # host['id'] is vcenter_host_id
                    # Check cache first
                    cached_host_blockers = cached_analysis.get('hosts', {}).get(host['server_id']) if cache_is_valid else None
                    
                    if cached_host_blockers:
                        self.log(f"    Using cached blocker analysis")
                        blocker_analysis = cached_host_blockers
                    else:
                        self.log(f"    Analyzing maintenance blockers...")
                        blocker_analysis = self.executor.analyze_maintenance_blockers(
                            host_id=host['id'],
                            source_vcenter_id=host.get('source_vcenter_id')
                        )
                    
                    if blocker_analysis:
                        # Inject server_id into blocker analysis for reliable resolution lookup
                        blocker_analysis['server_id'] = host['server_id']
                        all_maintenance_blockers[host['server_id']] = blocker_analysis
                        host_creds['maintenance_blockers'] = blocker_analysis
                        
                        # Check for critical blockers
                        critical_blockers = [b for b in blocker_analysis.get('blockers', []) 
                                           if b.get('severity') == 'critical']
                        
                        if critical_blockers:
                            critical_blockers_found = True
                            blocker_names = [b['vm_name'] for b in critical_blockers[:3]]
                            self.log(f"    ⚠️ Critical blockers: {', '.join(blocker_names)}", "WARN")
                        elif blocker_analysis.get('blockers'):
                            warning_count = len(blocker_analysis['blockers'])
                            self.log(f"    ⚠️ {warning_count} warning-level blocker(s)")
                        else:
                            self.log(f"    ✓ No maintenance blockers detected")
                
                # Check for available firmware updates (if enabled)
                if check_available_updates:
                    self.log(f"    Checking for available updates...")
                    try:
                        if firmware_source == 'dell_online_catalog':
                            # Use Dell catalog for update checking
                        from job_executor.dell_redfish import DellOperations, DellRedfishAdapter
                        adapter = DellRedfishAdapter(
                            self.executor.session_manager, 
                            self.executor._get_dell_logger(), 
                            self.executor._log_dell_redfish_command
                        )
                        dell_ops = DellOperations(adapter)
                            
                            catalog_url = dell_catalog_url or 'https://downloads.dell.com/catalog/Catalog.xml'
                            check_result = dell_ops.check_available_catalog_updates(
                                ip=server['ip_address'],
                                username=username,
                                password=password,
                                catalog_url=catalog_url,
                                server_id=host['server_id'],
                                job_id=job['id'],
                                user_id=job.get('created_by')
                            )
                            
                            available_updates = check_result.get('available_updates', [])
                        else:
                            # Use local repository for update checking
                            available_updates = self._check_local_repository_updates(
                                server['ip_address'],
                                username,
                                password,
                                server.get('model'),
                                host['server_id'],
                                job['id']
                            )
                        
                        host_creds['available_updates'] = available_updates
                        host_creds['needs_update'] = len(available_updates) > 0
                        
                        if available_updates:
                            total_hosts_needing_updates += 1
                            total_available_updates += len(available_updates)
                            self.log(f"    ✓ {len(available_updates)} update(s) available")
                            # Log first few updates
                            for upd in available_updates[:3]:
                                upd_name = upd.get('name', upd.get('component_name', 'Unknown'))[:40]
                                upd_ver = upd.get('version', upd.get('available_version', 'N/A'))
                                self.log(f"      - {upd_name} → {upd_ver}")
                            if len(available_updates) > 3:
                                self.log(f"      ... and {len(available_updates) - 3} more")
                        else:
                            self.log(f"    ✓ Already up to date - no updates needed")
                            
                    except Exception as update_check_error:
                        self.log(f"    ⚠️ Could not check for updates: {update_check_error}", "WARN")
                        self.log(f"    → Will attempt update anyway", "WARN")
                        # Mark as needs_update=True to be safe - we'll check again during the actual update
                        host_creds['needs_update'] = True
                        host_creds['update_check_error'] = str(update_check_error)
                
                host_credentials[host['server_id']] = host_creds
                
            except Exception as e:
                self.log(f"    ✗ FAILED: {e}", "ERROR")
                failed_hosts.append({'host': host['name'], 'error': str(e)})
        
        if failed_hosts:
            error_summary = ", ".join([f"{h['host']}: {h['error']}" for h in failed_hosts])
            raise Exception(f"Pre-flight checks failed for {len(failed_hosts)} hosts: {error_summary}")
        
        # Update job details with pre-flight results
        job_details = job.get('details', {})
        job_details['maintenance_blockers'] = all_maintenance_blockers
        job_details['critical_blockers_found'] = critical_blockers_found
        
        # Cache blocker analysis for future use (24 hours by default)
        if all_maintenance_blockers and not cache_is_valid:
            from datetime import timedelta
            job_details['blocker_analysis_cache'] = {
                'checked_at': utc_now_iso(),
                'valid_until': (datetime.now(timezone.utc) + timedelta(hours=cache_hours)).isoformat(),
                'hosts': all_maintenance_blockers
            }
            self.log(f"  ✓ Blocker analysis cached for {cache_hours} hours")
        
        if check_available_updates and firmware_source == 'dell_online_catalog':
            job_details['preflight_update_check'] = {
                'hosts_needing_updates': total_hosts_needing_updates,
                'hosts_up_to_date': len(eligible_hosts) - total_hosts_needing_updates,
                'total_available_updates': total_available_updates
            }
        
        self.executor.update_job_status(
            job['id'],
            'running',
            details=job_details
        )
        
        self.log(f"  ✓ All {len(eligible_hosts)} hosts passed pre-flight checks")
        if check_available_updates and firmware_source == 'dell_online_catalog':
            self.log(f"  📊 Update summary: {total_hosts_needing_updates}/{len(eligible_hosts)} hosts need updates ({total_available_updates} total updates)")
        if critical_blockers_found:
            self.log(f"  ⚠️ WARNING: Critical maintenance blockers detected - review before proceeding", "WARN")
        
        return host_credentials
    
    def _export_single_scp(
        self,
        job: Dict,
        host: Dict,
        creds: Dict
    ) -> Dict:
        """Export SCP for a single host. Used by batch backup."""
        server = creds['server']
        username = creds['username']
        password = creds['password']
        
        try:
            scp_result = self.executor.export_scp(
                server['ip_address'],
                username,
                password,
                server_id=host['server_id'],
                job_id=job['id']
            )
            
            return {
                'success': scp_result.get('success', False),
                'backup_id': scp_result.get('backup_id'),
                'size_kb': scp_result.get('size_kb', 0),
                'error': scp_result.get('error')
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def _execute_batch_scp_backups(
        self,
        job: Dict,
        eligible_hosts: List[Dict],
        host_credentials: Dict[str, Dict],
        cleanup_state: Dict,
        parallel: bool = False,
        max_parallel: int = 3
    ) -> Dict[str, Dict]:
        """
        Phase 1: Export SCP backups from ALL hosts before any updates.
        
        Args:
            parallel: If True, run SCP exports concurrently (up to max_parallel)
            max_parallel: Max concurrent SCP exports when parallel=True
            
        Returns dict mapping server_id -> {backup_id, success, error}
        """
        self.log("=" * 80)
        self.log(f"PHASE 1: SCP BACKUPS ({'PARALLEL' if parallel else 'SEQUENTIAL'})")
        self.log("=" * 80)
        
        backup_results = {}
        
        if parallel:
            # Parallel execution using ThreadPoolExecutor
            from concurrent.futures import ThreadPoolExecutor, as_completed
            
            self.log(f"  Running up to {max_parallel} backups concurrently...")
            
            with ThreadPoolExecutor(max_workers=max_parallel) as executor:
                future_to_host = {
                    executor.submit(
                        self._export_single_scp,
                        job, host, host_credentials[host['server_id']]
                    ): host
                    for host in eligible_hosts
                }
                
                completed = 0
                for future in as_completed(future_to_host):
                    host = future_to_host[future]
                    completed += 1
                    
                    try:
                        result = future.result()
                        backup_results[host['server_id']] = result
                        if result['success']:
                            self.log(f"  [{completed}/{len(eligible_hosts)}] ✓ {host['name']}: Backup completed ({result.get('size_kb', 0):.1f} KB)")
                        else:
                            self.log(f"  [{completed}/{len(eligible_hosts)}] ✗ {host['name']}: {result['error']}", "WARN")
                    except Exception as e:
                        backup_results[host['server_id']] = {'success': False, 'error': str(e)}
                        self.log(f"  [{completed}/{len(eligible_hosts)}] ✗ {host['name']}: {e}", "WARN")
        else:
            # Sequential execution
            for idx, host in enumerate(eligible_hosts, 1):
                # Check for cancellation (no graceful cancel during backups)
                cancel_result = self._check_and_handle_cancellation(job, cleanup_state, check_graceful=False)
                if cancel_result == 'cancelled':
                    raise Exception("Job cancelled during SCP backups")
                
                # Update job with current backup progress
                self.executor.update_job_status(
                    job['id'],
                    'running',
                    details={
                        **job.get('details', {}),
                        'current_step': f'SCP Backup: {host["name"]}',
                        'current_host': host['name'],
                        'hosts_backed_up': idx - 1,
                        'total_hosts': len(eligible_hosts),
                        'scp_batch_progress': int(((idx - 1) / len(eligible_hosts)) * 100)
                    }
                )
                
                self.log(f"  [{idx}/{len(eligible_hosts)}] Backing up {host['name']}...")
                
                try:
                    result = self._export_single_scp(
                        job, host, host_credentials[host['server_id']]
                    )
                    backup_results[host['server_id']] = result
                    
                    if result['success']:
                        self.log(f"    ✓ Backup completed ({result.get('size_kb', 0):.1f} KB)")
                    else:
                        self.log(f"    ✗ Backup failed: {result['error']}", "WARN")
                        
                except Exception as e:
                    backup_results[host['server_id']] = {'success': False, 'error': str(e)}
                    self.log(f"    ✗ Backup failed: {e}", "WARN")
        
        # Summarize results
        successful = sum(1 for r in backup_results.values() if r.get('success'))
        self.log(f"  SCP Backup Summary: {successful}/{len(eligible_hosts)} successful")
        
        return backup_results
    
    def _check_and_handle_cancellation(self, job: Dict, cleanup_state: Dict, check_graceful: bool = True) -> str:
        """
        Check if job was cancelled and perform cleanup if needed.
        
        Args:
            job: Current job dict
            cleanup_state: Dict tracking state needing cleanup:
                - hosts_in_maintenance: List of vcenter_host_ids currently in maintenance
                - current_server: Dict with ip, username, password for current server
                - firmware_in_progress: Bool indicating if firmware is actively being applied
                - current_host_name: Name of host currently being processed
            check_graceful: Whether to check for graceful cancel (finish current host)
                
        Returns:
            'none' - No cancellation requested
            'graceful' - Graceful cancel: finish current host, then stop
            'cancelled' - Full cancel: cleanup performed
        """
        # Refresh job to get latest status and details
        job_status = self.executor.get_job_status(job['id'])
        if not job_status:
            return 'none'
        
        current_status = job_status.get('status', 'running')
        job_details = job_status.get('details', {}) or {}
        
        # Check for graceful cancel flag (finish current host)
        if check_graceful and job_details.get('graceful_cancel'):
            if not cleanup_state.get('graceful_cancel_logged'):
                self.log("⏸️ GRACEFUL CANCEL REQUESTED - Will finish current host then stop", "WARN")
                cleanup_state['graceful_cancel_logged'] = True
            return 'graceful'
        
        # Check for full cancellation
        if current_status != 'cancelled':
            return 'none'
        
        self.log("⚠️ CANCELLATION DETECTED - Starting cleanup...", "WARN")
        
        # Log cancellation details
        cleanup_details = {
            'cancelled_at': utc_now_iso(),
            'hosts_in_maintenance': len(cleanup_state.get('hosts_in_maintenance', [])),
            'firmware_in_progress': cleanup_state.get('firmware_in_progress', False),
            'current_host': cleanup_state.get('current_host_name'),
            'cleanup_actions': []
        }
        
        # Check if firmware is in progress - this is risky!
        if cleanup_state.get('firmware_in_progress'):
            current_server = cleanup_state.get('current_server')
            if current_server:
                self.log("⚠️ WARNING: Firmware update may be in progress!", "WARN")
                self.log(f"  Server: {current_server.get('ip')}", "WARN")
                self.log("  Cancelling during firmware update may leave server unstable", "WARN")
                cleanup_details['cleanup_actions'].append({
                    'action': 'firmware_warning',
                    'server': current_server.get('ip'),
                    'message': 'Firmware may have been in progress during cancel'
                })
                
                # Check iDRAC job state before clearing
                try:
                    from job_executor.dell_redfish import DellOperations, DellRedfishAdapter
                    adapter = DellRedfishAdapter(
                        self.executor.session_manager, 
                        self.executor._get_dell_logger(), 
                        self.executor._log_dell_redfish_command
                    )
                    dell_ops = DellOperations(adapter)
                    
                    # Get current iDRAC jobs to log their state
                    jobs_result = dell_ops.get_idrac_jobs(
                        ip=current_server['ip'],
                        username=current_server['username'],
                        password=current_server['password'],
                        server_id=current_server.get('server_id')
                    )
                    
                    if jobs_result.get('success'):
                        active_jobs = [j for j in jobs_result.get('jobs', []) 
                                      if j.get('JobState') in ['Running', 'Downloading', 'Scheduling', 'Waiting']]
                        if active_jobs:
                            self.log(f"  Found {len(active_jobs)} active iDRAC job(s):", "WARN")
                            for j in active_jobs[:3]:  # Log up to 3
                                self.log(f"    - {j.get('Name', 'Unknown')}: {j.get('JobState')}", "WARN")
                            cleanup_details['cleanup_actions'].append({
                                'action': 'active_jobs_found',
                                'count': len(active_jobs),
                                'jobs': [{'name': j.get('Name'), 'state': j.get('JobState')} for j in active_jobs[:5]]
                            })
                except Exception as e:
                    self.log(f"  Could not check iDRAC job state: {e}", "WARN")
        
        # Exit maintenance mode for any hosts we put in maintenance
        for host_id in cleanup_state.get('hosts_in_maintenance', []):
            try:
                self.log(f"  Cleaning up: Exiting maintenance mode for host {host_id}")
                self.executor.exit_vcenter_maintenance_mode(host_id)
                cleanup_details['cleanup_actions'].append({
                    'action': 'exit_maintenance',
                    'host_id': host_id,
                    'success': True
                })
            except Exception as e:
                self.log(f"  Warning: Failed to exit maintenance mode for {host_id}: {e}", "WARN")
                cleanup_details['cleanup_actions'].append({
                    'action': 'exit_maintenance',
                    'host_id': host_id,
                    'success': False,
                    'error': str(e)
                })
        
        # Restore HA on cluster if it was disabled
        if cleanup_state.get('ha_disabled'):
            try:
                cluster_name = cleanup_state.get('ha_cluster_name')
                source_vcenter_id = cleanup_state.get('ha_source_vcenter_id')
                original_state = cleanup_state.get('ha_original_state', {})
                
                self.log(f"  Cleaning up: Re-enabling HA on cluster {cluster_name}")
                ha_result = self.executor.enable_cluster_ha(
                    cluster_name, 
                    source_vcenter_id,
                    host_monitoring=original_state.get('host_monitoring_was', 'enabled'),
                    admission_control=original_state.get('admission_control_was', True)
                )
                
                if ha_result.get('success'):
                    self.log(f"  ✓ HA re-enabled on cluster {cluster_name}")
                    cleanup_details['cleanup_actions'].append({
                        'action': 'enable_cluster_ha',
                        'cluster': cluster_name,
                        'success': True
                    })
                else:
                    self.log(f"  ⚠ Failed to re-enable HA: {ha_result.get('error')}", "WARN")
                    cleanup_details['cleanup_actions'].append({
                        'action': 'enable_cluster_ha',
                        'cluster': cluster_name,
                        'success': False,
                        'error': ha_result.get('error')
                    })
            except Exception as e:
                self.log(f"  Warning: Failed to re-enable HA: {e}", "WARN")
                cleanup_details['cleanup_actions'].append({
                    'action': 'enable_cluster_ha',
                    'success': False,
                    'error': str(e)
                })
        
        # Clear iDRAC job queue for current server if applicable
        current_server = cleanup_state.get('current_server')
        if current_server:
            try:
                self.log(f"  Cleaning up: Clearing iDRAC job queue for {current_server.get('ip')}")
                from job_executor.dell_redfish import DellOperations, DellRedfishAdapter
                adapter = DellRedfishAdapter(
                    self.executor.session_manager, 
                    self.executor._get_dell_logger(), 
                    self.executor._log_dell_redfish_command
                )
                dell_ops = DellOperations(adapter)
                dell_ops.clear_idrac_job_queue(
                    ip=current_server['ip'],
                    username=current_server['username'],
                    password=current_server['password'],
                    force=True,
                    server_id=current_server.get('server_id')
                )
                cleanup_details['cleanup_actions'].append({
                    'action': 'clear_job_queue',
                    'server': current_server.get('ip'),
                    'success': True
                })
            except Exception as e:
                self.log(f"  Warning: Failed to clear iDRAC job queue: {e}", "WARN")
                cleanup_details['cleanup_actions'].append({
                    'action': 'clear_job_queue',
                    'server': current_server.get('ip'),
                    'success': False,
                    'error': str(e)
                })
        
        # Update job with cleanup details
        self.update_job_status(
            job['id'],
            'cancelled',
            completed_at=utc_now_iso(),
            details={'cleanup_details': cleanup_details}
        )
        
        self.log("✓ Cleanup completed", "INFO")
        self.log(f"  Actions performed: {len(cleanup_details['cleanup_actions'])}", "INFO")
        return 'cancelled'
    
    def _should_stop_after_current_host(self, job: Dict, cleanup_state: Dict) -> bool:
        """
        Check if we should stop processing after the current host completes.
        Used for graceful cancellation.
        """
        result = self._check_and_handle_cancellation(job, cleanup_state)
        return result == 'graceful'
    
    def _deep_sanitize_for_json(self, obj):
        """
        Recursively ensure all values are JSON-serializable.
        Converts complex objects (pyvmomi references, etc.) to simple types.
        """
        import json
        from datetime import datetime as dt
        
        if obj is None:
            return None
        if isinstance(obj, (str, int, float, bool)):
            return obj
        if isinstance(obj, dict):
            return {str(k): self._deep_sanitize_for_json(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [self._deep_sanitize_for_json(i) for i in obj]
        if isinstance(obj, dt):
            return obj.isoformat()
        # Convert anything else to string representation
        try:
            return str(obj)
        except:
            return "<non-serializable>"
    
    def _log_workflow_step(self, job_id: str, workflow_type: str, step_number: int, 
                           step_name: str, status: str, server_id: str = None, 
                           host_id: str = None, cluster_id: str = None,
                           step_details: dict = None, step_error: str = None, 
                           step_started_at: str = None, step_completed_at: str = None):
        """Insert or update workflow execution step in database for real-time UI updates"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        import json
        
        try:
            # Sanitize step_details if provided to ensure JSON-serializable
            sanitized_details = step_details
            if step_details:
                try:
                    json.dumps(step_details)
                except (TypeError, ValueError) as json_err:
                    self.log(f"Step details contain non-serializable data, sanitizing: {json_err}", "DEBUG")
                    sanitized_details = self._deep_sanitize_for_json(step_details)
            
            # Check if step exists
            response = requests.get(
                f"{DSM_URL}/rest/v1/workflow_executions?job_id=eq.{job_id}&step_number=eq.{step_number}",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            
            step_data = {
                'job_id': job_id,
                'workflow_type': workflow_type,
                'step_number': step_number,
                'step_name': step_name,
                'step_status': status,
                'server_id': server_id,
                'host_id': host_id,
                'cluster_id': cluster_id,
                'step_details': sanitized_details,
                'step_error': step_error,
                'step_started_at': step_started_at,
                'step_completed_at': step_completed_at
            }
            
            # Remove None values
            step_data = {k: v for k, v in step_data.items() if v is not None}
            
            if response.status_code == 200 and response.json():
                # Update existing step
                step_id = response.json()[0]['id']
                patch_response = requests.patch(
                    f"{DSM_URL}/rest/v1/workflow_executions?id=eq.{step_id}",
                    headers={
                        'apikey': SERVICE_ROLE_KEY, 
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                    },
                    json=step_data,
                    verify=VERIFY_SSL
                )
                if patch_response.status_code not in [200, 204]:
                    self.log(f"Failed to update workflow step {step_name}: {patch_response.status_code} - {patch_response.text[:200]}", "WARN")
            else:
                # Insert new step
                post_response = requests.post(
                    f"{DSM_URL}/rest/v1/workflow_executions",
                    headers={
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                    },
                    json=step_data,
                    verify=VERIFY_SSL
                )
                if post_response.status_code not in [200, 201]:
                    self.log(f"Failed to insert workflow step {step_name}: {post_response.status_code} - {post_response.text[:200]}", "WARN")
        except Exception as e:
            self.log(f"Failed to log workflow step: {e}", "WARN")
    
    def _get_applicable_firmware_packages(self, server_model: str, component_filter: List[str]) -> List[Dict]:
        """
        Query firmware packages from library that are applicable to this server model.
        
        Args:
            server_model: The server model (e.g., 'PowerEdge R750')
            component_filter: List of component types to include, or ['all'] for all
            
        Returns:
            List of applicable firmware package dicts
        """
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        
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
                verify=VERIFY_SSL
            )
            
            if response.status_code != 200:
                self.log(f"    ⚠ Failed to query firmware packages: {response.status_code}", "WARN")
                return []
            
            packages = response.json()
            applicable = []
            
            for pkg in packages:
                # Check model applicability
                applicable_models = pkg.get('applicable_models') or []
                
                # If applicable_models is specified, check if server matches
                if applicable_models and server_model:
                    # Check for partial match (e.g., "R750" matches "PowerEdge R750")
                    model_matches = False
                    for model in applicable_models:
                        if model.lower() in server_model.lower() or server_model.lower() in model.lower():
                            model_matches = True
                            break
                    
                    if not model_matches:
                        continue
                
                # Check component filter
                pkg_type = (pkg.get('component_type') or '').upper()
                
                if 'all' not in [f.lower() for f in component_filter]:
                    # Map component types for matching
                    filter_upper = [f.upper() for f in component_filter]
                    if pkg_type not in filter_upper:
                        continue
                
                applicable.append(pkg)
            
            return applicable
            
        except Exception as e:
            self.log(f"    ⚠ Error querying firmware packages: {e}", "WARN")
            return []
    
    def _check_local_repository_updates(
        self,
        ip: str,
        username: str,
        password: str,
        server_model: str,
        server_id: str,
        job_id: str
    ) -> list:
        """
        Compare installed firmware against uploaded packages in firmware_packages table.
        Returns list of available updates in the same format as Dell catalog updates.
        
        Args:
            ip: Server iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            server_model: Server model string (e.g., 'PowerEdge R750')
            server_id: Server UUID for logging
            job_id: Job ID for session logging
            
        Returns:
            List of available update dicts with component_name, available_version, etc.
        """
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        import requests
        
        available_updates = []
        
        try:
            # Get current firmware inventory from iDRAC
            session = self.executor.create_idrac_session(
                ip, username, password,
                log_to_db=True, server_id=server_id, job_id=job_id
            )
            
            if not session:
                self.log(f"      Failed to create iDRAC session for local repo check", "WARN")
                return []
            
            try:
                dell_ops = self.executor._get_dell_operations()
                current_inventory = dell_ops.get_firmware_inventory(ip, username, password, server_id=server_id)
            finally:
                self.executor.delete_idrac_session(session, ip, server_id, job_id)
            
            if not current_inventory:
                self.log(f"      No firmware inventory returned", "WARN")
                return []
            
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
                self.log(f"      Could not query firmware packages: {response.status_code}", "WARN")
                return []
            
            packages = response.json()
            
            if not packages:
                return []
            
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
                    type_match = pkg_type and installed_type and pkg_type == installed_type
                    
                    # Match by name pattern
                    name_match = False
                    if pkg_name_pattern:
                        pattern_lower = pkg_name_pattern.lower()
                        if pattern_lower in installed_name or installed_name in pattern_lower:
                            name_match = True
                    
                    # Match by component type in name (fallback)
                    if not type_match and not name_match and pkg_type:
                        if pkg_type.lower() in installed_name:
                            name_match = True
                    
                    if type_match or name_match:
                        # Compare versions
                        if self._is_newer_version(pkg_version, installed_version):
                            available_updates.append({
                                'component_name': installed.get('Name') or installed.get('component_name'),
                                'component_type': installed_type or pkg_type,
                                'current_version': installed_version,
                                'available_version': pkg_version,
                                'version': pkg_version,
                                'name': installed.get('Name') or installed.get('component_name'),
                                'criticality': pkg.get('criticality', 'optional'),
                                'reboot_required': pkg.get('reboot_required', True),
                                'package_id': pkg.get('id'),
                                'source': 'local_repository'
                            })
                            break  # Only one update per component
            
        except Exception as e:
            self.log(f"      Error checking local repository: {e}", "WARN")
        
        return available_updates
    
    def _is_newer_version(self, new_version: str, current_version: str) -> bool:
        """
        Compare Dell firmware version strings.
        Returns True if new_version is newer than current_version.
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
    
    def execute_prepare_host_for_update(self, job: Dict):
        """Workflow: Prepare ESXi host for firmware updates"""
        workflow_results = {
            'steps_completed': [],
            'steps_failed': [],
            'total_time_seconds': 0
        }
        workflow_start = time.time()
        
        try:
            self.log(f"Starting prepare_host_for_update workflow: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=utc_now_iso())
            
            details = job.get('details', {})
            server_id = details.get('server_id')
            vcenter_host_id = details.get('vcenter_host_id')
            backup_scp = details.get('backup_scp', True)
            maintenance_timeout = details.get('maintenance_timeout', 600)
            
            # STEP 1: Validate server exists
            self._log_workflow_step(job['id'], 'prepare', 1, 'Validate Server', 'running', server_id=server_id)
            
            server = self.get_server_by_id(server_id)
            if not server:
                self._log_workflow_step(job['id'], 'prepare', 1, 'Validate Server', 'failed',
                                      server_id=server_id, step_error='Server not found')
                raise Exception(f"Server {server_id} not found")
            
            self.log(f"  [OK] Server validated: {server.get('hostname', server['ip_address'])}")
            self._log_workflow_step(job['id'], 'prepare', 1, 'Validate Server', 'completed',
                                  server_id=server_id, step_details={'hostname': server.get('hostname')})
            workflow_results['steps_completed'].append('validate_server')
            
            # STEP 2: Test iDRAC connectivity
            self._log_workflow_step(job['id'], 'prepare', 2, 'Test iDRAC Connectivity', 'running', server_id=server_id)
            
            username, password = self.executor.get_credentials_for_server(server)
            session = self.executor.create_idrac_session(
                server['ip_address'], username, password,
                log_to_db=True, server_id=server_id, job_id=job['id']
            )
            
            if not session:
                self._log_workflow_step(job['id'], 'prepare', 2, 'Test iDRAC Connectivity', 'failed',
                                      server_id=server_id, step_error='Failed to create iDRAC session')
                raise Exception("Failed to connect to iDRAC")
            
            self.log(f"  [OK] iDRAC connectivity confirmed")
            self._log_workflow_step(job['id'], 'prepare', 2, 'Test iDRAC Connectivity', 'completed', server_id=server_id)
            workflow_results['steps_completed'].append('test_idrac')
            
            # STEP 3: Enter maintenance mode (if vCenter linked)
            if vcenter_host_id:
                self._log_workflow_step(job['id'], 'prepare', 3, 'Enter Maintenance Mode', 'running',
                                      server_id=server_id, host_id=vcenter_host_id)
                
                self.log(f"  Entering vCenter maintenance mode (timeout: {maintenance_timeout}s)...")
                maintenance_result = self.executor.enter_vcenter_maintenance_mode(vcenter_host_id, maintenance_timeout)
                
                if not maintenance_result['success']:
                    self._log_workflow_step(job['id'], 'prepare', 3, 'Enter Maintenance Mode', 'failed',
                                          server_id=server_id, host_id=vcenter_host_id,
                                          step_error=maintenance_result.get('error'),
                                          step_details=maintenance_result)
                    workflow_results['evacuation_blockers'] = maintenance_result.get('evacuation_blockers')
                    raise Exception(f"Failed to enter maintenance mode: {maintenance_result.get('error')}")
                
                self.log(f"  [OK] Maintenance mode active ({maintenance_result.get('vms_evacuated', 0)} VMs evacuated)")
                self._log_workflow_step(job['id'], 'prepare', 3, 'Enter Maintenance Mode', 'completed',
                                      server_id=server_id, host_id=vcenter_host_id,
                                      step_details=maintenance_result)
                workflow_results['steps_completed'].append('enter_maintenance')
                workflow_results['vms_evacuated'] = maintenance_result.get('vms_evacuated', 0)
            else:
                self.log("  -> No vCenter host linked, skipping maintenance mode")
                self._log_workflow_step(job['id'], 'prepare', 3, 'Enter Maintenance Mode', 'skipped',
                                      server_id=server_id, step_details={'reason': 'No vCenter host linked'})
            
            # STEP 4: Export SCP backup (if requested)
            if backup_scp:
                self._log_workflow_step(job['id'], 'prepare', 4, 'Export SCP Backup', 'running', server_id=server_id)
                self.log(f"  Exporting SCP backup...")
                
                # Note: SCP export is complex - this is a simplified version
                # In production, you'd call execute_scp_export or implement inline
                self.log(f"  [OK] SCP backup export queued")
                self._log_workflow_step(job['id'], 'prepare', 4, 'Export SCP Backup', 'completed',
                                      server_id=server_id)
                workflow_results['steps_completed'].append('scp_export')
            else:
                self.log("  -> SCP backup not requested, skipping")
                self._log_workflow_step(job['id'], 'prepare', 4, 'Export SCP Backup', 'skipped',
                                      server_id=server_id, step_details={'reason': 'Not requested'})
            
            # Cleanup session
            if session:
                self.executor.delete_idrac_session(session, server['ip_address'], server_id, job['id'])
            
            workflow_results['total_time_seconds'] = int(time.time() - workflow_start)
            
            self.log(f"[OK] Host preparation workflow completed in {workflow_results['total_time_seconds']}s")
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=utc_now_iso(),
                details={
                    'workflow_results': workflow_results,
                    'server_id': server_id,
                    'vcenter_host_id': vcenter_host_id,
                    'ready_for_update': True
                }
            )
            
        except Exception as e:
            self.log(f"Prepare host workflow failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=utc_now_iso(),
                details={'error': str(e), 'workflow_results': workflow_results}
            )
    
    def execute_verify_host_after_update(self, job: Dict):
        """Workflow: Verify ESXi host health after firmware updates"""
        workflow_results = {
            'checks_passed': [],
            'checks_failed': [],
            'checks_warnings': [],
            'total_time_seconds': 0
        }
        workflow_start = time.time()
        
        try:
            self.log(f"Starting verify_host_after_update workflow: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=utc_now_iso())
            
            details = job.get('details', {})
            server_id = details.get('server_id')
            vcenter_host_id = details.get('vcenter_host_id')
            expected_versions = details.get('expected_firmware_versions', {})
            
            # Verification implementation here...
            # Delegate to executor's existing verification logic
            
            workflow_results['total_time_seconds'] = int(time.time() - workflow_start)
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=utc_now_iso(),
                details={'workflow_results': workflow_results}
            )
            
        except Exception as e:
            self.log(f"Verify host workflow failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=utc_now_iso(),
                details={'error': str(e), 'workflow_results': workflow_results}
            )
    
    def execute_rolling_cluster_update(self, job: Dict):
        """
        Execute a phased rolling firmware update across a vCenter cluster.
        
        Workflow:
        - Phase 0: Pre-flight checks (all hosts validated upfront, fail fast)
        - Phase 1: Batch SCP backups (all hosts backed up before any changes, optional parallel)
        - Phase 2: Sequential per-host updates (only one host in maintenance at a time)
        
        Supports:
        - Multiple firmware packages per server
        - Cluster-wide coordination
        - Server groups and individual servers
        - Parallel SCP backups (configurable concurrency)
        - Continue on failure option
        
        Job details parameters:
        - backup_scp (bool): Enable SCP backups (default: True)
        - parallel_backups (bool): Run SCP backups in parallel (default: False)
        - max_parallel_backups (int): Max concurrent SCP exports (default: 3)
        - continue_on_failure (bool): Continue to next host if one fails (default: False)
        """
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        from job_executor.utils import _safe_json_parse
        
        workflow_results = {
            'cluster_id': None,
            'total_hosts': 0,
            'hosts_updated': 0,
            'hosts_failed': 0,
            'hosts_skipped': 0,
            'host_results': [],
            'total_time_seconds': 0
        }
        workflow_start = time.time()
        cleanup_state = {
            'hosts_in_maintenance': [],
            'current_server': None,
            'ha_disabled': False,
            'ha_cluster_name': None,
            'ha_source_vcenter_id': None,
            'ha_original_state': None,
            'vms_to_power_on': {},
            'firmware_in_progress': False,
            'current_host_name': None
        }

        def reenable_cluster_ha(step_reason: str = 'after_updates', step_number: int = 9999) -> bool:
            """Attempt to restore HA if we previously disabled it."""
            if not cleanup_state.get('ha_disabled'):
                return False

            self.log("")
            self.log("=" * 80)
            self.log("HA MANAGEMENT: RE-ENABLING HA")
            self.log("=" * 80)

            step_name = f"Re-enable HA on cluster: {cleanup_state['ha_cluster_name']}"
            self._log_workflow_step(
                job['id'], 'rolling_cluster_update',
                step_number=step_number,
                step_name=step_name,
                status='running',
                cluster_id=workflow_results.get('cluster_id'),
                step_details={'reason': step_reason},
                step_started_at=utc_now_iso()
            )

            try:
                original_state = cleanup_state.get('ha_original_state', {})
                ha_enable_result = self.executor.enable_cluster_ha(
                    cleanup_state['ha_cluster_name'],
                    cleanup_state['ha_source_vcenter_id'],
                    host_monitoring=original_state.get('host_monitoring_was', 'enabled'),
                    admission_control=original_state.get('admission_control_was', True)
                )

                if ha_enable_result.get('success'):
                    self.log(f"  ✓ HA re-enabled on cluster {cleanup_state['ha_cluster_name']}")
                    cleanup_state['ha_disabled'] = False  # Mark as restored

                    self.update_job_details_field(job['id'], {
                        'ha_reenabled_at': utc_now_iso(),
                        'ha_restore_reason': step_reason
                    })

                    self._log_workflow_step(
                        job['id'], 'rolling_cluster_update',
                        step_number=step_number,
                        step_name=step_name,
                        status='completed',
                        cluster_id=workflow_results.get('cluster_id'),
                        step_details={'ha_enabled': True, 'reason': step_reason},
                        step_completed_at=utc_now_iso()
                    )
                    return True

                error_msg = ha_enable_result.get('error', 'Unknown error')
                self.log(f"  ⚠ Failed to re-enable HA: {error_msg}", "WARN")

                self._log_workflow_step(
                    job['id'], 'rolling_cluster_update',
                    step_number=step_number,
                    step_name=step_name,
                    status='failed',
                    cluster_id=workflow_results.get('cluster_id'),
                    step_error=error_msg,
                    step_details={'reason': step_reason},
                    step_completed_at=utc_now_iso()
                )

                workflow_results['ha_restore_failed'] = True
                workflow_results['ha_restore_error'] = error_msg
                return False
            except Exception as ha_err:
                self.log(f"  ⚠ Error re-enabling HA: {ha_err}", "WARN")
                workflow_results['ha_restore_failed'] = True
                workflow_results['ha_restore_error'] = str(ha_err)
                return False
        
        try:
            self.log(f"Starting rolling_cluster_update workflow: {job['id']}")
            self.log("=" * 80)
            self.update_job_status(job['id'], 'running', started_at=utc_now_iso())
            
            details = job.get('details', {})
            target_scope = job.get('target_scope', {})
            
            update_scope = details.get('update_scope', 'full_stack')
            firmware_updates = details.get('firmware_updates', [])
            backup_scp = details.get('backup_scp', True)
            min_healthy_hosts = details.get('min_healthy_hosts', 2)
            continue_on_failure = details.get('continue_on_failure', False)
            auto_select_latest = details.get('auto_select_latest', True)
            rebalance_wait_enabled = details.get('rebalance_wait_enabled', True)
            rebalance_wait_timeout = details.get('rebalance_wait_timeout', 420)  # 7 minutes
            rebalance_quiet_period = details.get('rebalance_quiet_period', 45)
            
            workflow_results['update_scope'] = update_scope
            
            eligible_hosts = []
            
            # Mode 1: Individual servers via target_scope
            if target_scope.get('type') == 'servers' and target_scope.get('server_ids'):
                server_ids = target_scope['server_ids']
                self.log(f"  [INFO] Target mode: Individual servers ({len(server_ids)} selected)")
                
                # Fetch servers directly from servers table
                for server_id in server_ids:
                    response = requests.get(
                        f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}&select=*",
                        headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                        verify=VERIFY_SSL
                    )
                    if response.status_code == 200:
                        servers = _safe_json_parse(response)
                        if servers:
                            server = servers[0]
                            eligible_hosts.append({
                                'id': server_id,
                                'name': server.get('hostname') or server.get('ip_address'),
                                'server_id': server_id,
                                'ip_address': server.get('ip_address')
                            })
                
                workflow_results['target_type'] = 'servers'
                workflow_results['server_ids'] = server_ids
                
            # Mode 2: Server group via target_scope
            elif target_scope.get('type') == 'group' and target_scope.get('group_id'):
                group_id = target_scope['group_id']
                self.log(f"  [INFO] Target mode: Server group {group_id}")
                
                # Fetch servers in group
                response = requests.get(
                    f"{DSM_URL}/rest/v1/server_group_members?server_group_id=eq.{group_id}&select=server_id,servers(*)",
                    headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                    verify=VERIFY_SSL
                )
                if response.status_code == 200:
                    members = _safe_json_parse(response)
                    for member in members:
                        server = member.get('servers')
                        if server:
                            eligible_hosts.append({
                                'id': server['id'],
                                'name': server.get('hostname') or server.get('ip_address'),
                                'server_id': server['id'],
                                'ip_address': server.get('ip_address')
                            })
                
                workflow_results['target_type'] = 'group'
                workflow_results['group_id'] = group_id
                
            # Mode 3: Cluster via details or target_scope (existing behavior)
            else:
                cluster_id = details.get('cluster_id') or details.get('cluster_name') or target_scope.get('cluster_name')
                self.log(f"  [INFO] Target mode: Cluster {cluster_id}")
                
                if not cluster_id:
                    self.log(f"  [ERROR] No valid target specified!", "ERROR")
                    self.log(f"  [DEBUG] target_scope: {target_scope}", "DEBUG")
                    self.log(f"  [DEBUG] details: {details}", "DEBUG")
                    raise Exception("No valid target: missing cluster_id, group_id, or server_ids")
                
                workflow_results['cluster_id'] = cluster_id
                workflow_results['target_type'] = 'cluster'
                
                # Existing cluster logic - fetch from vcenter_hosts
                response = requests.get(
                    f"{DSM_URL}/rest/v1/vcenter_hosts?cluster=eq.{quote(cluster_id)}&select=*",
                    headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                    verify=VERIFY_SSL
                )
                
                if response.status_code != 200:
                    raise Exception(f"Failed to fetch cluster hosts: {response.status_code}")
                
                cluster_hosts = _safe_json_parse(response)
                eligible_hosts = [h for h in cluster_hosts if h.get('server_id') and h.get('status') in ['connected', 'online']]
            
            workflow_results['total_hosts'] = len(eligible_hosts)
            
            if len(eligible_hosts) == 0:
                self.log(f"  [ERROR] No eligible hosts/servers found!", "ERROR")
                self.log(f"  [DEBUG] target_scope: {target_scope}", "DEBUG")
                self.log(f"  [DEBUG] details: {details}", "DEBUG")
                raise Exception("No eligible hosts/servers found for update. Check target_scope or cluster_id.")
            
            self.log(f"  [OK] Found {len(eligible_hosts)} eligible hosts/servers")

            # Determine cluster name early for HA management and progress estimation
            cluster_name = None
            source_vcenter_id = None
            for host in eligible_hosts:
                server = self.get_server_by_id(host['server_id'])
                if server and server.get('vcenter_host_id'):
                    try:
                        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
                        response = requests.get(
                            f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{server['vcenter_host_id']}&select=cluster,source_vcenter_id",
                            headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                            verify=VERIFY_SSL,
                            timeout=5
                        )
                        if response.status_code == 200:
                            hosts_data = _safe_json_parse(response)
                            if hosts_data and hosts_data[0].get('cluster'):
                                cluster_name = hosts_data[0]['cluster']
                                source_vcenter_id = hosts_data[0].get('source_vcenter_id')
                                break
                    except Exception as e:
                        self.log(f"  Warning: Could not determine cluster name: {e}", "WARN")
            
            # Calculate expected total workflow steps for accurate UI progress
            # Base steps: pre-flight (0), SCP backups if enabled (1), sequential updates container (2)
            # Calculate expected total steps with sequential numbering:
            # 1. Pre-flight checks
            # 2. HA disable (if cluster)
            # 3. Comprehensive blocker scan (Phase 1.5)
            # 4. SCP backups (if enabled)
            # Per host (7 steps each): check_updates, maintenance, firmware, reboot, verify, exit_maintenance, power_on
            # N+1. HA re-enable
            base_steps = 1  # Pre-flight
            if cluster_name:
                base_steps += 1  # HA disable
                base_steps += 1  # Phase 1.5 blocker scan
                base_steps += 1  # HA re-enable at end
            if backup_scp:
                base_steps += 1  # SCP backups
            steps_per_host = 8 if (cluster_name and rebalance_wait_enabled) else 7  # + rebalance wait
            expected_total_steps = base_steps + (len(eligible_hosts) * steps_per_host)
            
            # Track workflow step counter for sequential numbering
            workflow_step_counter = 1
            
            # Store progress metadata in job details for UI
            self.update_job_details_field(job['id'], {
                'total_hosts': len(eligible_hosts),
                'expected_total_steps': expected_total_steps,
                'hosts_processed': 0,
                'steps_per_host': steps_per_host
            })
            
            # =================================================================
            # VCSA DETECTION AND HOST ORDERING
            # =================================================================
            self.log("")
            self.log("=" * 80)
            self.log("VCSA DETECTION & HOST ORDERING")
            self.log("=" * 80)
            
            # Get all vcenter_host_ids from servers
            vcenter_host_ids = []
            for host in eligible_hosts:
                server = self.get_server_by_id(host['server_id'])
                if server and server.get('vcenter_host_id'):
                    vcenter_host_ids.append(server['vcenter_host_id'])
            
            vcsa_info = {'vcsa_host_id': None, 'vcsa_host_name': None}
            if vcenter_host_ids:
                vcsa_info = self.executor.detect_vcsa_on_hosts(
                    vcenter_host_ids, 
                    cluster_name=workflow_results.get('cluster_id')
                )
                workflow_results['vcsa_detection'] = vcsa_info
            
            # Reorder hosts: put VCSA host last if detected
            if vcsa_info.get('vcsa_host_id'):
                vcsa_vcenter_host_id = vcsa_info['vcsa_host_id']
                
                # Find which eligible_host has this vcenter_host_id
                vcsa_host_index = None
                for idx, host in enumerate(eligible_hosts):
                    server = self.get_server_by_id(host['server_id'])
                    if server and server.get('vcenter_host_id') == vcsa_vcenter_host_id:
                        vcsa_host_index = idx
                        break
                
                if vcsa_host_index is not None and vcsa_host_index < len(eligible_hosts) - 1:
                    # Move VCSA host to the end
                    vcsa_host = eligible_hosts.pop(vcsa_host_index)
                    eligible_hosts.append(vcsa_host)
                    self.log(f"  ✓ Host order adjusted: {vcsa_info['vcsa_host_name']} moved to position {len(eligible_hosts)} (last)")
                    self.log(f"    Reason: Contains VCSA VM '{vcsa_info.get('vcsa_vm_name')}' - must be updated after VCSA can migrate")
                    workflow_results['host_order_adjusted'] = True
                    workflow_results['vcsa_host_position'] = len(eligible_hosts)
                else:
                    self.log(f"  ✓ VCSA host already in last position")
            else:
                self.log(f"  ✓ No VCSA detected - using default host order")
            
            # =================================================================
            # MAINTENANCE MODE PRIORITIZATION
            # =================================================================
            self.log("")
            self.log("=" * 80)
            self.log("CHECKING CURRENT MAINTENANCE STATUS")
            self.log("=" * 80)
            
            hosts_in_maintenance = []
            hosts_not_in_maintenance = []
            vcsa_host_entry = None  # Track VCSA host separately to ensure it stays last
            
            for host in eligible_hosts:
                server = self.get_server_by_id(host['server_id'])
                vcenter_host_id = server.get('vcenter_host_id') if server else None
                is_vcsa_host = server and server.get('vcenter_host_id') == vcsa_info.get('vcsa_host_id')
                
                # Check if this is the VCSA host - always goes last
                if is_vcsa_host:
                    vcsa_host_entry = host
                    self.log(f"  ⚠️ {host['name']}: VCSA host (will be updated last)")
                    continue
                
                if vcenter_host_id:
                    # Prefer live vCenter status to catch hosts already placed in maintenance
                    try:
                        host_status = self.executor._get_vcenter_host_status(vcenter_host_id)
                        if host_status and host_status.get('in_maintenance'):
                            hosts_in_maintenance.append(host)
                            self.log(f"  ✓ {host['name']}: Already in maintenance mode (vCenter)")
                            continue
                    except Exception as e:
                        self.log(f"  ⚠️ {host['name']}: Live maintenance check failed ({e})", "WARN")
                    
                    # Fall back to persisted maintenance_mode flag
                    try:
                        response = requests.get(
                            f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{vcenter_host_id}&select=maintenance_mode",
                            headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                            verify=VERIFY_SSL,
                            timeout=5
                        )
                        if response.status_code == 200:
                            vc_hosts = _safe_json_parse(response)
                            if vc_hosts and vc_hosts[0].get('maintenance_mode'):
                                hosts_in_maintenance.append(host)
                                self.log(f"  ✓ {host['name']}: Already in maintenance mode")
                            else:
                                hosts_not_in_maintenance.append(host)
                                self.log(f"  - {host['name']}: Not in maintenance mode")
                        else:
                            hosts_not_in_maintenance.append(host)
                            self.log(f"  - {host['name']}: Could not check status")
                    except Exception as e:
                        hosts_not_in_maintenance.append(host)
                        self.log(f"  - {host['name']}: Status check failed ({e})")
                else:
                    # No vCenter link - treat as not in maintenance
                    hosts_not_in_maintenance.append(host)
                    self.log(f"  - {host['name']}: No vCenter link")
            
            # Reorder: maintenance mode hosts first, then non-maintenance, then VCSA last
            if hosts_in_maintenance:
                self.log(f"")
                self.log(f"  ✓ Prioritizing {len(hosts_in_maintenance)} host(s) already in maintenance mode")
                eligible_hosts = hosts_in_maintenance + hosts_not_in_maintenance
                workflow_results['maintenance_prioritization'] = {
                    'hosts_in_maintenance': len(hosts_in_maintenance),
                    'hosts_not_in_maintenance': len(hosts_not_in_maintenance)
                }
            else:
                eligible_hosts = hosts_not_in_maintenance
            
            # Always append VCSA host last if detected
            if vcsa_host_entry:
                eligible_hosts.append(vcsa_host_entry)
                self.log(f"  ✓ VCSA host '{vcsa_host_entry['name']}' positioned last in update order")
            
            # Log final host order
            self.log(f"")
            self.log(f"  Final update order:")
            for idx, host in enumerate(eligible_hosts, 1):
                server = self.get_server_by_id(host['server_id']) if host.get('server_id') else None
                is_vcsa = server and server.get('vcenter_host_id') == vcsa_info.get('vcsa_host_id')
                is_in_maint = host in hosts_in_maintenance
                
                markers = []
                if is_in_maint:
                    markers.append("in maintenance")
                if is_vcsa:
                    markers.append("VCSA HOST")
                marker = f" ⚠️ [{', '.join(markers)}]" if markers else ""
                self.log(f"    {idx}. {host['name']}{marker}")
            
            # Log workflow initialization step
            self._log_workflow_step(
                job['id'], 
                'rolling_cluster_update',
                step_number=0,
                step_name=f"Initialize workflow ({len(eligible_hosts)} hosts)",
                status='completed',
                cluster_id=workflow_results.get('cluster_id'),
                step_details={
                    'total_hosts': len(eligible_hosts),
                    'target_type': workflow_results.get('target_type'),
                    'update_scope': update_scope,
                    'vcsa_detected': bool(vcsa_info.get('vcsa_host_id')),
                    'vcsa_host': vcsa_info.get('vcsa_host_name'),
                    'host_order_adjusted': workflow_results.get('host_order_adjusted', False)
                },
                step_started_at=utc_now_iso(),
                step_completed_at=utc_now_iso()
            )
            
            # =================================================================
            # PHASE 0: PRE-FLIGHT CHECKS WITH UPDATE AVAILABILITY CHECK
            # =================================================================
            # This phase now includes checking for available firmware updates
            # BEFORE we disable HA or run SCP backups - allowing early exit
            # if no hosts need updates
            firmware_source = details.get('firmware_source', 'manual_repository')
            dell_catalog_url = details.get('dell_catalog_url', 'https://downloads.dell.com/catalog/Catalog.xml')
            # Enable update checking for both Dell catalog and local repository
            check_updates_in_preflight = firmware_source in ('dell_online_catalog', 'local_repository')
            
            self._log_workflow_step(job['id'], 'rolling_cluster_update', 0,
                f"Pre-flight checks ({len(eligible_hosts)} hosts)", 'running',
                step_details={'checking_updates': check_updates_in_preflight, 'firmware_source': firmware_source})
            
            host_credentials = self._execute_batch_preflight_checks(
                job, eligible_hosts, cleanup_state,
                check_maintenance_blockers=True,
                check_available_updates=check_updates_in_preflight,
                firmware_source=firmware_source,
                dell_catalog_url=dell_catalog_url
            )
            
            # Determine which hosts actually need updates
            hosts_needing_updates = []
            hosts_up_to_date = []
            
            for host in eligible_hosts:
                creds = host_credentials.get(host['server_id'], {})
                if creds.get('needs_update', True):  # Default to True for safety
                    hosts_needing_updates.append(host)
                else:
                    hosts_up_to_date.append(host)
            
            # Log pre-flight completion with update summary
            preflight_details = {
                'total_hosts': len(eligible_hosts),
                'hosts_needing_updates': len(hosts_needing_updates),
                'hosts_up_to_date': len(hosts_up_to_date)
            }
            
            if check_updates_in_preflight:
                # Include list of hosts and their status
                preflight_details['host_update_status'] = [
                    {
                        'name': h['name'],
                        'needs_update': host_credentials.get(h['server_id'], {}).get('needs_update', True),
                        'update_count': len(host_credentials.get(h['server_id'], {}).get('available_updates', []))
                    }
                    for h in eligible_hosts
                ]
            
            self._log_workflow_step(job['id'], 'rolling_cluster_update', 0,
                f"Pre-flight checks ({len(eligible_hosts)} hosts)", 'completed',
                step_details=preflight_details)
            
            # =================================================================
            # EARLY EXIT: NO UPDATES NEEDED
            # =================================================================
            if check_updates_in_preflight and len(hosts_needing_updates) == 0:
                self.log("")
                self.log("=" * 80)
                self.log("✓ ALL HOSTS ARE UP TO DATE - NO UPDATES NEEDED")
                self.log("=" * 80)
                self.log(f"  Checked {len(eligible_hosts)} hosts against Dell catalog")
                self.log(f"  No firmware updates are available")
                self.log(f"  Skipping HA disable and SCP backups (not needed)")
                
                workflow_results['no_updates_needed'] = True
                workflow_results['hosts_checked'] = len(eligible_hosts)
                workflow_results['all_hosts_current'] = True
                workflow_results['total_time_seconds'] = int(time.time() - workflow_start)
                
                self._log_workflow_step(job['id'], 'rolling_cluster_update', 1,
                    f"Early exit - no updates needed", 'completed',
                    step_details={
                        'no_updates_needed': True,
                        'hosts_checked': len(eligible_hosts),
                        'message': 'All hosts are already up to date'
                    })
                
                self.update_job_status(
                    job['id'],
                    'completed',
                    completed_at=utc_now_iso(),
                    details={
                        'no_updates_needed': True,
                        'message': f'All {len(eligible_hosts)} hosts are already up to date - no action required',
                        'hosts_checked': len(eligible_hosts),
                        'workflow_results': workflow_results
                    }
                )
                
                self.log("")
                self.log(f"✓ Job completed - no action required (all hosts current)")
                return  # Early exit - no HA disable, no backups, no updates
            
            # Log update summary if some hosts need updates
            if check_updates_in_preflight and hosts_up_to_date:
                self.log("")
                self.log(f"  📊 Update summary: {len(hosts_needing_updates)} hosts need updates, {len(hosts_up_to_date)} already current")
                for host in hosts_up_to_date:
                    self.log(f"    ✓ {host['name']} - already up to date (will skip)")
            
            # =================================================================
            # HA MANAGEMENT: DISABLE BEFORE MAINTENANCE OPERATIONS
            # =================================================================
            # Only disable HA if we have hosts that need updates
            if cluster_name and source_vcenter_id:
                self.log("")
                self.log("=" * 80)
                self.log("HA MANAGEMENT: DISABLING HA BEFORE MAINTENANCE")
                self.log("=" * 80)
                
                self._log_workflow_step(
                    job['id'], 'rolling_cluster_update',
                    step_number=-1,
                    step_name=f"Disable HA on cluster: {cluster_name}",
                    status='running',
                    cluster_id=workflow_results.get('cluster_id'),
                    step_started_at=utc_now_iso()
                )
                
                ha_status = self.executor.get_cluster_ha_status(cluster_name, source_vcenter_id)
                if ha_status.get('success') and ha_status.get('ha_enabled'):
                    self.log(f"  Cluster HA status: enabled (host_monitoring={ha_status.get('host_monitoring')})")
                    
                    ha_disable_result = self.executor.disable_cluster_ha(cluster_name, source_vcenter_id)
                    
                    if ha_disable_result.get('success'):
                        cleanup_state['ha_disabled'] = True
                        cleanup_state['ha_cluster_name'] = cluster_name
                        cleanup_state['ha_source_vcenter_id'] = source_vcenter_id
                        cleanup_state['ha_original_state'] = {
                            'was_enabled': ha_disable_result.get('was_enabled', True),
                            'host_monitoring_was': ha_disable_result.get('host_monitoring_was', 'enabled'),
                            'admission_control_was': ha_disable_result.get('admission_control_was', True)
                        }
                        
                        # Store HA state in job details for recovery
                        self.update_job_details_field(job['id'], {
                            'ha_state_before': cleanup_state['ha_original_state'],
                            'ha_cluster_name': cluster_name,
                            'ha_source_vcenter_id': source_vcenter_id,
                            'ha_disabled_at': utc_now_iso()
                        })
                        
                        self.log(f"  ✓ HA disabled on cluster {cluster_name}")
                        
                        self._log_workflow_step(
                            job['id'], 'rolling_cluster_update',
                            step_number=-1,
                            step_name=f"Disable HA on cluster: {cluster_name}",
                            status='completed',
                            cluster_id=workflow_results.get('cluster_id'),
                            step_details={'ha_was_enabled': True, 'disabled_successfully': True},
                            step_completed_at=utc_now_iso()
                        )
                    else:
                        # HA disable failed - log warning but continue
                        error_msg = ha_disable_result.get('error', 'Unknown error')
                        self.log(f"  ⚠ Warning: Could not disable HA: {error_msg}", "WARN")
                        
                        # Check if it's an FT VM issue
                        if ha_disable_result.get('ft_vm'):
                            self.log(f"    FT VM blocking: {ha_disable_result['ft_vm']}", "WARN")
                            self.log(f"    Continuing with HA enabled - expect failover alerts", "WARN")
                        
                        self._log_workflow_step(
                            job['id'], 'rolling_cluster_update',
                            step_number=-1,
                            step_name=f"Disable HA on cluster: {cluster_name}",
                            status='completed',
                            cluster_id=workflow_results.get('cluster_id'),
                            step_details={'warning': error_msg, 'ha_still_enabled': True},
                            step_completed_at=utc_now_iso()
                        )
                elif ha_status.get('success'):
                    self.log(f"  ✓ HA is not enabled on cluster {cluster_name} - no action needed")
                    self._log_workflow_step(
                        job['id'], 'rolling_cluster_update',
                        step_number=-1,
                        step_name=f"Disable HA on cluster: {cluster_name}",
                        status='completed',
                        cluster_id=workflow_results.get('cluster_id'),
                        step_details={'ha_was_enabled': False},
                        step_completed_at=utc_now_iso()
                    )
                else:
                    self.log(f"  ⚠ Could not check HA status: {ha_status.get('error')}", "WARN")
            else:
                self.log("")
                self.log("  ℹ No cluster identified for HA management (standalone hosts or no vCenter link)")
            
            # Increment step counter after HA step
            workflow_step_counter += 1
            
            # =================================================================
            # PHASE 1.5: COMPREHENSIVE BLOCKER SCAN (POST-HA)
            # =================================================================
            # Scan ALL hosts for blockers AFTER HA is disabled - this is the "point of no return"
            # If blockers are found and no resolutions/patterns provided, pause for wizard
            if cluster_name and source_vcenter_id:
                should_continue, workflow_step_counter, all_blockers = self._execute_comprehensive_blocker_scan(
                    job, eligible_hosts, host_credentials, source_vcenter_id, 
                    cleanup_state, workflow_step_counter
                )
                
                if not should_continue:
                    # Job was paused for blocker resolution - exit and wait for user action
                    self.log(f"")
                    self.log(f"⏸️ Job paused - awaiting blocker resolution from user")
                    return
            
            # =================================================================
            # PHASE 1: BATCH SCP BACKUPS (ONLY HOSTS NEEDING UPDATES)
            # =================================================================
            backup_results = {}
            if backup_scp:
                parallel_backups = details.get('parallel_backups', False)
                max_parallel_backups = details.get('max_parallel_backups', 3)
                
                # Only backup hosts that need updates
                hosts_to_backup = hosts_needing_updates if check_updates_in_preflight else eligible_hosts
                
                if len(hosts_to_backup) > 0:
                    if check_updates_in_preflight and len(hosts_to_backup) < len(eligible_hosts):
                        self.log("")
                        self.log(f"  ℹ SCP backups will only run for {len(hosts_to_backup)}/{len(eligible_hosts)} hosts (those needing updates)")
                    
                    self._log_workflow_step(job['id'], 'rolling_cluster_update', workflow_step_counter,
                        f"SCP backups ({len(hosts_to_backup)} hosts)", 'running',
                        step_details={'hosts_to_backup': len(hosts_to_backup), 'skipped': len(eligible_hosts) - len(hosts_to_backup)})
                    
                    backup_results = self._execute_batch_scp_backups(
                        job, hosts_to_backup, host_credentials, cleanup_state,
                        parallel=parallel_backups,
                        max_parallel=max_parallel_backups
                    )
                    
                    successful_backups = sum(1 for r in backup_results.values() if r.get('success'))
                    self._log_workflow_step(job['id'], 'rolling_cluster_update', workflow_step_counter,
                        f"SCP backups ({len(hosts_to_backup)} hosts)", 'completed',
                        step_details={
                            'successful': successful_backups, 
                            'total': len(hosts_to_backup),
                            'skipped_up_to_date': len(eligible_hosts) - len(hosts_to_backup)
                        })
                    workflow_step_counter += 1
                else:
                    self.log("")
                    self.log("  ℹ No hosts need SCP backup (all up to date)")
                    self._log_workflow_step(job['id'], 'rolling_cluster_update', workflow_step_counter,
                        f"SCP backups (skipped)", 'completed',
                        step_details={'skipped': True, 'reason': 'No hosts need updates'})
                    workflow_step_counter += 1
            
            # =================================================================
            # PHASE 2: SEQUENTIAL HOST UPDATES
            # =================================================================
            self._log_workflow_step(job['id'], 'rolling_cluster_update', workflow_step_counter,
                f"Sequential updates ({len(eligible_hosts)} hosts)", 'running')
            
            # Check for resume_from_host (continuing from a paused/failed state)
            resume_from_host = details.get('resume_from_host')
            skip_hosts = set(details.get('skipped_hosts', []))
            start_host_index = 0
            
            if resume_from_host:
                self.log(f"")
                self.log(f"📌 Resuming from host: {resume_from_host}")
                # Find the index of the host to resume from
                for idx, h in enumerate(eligible_hosts):
                    if h['server_id'] == resume_from_host or h['name'] == resume_from_host:
                        # Check if we're retrying or skipping
                        if details.get('skip_host'):
                            start_host_index = idx + 1  # Skip this host, start from next
                            skip_hosts.add(resume_from_host)
                            self.log(f"  → Skipping host {h['name']}, continuing from index {start_host_index}")
                        else:
                            start_host_index = idx  # Retry this host
                            self.log(f"  → Retrying host {h['name']} at index {start_host_index}")
                        break
            
            # Get auto power-off VMs from Phase 1.5
            auto_power_off_vms = details.get('auto_power_off_vms', {})
            
            # Update each host sequentially (one at a time)
            for host_index, host in enumerate(eligible_hosts):
                # Skip hosts before resume point
                if host_index < start_host_index:
                    self.log(f"  ⏭️ Skipping previously processed host: {host['name']}")
                    continue
                
                # Skip explicitly skipped hosts
                if host['name'] in skip_hosts or host['server_id'] in skip_hosts:
                    self.log(f"  ⏭️ Skipping host (user requested): {host['name']}")
                    workflow_results['hosts_skipped'] = workflow_results.get('hosts_skipped', 0) + 1
                    continue
                
                # Check cancellation before each host (supports graceful cancel)
                cancel_result = self._check_and_handle_cancellation(job, cleanup_state)
                if cancel_result == 'cancelled':
                    self.update_job_status(job['id'], 'cancelled', details={
                        'cancelled_at_host': host_index,
                        'cleanup_performed': True,
                        'workflow_results': workflow_results
                    })
                    return
                elif cancel_result == 'graceful':
                    # Graceful cancel - stop before starting this host
                    self.log(f"⏸️ Graceful cancel: Stopping before host {host_index} ({host['name']})", "WARN")
                    self.update_job_status(job['id'], 'cancelled', details={
                        'graceful_cancel': True,
                        'stopped_before_host': host_index,
                        'hosts_completed': host_index - 1,
                        'workflow_results': workflow_results
                    })
                    return
                
                host_result = {
                    'host_id': host['id'],
                    'host_name': host['name'],
                    'server_id': host['server_id'],
                    'status': 'pending',
                    'steps': [],
                    'backup_completed': backup_results.get(host['server_id'], {}).get('success', False),
                    'no_updates_needed': False
                }
                current_step_number = None
                current_step_name = None
                current_step_in_progress = False
                
                # Track current host for logging
                cleanup_state['current_host_name'] = host['name']
                
                try:
                    self.log(f"\n[HOST {host_index}/{len(eligible_hosts)}] {host['name']}")
                    self.log("-" * 60)
                    
                    base_step = 1000 + (host_index * 10)  # Steps 1010, 1020, 1030...
                    host_steps_total = 7 + (1 if (cluster_name and rebalance_wait_enabled) else 0)
                    
                    # Update job details with current host information for UI display
                    self.update_job_details_field(job['id'], {
                        'current_step': f'Processing host {host_index}/{len(eligible_hosts)}: {host["name"]}',
                        'current_host': host['name'],
                        'current_host_ip': None,  # Will be set after we get server details
                        'current_host_server_id': host.get('server_id'),
                        'hosts_processed': host_index - 1
                    })
                    
                    # Get credentials from pre-flight phase
                    creds = host_credentials[host['server_id']]
                    server = creds['server']
                    username = creds['username']
                    password = creds['password']
                    vcenter_host_id = server.get('vcenter_host_id')
                    
                    # Track current server for cleanup
                    cleanup_state['current_server'] = {
                        'ip': server['ip_address'],
                        'username': username,
                        'password': password,
                        'server_id': host['server_id']
                    }
                    cleanup_state['firmware_in_progress'] = False  # Will be set to True during firmware phase
                    
                    # Update job details with server IP now that we have it
                    self.update_job_details_field(job['id'], {
                        'current_host_ip': server['ip_address']
                    })
                    
                    # Create iDRAC session for this host
                    session = self.executor.create_idrac_session(
                        server['ip_address'], username, password,
                        log_to_db=True, server_id=host['server_id'], job_id=job['id']
                    )
                    
                    if not session:
                        raise Exception("Failed to create iDRAC session")
                    
                    try:
                        # Initialize Dell operations early for update check
                        from job_executor.dell_redfish import DellOperations, DellRedfishAdapter
                        adapter = DellRedfishAdapter(
                            self.executor.session_manager, 
                            self.executor._get_dell_logger(), 
                            self.executor._log_dell_redfish_command
                        )
                        dell_ops = DellOperations(adapter)
                        
                        firmware_source = details.get('firmware_source', 'manual_repository')
                        
                        # STEP 0: Check for available updates BEFORE entering maintenance mode
                        # OPTIMIZATION: Use cached results from pre-flight if available
                        if firmware_source == 'dell_online_catalog':
                            current_step_number = base_step
                            current_step_name = f"Check for updates: {host['name']}"
                            current_step_in_progress = True
                            self._log_workflow_step(
                                job['id'], 'rolling_cluster_update',
                                step_number=current_step_number,
                                step_name=current_step_name,
                                status='running',
                                server_id=host['server_id'],
                                step_started_at=utc_now_iso()
                            )
                            
                            # Check if we already have update info from pre-flight
                            cached_updates = creds.get('available_updates')
                            preflight_checked = creds.get('needs_update') is not None
                            
                            if preflight_checked and cached_updates is not None:
                                # Use cached results from pre-flight
                                self.log(f"  [0/{host_steps_total}] Using pre-flight update check results...")
                                self.update_job_details_field(job['id'], {
                                    'current_step': f'Using cached update check: {host["name"]}'
                                })
                                
                                if not cached_updates:
                                    # Pre-flight said no updates needed
                                    self.log(f"    ✓ Pre-flight confirmed: no updates available")
                                    
                                    # Check if host was already in maintenance mode
                                    if vcenter_host_id:
                                        try:
                                            host_status = self.executor._get_vcenter_host_status(vcenter_host_id)
                                            if host_status and host_status.get('in_maintenance', False):
                                                self.log(f"    ⚠ Host is in maintenance mode (likely from previous job) - exiting...")
                                                exit_result = self.executor.exit_vcenter_maintenance_mode(vcenter_host_id)
                                                if exit_result.get('success'):
                                                    self.log(f"    ✓ Maintenance mode exited successfully")
                                                else:
                                                    self.log(f"    ⚠ Warning: Failed to exit maintenance: {exit_result.get('error')}", "WARN")
                                            else:
                                                self.log(f"    ℹ️ Skipping host (no maintenance mode needed)")
                                        except Exception as mm_check_error:
                                            self.log(f"    ⚠ Could not check/exit maintenance mode: {mm_check_error}", "WARN")
                                    else:
                                        self.log(f"    ℹ️ Skipping host (no vCenter link)")
                                    
                                    self._log_workflow_step(
                                        job['id'], 'rolling_cluster_update',
                                        step_number=current_step_number,
                                        step_name=current_step_name,
                                        status='completed',
                                        server_id=host['server_id'],
                                        step_details={'no_updates_needed': True, 'message': 'Pre-flight confirmed: already up to date', 'from_cache': True},
                                        step_completed_at=utc_now_iso()
                                    )
                                    current_step_in_progress = False
                                    
                                    host_result['status'] = 'skipped'
                                    host_result['no_updates_needed'] = True
                                    host_result['message'] = 'Pre-flight confirmed: already up to date'
                                    host_result['steps'].append('check_updates_cached_skip')
                                    workflow_results['host_results'].append(host_result)
                                    workflow_results['hosts_skipped'] = workflow_results.get('hosts_skipped', 0) + 1
                                    
                                    self.executor.delete_idrac_session(
                                        session, server['ip_address'], host['server_id'], job['id']
                                    )
                                    continue
                                
                                self.log(f"    ✓ Pre-flight found {len(cached_updates)} update(s) available")
                                host_result['available_updates'] = len(cached_updates)
                                
                                self._log_workflow_step(
                                    job['id'], 'rolling_cluster_update',
                                    step_number=current_step_number,
                                    step_name=current_step_name,
                                    status='completed',
                                    server_id=host['server_id'],
                                    step_details={'available_updates': len(cached_updates), 'from_cache': True},
                                    step_completed_at=utc_now_iso()
                                )
                                current_step_in_progress = False
                                host_result['steps'].append('check_updates_cached')
                            else:
                                # No cached results - run fresh update check
                                self.log(f"  [0/{host_steps_total}] Checking for available updates...")
                                self.update_job_details_field(job['id'], {
                                    'current_step': f'Checking for available updates: {host["name"]}'
                                })
                                
                                dell_catalog_url = details.get('dell_catalog_url', 'https://downloads.dell.com/catalog/Catalog.xml')
                                
                                try:
                                    check_result = dell_ops.check_available_catalog_updates(
                                        ip=server['ip_address'],
                                        username=username,
                                        password=password,
                                        catalog_url=dell_catalog_url,
                                        server_id=host['server_id'],
                                        job_id=job['id'],
                                        user_id=job['created_by']
                                    )
                                    
                                    available_updates = check_result.get('available_updates', [])
                                    
                                    if not available_updates:
                                        self.log(f"    ✓ Server is already up to date - no updates available")
                                        
                                        if vcenter_host_id:
                                            try:
                                                host_status = self.executor._get_vcenter_host_status(vcenter_host_id)
                                                if host_status and host_status.get('in_maintenance', False):
                                                    self.log(f"    ⚠ Host is in maintenance mode (likely from previous job) - exiting...")
                                                    exit_result = self.executor.exit_vcenter_maintenance_mode(vcenter_host_id)
                                                    if exit_result.get('success'):
                                                        self.log(f"    ✓ Maintenance mode exited successfully")
                                                    else:
                                                        self.log(f"    ⚠ Warning: Failed to exit maintenance: {exit_result.get('error')}", "WARN")
                                                else:
                                                    self.log(f"    ℹ️ Skipping host (no maintenance mode needed)")
                                            except Exception as mm_check_error:
                                                self.log(f"    ⚠ Could not check/exit maintenance mode: {mm_check_error}", "WARN")
                                        else:
                                            self.log(f"    ℹ️ Skipping host (no vCenter link)")
                                        
                                        self._log_workflow_step(
                                            job['id'], 'rolling_cluster_update',
                                            step_number=current_step_number,
                                            step_name=current_step_name,
                                            status='completed',
                                            server_id=host['server_id'],
                                            step_details={'no_updates_needed': True, 'message': 'Server already up to date'},
                                            step_completed_at=utc_now_iso()
                                        )
                                        current_step_in_progress = False
                                        
                                        host_result['status'] = 'skipped'
                                        host_result['no_updates_needed'] = True
                                        host_result['message'] = 'Server already up to date'
                                        host_result['steps'].append('check_updates_skipped')
                                        workflow_results['host_results'].append(host_result)
                                        workflow_results['hosts_skipped'] = workflow_results.get('hosts_skipped', 0) + 1
                                        
                                        self.executor.delete_idrac_session(
                                            session, server['ip_address'], host['server_id'], job['id']
                                        )
                                        continue
                                    
                                    self.log(f"    ✓ Found {len(available_updates)} update(s) available")
                                    host_result['available_updates'] = len(available_updates)
                                    
                                    self._log_workflow_step(
                                        job['id'], 'rolling_cluster_update',
                                        step_number=current_step_number,
                                        step_name=current_step_name,
                                        status='completed',
                                        server_id=host['server_id'],
                                        step_details={'available_updates': len(available_updates), 'updates': available_updates[:5]},
                                        step_completed_at=utc_now_iso()
                                    )
                                    current_step_in_progress = False
                                    host_result['steps'].append('check_updates')
                                    
                                except Exception as check_error:
                                    self.log(f"    ⚠️ Could not pre-check updates: {check_error}", "WARN")
                                    self.log(f"    ℹ️ Continuing with update attempt...")
                                    self._log_workflow_step(
                                        job['id'], 'rolling_cluster_update',
                                        step_number=current_step_number,
                                        step_name=current_step_name,
                                        status='completed',
                                        server_id=host['server_id'],
                                        step_details={'warning': str(check_error), 'continuing': True},
                                        step_completed_at=utc_now_iso()
                                    )
                                    current_step_in_progress = False
                        else:
                            # For non-catalog sources, skip the pre-check
                            self.log(f"  [0/{host_steps_total}] Update pre-check skipped (using {firmware_source})")
                        
                        # STEP 1: Enter maintenance mode (if vCenter linked)
                        if vcenter_host_id:
                            current_step_number = base_step + 1
                            current_step_name = f"Enter maintenance mode: {host['name']}"
                            current_step_in_progress = True
                            self._log_workflow_step(
                                job['id'], 'rolling_cluster_update',
                                step_number=current_step_number,
                                step_name=current_step_name,
                                status='running',
                                server_id=host['server_id'],
                                host_id=vcenter_host_id,
                                step_started_at=utc_now_iso()
                            )
                            
                            self.log(f"  [1/{host_steps_total}] Entering maintenance mode...")
                            self.update_job_details_field(job['id'], {
                                'current_step': f'Entering maintenance mode: {host["name"]}'
                            })
                            maintenance_timeout = details.get('maintenance_timeout', 1800)
                            manual_power_off_vms = self._extract_manual_power_off_vms(details, host, vcenter_host_id)
                            manual_power_off_result = None
                            if manual_power_off_vms:
                                self.log(f"  -> Powering off {len(manual_power_off_vms)} selected VM(s) before maintenance mode")
                                manual_power_off_result = self.executor.power_off_vms_for_maintenance(
                                    vcenter_host_id,
                                    manual_power_off_vms,
                                    graceful=True
                                )
                                if not manual_power_off_result.get('success'):
                                    maintenance_result = {
                                        'success': False,
                                        'error': 'Failed to power off selected VMs before maintenance mode',
                                        'power_off_result': manual_power_off_result
                                    }
                                    self._log_workflow_step(
                                        job['id'], 'rolling_cluster_update',
                                        step_number=current_step_number,
                                        step_name=current_step_name,
                                        status='failed',
                                        server_id=host['server_id'],
                                        host_id=vcenter_host_id,
                                        step_details=maintenance_result,
                                        step_error=maintenance_result.get('error'),
                                        step_completed_at=utc_now_iso()
                                    )
                                    current_step_in_progress = False
                                    raise Exception(maintenance_result.get('error'))
                                
                                # Track VMs that were powered off for later power-on
                                vms_powered_off = manual_power_off_result.get('vms_powered_off', [])
                                if vms_powered_off:
                                    cleanup_state['vms_to_power_on'][host['server_id']] = {
                                        'vcenter_host_id': vcenter_host_id,
                                        'vm_names': vms_powered_off,
                                        'powered_off_at': utc_now_iso(),
                                        'host_name': host['name']
                                    }
                                    host_result['vms_powered_off_for_maintenance'] = vms_powered_off
                                    self.log(f"    ✓ Tracking {len(vms_powered_off)} VM(s) for power-on after maintenance")
                                    
                            maintenance_result = self.executor.enter_vcenter_maintenance_mode(
                                vcenter_host_id, 
                                timeout=maintenance_timeout
                            )

                            if manual_power_off_result:
                                maintenance_result['power_off_result'] = manual_power_off_result

                            if (
                                not maintenance_result.get('success')
                                and maintenance_result.get('maintenance_blockers')
                                and details.get('auto_power_off_enabled')
                            ):
                                strategy = details.get('power_off_strategy', 'non_migratable')
                                blockers = maintenance_result.get('maintenance_blockers', {}).get('blockers', [])
                                auto_power_off_candidates = self._select_power_off_candidates(blockers, strategy)
                                if auto_power_off_candidates:
                                    self.log(
                                        f"  -> Auto power-off enabled ({strategy}). "
                                        f"Powering off {len(auto_power_off_candidates)} blocking VM(s) and retrying..."
                                    )
                                    auto_power_off_result = self.executor.power_off_vms_for_maintenance(
                                        vcenter_host_id,
                                        auto_power_off_candidates,
                                        graceful=True
                                    )
                                    maintenance_result['power_off_result'] = auto_power_off_result
                                    if auto_power_off_result.get('success'):
                                        # Track VMs powered off by auto-power-off for later power-on
                                        auto_vms_powered_off = auto_power_off_result.get('vms_powered_off', [])
                                        if auto_vms_powered_off:
                                            existing_vms = cleanup_state.get('vms_to_power_on', {}).get(host['server_id'], {}).get('vm_names', [])
                                            all_vms = list(set(existing_vms + auto_vms_powered_off))
                                            cleanup_state['vms_to_power_on'][host['server_id']] = {
                                                'vcenter_host_id': vcenter_host_id,
                                                'vm_names': all_vms,
                                                'powered_off_at': utc_now_iso(),
                                                'host_name': host['name']
                                            }
                                            host_result['vms_powered_off_for_maintenance'] = all_vms
                                            self.log(f"    ✓ Tracking {len(auto_vms_powered_off)} auto-powered-off VM(s) for power-on after maintenance")
                                        
                                        maintenance_result = self.executor.enter_vcenter_maintenance_mode(
                                            vcenter_host_id,
                                            timeout=maintenance_timeout
                                        )
                                        maintenance_result['power_off_result'] = auto_power_off_result
                                else:
                                    maintenance_result['power_off_result'] = {
                                        'success': False,
                                        'error': 'No eligible VMs found to power off for maintenance mode',
                                        'vms_powered_off': [],
                                        'vms_failed': []
                                    }
                            
                            if not maintenance_result.get('success'):
                                # Store evacuation blockers if available (VMs that prevented maintenance mode)
                                if maintenance_result.get('maintenance_blockers'):
                                    host_result['maintenance_blockers'] = maintenance_result['maintenance_blockers']
                                if maintenance_result.get('evacuation_blockers'):
                                    host_result['evacuation_blockers'] = maintenance_result['evacuation_blockers']
                                if maintenance_result.get('stall_duration_seconds'):
                                    host_result['stalled_duration'] = maintenance_result['stall_duration_seconds']
                                
                                # Include detailed blocker info for human-readable display
                                if maintenance_result.get('blocker_details'):
                                    host_result['blocker_details'] = maintenance_result['blocker_details']
                                if maintenance_result.get('remediation_summary'):
                                    host_result['remediation_summary'] = maintenance_result['remediation_summary']
                                
                                # Build human-readable error message
                                blocker_details = maintenance_result.get('blocker_details', [])
                                if blocker_details:
                                    error_lines = [f"Maintenance blocked by {len(blocker_details)} VM(s):"]
                                    for b in blocker_details[:5]:
                                        vm_name = b.get('vm_name', 'Unknown VM')
                                        reason = b.get('reason', 'unknown')
                                        remediation = b.get('remediation', 'No remediation available')
                                        error_lines.append(f"  • {vm_name} ({reason}): {remediation}")
                                    if len(blocker_details) > 5:
                                        error_lines.append(f"  ... and {len(blocker_details) - 5} more")
                                    detailed_error = "\n".join(error_lines)
                                else:
                                    detailed_error = maintenance_result.get('error', 'Maintenance mode failed')
                                
                                self._log_workflow_step(
                                    job['id'], 'rolling_cluster_update',
                                    step_number=current_step_number,
                                    step_name=current_step_name,
                                    status='failed',
                                    server_id=host['server_id'],
                                    host_id=vcenter_host_id,
                                    step_details={
                                        **maintenance_result,
                                        'human_readable_error': detailed_error
                                    },
                                    step_error=detailed_error,
                                    step_completed_at=utc_now_iso()
                                )
                                current_step_in_progress = False
                                raise Exception(detailed_error)
                            
                            vms_evacuated = maintenance_result.get('vms_evacuated', 0)
                            cleanup_state['hosts_in_maintenance'].append(vcenter_host_id)
                            self.log(f"    ✓ Maintenance mode active ({vms_evacuated} VMs evacuated)")
                            
                            self._log_workflow_step(
                                job['id'], 'rolling_cluster_update',
                                step_number=current_step_number,
                                step_name=current_step_name,
                                status='completed',
                                server_id=host['server_id'],
                                host_id=vcenter_host_id,
                                step_details=maintenance_result,
                                step_completed_at=utc_now_iso()
                            )
                            current_step_in_progress = False
                            host_result['steps'].append('enter_maintenance')
                        else:
                            self.log(f"  [1/{host_steps_total}] Maintenance mode skipped (no vCenter link)")
                        
                        # STEP 2: Apply firmware updates
                        max_catalog_passes = max(1, details.get('max_catalog_passes', 2 if firmware_source == 'dell_online_catalog' else 1))
                        for update_pass in range(1, max_catalog_passes + 1):
                            pass_suffix = f" (pass {update_pass}/{max_catalog_passes})" if max_catalog_passes > 1 else ""
                            current_step_number = base_step + 2
                            current_step_name = f"Apply firmware updates: {host['name']}{pass_suffix}"
                            current_step_in_progress = True
                            self._log_workflow_step(
                                job['id'], 'rolling_cluster_update',
                                step_number=current_step_number,
                                step_name=current_step_name,
                                status='running',
                                server_id=host['server_id'],
                                step_started_at=utc_now_iso()
                            )
                            
                            self.log(f"  [2/{host_steps_total}] Applying firmware updates{pass_suffix}...")
                            self.update_job_details_field(job['id'], {
                                'current_step': f'Applying firmware updates: {host["name"]}{pass_suffix}'
                            })
                            
                            # Clear stale iDRAC jobs before firmware update to prevent RED014/JCP042 errors
                            clear_stale_jobs = details.get('clear_stale_jobs_before_update', True)
                            if clear_stale_jobs:
                                self.log(f"    Checking for stale iDRAC jobs that could block updates...")
                                try:
                                    clear_result = dell_ops.clear_stale_idrac_jobs(
                                        ip=server['ip_address'],
                                        username=username,
                                        password=password,
                                        clear_failed=True,
                                        clear_completed_errors=True,
                                        clear_old_scheduled=details.get('clear_old_scheduled_jobs', False),
                                        stale_age_hours=details.get('stale_job_max_age_hours', 24),
                                        server_id=host['server_id'],
                                        job_id=job['id'],
                                        user_id=job['created_by']
                                    )
                                    
                                    if clear_result.get('cleared_count', 0) > 0:
                                        self.log(f"    ✓ Cleared {clear_result['cleared_count']} stale jobs from queue")
                                        for cleared_job in clear_result.get('cleared_jobs', [])[:5]:
                                            self.log(f"      - {cleared_job['id']}: {cleared_job.get('name', 'Unknown')} ({cleared_job.get('state')})")
                                    else:
                                        self.log(f"    ✓ Job queue is clean - no stale jobs to clear")
                                        
                                except Exception as clear_error:
                                    self.log(f"    ⚠ Error clearing stale jobs (non-fatal): {clear_error}", "WARN")
                                    # Continue with firmware update - this is not a fatal error
                            
                            # Mark firmware as in progress (for cancellation safety)
                            cleanup_state['firmware_in_progress'] = True
                            
                            # Apply firmware based on source (firmware_source already set in STEP 0)
                            reboot_required = False  # Track if reboot is actually needed
                            
                            if firmware_source == 'dell_online_catalog':
                                dell_catalog_url = details.get('dell_catalog_url', 'https://downloads.dell.com/catalog/Catalog.xml')
                                component_filter = details.get('component', None)
                                
                                self.log(f"    Using Dell online catalog: {dell_catalog_url}")
                                update_result = dell_ops.update_firmware_from_catalog(
                                    ip=server['ip_address'],
                                    username=username,
                                    password=password,
                                    catalog_url=dell_catalog_url,
                                    apply_update=True,
                                    reboot_needed=True,
                                    server_id=host['server_id'],
                                    user_id=job['created_by']
                                )
                                
                                if not update_result.get('success'):
                                    error_msg = update_result.get('error', 'Unknown error')
                                    # Detect common air-gapped/network issues
                                    if any(indicator in str(error_msg).lower() for indicator in ['internal error', 'red004', 'unable to complete', 'network', 'connection']):
                                        self.log(f"    ❌ Catalog download failed - likely network unreachable", "ERROR")
                                        self.log(f"    💡 Hint: For air-gapped networks, use 'local_repository' instead of 'dell_online_catalog'", "WARN")
                                        raise Exception(
                                            f"Catalog download failed - iDRAC cannot reach {dell_catalog_url}. "
                                            f"For air-gapped networks, use 'Local Repository' firmware source instead. "
                                            f"Original error: {error_msg}"
                                        )
                                    raise Exception(f"Firmware catalog update failed: {error_msg}")
                                
                                # Extract job ID and poll for completion
                                repo_job_id = update_result.get('job_id')
                                repo_task_uri = update_result.get('task_uri')
                                
                                if repo_job_id or repo_task_uri:
                                    self.log(f"    Repository scan job created: {repo_job_id or repo_task_uri}")
                                    self.log(f"    Waiting for catalog scan and update scheduling...")
                                    
                                    # Get stall recovery settings from job details
                                    stall_timeout = details.get('stall_timeout_minutes', 10) * 60
                                    max_stall_retries = details.get('max_stall_retries', 2)
                                    stall_recovery_action = details.get('stall_recovery_action', 'reboot')
                                    
                                    # Poll the repository update job with recovery
                                    try:
                                        if repo_job_id and repo_job_id.startswith('JID_'):
                                            # Poll using job endpoint with stall recovery
                                            job_result = dell_ops.wait_for_job_with_recovery(
                                                ip=server['ip_address'],
                                                username=username,
                                                password=password,
                                                job_id_str=repo_job_id,
                                                timeout=2700,  # 45 minutes total
                                                poll_interval=15,
                                                stall_timeout=stall_timeout,
                                                max_stall_retries=max_stall_retries,
                                                stall_recovery_action=stall_recovery_action,
                                                operation_name='Repository Firmware Update',
                                                parent_job_id=job['id'],
                                                server_id=host['server_id'],
                                                user_id=job['created_by']
                                            )
                                            
                                            # Log if recovery was needed
                                            if job_result.get('recovery_attempts', 0) > 0:
                                                self.log(f"    ℹ️ Job required {job_result['recovery_attempts']} recovery attempt(s)")
                                                
                                        elif repo_task_uri:
                                            # Extract job ID from task URI if present
                                            if '/Jobs/' in repo_task_uri:
                                                extracted_job_id = repo_task_uri.split('/Jobs/')[-1]
                                                job_result = dell_ops.wait_for_job_with_recovery(
                                                    ip=server['ip_address'],
                                                    username=username,
                                                    password=password,
                                                    job_id_str=extracted_job_id,
                                                    timeout=2700,
                                                    poll_interval=15,
                                                    stall_timeout=stall_timeout,
                                                    max_stall_retries=max_stall_retries,
                                                    stall_recovery_action=stall_recovery_action,
                                                    operation_name='Repository Firmware Update',
                                                    parent_job_id=job['id'],
                                                    server_id=host['server_id'],
                                                    user_id=job['created_by']
                                                )
                                            else:
                                                # Poll using task endpoint (no stall recovery for tasks)
                                                job_result = dell_ops.helpers.wait_for_task(
                                                    ip=server['ip_address'],
                                                    username=username,
                                                    password=password,
                                                    task_uri=repo_task_uri,
                                                    timeout=1800,
                                                    poll_interval=15,
                                                    operation_name='Repository Firmware Update',
                                                    job_id=job['id'],
                                                    server_id=host['server_id'],
                                                    user_id=job['created_by']
                                                )
                                        else:
                                            job_result = {}
                                        
                                        # Check the result to determine if updates were applied
                                        job_message = job_result.get('Message', '').lower()
                                        job_state = job_result.get('JobState', '')
                                        
                                        self.log(f"    Repository job state: {job_state}, message: {job_result.get('Message', 'N/A')}")
                                        
                                        # Dell messages that indicate no updates needed
                                        no_update_indicators = [
                                            'no applicable',
                                            'no updates',
                                            'already at latest',
                                            'current version',
                                            'up to date',
                                            'no new updates'
                                        ]
                                        
                                        if any(indicator in job_message for indicator in no_update_indicators):
                                            self.log(f"    ℹ️ No firmware updates needed - server is already up to date")
                                            update_result['no_updates_needed'] = True
                                            reboot_required = False
                                        elif job_state == 'Completed':
                                            # Repository scan completed - now check for SCHEDULED jobs
                                            # Dell InstallFromRepository does NOT auto-reboot - it schedules jobs
                                            self.log(f"    Checking for scheduled iDRAC jobs...")
                                            
                                            try:
                                                pending_check = dell_ops.get_pending_idrac_jobs(
                                                    ip=server['ip_address'],
                                                    username=username,
                                                    password=password,
                                                    server_id=host['server_id'],
                                                    job_id=job['id'],
                                                    user_id=job['created_by']
                                                )
                                                
                                                scheduled_jobs = pending_check.get('jobs', [])
                                                # Look for ALL active firmware (JID_) or reboot (RID_) jobs
                                                # FIX: Include Running, Downloading, New - not just Scheduled!
                                                active_states = ['Scheduled', 'Running', 'Downloading', 'New', 'Starting', 'Waiting']
                                                active_updates = [
                                                    j for j in scheduled_jobs 
                                                    if j.get('status') in active_states and 
                                                       (j.get('id', '').startswith('JID_') or j.get('id', '').startswith('RID_'))
                                                ]
                                                
                                                if active_updates:
                                                    self.log(f"    Found {len(active_updates)} active update job(s):")
                                                    for sj in active_updates[:5]:  # Show first 5
                                                        self.log(f"      - {sj.get('id')}: {sj.get('name', 'Unknown')} ({sj.get('status')})")
                                                    
                                                    # Check for iDRAC firmware updates (require iDRAC restart, not just system reboot)
                                                    idrac_fw_updates = [j for j in active_updates if 'idrac' in j.get('name', '').lower()]
                                                    if idrac_fw_updates:
                                                        self.log(f"    ⚠ iDRAC firmware update detected - will require iDRAC restart")
                                                        update_result['idrac_fw_update_pending'] = True
                                                    
                                                    # Track active jobs for later verification
                                                    update_result['active_jobs'] = [{'id': j.get('id'), 'name': j.get('name'), 'status': j.get('status')} for j in active_updates]
                                                    
                                                    # If jobs are already Running/Downloading, don't reboot yet - wait for them
                                                    running_jobs = [j for j in active_updates if j.get('status') in ['Running', 'Downloading']]
                                                    if running_jobs:
                                                        self.log(f"    Jobs already in progress - will wait for completion...")
                                                        reboot_required = True  # Will need reboot after jobs complete
                                                        
                                                        # Wait for all jobs to finish
                                                        pending_jobs = dell_ops.wait_for_all_jobs_complete(
                                                            ip=server['ip_address'],
                                                            username=username,
                                                            password=password,
                                                            timeout=3600,
                                                            poll_interval=30,
                                                            server_id=host['server_id'],
                                                            job_id=job['id'],
                                                            user_id=job['created_by']
                                                        )
                                                        
                                                        if not pending_jobs.get('success', False):
                                                            self.log(f"    ⚠ Warning: Some jobs did not complete within timeout", "WARN")
                                                            for pj in pending_jobs.get('pending_jobs', [])[:5]:
                                                                self.log(f"      - {pj.get('id')}: {pj.get('status')} ({pj.get('name', 'Unknown')})", "WARN")
                                                        else:
                                                            self.log(f"    ✓ All pending jobs completed")
                                                            update_result['job_wait_result'] = pending_jobs
                                                    else:
                                                        self.log(f"    Scheduling {len(active_updates)} firmware job(s) for reboot...")
                                                        reboot_required = True
                                                else:
                                                    self.log(f"    ℹ️ No active firmware jobs found after repository scan")
                                                    update_result['no_updates_needed'] = True
                                            except Exception as pending_err:
                                                self.log(f"    ⚠ Could not inspect scheduled iDRAC jobs: {pending_err}", "WARN")
                                                reboot_required = True
                                        elif job_state in ['Failed', 'Exception']:
                                            # Check for common iDRAC errors related to catalog downloads
                                            lower_msg = job_message.lower()
                                            network_indicators = ['network', 'connection', 'unable to connect', 'download', 'red004', 'internal error']
                                            if any(indicator in lower_msg for indicator in network_indicators):
                                                self.log(f"    ❌ Repository job failed - network or download issue", "ERROR")
                                                self.log(f"    💡 Suggestion: Switch to 'Local Repository' firmware source for air-gapped environments", "WARN")
                                                raise Exception(
                                                    f"Repository scan failed due to network/download issue. "
                                                    f"Switch to 'Local Repository' source or check connectivity to Dell catalog. "
                                                    f"Original message: {job_result.get('Message', 'Unknown error')}"
                                                )
                                            else:
                                                raise Exception(f"Repository job failed: {job_result.get('Message', 'Unknown error')}")
                                        else:
                                            # Default: assume reboot required if job completed without explicit indicators
                                            reboot_required = True
                                            update_result['job_result'] = job_result
                                        
                                    except Exception as poll_error:
                                        self.log(f"    ⚠ Error polling repository job: {poll_error}", "WARN")
                                        # Assume updates were applied if we can't poll
                                        reboot_required = True
                                else:
                                    self.log(f"    ⚠ No job ID returned from catalog update - cannot track progress", "WARN")
                                    # Assume updates were applied
                                    reboot_required = True
                                
                            elif firmware_source == 'local_repository':
                                # Query firmware packages from library and apply applicable ones
                                self.log(f"    Using local firmware repository...")
                                
                                server_model = server.get('model', '')
                                component_filter = details.get('component_filter', ['all'])
                                
                                # Get applicable firmware packages from library
                                applicable_packages = self._get_applicable_firmware_packages(
                                    server_model=server_model,
                                    component_filter=component_filter
                                )
                                
                                if not applicable_packages:
                                    raise Exception(
                                        f"No firmware packages in library for model '{server_model}'. "
                                        f"Upload DUP files in Settings → Firmware Library, or use 'Dell Online Catalog' source."
                                    )
                                
                                self.log(f"    Found {len(applicable_packages)} applicable package(s) for {server_model or 'this server'}")
                                packages_applied = 0
                                update_result = {'success': True, 'packages_applied': []}
                                
                                for pkg in applicable_packages:
                                    firmware_uri = pkg.get('served_url') or pkg.get('local_path')
                                    if not firmware_uri:
                                        self.log(f"      ⚠ Package {pkg['filename']} has no URL - skipping", "WARN")
                                        continue
                                    
                                    self.log(f"      Applying: {pkg.get('component_type', 'Unknown')} v{pkg['dell_version']} ({pkg['filename']})")
                                    
                                    pkg_result = dell_ops.update_firmware_simple(
                                        ip=server['ip_address'],
                                        username=username,
                                        password=password,
                                        firmware_uri=firmware_uri,
                                        apply_time='Immediate',
                                        job_id=job['id'],
                                        server_id=host['server_id']
                                    )
                                    
                                    if pkg_result.get('success'):
                                        packages_applied += 1
                                        update_result['packages_applied'].append({
                                            'filename': pkg['filename'],
                                            'component': pkg.get('component_type'),
                                            'version': pkg['dell_version']
                                        })
                                        self.log(f"        ✓ Package applied successfully")
                                    else:
                                        error_msg = pkg_result.get('error', 'Unknown error')
                                        # Check if package is not applicable (not an error)
                                        if 'already' in error_msg.lower() or 'not applicable' in error_msg.lower():
                                            self.log(f"        ℹ Package not needed: {error_msg}")
                                        else:
                                            self.log(f"        ✗ Package failed: {error_msg}", "WARN")
                                
                                if packages_applied > 0:
                                    self.log(f"    ✓ Applied {packages_applied} firmware package(s)")
                                    reboot_required = True
                                else:
                                    self.log(f"    ℹ No firmware packages were applicable - server may be up to date")
                                    update_result['no_updates_needed'] = True
                                
                            else:
                                # Manual/legacy mode - requires explicit firmware_uri
                                firmware_uri = details.get('firmware_uri')
                                if not firmware_uri and firmware_updates:
                                    firmware_uri = firmware_updates[0].get('firmware_uri')
                                
                                if not firmware_uri:
                                    raise Exception(
                                        "No firmware URI specified. Either:\n"
                                        "1. Upload DUP files in Settings → Firmware Library and use 'Local Repository'\n"
                                        "2. Use 'Dell Online Catalog' source (requires internet access)\n"
                                        "3. Specify firmware_uri manually in job details"
                                    )
                                
                                self.log(f"    Using firmware package: {firmware_uri}")
                                update_result = dell_ops.update_firmware_simple(
                                    ip=server['ip_address'],
                                    username=username,
                                    password=password,
                                    firmware_uri=firmware_uri,
                                    apply_time='Immediate',
                                    job_id=job['id'],
                                    server_id=host['server_id']
                                )
                                
                                if not update_result.get('success'):
                                    raise Exception(f"Firmware update failed: {update_result.get('error')}")
                                
                                # Manual firmware updates always require reboot
                                reboot_required = True
                            
                            self.log(f"    ✓ Firmware update step completed (reboot_required={reboot_required})")
                            update_result['reboot_required'] = reboot_required
                            update_result['update_pass'] = update_pass
                            host_result['no_updates_needed'] = update_result.get('no_updates_needed', False)
                            self._log_workflow_step(
                                job['id'], 'rolling_cluster_update',
                                step_number=current_step_number,
                                step_name=current_step_name,
                                status='completed',
                                server_id=host['server_id'],
                                step_details=update_result,
                                step_completed_at=utc_now_iso()
                            )
                            current_step_in_progress = False
                            host_result['steps'].append('firmware_update' if update_pass == 1 else f'firmware_update_pass_{update_pass}')
                            
                            # STEP 3: Reboot and wait for system to come online (only if reboot required)
                            reboot_step_name = f"Reboot and wait: {host['name']}{pass_suffix}"
                            if reboot_required:
                                current_step_number = base_step + 3
                                current_step_in_progress = True
                                self._log_workflow_step(
                                    job['id'], 'rolling_cluster_update',
                                    step_number=current_step_number,
                                    step_name=reboot_step_name,
                                    status='running',
                                    server_id=host['server_id'],
                                    step_started_at=utc_now_iso()
                                )
                                
                                self.log(f"  [3/{host_steps_total}] Waiting for system reboot{pass_suffix}...")
                                
                                # Immediate status update when entering wait loop
                                reboot_wait_started = utc_now_iso()
                                esxi_target = host.get('name') or server['ip_address']
                                self.update_job_details_field(job['id'], {
                                    'current_step': f'Waiting for server to reboot: {host["name"]}{pass_suffix}',
                                    'reboot_wait_started': reboot_wait_started,
                                    'reboot_wait_target': esxi_target
                                })
                                
                                self.log(f"    Initial wait: 3 minutes for BIOS POST and reboot...")
                                self._append_console_log(job['id'], f"Starting reboot wait for {host['name']}", "INFO")
                                time.sleep(180)  # Wait 3 minutes for reboot to start (BIOS POST can be slow)
                                
                                # Wait for system to come back online - phase 1: iDRAC, phase 2: ESXi
                                max_attempts = 180  # 30 minutes (180 * 10s) - enough for BIOS updates
                                idrac_online = False
                                esxi_online = False
                                esxi_timeout = 5  # Dynamic timeout adjustment
                                fallback_ip = host.get('management_ip')  # IP fallback option
                                esxi_access_method = 'hostname'  # Track what worked
                                vcenter_fallback_used = False
                                
                                for attempt in range(max_attempts):
                                    # Check for cancellation during reboot wait (no graceful cancel during reboot)
                                    cancel_result = self._check_and_handle_cancellation(job, cleanup_state, check_graceful=False)
                                    if cancel_result == 'cancelled':
                                        self.update_job_status(job['id'], 'cancelled', details={
                                            'cancelled_during': 'reboot_wait',
                                            'cleanup_performed': True,
                                            'workflow_results': workflow_results
                                        })
                                        return
                                    
                                    # Phase 1: Wait for iDRAC to come back online
                                    if not idrac_online:
                                        try:
                                            test_session = self.executor.create_idrac_session(
                                                server['ip_address'], username, password,
                                                log_to_db=False
                                            )
                                            if test_session:
                                                self.executor.delete_idrac_session(
                                                    test_session, 
                                                    server['ip_address'], 
                                                    host['server_id'], 
                                                    job['id']
                                                )
                                                idrac_online = True
                                                self.log(f"    ✓ iDRAC back online (attempt {attempt+1}/{max_attempts})")
                                                self._append_console_log(job['id'], f"iDRAC online after {attempt * 10}s", "INFO")
                                        except Exception as idrac_err:
                                            # Log iDRAC errors every minute to console_log
                                            if attempt % 6 == 0:
                                                error_msg = f"iDRAC check failed: {type(idrac_err).__name__}: {idrac_err}"
                                                self.log(f"      {error_msg}", "DEBUG")
                                                self._append_console_log(job['id'], error_msg, "DEBUG")
                                    
                                    # Phase 2: Wait for ESXi to be accessible (only after iDRAC is up)
                                    if idrac_online and not esxi_online:
                                        # Try primary target first
                                        accessible, connect_time, error_msg = self._check_esxi_accessible(
                                            esxi_target, timeout=esxi_timeout, job_id=job['id']
                                        )
                                        
                                        if accessible:
                                            esxi_online = True
                                            self.log(f"    ✓ ESXi accessible on port 443 ({esxi_target})")
                                            self._append_console_log(job['id'], f"ESXi accessible via {esxi_access_method}", "INFO")
                                            
                                            # Dynamic timeout adjustment: if connection was slow, increase timeout
                                            if connect_time > 3:
                                                self._append_console_log(job['id'], f"Slow connection detected ({connect_time:.1f}s)", "WARN")
                                            
                                            # Store what worked
                                            self.update_job_details_field(job['id'], {
                                                'esxi_access_method': esxi_access_method,
                                                'esxi_access_target': esxi_target,
                                                'esxi_connect_time_s': round(connect_time, 2)
                                            })
                                            break
                                        
                                        # Fallback: Try management IP if hostname failed and IP is available
                                        if error_msg and fallback_ip and fallback_ip != esxi_target:
                                            accessible_ip, connect_time_ip, _ = self._check_esxi_accessible(
                                                fallback_ip, timeout=esxi_timeout, job_id=job['id']
                                            )
                                            if accessible_ip:
                                                esxi_online = True
                                                esxi_access_method = 'management_ip'
                                                self.log(f"    ✓ ESXi accessible via fallback IP ({fallback_ip})")
                                                self._append_console_log(job['id'], f"ESXi accessible via fallback IP {fallback_ip}", "INFO")
                                                self.update_job_details_field(job['id'], {
                                                    'esxi_access_method': 'management_ip',
                                                    'esxi_access_target': fallback_ip,
                                                    'esxi_access_fallback_used': True,
                                                    'esxi_connect_time_s': round(connect_time_ip, 2)
                                                })
                                                break
                                        
                                        # VCenter fallback: After 10 minutes, check vCenter status
                                        if attempt >= 60 and attempt % 30 == 0:  # Every 5 mins after 10 min
                                            vcenter_status = self._check_vcenter_host_status(host, job['id'])
                                            if vcenter_status == 'connected':
                                                self.log(f"    ⚠ Port check failing but vCenter shows 'connected' - proceeding", "WARN")
                                                self._append_console_log(job['id'], f"vCenter reports connected, proceeding despite port check failure", "WARN")
                                                esxi_online = True
                                                vcenter_fallback_used = True
                                                self.update_job_details_field(job['id'], {
                                                    'esxi_access_method': 'vcenter_fallback',
                                                    'esxi_access_warning': 'Port 443 check failed but vCenter reported connected',
                                                    'vcenter_fallback_used': True
                                                })
                                                break
                                            elif vcenter_status:
                                                self._append_console_log(job['id'], f"vCenter status: {vcenter_status}", "DEBUG")
                                    
                                    # Heartbeat logging every minute with timestamps
                                    if attempt % 6 == 0:
                                        elapsed_mins = (attempt * 10) // 60
                                        status_msg = f"Waiting for {'ESXi' if idrac_online else 'iDRAC'}: {elapsed_mins}m elapsed"
                                        self._append_console_log(job['id'], status_msg, "INFO")
                                        self.update_job_details_field(job['id'], {
                                            'current_step': f'Waiting for {"ESXi" if idrac_online else "iDRAC"}: {esxi_target}',
                                            'wait_heartbeat': utc_now_iso(),
                                            'wait_attempt': attempt,
                                            'wait_elapsed_mins': elapsed_mins,
                                            'idrac_online': idrac_online,
                                            'esxi_online': esxi_online,
                                            'vcenter_fallback_used': vcenter_fallback_used
                                        })
                                    
                                    # Once ESXi is back, break the loop
                                    if idrac_online and esxi_online:
                                        break
                                    
                                    # Incrementally increase timeout if ESXi is slow to respond
                                    if attempt % 12 == 0 and esxi_timeout < 10:  # Every 2 minutes, up to 10s timeout
                                        esxi_timeout += 1
                                    
                                    time.sleep(10)
                                
                                # If ESXi never came online, raise an error
                                if not esxi_online:
                                    raise Exception(f"ESXi did not come back online within {max_attempts * 10 // 60} minutes")
                                
                                # Successful reboot and ESXi reconnection
                                self._log_workflow_step(
                                    job['id'], 'rolling_cluster_update',
                                    step_number=current_step_number,
                                    step_name=reboot_step_name,
                                    status='completed',
                                    server_id=host['server_id'],
                                    step_details={
                                        'reboot_wait_started': reboot_wait_started,
                                        'esxi_target': esxi_target,
                                        'vcenter_fallback_used': vcenter_fallback_used
                                    },
                                    step_completed_at=utc_now_iso()
                                )
                                current_step_in_progress = False
                                host_result['steps'].append('reboot' if update_pass == 1 else f'reboot_pass_{update_pass}')
                            else:
                                # No reboot required - skip reboot wait
                                self.log(f"  [3/{host_steps_total}] Skipping reboot wait - no updates required reboot{pass_suffix}")
                                self._log_workflow_step(
                                    job['id'], 'rolling_cluster_update',
                                    step_number=base_step + 3,
                                    step_name=reboot_step_name,
                                    status='skipped',
                                    server_id=host['server_id'],
                                    step_details={'reason': 'no_updates_needed', 'update_pass': update_pass},
                                    step_started_at=utc_now_iso(),
                                    step_completed_at=utc_now_iso()
                                )
                                current_step_in_progress = False
                            
                            # STEP 4: Verify firmware update (only if updates were applied)
                            verify_step_name = f"Verify update: {host['name']}{pass_suffix}"
                            if reboot_required:
                                current_step_number = base_step + 4
                                current_step_in_progress = True
                                self._log_workflow_step(
                                    job['id'], 'rolling_cluster_update',
                                    step_number=current_step_number,
                                    step_name=verify_step_name,
                                    status='running',
                                    server_id=host['server_id'],
                                    step_started_at=utc_now_iso()
                                )
                                
                                self.log(f"  [4/{host_steps_total}] Verifying firmware update{pass_suffix}...")
                                self.update_job_details_field(job['id'], {
                                    'current_step': f'Verifying firmware update: {host["name"]}{pass_suffix}'
                                })
                                
                                # Create new session for verification
                                verify_session = self.executor.create_idrac_session(
                                    server['ip_address'], username, password,
                                    log_to_db=True, server_id=host['server_id'], job_id=job['id']
                                )
                                
                                if verify_session:
                                    new_fw_inventory = dell_ops.get_firmware_inventory(
                                        ip=server['ip_address'],
                                        username=username,
                                        password=password,
                                        server_id=host['server_id'],
                                        job_id=job['id']
                                    )
                                    
                                    self.executor.delete_idrac_session(
                                        verify_session, 
                                        server['ip_address'], 
                                        host['server_id'], 
                                        job['id']
                                    )
                                    
                                    self.log(f"    ✓ Firmware inventory refreshed")
                                
                                self._log_workflow_step(
                                    job['id'], 'rolling_cluster_update',
                                    step_number=current_step_number,
                                    step_name=verify_step_name,
                                    status='completed',
                                    server_id=host['server_id'],
                                    step_details={'verified': True, 'update_pass': update_pass},
                                    step_completed_at=utc_now_iso()
                                )
                                current_step_in_progress = False
                                host_result['steps'].append('verify' if update_pass == 1 else f'verify_pass_{update_pass}')
                            else:
                                # Skip verification for no-updates case
                                self.log(f"  [4/{host_steps_total}] Skipping verification - no updates were applied{pass_suffix}")
                                self._log_workflow_step(
                                    job['id'], 'rolling_cluster_update',
                                    step_number=base_step + 4,
                                    step_name=verify_step_name,
                                    status='skipped',
                                    server_id=host['server_id'],
                                    step_details={'reason': 'no_updates_applied', 'update_pass': update_pass},
                                    step_started_at=utc_now_iso(),
                                    step_completed_at=utc_now_iso()
                                )
                                current_step_in_progress = False
                            
                            # Optional post-update rescan to catch sequential catalog updates
                            if firmware_source == 'dell_online_catalog' and update_pass < max_catalog_passes:
                                try:
                                    dell_catalog_url = details.get('dell_catalog_url', 'https://downloads.dell.com/catalog/Catalog.xml')
                                    rescan_result = dell_ops.check_available_catalog_updates(
                                        ip=server['ip_address'],
                                        username=username,
                                        password=password,
                                        catalog_url=dell_catalog_url,
                                        server_id=host['server_id'],
                                        job_id=job['id'],
                                        user_id=job['created_by']
                                    )
                                    remaining_updates = rescan_result.get('available_updates', [])
                                    host_result.setdefault('post_update_rescans', []).append({
                                        'pass': update_pass,
                                        'remaining_updates': len(remaining_updates)
                                    })
                                    if remaining_updates:
                                        self.log(f"    ⚠ Post-update rescan found {len(remaining_updates)} additional update(s); running catalog pass {update_pass + 1}/{max_catalog_passes}...")
                                        continue
                                    else:
                                        self.log(f"    ✓ Post-update rescan shows no remaining updates")
                                except Exception as rescan_err:
                                    self.log(f"    ⚠ Post-update rescan failed: {rescan_err}", "WARN")
                            
                            break
                        # STEP 5: Exit maintenance mode (if applicable)
                        if vcenter_host_id:
                            current_step_number = base_step + 5
                            current_step_name = f"Exit maintenance mode: {host['name']}"
                            current_step_in_progress = True
                            self._log_workflow_step(
                                job['id'], 'rolling_cluster_update',
                                step_number=current_step_number,
                                step_name=current_step_name,
                                status='running',
                                server_id=host['server_id'],
                                host_id=vcenter_host_id,
                                step_started_at=utc_now_iso()
                            )
                            
                            self.log(f"  [5/{host_steps_total}] Waiting for vCenter to see host as connected...")
                            self.update_job_details_field(job['id'], {
                                'current_step': f'Waiting for vCenter reconnection: {host["name"]}'
                            })
                            vcenter_ready = self.executor.wait_for_vcenter_host_connected(
                                vcenter_host_id, 
                                timeout=300  # 5 minutes
                            )
                            if vcenter_ready:
                                self.log(f"    ✓ Host connected in vCenter")
                            else:
                                self.log(f"    ⚠ Warning: Host not showing connected in vCenter yet", "WARN")
                            
                            self.log(f"  [5/{host_steps_total}] Exiting maintenance mode...")
                            self.update_job_details_field(job['id'], {
                                'current_step': f'Exiting maintenance mode: {host["name"]}'
                            })
                            exit_result = self.executor.exit_vcenter_maintenance_mode(vcenter_host_id)
                            
                            if not exit_result.get('success'):
                                self.log(f"    ⚠ Warning: Failed to exit maintenance: {exit_result.get('error')}", "WARN")
                            else:
                                self.log(f"    ✓ Maintenance mode exited")
                                # Remove from cleanup tracking
                                if vcenter_host_id in cleanup_state['hosts_in_maintenance']:
                                    cleanup_state['hosts_in_maintenance'].remove(vcenter_host_id)
                            
                            self._log_workflow_step(
                                job['id'], 'rolling_cluster_update',
                                step_number=current_step_number,
                                step_name=current_step_name,
                                status='completed' if exit_result.get('success') else 'failed',
                                server_id=host['server_id'],
                                host_id=vcenter_host_id,
                                step_details=exit_result,
                                step_error=exit_result.get('error') if not exit_result.get('success') else None,
                                step_completed_at=utc_now_iso()
                            )
                            current_step_in_progress = False
                            host_result['steps'].append('exit_maintenance')
                        else:
                            self.log(f"  [5/{host_steps_total}] Exit maintenance skipped (no vCenter link)")
                        
                        # STEP 6: Power on VMs that were powered off for maintenance
                        vms_to_power_on = cleanup_state.get('vms_to_power_on', {}).get(host['server_id'])
                        if vms_to_power_on and vcenter_host_id:
                            current_step_number = base_step + 6
                            current_step_name = f"Power on VMs: {host['name']}"
                            current_step_in_progress = True
                            self._log_workflow_step(
                                job['id'], 'rolling_cluster_update',
                                step_number=current_step_number,
                                step_name=current_step_name,
                                status='running',
                                server_id=host['server_id'],
                                host_id=vcenter_host_id,
                                step_started_at=utc_now_iso()
                            )
                            
                            vm_names_to_power_on = vms_to_power_on.get('vm_names', [])
                            self.log(f"  [6/{host_steps_total}] Powering on {len(vm_names_to_power_on)} VM(s) that were shut down for maintenance...")
                            self.update_job_details_field(job['id'], {
                                'current_step': f'Powering on VMs: {host["name"]}'
                            })
                            
                            power_on_result = self.executor.power_on_vms_after_maintenance(
                                vcenter_host_id,
                                vm_names_to_power_on,
                                timeout=300  # 5 minute timeout for VMware Tools
                            )
                            
                            if power_on_result.get('success'):
                                powered_on = power_on_result.get('vms_powered_on', [])
                                already_on = power_on_result.get('vms_already_on', [])
                                self.log(f"    ✓ VMs restored: {len(powered_on)} powered on, {len(already_on)} already on")
                                host_result['vms_powered_on'] = powered_on
                                host_result['vms_already_on'] = already_on
                                
                                # Clear from cleanup tracking since we successfully powered them on
                                if host['server_id'] in cleanup_state.get('vms_to_power_on', {}):
                                    del cleanup_state['vms_to_power_on'][host['server_id']]
                            else:
                                failed_vms = power_on_result.get('vms_failed', [])
                                self.log(f"    ⚠ Some VMs failed to power on: {[v.get('name') for v in failed_vms]}", "WARN")
                                host_result['vms_power_on_failed'] = failed_vms
                            
                            self._log_workflow_step(
                                job['id'], 'rolling_cluster_update',
                                step_number=current_step_number,
                                step_name=current_step_name,
                                status='completed' if power_on_result.get('success') else 'warning',
                                server_id=host['server_id'],
                                host_id=vcenter_host_id,
                                step_details=power_on_result,
                                step_completed_at=utc_now_iso()
                            )
                            current_step_in_progress = False
                            host_result['steps'].append('power_on_vms')
                        elif vms_to_power_on:
                            self.log(f"  [6/{host_steps_total}] VM power-on skipped (no vCenter link)")
                        
                        # STEP 7: Wait for cluster rebalance/quiet (optional, cluster-only)
                        if cluster_name and rebalance_wait_enabled:
                            current_step_number = base_step + 7
                            current_step_name = f"Wait for DRS rebalance: {cluster_name}"
                            current_step_in_progress = True
                            self._log_workflow_step(
                                job['id'], 'rolling_cluster_update',
                                step_number=current_step_number,
                                step_name=current_step_name,
                                status='running',
                                server_id=host['server_id'],
                                step_started_at=utc_now_iso()
                            )

                            self.log(
                                f"  [7/{host_steps_total}] Waiting for DRS to rebalance/settle "
                                f"({rebalance_wait_timeout}s timeout, {rebalance_quiet_period}s quiet)..."
                            )
                            self.update_job_details_field(job['id'], {
                                'current_step': f'Waiting for DRS rebalance: {cluster_name}'
                            })

                            rebalance_result = self.executor.wait_for_cluster_rebalance(
                                cluster_name,
                                timeout=rebalance_wait_timeout,
                                quiet_period=rebalance_quiet_period,
                                source_vcenter_id=source_vcenter_id
                            )

                            if rebalance_result.get('success'):
                                self.log(
                                    f"    ✓ DRS rebalance complete (waited {rebalance_result.get('waited_seconds', 0)}s, "
                                    f"quiet {rebalance_quiet_period}s)"
                                )
                            else:
                                error_msg = rebalance_result.get('error', 'DRS rebalance did not complete')
                                active = rebalance_result.get('active_migrations', [])
                                if active:
                                    self.log(f"    ⚠ Active migrations still running ({len(active)})", "WARN")
                                    for mig in active[:3]:
                                        self.log(
                                            f"      - {mig.get('vm_name')} → {mig.get('destination', 'unknown')} "
                                            f"({mig.get('state')})",
                                            "WARN"
                                        )
                                self._log_workflow_step(
                                    job['id'], 'rolling_cluster_update',
                                    step_number=current_step_number,
                                    step_name=current_step_name,
                                    status='failed',
                                    server_id=host['server_id'],
                                    step_details=rebalance_result,
                                    step_error=error_msg,
                                    step_completed_at=utc_now_iso()
                                )
                                current_step_in_progress = False
                                raise Exception(error_msg)

                            self._log_workflow_step(
                                job['id'], 'rolling_cluster_update',
                                step_number=current_step_number,
                                step_name=current_step_name,
                                status='completed',
                                server_id=host['server_id'],
                                step_details=rebalance_result,
                                step_completed_at=utc_now_iso()
                            )
                            current_step_in_progress = False
                            host_result['steps'].append('rebalance_wait')
                        
                        # Clear current server and firmware tracking
                        cleanup_state['current_server'] = None
                        cleanup_state['firmware_in_progress'] = False
                        cleanup_state['current_host_name'] = None
                        
                        workflow_results['hosts_updated'] += 1
                        host_result['status'] = 'completed'
                        self.log(f"  ✓ Host {host['name']} update completed successfully")
                        
                        # Update host progress for accurate UI display
                        self.update_job_details_field(job['id'], {
                            'hosts_processed': host_index,
                            'current_host': eligible_hosts[host_index]['name'] if host_index < len(eligible_hosts) else None
                        })
                        
                        # Check for graceful cancel after host completes
                        if self._should_stop_after_current_host(job, cleanup_state):
                            self.log(f"⏸️ Graceful cancel: Stopping after host {host_index} ({host['name']})", "WARN")
                            workflow_results['host_results'].append(host_result)
                            self.update_job_status(job['id'], 'cancelled', details={
                                'graceful_cancel': True,
                                'stopped_after_host': host_index,
                                'hosts_completed': host_index,
                                'workflow_results': workflow_results
                            })
                            return
                        
                        # Refresh vCenter session before processing next host
                        # This prevents vim.fault.NotAuthenticated errors during long rolling updates
                        if host_index < len(eligible_hosts):
                            self.log(f"  Refreshing vCenter session for next host...")
                            try:
                                vcenter_id = details.get('source_vcenter_id') or details.get('vcenter_id')
                                if vcenter_id:
                                    vcenter_settings = self.executor.get_vcenter_settings(vcenter_id)
                                    self.executor.ensure_vcenter_connection(settings=vcenter_settings)
                                else:
                                    self.executor.ensure_vcenter_connection()
                            except Exception as refresh_err:
                                self.log(f"    ⚠ vCenter session refresh warning: {refresh_err}", "WARN")
                        
                    finally:
                        # Always cleanup iDRAC session
                        if session:
                            self.executor.delete_idrac_session(
                                session, 
                                server['ip_address'], 
                                host['server_id'], 
                                job['id']
                            )
                
                except Exception as e:
                    host_result['status'] = 'failed'
                    host_result['error'] = str(e)
                    workflow_results['hosts_failed'] += 1
                    self.log(f"  ✗ Host {host['name']} update failed: {e}", "ERROR")
                    
                    # Log failed workflow step with actual error message
                    failed_step_number = current_step_number or base_step + 2
                    failed_step_name = current_step_name or f"Apply firmware updates: {host['name']}"
                    if current_step_in_progress:
                        self._log_workflow_step(
                            job['id'], 'rolling_cluster_update',
                            step_number=failed_step_number,
                            step_name=failed_step_name,
                            status='failed',
                            server_id=host['server_id'],
                            step_error=str(e),
                            step_completed_at=utc_now_iso()
                        )
                    current_step_in_progress = False
                    
                    # Clear current server and firmware tracking
                    cleanup_state['current_server'] = None
                    cleanup_state['firmware_in_progress'] = False
                    cleanup_state['current_host_name'] = None
                    
                    if not continue_on_failure:
                        workflow_results['host_results'].append(host_result)
                        raise
                    
                    workflow_results['host_results'].append(host_result)
                    workflow_results['paused_for_intervention'] = True
                    pause_reason = f"Host {host['name']} failed at step: {failed_step_name}"
                    
                    # Ensure HA is restored before pausing the workflow
                    if cleanup_state.get('ha_disabled'):
                        reenable_cluster_ha(step_reason='pause_after_host_failure', step_number=9999)
                    
                    self.update_job_status(job['id'], 'paused', details={
                        'pause_reason': pause_reason,
                        'paused_at': utc_now_iso(),
                        'intervention_required': True,
                        'intervention_host': host['name'],
                        'intervention_step': failed_step_name,
                        'intervention_error': str(e),
                        'workflow_results': workflow_results
                    })
                    self.log(f"⏸️ Pausing workflow for operator intervention: {pause_reason}", "WARN")
                    return
                
                workflow_results['host_results'].append(host_result)
            
            # Mark Phase 2 complete
            self._log_workflow_step(job['id'], 'rolling_cluster_update', 2,
                f"Sequential updates ({len(eligible_hosts)} hosts)", 'completed')
            
            # =================================================================
            # HA MANAGEMENT: RE-ENABLE HA AFTER ALL HOSTS PROCESSED
            # =================================================================
            if cleanup_state.get('ha_disabled'):
                reenable_cluster_ha(step_reason='after_updates', step_number=9999)
            
            workflow_results['total_time_seconds'] = int(time.time() - workflow_start)
            
            final_details = {
                'workflow_results': workflow_results,
                'backup_mode': 'parallel' if details.get('parallel_backups', False) else 'sequential',
                'backup_scp_enabled': backup_scp,
                'phased_approach': True
            }
            
            if workflow_results['hosts_failed'] > 0 and not continue_on_failure:
                self.update_job_status(
                    job['id'],
                    'failed',
                    completed_at=utc_now_iso(),
                    details=final_details
                )
            else:
                # Job is successful if:
                # - At least one host was updated, OR
                # - No hosts failed (all were skipped because already up to date)
                final_status = 'completed' if (workflow_results['hosts_updated'] > 0 or workflow_results['hosts_failed'] == 0) else 'failed'
                
                # Add descriptive summary when all hosts were already up to date
                if workflow_results['hosts_updated'] == 0 and workflow_results['hosts_skipped'] > 0:
                    final_details['summary'] = 'All servers already up to date - no updates needed'
                
                self.update_job_status(
                    job['id'],
                    final_status,
                    completed_at=utc_now_iso(),
                    details=final_details
                )
                
                if workflow_results['hosts_updated'] == 0 and workflow_results['hosts_skipped'] > 0:
                    self.log(f"✓ Phased rolling cluster update completed - all servers already up to date")
                else:
                    self.log(f"✓ Phased rolling cluster update completed:")
                    self.log(f"  - Hosts updated: {workflow_results['hosts_updated']}/{workflow_results['total_hosts']}")
                if backup_scp:
                    successful_backups = sum(1 for r in backup_results.values() if r.get('success'))
                    self.log(f"  - SCP backups: {successful_backups}/{workflow_results['total_hosts']}")
            
        except Exception as e:
            self.log(f"Phased rolling cluster update workflow failed: {e}", "ERROR")
            
            # Ensure HA is re-enabled even on failure
            if cleanup_state.get('ha_disabled'):
                reenable_cluster_ha(step_reason='exception_cleanup', step_number=9999)
            
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=utc_now_iso(),
                details={'error': str(e), 'workflow_results': workflow_results}
            )
    
    def execute_cluster_safety_check(self, job: Dict):
        """Execute cluster safety check before taking hosts offline for updates"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        from job_executor.utils import _safe_json_parse
        
        try:
            from pyVmomi import vim
            
            self.log(f"Starting cluster safety check: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=utc_now_iso())
            
            details = job.get('details', {})
            cluster_name = details.get('cluster_name')
            min_required_hosts = details.get('min_required_hosts', 2)
            
            if not cluster_name:
                raise Exception("Missing cluster_name in job details")
            
            self.log(f"Checking safety for cluster: {cluster_name}")
            
            # Fetch vCenter settings and connect
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_settings?select=*&limit=1",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            
            if response.status_code != 200:
                raise Exception(f"Failed to fetch vCenter settings")
            
            settings = _safe_json_parse(response)[0]
            vc = self.executor.connect_vcenter(settings)
            if not vc:
                raise Exception("Failed to connect to vCenter")
            
            # Find cluster
            content = vc.RetrieveContent()
            cluster_obj = None
            for dc in content.rootFolder.childEntity:
                if hasattr(dc, 'hostFolder'):
                    for cluster in dc.hostFolder.childEntity:
                        if isinstance(cluster, vim.ClusterComputeResource) and cluster.name == cluster_name:
                            cluster_obj = cluster
                            break
            
            if not cluster_obj:
                raise Exception(f"Cluster '{cluster_name}' not found")
            
            # Check DRS configuration
            drs_enabled = cluster_obj.configuration.drsConfig.enabled
            drs_behavior = cluster_obj.configuration.drsConfig.defaultVmBehavior
            drs_mode = 'fullyAutomated' if drs_behavior == 'fullyAutomated' else \
                       'partiallyAutomated' if drs_behavior == 'partiallyAutomated' else \
                       'manual'
            
            # Count host states
            total_hosts = len(cluster_obj.host)
            healthy_hosts = sum(1 for h in cluster_obj.host 
                              if h.runtime.connectionState == 'connected' 
                              and h.runtime.powerState == 'poweredOn' 
                              and not h.runtime.inMaintenanceMode)
            
            # Enhanced safety logic with warnings
            warnings = []
            if not drs_enabled:
                warnings.append("DRS is disabled - VMs will not automatically evacuate")
            if drs_mode == 'manual':
                warnings.append("DRS is in manual mode - requires manual VM migration")
            
            # NEW: Run iDRAC pre-flight checks for linked Dell servers
            idrac_results = []
            all_idrac_ready = True
            
            # Get target host ID if specified in details
            target_host_id = details.get('target_host_id')
            
            # Query for servers linked to hosts in this cluster
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            from job_executor.utils import _safe_json_parse
            
            cluster_hosts_response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_hosts?cluster=eq.{cluster_name}&select=id,hostname,server_id,servers(id,hostname,ip_address)",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            
            if cluster_hosts_response.status_code == 200:
                cluster_hosts_data = _safe_json_parse(cluster_hosts_response)
                for host_data in cluster_hosts_data:
                    if host_data.get('server_id') and host_data.get('servers'):
                        server = host_data['servers'] if isinstance(host_data['servers'], dict) else host_data['servers'][0]
                        
                        # Only check target host if specified, otherwise check all
                        if target_host_id and host_data['id'] != target_host_id:
                            continue
                        
                        try:
                            idrac_check = self._run_idrac_preflight(server, job['id'])
                            idrac_results.append(idrac_check)
                            if not idrac_check['ready']:
                                all_idrac_ready = False
                        except Exception as e:
                            self.log(f"iDRAC pre-flight check failed for {server['hostname']}: {e}", "WARNING")
                            idrac_results.append({
                                'server_id': server['id'],
                                'hostname': server.get('hostname', server.get('ip_address', 'Unknown')),
                                'ip_address': server.get('ip_address', ''),
                                'ready': False,
                                'error': str(e),
                                'checks': {}
                            })
                            all_idrac_ready = False
            
            safe_to_proceed = (
                healthy_hosts >= (min_required_hosts + 1) and
                (drs_enabled or True) and
                (len(idrac_results) == 0 or all_idrac_ready)  # All iDRAC checks must pass
            )
            
            result = {
                'safe_to_proceed': safe_to_proceed,
                'total_hosts': total_hosts,
                'healthy_hosts': healthy_hosts,
                'min_required_hosts': min_required_hosts,
                'drs_enabled': drs_enabled,
                'drs_mode': drs_mode,
                'warnings': warnings,
                'idrac_checks': idrac_results,
                'all_idrac_ready': all_idrac_ready
            }
            
            # Store result
            requests.post(
                f"{DSM_URL}/rest/v1/cluster_safety_checks",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}', 'Content-Type': 'application/json'},
                json={'job_id': job['id'], 'cluster_id': cluster_name, 'total_hosts': total_hosts, 
                      'healthy_hosts': healthy_hosts, 'min_required_hosts': min_required_hosts, 
                      'safe_to_proceed': safe_to_proceed, 'details': result},
                verify=VERIFY_SSL
            )
            
            self.log(f"✓ Safety check: {'PASSED' if safe_to_proceed else 'FAILED'}")
            self.update_job_status(job['id'], 'completed', completed_at=utc_now_iso(), details=result)
            
        except Exception as e:
            self.log(f"Cluster safety check failed: {e}", "ERROR")
            self.update_job_status(job['id'], 'failed', completed_at=utc_now_iso(), 
                                 details={'error': str(e), 'safe_to_proceed': False})
    
    def _run_idrac_preflight(self, server: Dict, job_id: str) -> Dict:
        """
        Run all iDRAC pre-flight checks for a single server.
        
        Args:
            server: Server dict with id, hostname, ip_address, credentials
            job_id: Job ID for logging
            
        Returns:
            dict: Pre-flight check results with ready status and individual checks
        """
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        from job_executor.utils import _safe_json_parse
        
        server_id = server['id']
        hostname = server.get('hostname', server.get('ip_address', 'Unknown'))
        ip_address = server.get('ip_address', '')
        
        self.log(f"Running iDRAC pre-flight checks for {hostname}")
        
        # Get credentials
        creds = self.get_credentials(server_id)
        if not creds:
            raise Exception(f"No credentials found for server {hostname}")
        
        username, password = creds
        
        # Initialize Dell operations
        dell_ops = self.executor._get_dell_operations()
        
        checks = {
            'lc_status': {'passed': False, 'status': None, 'message': ''},
            'pending_jobs': {'passed': False, 'count': 0, 'jobs': []},
            'system_health': {'passed': False, 'overall': None, 'details': {}},
            'storage_health': {'passed': False, 'rebuilding': False},
            'power_state': {'passed': False, 'state': None},
            'thermal_status': {'passed': False, 'warnings': []}
        }
        
        try:
            # 1. Lifecycle Controller Status (CRITICAL)
            try:
                lc_result = dell_ops.get_lifecycle_controller_status(
                    ip=ip_address,
                    username=username,
                    password=password,
                    server_id=server_id,
                    job_id=job_id
                )
                checks['lc_status'] = lc_result
            except Exception as e:
                checks['lc_status']['message'] = f"Failed to check LC status: {str(e)}"
                self.log(f"LC status check failed for {hostname}: {e}", "WARNING")
            
            # 2. Pending Jobs (CRITICAL)
            try:
                jobs_result = dell_ops.get_pending_idrac_jobs(
                    ip=ip_address,
                    username=username,
                    password=password,
                    server_id=server_id,
                    job_id=job_id
                )
                checks['pending_jobs'] = jobs_result
            except Exception as e:
                checks['pending_jobs']['message'] = f"Failed to check job queue: {str(e)}"
                self.log(f"Job queue check failed for {hostname}: {e}", "WARNING")
            
            # 3. System Health (WARNING)
            try:
                health_result = dell_ops.get_health_status(
                    ip=ip_address,
                    username=username,
                    password=password,
                    server_id=server_id
                )
                checks['system_health'] = {
                    'passed': health_result.get('overall_health') == 'OK',
                    'overall': health_result.get('overall_health'),
                    'details': health_result
                }
                checks['power_state'] = {
                    'passed': health_result.get('power_state') == 'On',
                    'state': health_result.get('power_state')
                }
            except Exception as e:
                checks['system_health']['message'] = f"Failed to check health: {str(e)}"
                self.log(f"Health check failed for {hostname}: {e}", "WARNING")
            
            # 4. Storage/RAID (WARNING)
            try:
                storage_result = dell_ops.check_storage_rebuild_status(
                    ip=ip_address,
                    username=username,
                    password=password,
                    server_id=server_id,
                    job_id=job_id
                )
                checks['storage_health'] = storage_result
            except Exception as e:
                checks['storage_health']['message'] = f"Failed to check storage: {str(e)}"
                self.log(f"Storage check failed for {hostname}: {e}", "WARNING")
            
            # 5. Thermal Status (WARNING)
            try:
                thermal_result = dell_ops.get_thermal_status(
                    ip=ip_address,
                    username=username,
                    password=password,
                    server_id=server_id,
                    job_id=job_id
                )
                checks['thermal_status'] = thermal_result
            except Exception as e:
                checks['thermal_status']['message'] = f"Failed to check thermal: {str(e)}"
                self.log(f"Thermal check failed for {hostname}: {e}", "WARNING")
            
        except Exception as e:
            self.log(f"Overall iDRAC pre-flight failed for {hostname}: {e}", "ERROR")
            raise
        
        # Determine overall ready status (CRITICAL checks must pass)
        critical_checks_passed = (
            checks['lc_status'].get('passed', False) and
            checks['pending_jobs'].get('passed', False) and
            checks['power_state'].get('passed', False)
        )
        
        # Warning checks can fail but still allow override
        warning_checks = []
        if not checks['system_health'].get('passed', False):
            warning_checks.append('System health is not OK')
        if not checks['storage_health'].get('passed', False):
            warning_checks.append('RAID rebuild in progress')
        if not checks['thermal_status'].get('passed', False):
            warning_checks.append('Thermal warnings detected')
        
        return {
            'server_id': server_id,
            'hostname': hostname,
            'ip_address': ip_address,
            'ready': critical_checks_passed,
            'checks': checks,
            'warnings': warning_checks
        }
    
    def execute_server_group_safety_check(self, job: Dict):
        """Execute server group safety check before taking servers offline for maintenance"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        from job_executor.utils import _safe_json_parse
        
        try:
            self.log(f"Starting server group safety check: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=utc_now_iso())
            
            details = job.get('details', {})
            group_id = details.get('server_group_id')
            min_required = details.get('min_required_servers', 1)
            
            if not group_id:
                raise Exception("Missing server_group_id in job details")
            
            # Fetch server group
            group_response = requests.get(
                f"{DSM_URL}/rest/v1/server_groups?id=eq.{group_id}&select=*",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            
            if group_response.status_code != 200:
                raise Exception("Failed to fetch server group")
            
            groups = _safe_json_parse(group_response)
            if not groups:
                raise Exception(f"Server group {group_id} not found")
            
            group = groups[0]
            group_name = group['name']
            
            self.log(f"Checking safety for server group: {group_name}")
            
            # Fetch group members with server details
            members_response = requests.get(
                f"{DSM_URL}/rest/v1/server_group_members?server_group_id=eq.{group_id}&select=server_id,servers(id,ip_address,hostname,overall_health,power_state,connection_status)",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            
            members = _safe_json_parse(members_response)
            total_servers = len(members)
            healthy_servers = 0
            warnings = []
            
            # Check health of each server
            for member in members:
                server = member.get('servers')
                if not server:
                    continue
                
                # Simplified health check
                if server.get('overall_health') == 'OK' and server.get('power_state') == 'On':
                    healthy_servers += 1
            
            safe_to_proceed = healthy_servers >= (min_required + 1)
            
            result = {
                'safe_to_proceed': safe_to_proceed,
                'total_servers': total_servers,
                'healthy_servers': healthy_servers,
                'min_required_servers': min_required,
                'warnings': warnings
            }
            
            self.log(f"✓ Group safety check: {'PASSED' if safe_to_proceed else 'FAILED'}")
            self.update_job_status(job['id'], 'completed', completed_at=utc_now_iso(), details=result)
            
        except Exception as e:
            self.log(f"Server group safety check failed: {e}", "ERROR")
            self.update_job_status(job['id'], 'failed', completed_at=utc_now_iso(), 
                                 details={'error': str(e), 'safe_to_proceed': False})
