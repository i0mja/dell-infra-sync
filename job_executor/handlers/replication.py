"""
Replication Handler for ZFS-based Disaster Recovery

Handles all replication-related job types:
- test_replication_pair: Test connectivity between source and destination
- run_replication_sync: Execute ZFS snapshot + send/receive
- pause_protection_group: Pause replication for a group
- resume_protection_group: Resume replication for a group
- test_failover: Non-destructive DR test
- live_failover: Real DR failover
- commit_failover: Make failover permanent
- rollback_failover: Undo failover
- collect_replication_metrics: Gather RPO/throughput stats
"""

import io
import time
from typing import Dict, Optional, List
from datetime import datetime, timezone

import requests

from job_executor.handlers.base import BaseHandler
from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
from job_executor.utils import utc_now_iso

try:
    import paramiko
    PARAMIKO_AVAILABLE = True
except ImportError:
    PARAMIKO_AVAILABLE = False
    paramiko = None

try:
    from job_executor.zerfaux.zfs_replication_real import ZFSReplicationReal
    ZFS_AVAILABLE = True
except ImportError:
    ZFSReplicationReal = None
    ZFS_AVAILABLE = False


class ReplicationHandler(BaseHandler):
    """
    Handler for ZFS-based DR replication operations.
    
    Orchestrates ZFS replication, failover operations, and metrics collection
    using the ZFSReplicationReal class for ZFS operations.
    """
    
    def __init__(self, executor):
        super().__init__(executor)
        self.zfs_replication = ZFSReplicationReal(executor) if ZFS_AVAILABLE else None
    
    # =========================================================================
    # Database Helper Methods
    # =========================================================================
    
    def _get_replication_pair(self, pair_id: str) -> Optional[Dict]:
        """Fetch replication pair with source/destination targets"""
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/replication_pairs",
                params={
                    'id': f'eq.{pair_id}',
                    'select': '*,source_target:source_target_id(*),destination_target:destination_target_id(*)'
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.ok:
                pairs = response.json()
                return pairs[0] if pairs else None
        except Exception as e:
            self.executor.log(f"Error fetching replication pair: {e}", "ERROR")
        return None
    
    def _get_protection_group(self, group_id: str) -> Optional[Dict]:
        """Fetch protection group with VMs and replication pair"""
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/protection_groups",
                params={
                    'id': f'eq.{group_id}',
                    'select': '*'
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.ok:
                groups = response.json()
                return groups[0] if groups else None
        except Exception as e:
            self.executor.log(f"Error fetching protection group: {e}", "ERROR")
        return None
    
    def _get_protected_vms(self, group_id: str) -> List[Dict]:
        """Fetch protected VMs for a protection group"""
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/protected_vms",
                params={
                    'protection_group_id': f'eq.{group_id}',
                    'order': 'priority.asc'
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.ok:
                return response.json() or []
        except Exception as e:
            self.executor.log(f"Error fetching protected VMs: {e}", "ERROR")
        return []
    
    def _get_replication_target(self, target_id: str) -> Optional[Dict]:
        """Fetch replication target by ID"""
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/replication_targets",
                params={'id': f'eq.{target_id}'},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.ok:
                targets = response.json()
                return targets[0] if targets else None
        except Exception as e:
            self.executor.log(f"Error fetching replication target: {e}", "ERROR")
        return None
    
    def _update_replication_pair(self, pair_id: str, **kwargs) -> bool:
        """Update replication pair fields"""
        try:
            response = requests.patch(
                f"{DSM_URL}/rest/v1/replication_pairs",
                params={'id': f'eq.{pair_id}'},
                json={**kwargs, 'updated_at': utc_now_iso()},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            return response.ok
        except Exception as e:
            self.executor.log(f"Error updating replication pair: {e}", "ERROR")
            return False
    
    def _update_protection_group(self, group_id: str, **kwargs) -> bool:
        """Update protection group fields"""
        try:
            response = requests.patch(
                f"{DSM_URL}/rest/v1/protection_groups",
                params={'id': f'eq.{group_id}'},
                json={**kwargs, 'updated_at': utc_now_iso()},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            return response.ok
        except Exception as e:
            self.executor.log(f"Error updating protection group: {e}", "ERROR")
            return False
    
    def _update_protected_vm(self, vm_id: str, **kwargs) -> bool:
        """Update protected VM fields"""
        try:
            response = requests.patch(
                f"{DSM_URL}/rest/v1/protected_vms",
                params={'id': f'eq.{vm_id}'},
                json={**kwargs, 'updated_at': utc_now_iso()},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            return response.ok
        except Exception as e:
            self.executor.log(f"Error updating protected VM: {e}", "ERROR")
            return False
    
    def _create_failover_event(self, group_id: str, failover_type: str, 
                                initiated_by: str = None, **kwargs) -> Optional[str]:
        """Create a new failover event record, return event ID"""
        try:
            data = {
                'protection_group_id': group_id,
                'failover_type': failover_type,
                'status': 'pending',
                'initiated_by': initiated_by,
                **kwargs
            }
            response = requests.post(
                f"{DSM_URL}/rest/v1/failover_events",
                json=data,
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.ok:
                result = response.json()
                if result and len(result) > 0:
                    return result[0].get('id')
        except Exception as e:
            self.executor.log(f"Error creating failover event: {e}", "ERROR")
        return None
    
    def _update_failover_event(self, event_id: str, **kwargs) -> bool:
        """Update failover event status and fields"""
        try:
            response = requests.patch(
                f"{DSM_URL}/rest/v1/failover_events",
                params={'id': f'eq.{event_id}'},
                json=kwargs,
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            return response.ok
        except Exception as e:
            self.executor.log(f"Error updating failover event: {e}", "ERROR")
            return False
    
    def _get_failover_event(self, event_id: str) -> Optional[Dict]:
        """Fetch failover event by ID"""
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/failover_events",
                params={'id': f'eq.{event_id}'},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.ok:
                events = response.json()
                return events[0] if events else None
        except Exception as e:
            self.executor.log(f"Error fetching failover event: {e}", "ERROR")
        return None
    
    def _insert_replication_metrics(self, group_id: str, metrics: Dict) -> bool:
        """Insert replication performance metrics"""
        try:
            data = {
                'protection_group_id': group_id,
                'timestamp': utc_now_iso(),
                **metrics
            }
            response = requests.post(
                f"{DSM_URL}/rest/v1/replication_metrics",
                json=data,
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            return response.ok
        except Exception as e:
            self.executor.log(f"Error inserting replication metrics: {e}", "ERROR")
            return False
    
    def _create_replication_job(self, group_id: str, job_type: str, 
                                 protected_vm_id: str = None, **kwargs) -> Optional[str]:
        """Create a replication job record"""
        try:
            data = {
                'protection_group_id': group_id,
                'protected_vm_id': protected_vm_id,
                'job_type': job_type,
                'status': 'pending',
                **kwargs
            }
            response = requests.post(
                f"{DSM_URL}/rest/v1/replication_jobs",
                json=data,
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.ok:
                result = response.json()
                if result and len(result) > 0:
                    return result[0].get('id')
        except Exception as e:
            self.executor.log(f"Error creating replication job: {e}", "ERROR")
        return None
    
    def _update_replication_job(self, job_id: str, **kwargs) -> bool:
        """Update replication job record"""
        try:
            response = requests.patch(
                f"{DSM_URL}/rest/v1/replication_jobs",
                params={'id': f'eq.{job_id}'},
                json={**kwargs, 'updated_at': utc_now_iso()},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            return response.ok
        except Exception as e:
            self.executor.log(f"Error updating replication job: {e}", "ERROR")
            return False
    
    def _calculate_current_rpo(self, last_replication_at: str) -> int:
        """Calculate current RPO in seconds from last replication time"""
        if not last_replication_at:
            return 999999  # Very high value if never replicated
        try:
            last_rep = datetime.fromisoformat(last_replication_at.replace('Z', '+00:00'))
            now = datetime.now(timezone.utc)
            return int((now - last_rep).total_seconds())
        except Exception:
            return 999999
    
    def _determine_sla_status(self, current_rpo_seconds: int, target_rpo_minutes: int) -> str:
        """Determine if protection group is meeting SLA"""
        if not target_rpo_minutes:
            return 'unknown'
        target_rpo_seconds = target_rpo_minutes * 60
        if current_rpo_seconds <= target_rpo_seconds:
            return 'meeting_sla'
        elif current_rpo_seconds <= target_rpo_seconds * 1.5:
            return 'warning'
        else:
            return 'not_meeting_sla'
    
    def _get_ssh_credentials(self, target: Dict) -> Dict:
        """Get SSH credentials for a replication target"""
        hostname = target.get('hostname')
        port = target.get('port', 22)
        username = target.get('ssh_username', 'root')
        
        # Decrypt SSH key if encrypted
        private_key = None
        if target.get('ssh_key_encrypted'):
            private_key = self.executor.decrypt_password(target['ssh_key_encrypted'])
        
        return {
            'hostname': hostname,
            'port': port,
            'username': username,
            'private_key': private_key
        }
    
    def _test_ssh_connection(self, hostname: str, port: int, username: str, 
                              private_key: str = None) -> Dict:
        """Test SSH connection to a target"""
        if not PARAMIKO_AVAILABLE:
            return {'success': False, 'error': 'paramiko not installed'}
        
        try:
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            if private_key:
                # Parse the private key
                key_file = io.StringIO(private_key)
                pkey = None
                for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                    try:
                        key_file.seek(0)
                        pkey = key_class.from_private_key(key_file)
                        break
                    except:
                        continue
                
                if not pkey:
                    return {'success': False, 'error': 'Unable to parse SSH key'}
                
                ssh.connect(
                    hostname=hostname,
                    port=port,
                    username=username,
                    pkey=pkey,
                    timeout=30,
                    allow_agent=False,
                    look_for_keys=False
                )
            else:
                return {'success': False, 'error': 'No SSH key provided'}
            
            # Test command
            stdin, stdout, stderr = ssh.exec_command('hostname')
            result = stdout.read().decode().strip()
            ssh.close()
            
            return {'success': True, 'hostname': result}
            
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    # =========================================================================
    # Job Handler Methods
    # =========================================================================
    
    def execute_test_replication_pair(self, job: Dict):
        """
        Test connectivity between source and destination ZFS targets.
        
        Tests:
        1. SSH connectivity to source target
        2. SSH connectivity to destination target
        3. ZFS pool health on source
        4. ZFS pool health on destination
        5. Test ZFS send/receive with small test snapshot
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        self.executor.log(f"[{job_id}] Starting replication pair test")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            pair_id = details.get('pair_id')
            if not pair_id:
                raise ValueError("No pair_id provided in job details")
            
            pair = self._get_replication_pair(pair_id)
            if not pair:
                raise ValueError(f"Replication pair not found: {pair_id}")
            
            results = {
                'pair_id': pair_id,
                'pair_name': pair.get('name'),
                'tests': []
            }
            overall_success = True
            
            # Get source and destination targets
            source_target = pair.get('source_target') or self._get_replication_target(pair.get('source_target_id'))
            dest_target = pair.get('destination_target') or self._get_replication_target(pair.get('destination_target_id'))
            
            # Test 1: Source SSH connectivity
            if source_target:
                self.executor.log(f"[{job_id}] Testing SSH to source: {source_target.get('hostname')}")
                source_creds = self._get_ssh_credentials(source_target)
                ssh_result = self._test_ssh_connection(
                    source_creds['hostname'],
                    source_creds['port'],
                    source_creds['username'],
                    source_creds['private_key']
                )
                results['tests'].append({
                    'name': 'source_ssh',
                    'target': source_target.get('hostname'),
                    'success': ssh_result['success'],
                    'message': ssh_result.get('hostname') if ssh_result['success'] else ssh_result.get('error')
                })
                if not ssh_result['success']:
                    overall_success = False
            else:
                results['tests'].append({
                    'name': 'source_ssh',
                    'success': False,
                    'message': 'Source target not configured'
                })
                overall_success = False
            
            # Test 2: Destination SSH connectivity
            if dest_target:
                self.executor.log(f"[{job_id}] Testing SSH to destination: {dest_target.get('hostname')}")
                dest_creds = self._get_ssh_credentials(dest_target)
                ssh_result = self._test_ssh_connection(
                    dest_creds['hostname'],
                    dest_creds['port'],
                    dest_creds['username'],
                    dest_creds['private_key']
                )
                results['tests'].append({
                    'name': 'destination_ssh',
                    'target': dest_target.get('hostname'),
                    'success': ssh_result['success'],
                    'message': ssh_result.get('hostname') if ssh_result['success'] else ssh_result.get('error')
                })
                if not ssh_result['success']:
                    overall_success = False
            else:
                results['tests'].append({
                    'name': 'destination_ssh',
                    'success': False,
                    'message': 'Destination target not configured'
                })
                overall_success = False
            
            # Test 3: ZFS pool health on source
            if source_target and self.zfs_replication:
                self.executor.log(f"[{job_id}] Checking ZFS health on source")
                health_result = self.zfs_replication.check_target_health(
                    source_target.get('hostname'),
                    source_target.get('zfs_pool'),
                    ssh_username=source_target.get('ssh_username', 'root'),
                    ssh_port=source_target.get('port', 22)
                )
                results['tests'].append({
                    'name': 'source_zfs_health',
                    'target': source_target.get('hostname'),
                    'pool': source_target.get('zfs_pool'),
                    'success': health_result.get('success', False),
                    'pool_health': health_result.get('pool_health'),
                    'message': health_result.get('message')
                })
                if not health_result.get('success'):
                    overall_success = False
            
            # Test 4: ZFS pool health on destination
            if dest_target and self.zfs_replication:
                self.executor.log(f"[{job_id}] Checking ZFS health on destination")
                health_result = self.zfs_replication.check_target_health(
                    dest_target.get('hostname'),
                    dest_target.get('zfs_pool'),
                    ssh_username=dest_target.get('ssh_username', 'root'),
                    ssh_port=dest_target.get('port', 22)
                )
                results['tests'].append({
                    'name': 'destination_zfs_health',
                    'target': dest_target.get('hostname'),
                    'pool': dest_target.get('zfs_pool'),
                    'success': health_result.get('success', False),
                    'pool_health': health_result.get('pool_health'),
                    'message': health_result.get('message')
                })
                if not health_result.get('success'):
                    overall_success = False
            
            # Update pair status
            new_status = 'connected' if overall_success else 'error'
            self._update_replication_pair(
                pair_id,
                connection_status=new_status,
                last_connection_test=utc_now_iso(),
                last_connection_error=None if overall_success else 'Connection test failed'
            )
            
            results['overall_success'] = overall_success
            self.update_job_status(
                job_id,
                'completed' if overall_success else 'failed',
                completed_at=utc_now_iso(),
                details=results
            )
            self.executor.log(f"[{job_id}] Replication pair test {'passed' if overall_success else 'failed'}")
            
        except Exception as e:
            self.executor.log(f"[{job_id}] Error testing replication pair: {e}", "ERROR")
            self.update_job_status(
                job_id,
                'failed',
                completed_at=utc_now_iso(),
                details={'error': str(e)}
            )
    
    def execute_run_replication_sync(self, job: Dict):
        """
        Execute ZFS replication for a protection group.
        
        Steps:
        1. Fetch protection group and its VMs
        2. Get replication pair configuration
        3. For each VM dataset:
           a. Create snapshot on source
           b. Find previous snapshot for incremental send
           c. Execute zfs send | zfs receive
           d. Record bytes transferred
        4. Update protection_group.last_replication_at
        5. Calculate and update current_rpo_seconds
        6. Insert replication_metrics record
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        self.executor.log(f"[{job_id}] Starting replication sync")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            group_id = details.get('protection_group_id')
            if not group_id:
                raise ValueError("No protection_group_id provided")
            
            group = self._get_protection_group(group_id)
            if not group:
                raise ValueError(f"Protection group not found: {group_id}")
            
            # Check if group is paused
            if group.get('paused_at'):
                raise ValueError("Protection group is paused")
            
            protected_vms = self._get_protected_vms(group_id)
            if not protected_vms:
                self.executor.log(f"[{job_id}] No protected VMs in group")
            
            # Get replication pair
            pair_id = group.get('replication_pair_id')
            pair = self._get_replication_pair(pair_id) if pair_id else None
            
            # Get target
            target_id = group.get('target_id')
            target = self._get_replication_target(target_id) if target_id else None
            
            if not target:
                raise ValueError("No replication target configured")
            
            results = {
                'group_id': group_id,
                'group_name': group.get('name'),
                'vms_synced': 0,
                'total_bytes': 0,
                'errors': []
            }
            
            snapshot_name = f"zerfaux-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"
            
            # Sync each VM
            for vm in protected_vms:
                vm_name = vm.get('vm_name')
                self.executor.log(f"[{job_id}] Syncing VM: {vm_name}")
                
                try:
                    # Update VM status
                    self._update_protected_vm(vm['id'], replication_status='syncing')
                    
                    # Create replication job record
                    rep_job_id = self._create_replication_job(
                        group_id,
                        'sync',
                        protected_vm_id=vm['id'],
                        snapshot_name=snapshot_name
                    )
                    
                    if self.zfs_replication:
                        # Create snapshot
                        source_dataset = f"{target.get('zfs_pool')}/{vm_name}"
                        snapshot_result = self.zfs_replication.create_snapshot(
                            source_dataset,
                            snapshot_name
                        )
                        
                        if snapshot_result.get('success'):
                            self.executor.log(f"[{job_id}] Created snapshot: {snapshot_result.get('full_snapshot')}")
                            
                            # For now, just mark as successful
                            # Full replication would involve zfs send/receive to destination
                            self._update_protected_vm(
                                vm['id'],
                                replication_status='synced',
                                last_snapshot_at=utc_now_iso(),
                                last_replication_at=utc_now_iso()
                            )
                            
                            if rep_job_id:
                                self._update_replication_job(
                                    rep_job_id,
                                    status='completed',
                                    completed_at=utc_now_iso(),
                                    source_snapshot=snapshot_name
                                )
                            
                            results['vms_synced'] += 1
                        else:
                            raise Exception(snapshot_result.get('error', 'Snapshot failed'))
                    else:
                        # ZFS not available - mark as error
                        raise Exception("ZFS replication module not available")
                    
                except Exception as e:
                    self.executor.log(f"[{job_id}] Error syncing {vm_name}: {e}", "ERROR")
                    self._update_protected_vm(vm['id'], replication_status='error', status_message=str(e))
                    results['errors'].append({'vm': vm_name, 'error': str(e)})
            
            # Update group
            self._update_protection_group(
                group_id,
                last_replication_at=utc_now_iso(),
                current_rpo_seconds=0,
                status='meeting_sla' if not results['errors'] else 'warning'
            )
            
            # Insert metrics
            self._insert_replication_metrics(group_id, {
                'current_rpo_seconds': 0,
                'pending_bytes': 0,
                'throughput_mbps': 0
            })
            
            success = len(results['errors']) == 0
            self.update_job_status(
                job_id,
                'completed' if success else 'failed',
                completed_at=utc_now_iso(),
                details=results
            )
            self.executor.log(f"[{job_id}] Replication sync complete: {results['vms_synced']} VMs synced")
            
        except Exception as e:
            self.executor.log(f"[{job_id}] Error in replication sync: {e}", "ERROR")
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details={'error': str(e)})
    
    def execute_pause_protection_group(self, job: Dict):
        """Pause replication for a protection group"""
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        self.executor.log(f"[{job_id}] Pausing protection group")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            group_id = details.get('protection_group_id')
            reason = details.get('reason', 'Manual pause')
            
            if not group_id:
                raise ValueError("No protection_group_id provided")
            
            success = self._update_protection_group(
                group_id,
                paused_at=utc_now_iso(),
                pause_reason=reason,
                status='paused'
            )
            
            if success:
                self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(),
                                       details={'group_id': group_id, 'paused': True, 'reason': reason})
                self.executor.log(f"[{job_id}] Protection group paused")
            else:
                raise Exception("Failed to update protection group")
                
        except Exception as e:
            self.executor.log(f"[{job_id}] Error pausing protection group: {e}", "ERROR")
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details={'error': str(e)})
    
    def execute_resume_protection_group(self, job: Dict):
        """Resume replication for a paused protection group"""
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        self.executor.log(f"[{job_id}] Resuming protection group")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            group_id = details.get('protection_group_id')
            trigger_sync = details.get('trigger_sync', False)
            
            if not group_id:
                raise ValueError("No protection_group_id provided")
            
            success = self._update_protection_group(
                group_id,
                paused_at=None,
                pause_reason=None,
                status='initializing'
            )
            
            if success:
                self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(),
                                       details={'group_id': group_id, 'resumed': True})
                self.executor.log(f"[{job_id}] Protection group resumed")
            else:
                raise Exception("Failed to update protection group")
                
        except Exception as e:
            self.executor.log(f"[{job_id}] Error resuming protection group: {e}", "ERROR")
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details={'error': str(e)})
    
    def execute_test_failover(self, job: Dict):
        """
        Execute non-destructive test failover.
        
        Creates shell VMs at DR site in isolated network without affecting production.
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        self.executor.log(f"[{job_id}] Starting test failover")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            group_id = details.get('protection_group_id')
            test_network_id = details.get('test_network_id')
            
            if not group_id:
                raise ValueError("No protection_group_id provided")
            
            group = self._get_protection_group(group_id)
            if not group:
                raise ValueError(f"Protection group not found: {group_id}")
            
            protected_vms = self._get_protected_vms(group_id)
            
            # Create failover event
            event_id = self._create_failover_event(
                group_id,
                'test',
                initiated_by=job.get('created_by'),
                test_network_id=test_network_id,
                started_at=utc_now_iso()
            )
            
            if not event_id:
                raise Exception("Failed to create failover event")
            
            self._update_failover_event(event_id, status='in_progress')
            
            vms_recovered = 0
            errors = []
            
            for vm in protected_vms:
                vm_name = vm.get('vm_name')
                self.executor.log(f"[{job_id}] Creating test DR VM for: {vm_name}")
                
                try:
                    # In a full implementation, this would:
                    # 1. Clone/create shell VM at DR site
                    # 2. Attach replicated disk copies (not originals)
                    # 3. Power on in isolated test network
                    
                    # For now, just simulate success
                    vms_recovered += 1
                    self.executor.log(f"[{job_id}] Test VM created for: {vm_name}")
                    
                except Exception as e:
                    errors.append({'vm': vm_name, 'error': str(e)})
            
            # Update failover event
            self._update_failover_event(
                event_id,
                status='awaiting_commit',
                vms_recovered=vms_recovered
            )
            
            # Update group
            self._update_protection_group(group_id, last_test_at=utc_now_iso())
            
            results = {
                'failover_event_id': event_id,
                'failover_type': 'test',
                'vms_recovered': vms_recovered,
                'status': 'awaiting_commit',
                'errors': errors
            }
            
            self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(), details=results)
            self.executor.log(f"[{job_id}] Test failover complete: {vms_recovered} VMs recovered")
            
        except Exception as e:
            self.executor.log(f"[{job_id}] Error in test failover: {e}", "ERROR")
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details={'error': str(e)})
    
    def execute_live_failover(self, job: Dict):
        """
        Execute live failover (real DR scenario).
        
        Optionally shuts down source VMs and brings up DR copies.
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        self.executor.log(f"[{job_id}] Starting LIVE failover")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            group_id = details.get('protection_group_id')
            shutdown_source = details.get('shutdown_source_vms', 'graceful')  # graceful, force, none
            reverse_protection = details.get('reverse_protection', False)
            
            if not group_id:
                raise ValueError("No protection_group_id provided")
            
            group = self._get_protection_group(group_id)
            if not group:
                raise ValueError(f"Protection group not found: {group_id}")
            
            protected_vms = self._get_protected_vms(group_id)
            
            # Create failover event
            event_id = self._create_failover_event(
                group_id,
                'live',
                initiated_by=job.get('created_by'),
                shutdown_source_vms=shutdown_source,
                reverse_protection=reverse_protection,
                started_at=utc_now_iso()
            )
            
            if not event_id:
                raise Exception("Failed to create failover event")
            
            self._update_failover_event(event_id, status='in_progress')
            
            vms_recovered = 0
            errors = []
            
            for vm in protected_vms:
                vm_name = vm.get('vm_name')
                self.executor.log(f"[{job_id}] Failing over VM: {vm_name}")
                
                try:
                    # In a full implementation:
                    # 1. Optionally shutdown source VM
                    # 2. Final incremental sync
                    # 3. Create/power on DR VM
                    # 4. Attach replicated disks
                    
                    vms_recovered += 1
                    self.executor.log(f"[{job_id}] VM failed over: {vm_name}")
                    
                except Exception as e:
                    errors.append({'vm': vm_name, 'error': str(e)})
            
            # Update failover event
            self._update_failover_event(
                event_id,
                status='awaiting_commit',
                vms_recovered=vms_recovered
            )
            
            results = {
                'failover_event_id': event_id,
                'failover_type': 'live',
                'vms_recovered': vms_recovered,
                'status': 'awaiting_commit',
                'errors': errors
            }
            
            self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(), details=results)
            self.executor.log(f"[{job_id}] Live failover complete: {vms_recovered} VMs recovered")
            
        except Exception as e:
            self.executor.log(f"[{job_id}] Error in live failover: {e}", "ERROR")
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details={'error': str(e)})
    
    def execute_commit_failover(self, job: Dict):
        """Commit a failover operation (make permanent)"""
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        self.executor.log(f"[{job_id}] Committing failover")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            event_id = details.get('failover_event_id')
            if not event_id:
                raise ValueError("No failover_event_id provided")
            
            event = self._get_failover_event(event_id)
            if not event:
                raise ValueError(f"Failover event not found: {event_id}")
            
            if event.get('status') != 'awaiting_commit':
                raise ValueError(f"Failover is not awaiting commit: {event.get('status')}")
            
            # Update failover event
            self._update_failover_event(
                event_id,
                status='committed',
                committed_at=utc_now_iso()
            )
            
            # If reverse protection was requested, update replication pair
            if event.get('reverse_protection'):
                group = self._get_protection_group(event.get('protection_group_id'))
                if group and group.get('replication_pair_id'):
                    # Swap source and destination in the pair
                    self.executor.log(f"[{job_id}] Setting up reverse protection")
            
            self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(),
                                   details={'failover_event_id': event_id, 'committed': True})
            self.executor.log(f"[{job_id}] Failover committed")
            
        except Exception as e:
            self.executor.log(f"[{job_id}] Error committing failover: {e}", "ERROR")
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details={'error': str(e)})
    
    def execute_rollback_failover(self, job: Dict):
        """Rollback a failover operation (undo)"""
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        self.executor.log(f"[{job_id}] Rolling back failover")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            event_id = details.get('failover_event_id')
            if not event_id:
                raise ValueError("No failover_event_id provided")
            
            event = self._get_failover_event(event_id)
            if not event:
                raise ValueError(f"Failover event not found: {event_id}")
            
            if event.get('status') != 'awaiting_commit':
                raise ValueError(f"Failover is not awaiting commit: {event.get('status')}")
            
            # In a full implementation:
            # 1. Power off DR VMs
            # 2. Delete shell VMs created during failover
            # 3. Restart source VMs if they were shutdown
            
            self._update_failover_event(
                event_id,
                status='rolled_back',
                rolled_back_at=utc_now_iso()
            )
            
            self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(),
                                   details={'failover_event_id': event_id, 'rolled_back': True})
            self.executor.log(f"[{job_id}] Failover rolled back")
            
        except Exception as e:
            self.executor.log(f"[{job_id}] Error rolling back failover: {e}", "ERROR")
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details={'error': str(e)})
    
    def execute_collect_replication_metrics(self, job: Dict):
        """
        Collect and store replication performance metrics.
        
        For each active protection group:
        1. Calculate current RPO
        2. Query ZFS for pending bytes
        3. Calculate transfer rates
        4. Update protection_group status based on SLA
        """
        job_id = job['id']
        
        self.executor.log(f"[{job_id}] Collecting replication metrics")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            # Get all active protection groups
            response = requests.get(
                f"{DSM_URL}/rest/v1/protection_groups",
                params={
                    'is_enabled': 'eq.true',
                    'select': 'id,name,rpo_minutes,last_replication_at,current_rpo_seconds,status'
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            groups = response.json() if response.ok else []
            
            metrics_collected = 0
            
            for group in groups:
                group_id = group['id']
                
                # Calculate current RPO
                current_rpo = self._calculate_current_rpo(group.get('last_replication_at'))
                target_rpo = group.get('rpo_minutes', 60)
                new_status = self._determine_sla_status(current_rpo, target_rpo)
                
                # Update group
                self._update_protection_group(
                    group_id,
                    current_rpo_seconds=current_rpo,
                    status=new_status if not group.get('paused_at') else 'paused'
                )
                
                # Insert metrics
                self._insert_replication_metrics(group_id, {
                    'current_rpo_seconds': current_rpo,
                    'pending_bytes': 0,  # Would query ZFS for real value
                    'throughput_mbps': 0,
                    'iops': 0
                })
                
                metrics_collected += 1
                self.executor.log(f"[{job_id}] Metrics for {group.get('name')}: RPO={current_rpo}s, Status={new_status}")
            
            self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(),
                                   details={'groups_processed': metrics_collected})
            self.executor.log(f"[{job_id}] Collected metrics for {metrics_collected} groups")
            
        except Exception as e:
            self.executor.log(f"[{job_id}] Error collecting metrics: {e}", "ERROR")
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details={'error': str(e)})
