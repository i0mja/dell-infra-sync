"""vCenter sync and connectivity handlers"""

from typing import Dict, Optional, List
from datetime import datetime, timezone
import time
import requests
from .base import BaseHandler
from job_executor.utils import utc_now_iso


class VCenterHandlers(BaseHandler):
    """Handles vCenter sync and connectivity test operations"""
    
    def _log_console(self, message: str, level: str, job_details: Dict):
        """Add message to console log for UI display and log to stdout"""
        timestamp = datetime.now(timezone.utc).strftime('%H:%M:%S')
        if 'console_log' not in job_details:
            job_details['console_log'] = []
        job_details['console_log'].append(f'[{timestamp}] [{level}] {message}')
        self.log(message, level)
    
    def execute_vcenter_sync(self, job: Dict):
        """Execute vCenter sync - fetch ESXi hosts and auto-link to Dell servers
        
        If no specific vcenter_id is provided, syncs ALL sync-enabled vCenters sequentially.
        """
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        from job_executor.utils import _safe_json_parse
        from pyVmomi import vim
        
        sync_start = time.time()
        all_vcenter_results = []
        
        # Initialize job details with console_log
        job_details = {
            "current_step": "Initializing",
            "console_log": []
        }
        
        try:
            self._log_console(f"Starting vCenter sync job: {job['id']}", "INFO", job_details)
            self.update_job_status(
                job['id'], 
                'running', 
                started_at=utc_now_iso(),
                details=job_details
            )
            
            # Fetch vCenter configuration(s)
            self._log_console("Fetching vCenter configuration...", "INFO", job_details)
            
            # Get target vCenter ID from target_scope (frontend format) or details (legacy)
            job_details = job.get('details', {})
            target_scope = job.get('target_scope', {})
            
            # First check target_scope.vcenter_ids (frontend "Sync All" format)
            vcenter_ids_from_scope = target_scope.get('vcenter_ids', [])
            if vcenter_ids_from_scope and len(vcenter_ids_from_scope) == 1:
                target_vcenter_id = vcenter_ids_from_scope[0]
                self._log_console(f"Target vCenter from target_scope: {target_vcenter_id}", "INFO", job_details)
            else:
                # Fallback to details.vcenter_id (legacy/background sync format)
                target_vcenter_id = job_details.get('vcenter_id')
                if target_vcenter_id:
                    self._log_console(f"Target vCenter from details: {target_vcenter_id}", "INFO", job_details)
            
            if target_vcenter_id:
                vcenter_url = f"{DSM_URL}/rest/v1/vcenters?id=eq.{target_vcenter_id}&select=*"
            else:
                # Fetch ALL sync-enabled vCenters (no limit)
                self._log_console("No specific target - syncing ALL enabled vCenters", "INFO", job_details)
                vcenter_url = f"{DSM_URL}/rest/v1/vcenters?sync_enabled=eq.true&order=created_at.asc"
            
            response = requests.get(
                vcenter_url,
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL
            )
            
            if response.status_code != 200:
                raise Exception(f"Failed to fetch vCenter configuration: {response.status_code}")
            
            vcenters_list = _safe_json_parse(response)
            if not vcenters_list:
                raise Exception("No vCenter connection configured or sync is disabled")
            
            total_vcenters = len(vcenters_list)
            self._log_console(f"Found {total_vcenters} vCenter(s) to sync", "INFO", job_details)
            
            # Update job with total vCenters count
            job_details.update({
                "current_step": f"Starting sync for {total_vcenters} vCenter(s)",
                "total_vcenters": total_vcenters,
                "current_vcenter_index": 0
            })
            self.update_job_status(
                job['id'],
                'running',
                details=job_details
            )
            
            # Iterate through ALL vCenters
            for vcenter_index, vcenter_config in enumerate(vcenters_list):
                vcenter_result = self._sync_single_vcenter(
                    job=job,
                    vcenter_config=vcenter_config,
                    vcenter_index=vcenter_index,
                    total_vcenters=total_vcenters,
                    job_details=job_details
                )
                
                if vcenter_result:
                    all_vcenter_results.append(vcenter_result)
                
                # Check if job was cancelled during sync
                if vcenter_result and vcenter_result.get('cancelled'):
                    break
            
            # Complete job with aggregated results
            sync_duration = int(time.time() - sync_start)
            
            # Aggregate totals across all vCenters
            totals = {
                'clusters': sum(r.get('clusters', 0) for r in all_vcenter_results),
                'datastores': sum(r.get('datastores', 0) for r in all_vcenter_results),
                'networks': sum(r.get('networks', 0) for r in all_vcenter_results),
                'vms': sum(r.get('vms', 0) for r in all_vcenter_results),
                'alarms': sum(r.get('alarms', 0) for r in all_vcenter_results),
                'hosts': sum(r.get('hosts', 0) for r in all_vcenter_results),
                'auto_linked': sum(r.get('auto_linked', 0) for r in all_vcenter_results),
            }
            
            # Collect all errors
            all_errors = []
            for r in all_vcenter_results:
                if r.get('errors'):
                    all_errors.extend(r['errors'] if isinstance(r['errors'], list) else [r['errors']])
            
            # Check if any vCenter failed
            any_failed = any(r.get('status') == 'failed' for r in all_vcenter_results)
            any_cancelled = any(r.get('cancelled') for r in all_vcenter_results)
            
            summary = {
                'sync_duration_seconds': sync_duration,
                'total_vcenters': total_vcenters,
                'vcenters_synced': len([r for r in all_vcenter_results if r.get('status') != 'failed']),
                'vcenter_results': all_vcenter_results,
                # Aggregated totals for quick display
                'clusters': totals['clusters'],
                'datastores': totals['datastores'],
                'networks': totals['networks'],
                'vms': totals['vms'],
                'alarms': totals['alarms'],
                'hosts': totals['hosts'],
                'auto_linked': totals['auto_linked'],
                'errors': all_errors if all_errors else None
            }
            
            final_status = 'cancelled' if any_cancelled else ('failed' if any_failed else 'completed')
            
            self._log_console(f"vCenter sync {final_status} in {sync_duration}s - {len(all_vcenter_results)}/{total_vcenters} vCenters processed", "INFO", job_details)
            
            # Include console_log in final summary
            summary['console_log'] = job_details.get('console_log', [])
            
            self.update_job_status(
                job['id'], 
                final_status,
                completed_at=utc_now_iso(),
                details=summary
            )
            
        except Exception as e:
            self._log_console(f"vCenter sync failed: {e}", "ERROR", job_details)
            job_details['error'] = str(e)
            job_details['vcenter_results'] = all_vcenter_results
            self.update_job_status(
                job['id'], 
                'failed',
                completed_at=utc_now_iso(),
                details=job_details
            )
    
    def _sync_single_vcenter(self, job: Dict, vcenter_config: Dict, vcenter_index: int, total_vcenters: int, job_details: Dict) -> Dict:
        """Sync a single vCenter and return results"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        
        vcenter_start = time.time()
        source_vcenter_id = vcenter_config['id']
        vcenter_host = vcenter_config.get('host')
        vcenter_name = vcenter_config['name']
        sync_errors = []
        
        self._log_console(f"Syncing vCenter {vcenter_index + 1}/{total_vcenters}: {vcenter_name} ({vcenter_host})", "INFO", job_details)
        
        # Update job with current vCenter info (keep vcenter_name in sync for UI display)
        job_details.update({
            "current_step": f"Connecting to {vcenter_name}",
            "total_vcenters": total_vcenters,
            "current_vcenter_index": vcenter_index,
            "current_vcenter_name": vcenter_name,
            "vcenter_name": vcenter_name,  # Keep updated for completed job display
            "vcenter_host": vcenter_host
        })
        self.update_job_status(
            job['id'],
            'running',
            details=job_details
        )
        
        # Create tasks for each sync phase (prefixed with vCenter name if multi)
        # PropertyCollector consolidates to 3 phases: connect, inventory, alarms
        phase_prefix = f"[{vcenter_name}] " if total_vcenters > 1 else ""
        
        sync_phases = [
            {'name': 'connect', 'label': f'{phase_prefix}Connecting to vCenter'},
            {'name': 'inventory', 'label': f'{phase_prefix}Syncing inventory (PropertyCollector)'},
            {'name': 'alarms', 'label': f'{phase_prefix}Syncing alarms'}
        ]
        
        phase_tasks = {}
        for phase in sync_phases:
            task_id = self.create_task(job['id'])
            if task_id:
                self.update_task_status(task_id, 'pending', log=phase['label'], progress=0)
                phase_tasks[phase['name']] = task_id
        
        try:
            # Connect to vCenter
            self._log_console(f"Connecting to {vcenter_name}...", "INFO", job_details)
            vc = self.executor.connect_vcenter(vcenter_config)
            if not vc:
                raise Exception(f"Failed to connect to vCenter {vcenter_name} - check credentials and network connectivity")
            
            self._log_console(f"Connected to {vcenter_name}", "INFO", job_details)
            
            # Mark connect phase complete
            if 'connect' in phase_tasks:
                self.update_task_status(
                    phase_tasks['connect'],
                    'completed',
                    log=f'✓ Connected to {vcenter_name}',
                    progress=100
                )
            
            # Get vCenter content for all syncs
            content = vc.RetrieveContent()
            
            # Helper to check cancellation between phases
            def check_cancelled():
                if self.executor.check_job_cancelled(job['id']):
                    self.log("Job cancelled by user - stopping sync")
                    # Cancel remaining tasks
                    for task_name, task_id in phase_tasks.items():
                        try:
                            requests.patch(
                                f"{DSM_URL}/rest/v1/job_tasks?id=eq.{task_id}",
                                headers={
                                    'apikey': SERVICE_ROLE_KEY,
                                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                    'Content-Type': 'application/json'
                                },
                                json={'status': 'cancelled', 'log': 'Cancelled by user'},
                                verify=VERIFY_SSL
                            )
                        except:
                            pass
                    return True
                return False
            
            # Check before each phase
            if check_cancelled():
                return {'vcenter_name': vcenter_name, 'vcenter_host': vcenter_host, 'cancelled': True}
            
            # =====================================================================
            # PropertyCollector-based FAST sync (single ContainerView, batch upsert)
            # =====================================================================
            self._log_console("Using PropertyCollector for fast inventory sync...", "INFO", job_details)
            
            if 'inventory' in phase_tasks:
                self.update_task_status(phase_tasks['inventory'], 'running', 
                    log=f'{phase_prefix}Fetching inventory via PropertyCollector...', progress=0)
            
            job_details.update({
                'current_step': f'PropertyCollector inventory fetch from {vcenter_name}',
                'total_vcenters': total_vcenters,
                'current_vcenter_index': vcenter_index,
                'current_vcenter_name': vcenter_name,
                'sync_mode': 'property_collector'
            })
            self.update_job_status(job['id'], 'running', details=job_details)
            
            # Import PropertyCollector module
            from job_executor.mixins.vcenter_property_collector import sync_vcenter_fast
            
            # Single call fetches ALL inventory (clusters, hosts, vms, datastores, networks)
            inventory_start = time.time()
            inventory_result = sync_vcenter_fast(content, source_vcenter_id)
            fetch_time = int((time.time() - inventory_start) * 1000)
            
            # DEBUG: Enhanced logging for Marseille VM count diagnosis
            vm_count = len(inventory_result.get('vms', []))
            host_count = len(inventory_result.get('hosts', []))
            self._log_console(f"DEBUG: PropertyCollector returned {vm_count} VMs, {host_count} hosts for {vcenter_name}", "INFO", job_details)
            if vm_count < 100:
                # Log sample VM names if count seems low
                sample_vms = [v.get('name', 'unknown') for v in inventory_result.get('vms', [])[:10]]
                self._log_console(f"DEBUG: Sample VMs: {sample_vms}", "INFO", job_details)
            
            self._log_console(f"PropertyCollector fetched {inventory_result.get('total_objects', 0)} objects in {fetch_time}ms", "INFO", job_details)
            
            if 'inventory' in phase_tasks:
                self.update_task_status(phase_tasks['inventory'], 'running',
                    log=f'{phase_prefix}Upserting {inventory_result.get("total_objects", 0)} objects to database...',
                    progress=50)
            
            # Check for cancellation before database upsert
            if check_cancelled():
                return {'vcenter_name': vcenter_name, 'vcenter_host': vcenter_host, 'cancelled': True}
            
            # Batch upsert all inventory to database
            def inventory_progress(pct, msg, phase_idx=None):
                if 'inventory' in phase_tasks:
                    # Scale progress from 50-100% for upsert phase
                    scaled_pct = 50 + int(pct * 0.5)
                    self.update_task_status(phase_tasks['inventory'], 'running', log=msg, progress=scaled_pct)
                job_details.update({
                    'current_step': msg,
                    'total_vcenters': total_vcenters,
                    'current_vcenter_index': vcenter_index,
                    'current_vcenter_name': vcenter_name
                })
                # Add sync_phase for monotonic UI progress tracking
                if phase_idx is not None:
                    job_details['sync_phase'] = phase_idx
                self.update_job_status(job['id'], 'running', details=job_details)
            
            upsert_result = self.executor.upsert_inventory_fast(
                inventory_result,
                source_vcenter_id,
                vcenter_name=vcenter_name,
                job_id=job['id'],
                progress_callback=inventory_progress
            )
            
            # Map results to legacy format for compatibility
            clusters_result = upsert_result.get('clusters', {})
            datastores_result = upsert_result.get('datastores', {})
            networks_result = upsert_result.get('networks', {})
            vms_result = upsert_result.get('vms', {})
            hosts_result = upsert_result.get('hosts', {})
            
            # Collect any upsert errors into sync_errors
            for entity_type, result in [
                ('Clusters', clusters_result),
                ('Hosts', hosts_result),
                ('Datastores', datastores_result),
                ('Networks', networks_result),
                ('VMs', vms_result)
            ]:
                if result.get('error'):
                    error_msg = f"{entity_type} upsert failed: {result['error']}"
                    self.log(f"⚠️ {error_msg}", "WARN")
                    sync_errors.append(error_msg)
            
            self._log_console(f"Inventory upsert complete: "
                f"{clusters_result.get('synced', 0)} clusters, "
                f"{hosts_result.get('synced', 0)} hosts, "
                f"{datastores_result.get('synced', 0)} datastores, "
                f"{networks_result.get('synced', 0)} networks, "
                f"{vms_result.get('synced', 0)} VMs", "INFO", job_details)
            
            if 'inventory' in phase_tasks:
                self.update_task_status(
                    phase_tasks['inventory'],
                    'completed',
                    log=f'✓ Synced {inventory_result.get("total_objects", 0)} objects '
                        f'(fetch: {inventory_result.get("fetch_time_ms", 0)}ms, '
                        f'process: {inventory_result.get("process_time_ms", 0)}ms)',
                    progress=100
                )
            
            # Collect any PropertyCollector errors
            if inventory_result.get('errors'):
                for err in inventory_result['errors']:
                    sync_errors.append(f"{err.get('object', 'unknown')}: {err.get('message', '')}")
            
            # =====================================================================
            # Datastore Change Detection - Alert on critical missing datastores
            # =====================================================================
            try:
                datastore_changes = self.executor.detect_datastore_changes(
                    source_vcenter_id,
                    inventory_result.get('datastores', [])
                )
                
                critical_ds = datastore_changes.get('critical', [])
                disappeared_ds = datastore_changes.get('disappeared', [])
                
                if critical_ds:
                    # Log critical alert for replication-linked datastores
                    for ds in critical_ds:
                        alert_msg = f"CRITICAL: Replication datastore '{ds.get('name')}' disappeared from vCenter"
                        self._log_console(alert_msg, "ERROR", job_details)
                        sync_errors.append(alert_msg)
                        
                        # Log to activity monitor for visibility
                        self.log_idrac_command(
                            endpoint='/vcenter/sync',
                            command_type='DATASTORE_DISAPPEARED',
                            operation_type='vcenter_sync',
                            full_url=f'{DSM_URL}/rest/v1/vcenter_datastores',
                            success=False,
                            details={
                                'alert_type': 'datastore_disappeared',
                                'datastore_name': ds.get('name'),
                                'datastore_id': ds.get('id'),
                                'vcenter_id': source_vcenter_id,
                                'vcenter_name': vcenter_name,
                                'replication_target_id': ds.get('replication_target_id'),
                                'severity': 'critical',
                                'message': alert_msg
                            },
                            source='job_executor',
                            job_id=job['id']
                        )
                    
                    # Trigger notification for critical datastore changes
                    self._send_datastore_alert(critical_ds, source_vcenter_id, vcenter_name, job['id'])
                
                elif disappeared_ds:
                    # Non-critical but noteworthy
                    for ds in disappeared_ds:
                        self._log_console(f"Warning: Datastore '{ds.get('name')}' no longer found in vCenter", "WARN", job_details)
                        
            except Exception as ds_change_err:
                self.log(f"Warning: Datastore change detection failed: {ds_change_err}", "WARN")
            
            # =====================================================================
            # Alarms sync (always uses AlarmManager API - separate per spec)
            # =====================================================================
            if check_cancelled():
                return {'vcenter_name': vcenter_name, 'vcenter_host': vcenter_host, 'cancelled': True}
            
            # Sync alarms
            self._log_console("Syncing alarms...", "INFO", job_details)
            if 'alarms' in phase_tasks:
                self.update_task_status(phase_tasks['alarms'], 'running', log=f'{phase_prefix}Syncing alarms...', progress=0)
            
            job_details.update({
                'current_step': f'Syncing alarms from {vcenter_name}',
                'total_vcenters': total_vcenters,
                'current_vcenter_index': vcenter_index,
                'current_vcenter_name': vcenter_name
            })
            self.update_job_status(job['id'], 'running', details=job_details)
            
            if not self.executor.check_vcenter_connection(content):
                raise Exception("vCenter connection lost before alarm sync")
            
            def alarm_progress(pct, msg):
                if 'alarms' in phase_tasks:
                    self.update_task_status(phase_tasks['alarms'], 'running', log=msg, progress=pct)
                job_details.update({
                    'current_step': msg,
                    'total_vcenters': total_vcenters,
                    'current_vcenter_index': vcenter_index,
                    'current_vcenter_name': vcenter_name,
                    'sync_phase': 5  # Alarms phase
                })
                self.update_job_status(job['id'], 'running', details=job_details)
            
            alarms_result = self.executor.sync_vcenter_alarms(content, source_vcenter_id, progress_callback=alarm_progress, vcenter_name=vcenter_name, job_id=job['id'])
            self._log_console(f"Alarms synced: {alarms_result.get('synced', 0)}", "INFO", job_details)
            
            if 'alarms' in phase_tasks:
                self.update_task_status(
                    phase_tasks['alarms'],
                    'completed',
                    log=f'✓ Synced {alarms_result.get("synced", 0)} alarms',
                    progress=100
                )
            


            # Complete this vCenter sync
            vcenter_duration = int(time.time() - vcenter_start)
            
            # =====================================================================
            # Network sync validation - add warning if networks = 0 but hosts > 0
            # =====================================================================
            networks_count = networks_result.get('synced', 0)
            hosts_count = hosts_result.get('synced', 0)
            
            if networks_count == 0 and hosts_count > 0:
                warning_msg = (
                    f"Network collection returned 0 results despite {hosts_count} hosts synced. "
                    "This may indicate a vCenter permissions issue, empty network folder, "
                    "or networks organized in unsupported structures."
                )
                self._log_console(warning_msg, "WARN", job_details)
                sync_errors.append(warning_msg)
            
            self._log_console(f"{vcenter_name} sync completed in {vcenter_duration}s", "INFO", job_details)
            
            # Determine final status - partial if any warnings/errors
            has_warnings = len(sync_errors) > 0
            final_status = 'partial' if has_warnings else 'success'
            
            # Update vCenter last_sync status on success
            try:
                requests.patch(
                    f"{DSM_URL}/rest/v1/vcenters?id=eq.{source_vcenter_id}",
                    json={
                        'last_sync': utc_now_iso(),
                        'last_sync_status': final_status,
                        'last_sync_error': '; '.join(sync_errors) if sync_errors else None
                    },
                    headers={
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                    },
                    verify=VERIFY_SSL
                )
            except Exception as update_err:
                self.log(f"Warning: Failed to update vCenter sync status: {update_err}", "WARN")
            
            return {
                'vcenter_id': source_vcenter_id,
                'vcenter_name': vcenter_name,
                'vcenter_host': vcenter_host,
                'status': 'completed_with_warnings' if has_warnings else 'success',
                'sync_duration_seconds': vcenter_duration,
                'clusters': clusters_result.get('synced', 0),
                'datastores': datastores_result.get('synced', 0),
                'networks': networks_count,
                'vms': vms_result.get('synced', 0),
                'alarms': alarms_result.get('synced', 0),
                'hosts': hosts_count,
                'auto_linked': hosts_result.get('auto_linked', 0),
                'errors': sync_errors if sync_errors else None
            }
            
        except Exception as e:
            self._log_console(f"vCenter {vcenter_name} sync failed: {e}", "ERROR", job_details)
            
            # Update vCenter last_sync status on failure
            try:
                requests.patch(
                    f"{DSM_URL}/rest/v1/vcenters?id=eq.{source_vcenter_id}",
                    json={
                        'last_sync': utc_now_iso(),
                        'last_sync_status': 'failed',
                        'last_sync_error': str(e)[:500]
                    },
                    headers={
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                    },
                    verify=VERIFY_SSL
                )
            except Exception as update_err:
                self.log(f"Warning: Failed to update vCenter error status: {update_err}", "WARN")
            
            return {
                'vcenter_id': source_vcenter_id,
                'vcenter_name': vcenter_name,
                'vcenter_host': vcenter_host,
                'status': 'failed',
                'error': str(e)
            }
    
    def execute_partial_vcenter_sync(self, job: Dict):
        """Execute partial vCenter sync - fetch only specific object types (hosts, vms, clusters, datastores, networks)"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        from job_executor.utils import _safe_json_parse
        from pyVmomi import vim
        import time
        
        sync_start = time.time()
        job_details = job.get('details', {})
        sync_scope = job_details.get('sync_scope', 'vms')  # vms, hosts, clusters, datastores, networks
        target_vcenter_id = job_details.get('vcenter_id')
        
        self.log(f"Starting partial vCenter sync job: {job['id']} (scope: {sync_scope})")
        
        try:
            self.update_job_status(
                job['id'], 
                'running', 
                started_at=utc_now_iso(),
                details={"current_step": f"Syncing {sync_scope} only", "sync_scope": sync_scope}
            )
            
            # Fetch vCenter configuration
            if target_vcenter_id:
                vcenter_url = f"{DSM_URL}/rest/v1/vcenters?id=eq.{target_vcenter_id}&select=*"
            else:
                vcenter_url = f"{DSM_URL}/rest/v1/vcenters?sync_enabled=eq.true&order=created_at.asc"
            
            response = requests.get(
                vcenter_url,
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL
            )
            
            if response.status_code != 200:
                raise Exception(f"Failed to fetch vCenter configuration: {response.status_code}")
            
            vcenters_list = _safe_json_parse(response)
            if not vcenters_list:
                raise Exception("No vCenter connection configured or sync is disabled")
            
            total_synced = 0
            all_errors = []
            
            for vcenter_config in vcenters_list:
                source_vcenter_id = vcenter_config['id']
                vcenter_name = vcenter_config['name']
                
                self.log(f"Connecting to {vcenter_name} for partial sync ({sync_scope})...")
                
                # Connect to vCenter
                vc = self.executor.connect_vcenter(vcenter_config)
                if not vc:
                    all_errors.append(f"Failed to connect to {vcenter_name}")
                    continue
                
                content = vc.RetrieveContent()
                
                # Import partial sync function
                from job_executor.mixins.vcenter_property_collector import sync_vcenter_partial
                
                # Collect only the requested scope
                inventory_result = sync_vcenter_partial(content, source_vcenter_id, sync_scope)
                
                self.log(f"Fetched {inventory_result.get('count', 0)} {sync_scope} from {vcenter_name}")
                
                # Upsert only the requested entity type
                upsert_result = self.executor.upsert_inventory_partial(
                    inventory_result,
                    source_vcenter_id,
                    sync_scope,
                    vcenter_name=vcenter_name,
                    job_id=job['id']
                )
                
                total_synced += upsert_result.get('synced', 0)
                if upsert_result.get('error'):
                    all_errors.append(upsert_result['error'])
                
                # Disconnect
                try:
                    from pyVim.connect import Disconnect
                    Disconnect(vc)
                except:
                    pass
            
            sync_duration = int(time.time() - sync_start)
            
            self.update_job_status(
                job['id'], 
                'completed',
                completed_at=utc_now_iso(),
                details={
                    "sync_scope": sync_scope,
                    "synced_count": total_synced,
                    "sync_duration_seconds": sync_duration,
                    "errors": all_errors if all_errors else None
                }
            )
            
            self.log(f"Partial sync complete: {total_synced} {sync_scope} synced in {sync_duration}s")
            
        except Exception as e:
            self.log(f"Partial vCenter sync failed: {e}", "ERROR")
            self.update_job_status(
                job['id'], 
                'failed',
                completed_at=utc_now_iso(),
                details={'error': str(e), 'sync_scope': sync_scope}
            )
    
    def execute_vcenter_connectivity_test(self, job: Dict):
        """Test vCenter connectivity - validates credentials against the vcenters table"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        from job_executor.utils import _safe_json_parse
        import time
        
        start_time = time.time()
        job_details = job.get('details', {})
        vcenter_id = job_details.get('vcenter_id')
        
        try:
            self.log(f"Starting vCenter connectivity test job: {job['id']} for vcenter_id: {vcenter_id}")
            self.update_job_status(
                job['id'], 
                'running', 
                started_at=utc_now_iso(),
                details={"current_step": "Fetching vCenter credentials", "vcenter_id": vcenter_id}
            )
            
            if not vcenter_id:
                raise ValueError("vcenter_id is required for connectivity test")
            
            # Fetch vCenter configuration from database
            vcenter_url = f"{DSM_URL}/rest/v1/vcenters?id=eq.{vcenter_id}&select=*"
            response = requests.get(
                vcenter_url,
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL
            )
            
            if response.status_code != 200:
                raise Exception(f"Failed to fetch vCenter configuration: {response.status_code}")
            
            vcenters_list = _safe_json_parse(response)
            if not vcenters_list:
                raise Exception(f"vCenter not found with id: {vcenter_id}")
            
            vcenter_config = vcenters_list[0]
            vcenter_name = vcenter_config.get('name', 'Unknown')
            vcenter_host = vcenter_config.get('host')
            vcenter_username = vcenter_config.get('username')
            
            self.log(f"Testing connectivity to vCenter: {vcenter_name} ({vcenter_host}) as {vcenter_username}")
            
            self.update_job_status(
                job['id'], 
                'running', 
                details={
                    "current_step": "Connecting to vCenter",
                    "vcenter_id": vcenter_id,
                    "vcenter_name": vcenter_name,
                    "vcenter_host": vcenter_host,
                    "username": vcenter_username
                }
            )
            
            # Actually test the connection using the executor's connect method
            vc = self.executor.connect_vcenter(vcenter_config)
            
            if not vc:
                raise Exception(f"Failed to connect to vCenter {vcenter_name} - connection returned None")
            
            # Get version info for verification
            try:
                content = vc.RetrieveContent()
                about = content.about
                vcenter_version = about.version
                vcenter_build = about.build
                vcenter_type = about.fullName
                
                self.log(f"Successfully connected to {vcenter_name}: {vcenter_type} (version {vcenter_version}, build {vcenter_build})")
            except Exception as ver_err:
                self.log(f"Connected but failed to get version info: {ver_err}", "WARNING")
                vcenter_version = "unknown"
                vcenter_build = "unknown"
                vcenter_type = "unknown"
            
            # Disconnect
            try:
                from pyVim.connect import Disconnect
                Disconnect(vc)
            except:
                pass
            
            elapsed_ms = int((time.time() - start_time) * 1000)
            
            # Update vCenter last_sync timestamp to indicate successful connection test
            try:
                update_url = f"{DSM_URL}/rest/v1/vcenters?id=eq.{vcenter_id}"
                requests.patch(
                    update_url,
                    headers={
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                    },
                    json={'last_sync': utc_now_iso()},
                    verify=VERIFY_SSL
                )
            except Exception as upd_err:
                self.log(f"Failed to update last_sync: {upd_err}", "WARNING")
            
            self.update_job_status(
                job['id'], 
                'completed',
                completed_at=utc_now_iso(),
                details={
                    "result": "Connectivity test passed",
                    "vcenter_id": vcenter_id,
                    "vcenter_name": vcenter_name,
                    "vcenter_host": vcenter_host,
                    "username": vcenter_username,
                    "version": vcenter_version,
                    "build": vcenter_build,
                    "product": vcenter_type,
                    "response_time_ms": elapsed_ms
                }
            )
            
            self.log(f"vCenter connectivity test PASSED for {vcenter_name} in {elapsed_ms}ms")
            
        except Exception as e:
            elapsed_ms = int((time.time() - start_time) * 1000)
            error_msg = str(e)
            
            # Check for specific vCenter/vim errors
            is_auth_error = 'InvalidLogin' in error_msg or 'incorrect user name or password' in error_msg.lower()
            is_ssl_error = 'SSL' in error_msg or 'certificate' in error_msg.lower()
            is_connection_error = 'Connection refused' in error_msg or 'timed out' in error_msg.lower() or 'unreachable' in error_msg.lower()
            
            if is_auth_error:
                error_category = "authentication"
                user_message = "Invalid credentials - check username and password"
            elif is_ssl_error:
                error_category = "ssl"
                user_message = "SSL/Certificate error - check SSL settings"
            elif is_connection_error:
                error_category = "network"
                user_message = "Network error - check host address and port"
            else:
                error_category = "unknown"
                user_message = error_msg
            
            self.log(f"vCenter connectivity test FAILED: {error_msg}", "ERROR")
            self.update_job_status(
                job['id'], 
                'failed',
                completed_at=utc_now_iso(),
                details={
                    'error': user_message,
                    'error_category': error_category,
                    'error_details': error_msg,
                    'vcenter_id': vcenter_id,
                    'response_time_ms': elapsed_ms
                }
            )
    
    def execute_openmanage_sync(self, job: Dict):
        """Execute OpenManage Enterprise device sync"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        from job_executor.utils import _safe_json_parse
        
        try:
            self.log(f"Starting OpenManage sync job: {job['id']}")
            self.update_job_status(
                job['id'], 
                'running', 
                started_at=utc_now_iso(),
                details={"current_step": "Fetching OME settings"}
            )
            
            # Fetch OME settings
            ome_url = f"{DSM_URL}/rest/v1/openmanage_settings?limit=1"
            response = requests.get(
                ome_url,
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL
            )
            
            if response.status_code != 200:
                raise Exception(f"Failed to fetch OME settings: {response.status_code}")
            
            ome_list = _safe_json_parse(response)
            if not ome_list:
                raise Exception("No OpenManage Enterprise connection configured")
            
            ome_config = ome_list[0]
            if not ome_config.get('sync_enabled'):
                raise Exception("OpenManage sync is disabled")
            
            self.log(f"✓ OME host: {ome_config.get('host')}")
            
            # Authenticate with OME
            self.update_job_status(
                job['id'],
                'running',
                details={"current_step": "Authenticating with OME"}
            )
            
            ome_host = ome_config.get('host')
            ome_port = ome_config.get('port', 443)
            ome_username = ome_config.get('username')
            ome_password = ome_config.get('password')
            ome_verify_ssl = ome_config.get('verify_ssl', False)
            
            # Get auth token
            auth_url = f"https://{ome_host}:{ome_port}/api/SessionService/Sessions"
            auth_response = requests.post(
                auth_url,
                json={"UserName": ome_username, "Password": ome_password, "SessionType": "API"},
                verify=ome_verify_ssl,
                headers={"Content-Type": "application/json"}
            )
            
            if auth_response.status_code not in [200, 201]:
                raise Exception(f"OME authentication failed: {auth_response.status_code}")
            
            auth_token = auth_response.headers.get('X-Auth-Token')
            if not auth_token:
                raise Exception("No auth token received from OME")
            
            self.log("✓ Authenticated with OME")
            
            # Fetch devices
            self.update_job_status(
                job['id'],
                'running',
                details={"current_step": "Fetching devices from OME"}
            )
            
            devices_url = f"https://{ome_host}:{ome_port}/api/DeviceService/Devices"
            devices_response = requests.get(
                devices_url,
                headers={
                    "X-Auth-Token": auth_token,
                    "Content-Type": "application/json"
                },
                verify=ome_verify_ssl
            )
            
            if devices_response.status_code != 200:
                raise Exception(f"Failed to fetch devices: {devices_response.status_code}")
            
            devices_data = devices_response.json()
            devices = devices_data.get('value', [])
            
            self.log(f"✓ Found {len(devices)} devices in OME")
            
            # Process devices
            self.update_job_status(
                job['id'],
                'running',
                details={"current_step": f"Processing {len(devices)} devices"}
            )
            
            synced_count = 0
            updated_count = 0
            errors = []
            
            for device in devices:
                try:
                    device_type = device.get('Type')
                    if device_type not in [1000, 2000]:  # Servers and chassis
                        continue
                    
                    service_tag = device.get('DeviceServiceTag')
                    if not service_tag:
                        continue
                    
                    # Check if server exists
                    check_url = f"{DSM_URL}/rest/v1/servers?service_tag=eq.{service_tag}"
                    check_response = requests.get(
                        check_url,
                        headers={
                            'apikey': SERVICE_ROLE_KEY,
                            'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                        },
                        verify=VERIFY_SSL
                    )
                    
                    existing = _safe_json_parse(check_response)
                    
                    server_data = {
                        'service_tag': service_tag,
                        'name': device.get('DeviceName'),
                        'model': device.get('Model'),
                        'idrac_ip': device.get('DeviceManagement', [{}])[0].get('NetworkAddress') if device.get('DeviceManagement') else None,
                        'ome_device_id': str(device.get('Id')),
                        'ome_status': device.get('Status'),
                    }
                    
                    if existing:
                        # Update existing
                        update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{existing[0]['id']}"
                        requests.patch(
                            update_url,
                            json=server_data,
                            headers={
                                'apikey': SERVICE_ROLE_KEY,
                                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                'Content-Type': 'application/json',
                                'Prefer': 'return=minimal'
                            },
                            verify=VERIFY_SSL
                        )
                        updated_count += 1
                    else:
                        # Insert new
                        insert_url = f"{DSM_URL}/rest/v1/servers"
                        requests.post(
                            insert_url,
                            json=server_data,
                            headers={
                                'apikey': SERVICE_ROLE_KEY,
                                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                'Content-Type': 'application/json',
                                'Prefer': 'return=minimal'
                            },
                            verify=VERIFY_SSL
                        )
                        synced_count += 1
                        
                except Exception as device_err:
                    errors.append(f"Device {device.get('DeviceServiceTag', 'unknown')}: {str(device_err)}")
            
            # Update OME settings with last sync
            try:
                requests.patch(
                    f"{DSM_URL}/rest/v1/openmanage_settings?id=eq.{ome_config['id']}",
                    json={'last_sync': utc_now_iso()},
                    headers={
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                    },
                    verify=VERIFY_SSL
                )
            except:
                pass
            
            self.log(f"✓ OME sync completed: {synced_count} new, {updated_count} updated")
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=utc_now_iso(),
                details={
                    'devices_found': len(devices),
                    'new_servers': synced_count,
                    'updated_servers': updated_count,
                    'errors': errors if errors else None
                }
            )
            
        except Exception as e:
            self.log(f"OpenManage sync failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=utc_now_iso(),
                details={'error': str(e)}
            )
    
    def _send_datastore_alert(self, critical_datastores: list, vcenter_id: str, vcenter_name: str, job_id: str):
        """Send Teams/email notification for critical datastore changes."""
        try:
            # Fetch notification settings
            response = requests.get(
                f"{DSM_URL}/rest/v1/notification_settings?limit=1",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.status_code != 200:
                return
            
            settings = response.json()
            if not settings:
                return
            
            settings = settings[0]
            teams_webhook = settings.get('teams_webhook_url')
            
            if not teams_webhook:
                self.log("No Teams webhook configured - skipping datastore alert notification", "DEBUG")
                return
            
            # Build alert message
            ds_names = [ds.get('name', 'Unknown') for ds in critical_datastores]
            ds_list = ', '.join(ds_names)
            
            message = {
                "@type": "MessageCard",
                "@context": "http://schema.org/extensions",
                "themeColor": "FF0000",
                "summary": f"Critical: Replication datastores missing from {vcenter_name}",
                "sections": [{
                    "activityTitle": "🚨 Critical Datastore Alert",
                    "facts": [
                        {"name": "vCenter", "value": vcenter_name},
                        {"name": "Missing Datastores", "value": ds_list},
                        {"name": "Impact", "value": "Replication and DR failover may be affected"},
                        {"name": "Action Required", "value": "Re-mount datastores on vCenter hosts"}
                    ],
                    "markdown": True
                }]
            }
            
            # Send Teams notification
            teams_response = requests.post(
                teams_webhook,
                json=message,
                timeout=10
            )
            
            if teams_response.status_code in [200, 202]:
                self.log(f"✓ Teams alert sent for {len(critical_datastores)} missing datastores")
                
                # Log notification to notification_logs
                requests.post(
                    f"{DSM_URL}/rest/v1/notification_logs",
                    headers={
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json'
                    },
                    json={
                        'notification_type': 'teams',
                        'status': 'sent',
                        'job_id': job_id,
                        'severity': 'critical',
                        'delivery_details': {
                            'alert_type': 'datastore_disappeared',
                            'datastores': ds_names,
                            'vcenter_id': vcenter_id,
                            'vcenter_name': vcenter_name
                        }
                    },
                    verify=VERIFY_SSL,
                    timeout=10
                )
            else:
                self.log(f"Teams alert failed: {teams_response.status_code}", "WARN")
                
        except Exception as e:
            self.log(f"Failed to send datastore alert: {e}", "WARN")
    
    def execute_scheduled_vcenter_sync(self, job: Dict):
        """
        Scheduled job that checks all vCenters and triggers syncs based on their configured intervals.
        Runs every 60 seconds to check if any vCenter needs syncing.
        """
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        from job_executor.utils import utc_now_iso
        from datetime import datetime, timedelta
        
        job_id = job['id']
        job_details = job.get('details', {})
        
        try:
            self.log("[vCenter Scheduler] Starting scheduled vCenter sync check...")
            self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details={
                'current_step': 'Checking vCenter sync schedules',
                'is_internal': True
            })
            
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            # Fetch all vCenters with sync_enabled=true
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenters",
                params={
                    'sync_enabled': 'eq.true',
                    'select': 'id,name,sync_interval_minutes,last_sync'
                },
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.status_code != 200:
                raise Exception(f"Failed to fetch vCenters: {response.status_code}")
            
            vcenters = response.json() or []
            syncs_triggered = 0
            checked_count = len(vcenters)
            
            now = datetime.now(timezone.utc)
            
            for vc in vcenters:
                vc_id = vc['id']
                vc_name = vc.get('name', 'Unknown')
                interval_minutes = vc.get('sync_interval_minutes') or 15
                last_sync = vc.get('last_sync')
                
                # Calculate if sync is due
                should_sync = False
                if not last_sync:
                    # Never synced - trigger now
                    should_sync = True
                    self.log(f"[vCenter Scheduler] {vc_name}: Never synced, triggering...")
                else:
                    try:
                        # Parse last_sync timestamp
                        last_sync_dt = datetime.fromisoformat(last_sync.replace('Z', '+00:00'))
                        next_sync_at = last_sync_dt + timedelta(minutes=interval_minutes)
                        now_utc = datetime.now().astimezone()
                        
                        if now_utc >= next_sync_at:
                            should_sync = True
                            self.log(f"[vCenter Scheduler] {vc_name}: Due for sync (last: {last_sync})")
                    except Exception as parse_err:
                        self.log(f"[vCenter Scheduler] {vc_name}: Error parsing last_sync: {parse_err}", "WARN")
                        should_sync = True
                
                if should_sync:
                    # Check if a sync is already running for this vCenter
                    running_check = requests.get(
                        f"{DSM_URL}/rest/v1/jobs",
                        params={
                            'job_type': 'eq.vcenter_sync',
                            'status': 'in.(pending,running)',
                            'select': 'id'
                        },
                        headers=headers,
                        verify=VERIFY_SSL,
                        timeout=10
                    )
                    
                    existing_jobs = running_check.json() if running_check.ok else []
                    
                    # Also check details for this specific vCenter
                    has_running_sync = False
                    for existing_job in existing_jobs:
                        job_check = requests.get(
                            f"{DSM_URL}/rest/v1/jobs",
                            params={
                                'id': f"eq.{existing_job['id']}",
                                'select': 'details'
                            },
                            headers=headers,
                            verify=VERIFY_SSL,
                            timeout=10
                        )
                        if job_check.ok:
                            job_data = job_check.json()
                            if job_data and job_data[0].get('details', {}).get('vcenter_id') == vc_id:
                                has_running_sync = True
                                break
                    
                    if has_running_sync:
                        self.log(f"[vCenter Scheduler] {vc_name}: Sync already in progress, skipping")
                        continue
                    
                    # Create vcenter_sync job
                    sync_job = requests.post(
                        f"{DSM_URL}/rest/v1/jobs",
                        headers={**headers, 'Prefer': 'return=representation'},
                        json={
                            'job_type': 'vcenter_sync',
                            'status': 'pending',
                            'target_scope': {'vcenter_ids': [vc_id]},
                            'details': {
                                'vcenter_id': vc_id,
                                'vcenter_name': vc_name,
                                'triggered_by': 'scheduled_sync',
                                'scheduled_interval_minutes': interval_minutes
                            }
                        },
                        verify=VERIFY_SSL,
                        timeout=10
                    )
                    
                    if sync_job.ok:
                        syncs_triggered += 1
                        self.log(f"[vCenter Scheduler] {vc_name}: Triggered sync job")
                    else:
                        self.log(f"[vCenter Scheduler] {vc_name}: Failed to create sync job: {sync_job.status_code}", "WARN")
            
            # Self-reschedule: create next scheduled_vcenter_sync job
            next_run_at = (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat().replace('+00:00', 'Z')
            
            requests.post(
                f"{DSM_URL}/rest/v1/jobs",
                headers=headers,
                json={
                    'job_type': 'scheduled_vcenter_sync',
                    'status': 'pending',
                    'schedule_at': next_run_at,
                    'details': {'is_internal': True, 'interval_seconds': 60}
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            self.log(f"[vCenter Scheduler] Complete: checked {checked_count} vCenters, triggered {syncs_triggered} syncs")
            
            self.update_job_status(
                job_id, 'completed',
                completed_at=utc_now_iso(),
                details={
                    'is_internal': True,
                    'vcenters_checked': checked_count,
                    'syncs_triggered': syncs_triggered,
                    'next_check_at': next_run_at
                }
            )
            
        except Exception as e:
            self.log(f"[vCenter Scheduler] Error: {e}", "ERROR")
            
            # Still try to reschedule even on error
            try:
                next_run_at = (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat().replace('+00:00', 'Z')
                requests.post(
                    f"{DSM_URL}/rest/v1/jobs",
                    headers={
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json'
                    },
                    json={
                        'job_type': 'scheduled_vcenter_sync',
                        'status': 'pending',
                        'schedule_at': next_run_at,
                        'details': {'is_internal': True, 'interval_seconds': 60}
                    },
                    verify=VERIFY_SSL,
                    timeout=10
                )
            except:
                pass
            
            self.update_job_status(
                job_id, 'failed',
                completed_at=utc_now_iso(),
                details={'error': str(e), 'is_internal': True}
            )
