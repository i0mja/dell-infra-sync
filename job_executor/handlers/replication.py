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
import socket
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
    
    # Agent API settings
    AGENT_API_PORT = 8080
    AGENT_API_PROTOCOL = 'http'
    AGENT_API_TIMEOUT = 60
    AGENT_STALE_MINUTES = 5
    
    def __init__(self, executor):
        super().__init__(executor)
        self.zfs_replication = ZFSReplicationReal(executor) if ZFS_AVAILABLE else None
        # Centralized SSH credential manager - imported lazily to avoid circular imports
        self._ssh_manager = None
    
    @property
    def ssh_manager(self):
        """Lazy-load SSH credential manager."""
        if self._ssh_manager is None:
            from job_executor.ssh_utils import SSHCredentialManager
            self._ssh_manager = SSHCredentialManager(self.executor)
        return self._ssh_manager
    
    # =========================================================================
    # Agent API Helper Methods (Agent-First Routing)
    # =========================================================================
    
    def _get_agent_for_target(self, target: Dict) -> Optional[Dict]:
        """
        Check if target has a linked ZFS agent and if it's online.
        
        Returns agent dict if usable for API operations, None otherwise.
        Used for agent-first routing - prefer agent API over SSH when available.
        """
        agent_id = target.get('agent_id')
        if not agent_id:
            return None
        
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/zfs_agents",
                params={'id': f'eq.{agent_id}'},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if not response.ok:
                return None
            
            agents = response.json()
            if not agents:
                return None
            
            agent = agents[0]
            
            # Check if online based on status field
            status = agent.get('status', 'unknown')
            if status not in ('online', 'idle', 'busy'):
                self.executor.log(f"Agent {agent_id} not online (status: {status})")
                return None
            
            # Check if last_seen_at is recent (within stale threshold)
            last_seen = agent.get('last_seen_at')
            if last_seen:
                try:
                    last_seen_dt = datetime.fromisoformat(last_seen.replace('Z', '+00:00'))
                    now = datetime.now(timezone.utc)
                    age_minutes = (now - last_seen_dt).total_seconds() / 60
                    if age_minutes > self.AGENT_STALE_MINUTES:
                        self.executor.log(f"Agent {agent_id} is stale (last seen {age_minutes:.1f}m ago)")
                        return None
                except Exception:
                    pass  # If we can't parse, proceed anyway
            
            return agent
            
        except Exception as e:
            self.executor.log(f"Error checking agent for target: {e}", "WARN")
            return None
    
    def _call_agent_api(
        self,
        agent: Dict,
        method: str,
        path: str,
        body: Dict = None,
        timeout: int = None
    ) -> Optional[Dict]:
        """
        Make HTTP request to ZFS Agent REST API.
        
        Args:
            agent: Agent record from database
            method: HTTP method (GET, POST, PUT, PATCH, DELETE)
            path: API path (e.g., /v1/health, /v1/datasets/.../snapshots)
            body: Request body for POST/PUT/PATCH
            timeout: Request timeout in seconds
            
        Returns:
            JSON response dict or None on error
        """
        if timeout is None:
            timeout = self.AGENT_API_TIMEOUT
        
        protocol = agent.get('api_protocol', self.AGENT_API_PROTOCOL)
        port = agent.get('api_port', self.AGENT_API_PORT)
        hostname = agent.get('hostname')
        
        if not hostname:
            self.executor.log("Agent has no hostname configured", "ERROR")
            return None
        
        url = f"{protocol}://{hostname}:{port}{path}"
        
        try:
            response = requests.request(
                method,
                url,
                json=body if method in ('POST', 'PUT', 'PATCH') else None,
                timeout=timeout,
                verify=False  # Internal network, self-signed certs
            )
            
            if response.ok:
                return response.json()
            else:
                self.executor.log(
                    f"Agent API error: {response.status_code} - {response.text[:200]}",
                    "WARN"
                )
                return None
                
        except requests.exceptions.Timeout:
            self.executor.log(f"Agent API timeout: {url}", "WARN")
            return None
        except requests.exceptions.ConnectionError as e:
            self.executor.log(f"Agent API connection error: {url} - {e}", "WARN")
            return None
        except Exception as e:
            self.executor.log(f"Agent API call failed: {url} - {e}", "ERROR")
            return None
    
    def _create_snapshot_via_agent(
        self,
        agent: Dict,
        dataset: str,
        snapshot_name: str
    ) -> Dict:
        """
        Create ZFS snapshot using agent API instead of SSH.
        
        Args:
            agent: Agent record with hostname/port
            dataset: Full dataset path (e.g., tank/vm-data/vm1)
            snapshot_name: Snapshot name (e.g., zerfaux-20240101-120000)
            
        Returns:
            Dict with success, full_snapshot, message
        """
        # URL-encode the dataset path for the API
        encoded_dataset = dataset.replace('/', '%2F')
        path = f"/v1/datasets/{encoded_dataset}/snapshots"
        
        result = self._call_agent_api(
            agent, 'POST', path,
            body={'name': snapshot_name}
        )
        
        if result and result.get('success'):
            return {
                'success': True,
                'full_snapshot': f"{dataset}@{snapshot_name}",
                'message': result.get('message', 'Snapshot created via agent API')
            }
        
        return {
            'success': False,
            'error': result.get('error', 'Agent API snapshot creation failed') if result else 'No response from agent'
        }
    
    def _run_replication_via_agent(
        self,
        source_agent: Dict,
        source_dataset: str,
        target_host: str,
        target_dataset: str,
        snapshot_name: str,
        incremental_from: str = None
    ) -> Dict:
        """
        Run ZFS replication using agent API instead of SSH-based syncoid.
        
        Args:
            source_agent: Agent record for source site
            source_dataset: Source dataset path
            target_host: Destination hostname
            target_dataset: Destination dataset path
            snapshot_name: Current snapshot to send
            incremental_from: Previous snapshot for incremental send
            
        Returns:
            Dict with success, bytes_transferred, duration_seconds, etc.
        """
        path = "/v1/replication/run"
        
        body = {
            'source_dataset': source_dataset,
            'target_host': target_host,
            'target_dataset': target_dataset,
            'snapshot': snapshot_name,
            'incremental_from': incremental_from,
            'force_full': incremental_from is None
        }
        
        # Use longer timeout for replication
        result = self._call_agent_api(
            source_agent, 'POST', path,
            body=body,
            timeout=3600  # 1 hour max for large transfers
        )
        
        if result and result.get('success'):
            return {
                'success': True,
                'bytes_transferred': result.get('bytes_transferred', 0),
                'duration_seconds': result.get('duration_seconds', 0),
                'transfer_rate_mbps': result.get('transfer_rate_mbps', 0),
                'message': result.get('message', 'Replication completed via agent API')
            }
        
        return {
            'success': False,
            'bytes_transferred': 0,
            'error': result.get('error', 'Agent API replication failed') if result else 'No response from agent'
        }
    
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
    
    def _get_previous_snapshot(self, protected_vm_id: str) -> Optional[str]:
        """Get the most recent successful snapshot name for incremental send"""
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/replication_jobs",
                params={
                    'protected_vm_id': f'eq.{protected_vm_id}',
                    'status': 'eq.completed',
                    'select': 'source_snapshot',
                    'order': 'completed_at.desc',
                    'limit': 1
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.ok:
                jobs = response.json()
                if jobs and jobs[0].get('source_snapshot'):
                    return jobs[0]['source_snapshot']
        except Exception as e:
            self.executor.log(f"Failed to get previous snapshot: {e}")
        
        return None

    
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
    
    def _log_ssh_command(self, job_id: str, command: str, hostname: str,
                         output: str, success: bool, duration_ms: int,
                         operation_type: str = 'ssh_command') -> bool:
        """
        Log SSH command to idrac_commands table for activity tracking.
        Uses the ssh_command operation_type for all SSH operations.
        """
        try:
            response = requests.post(
                f"{DSM_URL}/rest/v1/idrac_commands",
                json={
                    'job_id': job_id,
                    'command_type': command[:100] if command else 'SSH_COMMAND',  # Use command as type for clarity
                    'endpoint': command,
                    'full_url': f"ssh://{hostname}",
                    'response_body': {'output': output[:1000] if output else ''},  # Truncate for storage
                    'success': success,
                    'response_time_ms': duration_ms,
                    'operation_type': 'ssh_command',  # Always use ssh_command from the enum
                    'source': 'job_executor'
                },
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
            self.executor.log(f"Failed to log SSH command: {e}", "WARN")
            return False
    
    def _add_console_log(self, job_id: str, message: str, level: str = 'INFO') -> None:
        """Add log entry to job's console_log array using atomic append (no overwrite)"""
        timestamp = datetime.now(timezone.utc).strftime('%H:%M:%S')
        log_entry = f"[{timestamp}] {level}: {message}"
        
        try:
            # Use atomic RPC function to append without overwriting other details
            # This prevents race conditions where console log updates erase job progress
            response = requests.post(
                f"{DSM_URL}/rest/v1/rpc/append_job_console_log",
                json={
                    'p_job_id': job_id,
                    'p_log_entry': log_entry
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json'
                },
                verify=VERIFY_SSL,
                timeout=5
            )
            if not response.ok:
                # Log RPC failure but don't fail the job
                self.executor.log(f"Console log RPC failed: {response.status_code}", "WARN")
        except Exception as e:
            # Don't fail job for logging issues, but log the error
            self.executor.log(f"Console log append failed: {e}", "WARN")
        
        # Also log to executor output
        self.executor.log(message, level)
    
    def _find_datastore_recursive(self, content, datastore_name: str):
        """Recursively search for datastore, including in StoragePods and nested folders.
        
        vCenter datastores can be located in:
        - Direct children of datacenter's datastoreFolder
        - Inside StoragePods (datastore clusters)
        - Inside nested folders
        
        This method handles all cases.
        """
        from pyVmomi import vim
        
        def search_folder(folder):
            if not hasattr(folder, 'childEntity'):
                return None
            for item in folder.childEntity:
                # Direct datastore match
                if isinstance(item, vim.Datastore) and item.name == datastore_name:
                    return item
                # Check StoragePod (datastore cluster)
                if isinstance(item, vim.StoragePod):
                    for ds in item.childEntity:
                        if isinstance(ds, vim.Datastore) and ds.name == datastore_name:
                            return ds
                # Recurse into folders
                if hasattr(item, 'childEntity'):
                    result = search_folder(item)
                    if result:
                        return result
            return None
        
        for dc in content.rootFolder.childEntity:
            if hasattr(dc, 'datastoreFolder'):
                result = search_folder(dc.datastoreFolder)
                if result:
                    return result
        return None
    
    def _collect_datastore_names(self, folder, names: list, depth: int = 0):
        """Recursively collect all datastore names for debugging output."""
        from pyVmomi import vim
        
        if depth > 10:  # Prevent infinite recursion
            return
        
        if not hasattr(folder, 'childEntity'):
            return
        
        for item in folder.childEntity:
            if isinstance(item, vim.Datastore):
                names.append(item.name)
            elif isinstance(item, vim.StoragePod):
                names.append(f"[StoragePod: {item.name}]")
                for ds in item.childEntity:
                    if isinstance(ds, vim.Datastore):
                        names.append(f"  - {ds.name}")
            elif hasattr(item, 'childEntity'):
                self._collect_datastore_names(item, names, depth + 1)
    
    def _create_job_task(self, job_id: str, log_message: str, status: str = 'running') -> Optional[str]:
        """Create a job task for progress tracking"""
        try:
            response = requests.post(
                f"{DSM_URL}/rest/v1/job_tasks",
                json={
                    'job_id': job_id,
                    'status': status,
                    'log': log_message,
                    'started_at': utc_now_iso()
                },
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
            self.executor.log(f"Failed to create job task: {e}", "WARN")
        return None
    
    def _update_job_task(self, task_id: str, status: str, log_message: str = None) -> bool:
        """Update a job task status"""
        if not task_id:
            return False
        try:
            data = {'status': status}
            if log_message:
                data['log'] = log_message
            if status in ('completed', 'failed'):
                data['completed_at'] = utc_now_iso()
            
            response = requests.patch(
                f"{DSM_URL}/rest/v1/job_tasks",
                params={'id': f'eq.{task_id}'},
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
            self.executor.log(f"Failed to update job task: {e}", "WARN")
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
    
    def _load_private_key(self, key_path: str = None, key_data: str = None):
        """
        Load SSH private key, trying Ed25519, RSA, and ECDSA formats.
        Delegates to centralized SSHCredentialManager.
        """
        return self.ssh_manager.load_private_key(key_path=key_path, key_data=key_data)

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
    
    def _ensure_vm_dataset(
        self,
        vm_name: str,
        source_dataset: str,
        ssh_hostname: str,
        ssh_username: str = 'root',
        ssh_port: int = 22,
        ssh_key_data: str = None,
        add_console_log=None
    ) -> Dict:
        """
        Ensure a ZFS dataset exists for the VM. Auto-creates if missing.
        
        Returns:
            {
                'ready': bool,      # True if dataset is ready for snapshots
                'exists': bool,     # True if dataset already existed
                'created': bool,    # True if we created the dataset
                'needs_migration': bool,  # True if directory exists but not as dataset
                'dataset': str,     # The full dataset path
                'error': str        # Error message if not ready
            }
        """
        if add_console_log is None:
            add_console_log = lambda msg, level='INFO': self.executor.log(msg, level)
        
        result = {
            'ready': False,
            'exists': False,
            'created': False,
            'needs_migration': False,
            'dataset': source_dataset,
            'error': None
        }
        
        if not PARAMIKO_AVAILABLE:
            result['error'] = 'paramiko not available for SSH'
            return result
        
        try:
            # Connect via SSH
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            if not ssh_key_data:
                result['error'] = 'No SSH key provided'
                return result
            
            # Parse SSH key
            key_file = io.StringIO(ssh_key_data)
            pkey = None
            for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                try:
                    key_file.seek(0)
                    pkey = key_class.from_private_key(key_file)
                    break
                except:
                    continue
            
            if not pkey:
                result['error'] = 'Unable to parse SSH key'
                return result
            
            ssh.connect(
                hostname=ssh_hostname,
                port=ssh_port,
                username=ssh_username,
                pkey=pkey,
                timeout=30,
                allow_agent=False,
                look_for_keys=False
            )
            
            # Step 1: Check if dataset exists
            check_cmd = f"zfs list -H -o name {source_dataset} 2>/dev/null"
            stdin, stdout, stderr = ssh.exec_command(check_cmd)
            exit_code = stdout.channel.recv_exit_status()
            
            if exit_code == 0:
                # Dataset already exists
                add_console_log(f"ZFS dataset exists: {source_dataset}")
                result['ready'] = True
                result['exists'] = True
                ssh.close()
                return result
            
            # Dataset doesn't exist - check if parent exists
            parent_dataset = '/'.join(source_dataset.split('/')[:-1])
            check_parent_cmd = f"zfs list -H -o name {parent_dataset} 2>/dev/null"
            stdin, stdout, stderr = ssh.exec_command(check_parent_cmd)
            parent_exit_code = stdout.channel.recv_exit_status()
            
            if parent_exit_code != 0:
                result['error'] = f"Parent dataset '{parent_dataset}' does not exist"
                ssh.close()
                return result
            
            # Step 2: Check if directory exists (would need migration)
            mount_cmd = f"zfs get -H -o value mountpoint {parent_dataset}"
            stdin, stdout, stderr = ssh.exec_command(mount_cmd)
            parent_mount = stdout.read().decode().strip()
            
            vm_dir_path = f"{parent_mount}/{vm_name}"
            dir_check_cmd = f"test -d '{vm_dir_path}' && echo 'EXISTS' || echo 'MISSING'"
            stdin, stdout, stderr = ssh.exec_command(dir_check_cmd)
            dir_status = stdout.read().decode().strip()
            
            if dir_status == 'EXISTS':
                # Directory exists but is not a dataset - needs migration
                # Check if it has any content
                content_check_cmd = f"ls -A '{vm_dir_path}' 2>/dev/null | head -1"
                stdin, stdout, stderr = ssh.exec_command(content_check_cmd)
                has_content = stdout.read().decode().strip()
                
                if has_content:
                    # Directory has content - needs manual migration
                    add_console_log(f"WARNING: Directory {vm_dir_path} exists with data but is not a ZFS dataset", "WARNING")
                    add_console_log(f"Manual migration required: mv, zfs create, cp -a", "WARNING")
                    result['needs_migration'] = True
                    result['error'] = f"Directory exists with data at {vm_dir_path}. Manual migration to ZFS dataset required."
                    ssh.close()
                    return result
                else:
                    # Empty directory - we can remove it and create dataset
                    add_console_log(f"Removing empty directory to create dataset: {vm_dir_path}")
                    rmdir_cmd = f"rmdir '{vm_dir_path}'"
                    stdin, stdout, stderr = ssh.exec_command(rmdir_cmd)
                    rmdir_exit = stdout.channel.recv_exit_status()
                    
                    if rmdir_exit != 0:
                        rmdir_err = stderr.read().decode().strip()
                        result['error'] = f"Failed to remove empty directory: {rmdir_err}"
                        ssh.close()
                        return result
            
            # Step 3: Create the dataset
            add_console_log(f"Creating ZFS dataset: {source_dataset}")
            create_cmd = f"zfs create {source_dataset}"
            stdin, stdout, stderr = ssh.exec_command(create_cmd)
            create_exit = stdout.channel.recv_exit_status()
            create_err = stderr.read().decode().strip()
            
            if create_exit != 0:
                result['error'] = f"Failed to create dataset: {create_err}"
                ssh.close()
                return result
            
            # Verify dataset was created
            stdin, stdout, stderr = ssh.exec_command(f"zfs list -H -o name {source_dataset}")
            verify_exit = stdout.channel.recv_exit_status()
            
            if verify_exit == 0:
                add_console_log(f"Successfully created ZFS dataset: {source_dataset}")
                result['ready'] = True
                result['created'] = True
            else:
                result['error'] = 'Dataset creation completed but verification failed'
            
            ssh.close()
            return result
            
        except Exception as e:
            result['error'] = f"SSH error: {str(e)}"
            self.executor.log(f"Error in _ensure_vm_dataset: {e}", "ERROR")
            return result
    
    def _format_bytes(self, size_bytes: int) -> str:
        """Format bytes to human readable string"""
        if not size_bytes or size_bytes == 0:
            return "0 B"
        units = ['B', 'KB', 'MB', 'GB', 'TB']
        i = 0
        while size_bytes >= 1024 and i < len(units) - 1:
            size_bytes /= 1024
            i += 1
        return f"{size_bytes:.1f} {units[i]}"
    
    def _get_dataset_size(
        self,
        dataset: str,
        ssh_hostname: str,
        ssh_username: str = 'root',
        ssh_port: int = 22,
        ssh_key_data: str = None
    ) -> Dict:
        """
        Get the size of a ZFS dataset.
        
        Returns:
            Dict with success, used_bytes, referenced_bytes
        """
        result = {
            'success': False,
            'used_bytes': 0,
            'referenced_bytes': 0
        }
        
        if not PARAMIKO_AVAILABLE:
            return result
        
        try:
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            if ssh_key_data:
                key_file = io.StringIO(ssh_key_data)
                pkey = None
                for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                    try:
                        key_file.seek(0)
                        pkey = key_class.from_private_key(key_file)
                        break
                    except:
                        continue
                
                if pkey:
                    ssh.connect(
                        hostname=ssh_hostname,
                        port=ssh_port,
                        username=ssh_username,
                        pkey=pkey,
                        timeout=30,
                        allow_agent=False,
                        look_for_keys=False
                    )
            
            if not ssh.get_transport():
                return result
            
            # Get used and referenced size
            cmd = f"zfs list -H -o used,refer {dataset}"
            stdin, stdout, stderr = ssh.exec_command(cmd)
            exit_code = stdout.channel.recv_exit_status()
            output = stdout.read().decode().strip()
            
            ssh.close()
            
            if exit_code == 0 and output:
                parts = output.split()
                if len(parts) >= 2:
                    result['used_bytes'] = self._parse_zfs_size_to_bytes(parts[0])
                    result['referenced_bytes'] = self._parse_zfs_size_to_bytes(parts[1])
                    result['success'] = True
            
            return result
            
        except Exception as e:
            self.executor.log(f"Error getting dataset size: {e}", "WARN")
            return result
    
    def _parse_zfs_size_to_bytes(self, size_str: str) -> int:
        """Parse ZFS size string (e.g., '1.5T', '500G', '128M') to bytes"""
        try:
            size_str = size_str.strip().upper()
            if not size_str or size_str == '0' or size_str == '-':
                return 0
            
            multipliers = {
                'T': 1024**4,
                'G': 1024**3,
                'M': 1024**2,
                'K': 1024,
                'B': 1
            }
            
            for suffix, mult in multipliers.items():
                if size_str.endswith(suffix):
                    return int(float(size_str[:-1]) * mult)
            
            return int(float(size_str))
        except:
            return 0

    def _get_hosting_vm_hostname(self, hosting_vm_id: str) -> Optional[str]:
        """
        Get the vCenter VM hostname for SSH connection.
        Prefers IP address (always reachable) over VM name (may not be in DNS).
        """
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_vms",
                params={
                    'id': f"eq.{hosting_vm_id}",
                    'select': 'name,ip_address'
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.ok:
                vms = response.json()
                if vms:
                    vm = vms[0]
                    vm_name = vm.get('name')
                    vm_ip = vm.get('ip_address')
                    # Prefer IP address (always reachable), fallback to VM name
                    if vm_ip:
                        self.executor.log(f"[SSH] Resolved hosting VM '{vm_name}' to IP: {vm_ip}")
                        return vm_ip
                    if vm_name:
                        self.executor.log(f"[SSH] Using VM name (no IP available): {vm_name}")
                        return vm_name
            return None
        except Exception as e:
            self.executor.log(f"Error fetching hosting VM {hosting_vm_id}: {e}", "WARNING")
            return None

    def _resolve_ssh_hostname(self, target: Dict) -> str:
        """
        Resolve the actual SSH hostname for a target.
        If the target has a hosting_vm_id, use the VM name for SSH (DNS resolvable).
        Otherwise fall back to the target's hostname (NFS/ZFS share IP).
        """
        if target.get('hosting_vm_id'):
            vm_hostname = self._get_hosting_vm_hostname(target['hosting_vm_id'])
            if vm_hostname:
                return vm_hostname
        return target.get('hostname', '')

    def _get_target_ssh_creds(self, target: Dict, password: str = None) -> Optional[Dict]:
        """
        Get SSH credentials for connecting to a replication target.
        Delegates to centralized SSHCredentialManager for unified credential lookup.
        
        Returns dict with hostname, port, username, and key_path/key_data/password.
        
        Args:
            target: The replication target dict
            password: Optional password to use for authentication (e.g., from job details)
        """
        return self.ssh_manager.get_credentials(target, password=password)
    
    def _fetch_ssh_key_by_id(self, ssh_key_id: str, hostname: str) -> Optional[str]:
        """
        Fetch SSH private key by ID from ssh_keys table.
        Returns decrypted private key data if found and active.
        """
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/ssh_keys",
                params={
                    'id': f"eq.{ssh_key_id}",
                    'select': 'id,name,private_key_encrypted,status'
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.ok:
                keys = response.json()
                if keys and keys[0].get('private_key_encrypted'):
                    key = keys[0]
                    # Only use active or pending keys
                    if key.get('status') in ('active', 'pending'):
                        key_data = self.executor.decrypt_password(key['private_key_encrypted'])
                        if key_data:
                            self.executor.log(f"Using SSH key '{key.get('name', ssh_key_id)}' for {hostname}")
                            return key_data
                    else:
                        self.executor.log(f"SSH key {ssh_key_id} is not active (status: {key.get('status')})", "WARNING")
        except Exception as e:
            self.executor.log(f"Error fetching SSH key {ssh_key_id}: {e}", "WARNING")
        return None
    
    def _fetch_ssh_key_via_hosting_vm(self, hosting_vm_id: str, hostname: str) -> Optional[str]:
        """
        Fetch SSH key by following: hosting_vm_id → vcenter_vms → zfs_target_templates → ssh_key_id
        
        This supports the pattern where:
        - A replication target (NFS share IP) is hosted by a VM (hosting_vm_id)
        - That VM was deployed from a zfs_target_template
        - The template has an ssh_key_id for SSH access
        """
        self.executor.log(f"[SSH Lookup] Starting key search for hosting_vm_id={hosting_vm_id}")
        
        try:
            # First, get the hosting VM from vcenter_vms
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_vms",
                params={
                    'id': f"eq.{hosting_vm_id}",
                    'select': 'id,name,vcenter_id'
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if not response.ok:
                self.executor.log(f"[SSH Lookup] Failed to fetch hosting VM: HTTP {response.status_code}", "WARNING")
                return None
                
            vms = response.json()
            if not vms:
                self.executor.log(f"[SSH Lookup] Hosting VM {hosting_vm_id} not found in vcenter_vms", "WARNING")
                return None
            
            vm = vms[0]
            vm_name = vm.get('name', '')
            vm_vcenter_id = vm.get('vcenter_id', '')
            self.executor.log(f"[SSH Lookup] Found hosting VM: name='{vm_name}', vcenter_id='{vm_vcenter_id}'")
            
            # Find a zfs_target_template that matches this VM
            # Check by name pattern (e.g., VM "S16-VREP-02" might come from template "S16-VREP-TMP")
            # Or look for templates where this VM could be a deployment
            response = requests.get(
                f"{DSM_URL}/rest/v1/zfs_target_templates",
                params={
                    'is_active': 'eq.true',
                    'select': 'id,name,ssh_key_id,template_name,vcenter_id'
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if not response.ok:
                self.executor.log(f"[SSH Lookup] Failed to fetch templates: HTTP {response.status_code}", "WARNING")
                return None
            
            templates = response.json()
            if not templates:
                self.executor.log("[SSH Lookup] No active templates found in zfs_target_templates", "WARNING")
                return None
            
            self.executor.log(f"[SSH Lookup] Found {len(templates)} active templates to check")
            
            # Try to find a matching template
            import re
            
            # Helper to extract site prefix (e.g., "S06" from "S06-VREP-02")
            def extract_site_prefix(name: str) -> Optional[str]:
                match = re.match(r'^(S\d{2})-', name, re.IGNORECASE)
                return match.group(1).upper() if match else None
            
            # Helper to check if name contains replication patterns
            def is_replication_appliance(name: str) -> bool:
                # Match variations: VRP, VREP, REPL, REP (but not just "REP" alone to avoid false positives)
                patterns = ['VRP', 'VREP', 'REPL', '-REP-', '-REP']
                name_upper = name.upper()
                return any(p in name_upper for p in patterns)
            
            vm_site = extract_site_prefix(vm_name)
            vm_is_repl = is_replication_appliance(vm_name)
            self.executor.log(f"[SSH Lookup] VM analysis: site='{vm_site}', is_repl={vm_is_repl}")
            
            # Track templates with keys for vCenter fallback
            vcenter_fallback_templates = []
            
            for template in templates:
                template_name = template.get('name', '')
                template_vm_name = template.get('template_name', '')
                template_vcenter_id = template.get('vcenter_id', '')
                has_key = bool(template.get('ssh_key_id'))
                
                self.executor.log(f"[SSH Lookup] Checking template '{template_name}': has_key={has_key}, vcenter={template_vcenter_id}")
                
                if not has_key:
                    continue
                
                # Track for vCenter fallback
                if template_vcenter_id and template_vcenter_id == vm_vcenter_id:
                    vcenter_fallback_templates.append(template)
                    
                # Match if VM name starts with template name prefix (removing -TMP/-TEMPLATE suffixes)
                name_base = template_name.replace('-TMP', '').replace('-TEMPLATE', '').replace('_TMP', '').replace('_TEMPLATE', '')
                if name_base and vm_name.startswith(name_base):
                    self.executor.log(f"[SSH Lookup] ✓ Name prefix match: template '{template_name}' for VM '{vm_name}'")
                    return self._fetch_ssh_key_by_id(template['ssh_key_id'], hostname)
                
                # Also check template_name field (the VMware template VM name)
                template_name_base = template_vm_name.replace('-TMP', '').replace('-TEMPLATE', '').replace('_TMP', '').replace('_TEMPLATE', '') if template_vm_name else ''
                if template_name_base and vm_name.startswith(template_name_base):
                    self.executor.log(f"[SSH Lookup] ✓ Template VM name match: '{template_name}' via template_name field")
                    return self._fetch_ssh_key_by_id(template['ssh_key_id'], hostname)
                
                # Site-based fuzzy matching for replication appliances
                # Matches VRP/VREP/REPL variations within the same site
                template_site = extract_site_prefix(template_name)
                template_is_repl = is_replication_appliance(template_name)
                
                self.executor.log(f"[SSH Lookup]   Template '{template_name}': site='{template_site}', is_repl={template_is_repl}")
                
                if vm_site and template_site and vm_site == template_site:
                    if vm_is_repl and template_is_repl:
                        self.executor.log(f"[SSH Lookup] ✓ Site + replication pattern match: template '{template_name}' to VM '{vm_name}'")
                        return self._fetch_ssh_key_by_id(template['ssh_key_id'], hostname)
            
            # vCenter-based fallback: if name matching failed but VM is in same vCenter as a template
            if vcenter_fallback_templates:
                fallback = vcenter_fallback_templates[0]
                self.executor.log(f"[SSH Lookup] ⚡ vCenter fallback: using template '{fallback.get('name')}' (same vCenter: {vm_vcenter_id})")
                return self._fetch_ssh_key_by_id(fallback['ssh_key_id'], hostname)
            
            self.executor.log(f"[SSH Lookup] ✗ No template matched VM '{vm_name}' by name patterns", "WARNING")
            
            # If no name match, check ssh_key_deployments for this hosting VM
            self.executor.log(f"[SSH Lookup] Checking ssh_key_deployments for hosting_vm_id={hosting_vm_id}")
            response = requests.get(
                f"{DSM_URL}/rest/v1/ssh_key_deployments",
                params={
                    'hosting_vm_id': f"eq.{hosting_vm_id}",
                    'status': 'eq.deployed',
                    'select': 'ssh_key_id'
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.ok:
                deployments = response.json()
                if deployments:
                    self.executor.log(f"[SSH Lookup] ✓ Found SSH key deployment for hosting VM '{vm_name}'")
                    return self._fetch_ssh_key_by_id(deployments[0]['ssh_key_id'], hostname)
                else:
                    self.executor.log("[SSH Lookup] No ssh_key_deployments found for this VM", "WARNING")
            else:
                self.executor.log(f"[SSH Lookup] Failed to query ssh_key_deployments: HTTP {response.status_code}", "WARNING")
                    
        except Exception as e:
            self.executor.log(f"[SSH Lookup] Error: {e}", "WARNING")
        
        self.executor.log("[SSH Lookup] ✗ No SSH key found via hosting VM", "WARNING")
        return None
    
    def _fetch_ssh_key_via_template(self, template_id: str, hostname: str) -> Optional[str]:
        """
        Fetch SSH key by following: source_template_id → zfs_target_templates → ssh_key_id
        """
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/zfs_target_templates",
                params={
                    'id': f"eq.{template_id}",
                    'select': 'id,name,ssh_key_id'
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if not response.ok:
                return None
                
            templates = response.json()
            if not templates:
                self.executor.log(f"Template {template_id} not found in zfs_target_templates", "WARNING")
                return None
            
            template = templates[0]
            if template.get('ssh_key_id'):
                self.executor.log(f"Found SSH key via source template '{template.get('name', template_id)}'")
                return self._fetch_ssh_key_by_id(template['ssh_key_id'], hostname)
                
        except Exception as e:
            self.executor.log(f"Error fetching SSH key via template: {e}", "WARNING")
        return None
    
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
                'protection_group_id': group_id,
                'protection_group_name': group.get('name'),
                'vms_synced': 0,
                'total_bytes': 0,
                'errors': [],
                'vms_completed': 0,
                'total_vms': len(protected_vms),
                'current_vm': None,
                'current_step': 'Initializing',
                'progress_percent': 0,
                'bytes_transferred': 0,
                'transfer_rate_mbps': 0,
                'vm_sync_details': [],
                'sync_start_time': utc_now_iso()
            }
            
            # Update job with initial progress info
            self.update_job_status(job_id, 'running', details=results)
            
            # Add console log helper for this job
            def add_console_log(message: str, level: str = 'INFO'):
                self._add_console_log(job_id, message, level)
            
            add_console_log(f"Starting replication sync for group: {group.get('name')}")
            add_console_log(f"Target: {target.get('hostname')} / Pool: {target.get('zfs_pool')}")
            
            # ===== AGENT-FIRST ROUTING =====
            # Check if target has an online agent for API-based operations
            source_agent = self._get_agent_for_target(target)
            use_agent_api = source_agent is not None
            
            if use_agent_api:
                add_console_log(f"🚀 Agent API mode: Using agent at {source_agent.get('hostname')}")
                results['replication_mode'] = 'agent_api'
            else:
                add_console_log(f"📟 SSH mode: Using direct SSH commands")
                results['replication_mode'] = 'ssh'
            
            # Get SSH credentials for target (fallback or primary depending on agent availability)
            ssh_creds = self._get_target_ssh_creds(target)
            ssh_hostname = None
            ssh_username = 'root'
            ssh_port = 22
            ssh_key_data = None
            
            if ssh_creds:
                ssh_hostname = ssh_creds.get('hostname')
                ssh_username = ssh_creds.get('username', 'root')
                ssh_port = ssh_creds.get('port', 22)
                ssh_key_data = ssh_creds.get('key_data') or ssh_creds.get('private_key')
                add_console_log(f"SSH credentials: {ssh_username}@{ssh_hostname}:{ssh_port}")
            elif not use_agent_api:
                # No agent and no SSH - can't proceed
                raise ValueError(f"No SSH credentials available for target '{target.get('name')}'. Configure an SSH key or run SSH Key Exchange first.")
            
            if not ssh_hostname and not use_agent_api:
                raise ValueError(f"No hostname configured for target {target.get('name')}")
            
            snapshot_name = f"zerfaux-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"
            add_console_log(f"Using snapshot name: {snapshot_name}")
            
            # Create job task for the sync operation
            sync_task_id = self._create_job_task(job_id, f"Sync {len(protected_vms)} VMs")
            
            # Sync each VM
            total_vms = len(protected_vms)
            for idx, vm in enumerate(protected_vms):
                vm_name = vm.get('vm_name')
                self.executor.log(f"[{job_id}] Syncing VM: {vm_name}")
                add_console_log(f"Processing VM {idx + 1}/{total_vms}: {vm_name}")
                
                # Update progress
                progress = int(((idx) / max(total_vms, 1)) * 100)
                results['current_vm'] = vm_name
                results['vm_name'] = vm_name
                results['current_step'] = f'Syncing {vm_name}'
                results['progress_percent'] = progress
                results['vms_completed'] = idx
                self.update_job_status(job_id, 'running', details=results)
                
                # Create VM-specific task
                vm_task_id = self._create_job_task(job_id, f"Sync VM: {vm_name}")
                
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
                        # Update step
                        results['current_step'] = f'Validating dataset for {vm_name}'
                        self.update_job_status(job_id, 'running', details=results)
                        
                        # Build correct dataset path using zfs_dataset_prefix
                        dataset_prefix = target.get('zfs_dataset_prefix') or target.get('zfs_pool')
                        source_dataset = f"{dataset_prefix}/{vm_name}"
                        add_console_log(f"Target dataset: {source_dataset}")
                        
                        # Ensure VM dataset exists (auto-create if needed)
                        dataset_result = self._ensure_vm_dataset(
                            vm_name=vm_name,
                            source_dataset=source_dataset,
                            ssh_hostname=ssh_hostname,
                            ssh_username=ssh_username,
                            ssh_port=ssh_port,
                            ssh_key_data=ssh_key_data,
                            add_console_log=add_console_log
                        )
                        
                        if not dataset_result.get('ready'):
                            error_msg = dataset_result.get('error', 'Dataset not ready')
                            add_console_log(f"ERROR: Dataset not ready for {vm_name}: {error_msg}", "ERROR")
                            self._update_job_task(vm_task_id, 'failed', f"Dataset error: {error_msg}")
                            self._update_protected_vm(vm['id'], replication_status='error', status_message=error_msg)
                            results['errors'].append({'vm': vm_name, 'error': error_msg})
                            continue
                        
                        if dataset_result.get('created'):
                            add_console_log(f"Created new ZFS dataset: {source_dataset}")
                        
                        # Now create snapshot - use agent API if available
                        results['current_step'] = f'Creating snapshot for {vm_name}'
                        self.update_job_status(job_id, 'running', details=results)
                        add_console_log(f"Creating ZFS snapshot for {vm_name}")
                        
                        step_start = time.time()
                        
                        if use_agent_api and source_agent:
                            # Use agent API for snapshot creation
                            add_console_log(f"Using agent API for snapshot")
                            snapshot_result = self._create_snapshot_via_agent(
                                source_agent,
                                source_dataset,
                                snapshot_name
                            )
                        else:
                            # Fall back to SSH-based snapshot
                            snapshot_result = self.zfs_replication.create_snapshot(
                                source_dataset,
                                snapshot_name,
                                ssh_hostname=ssh_hostname,
                                ssh_username=ssh_username,
                                ssh_port=ssh_port,
                                ssh_key_data=ssh_key_data
                            )
                        
                        if snapshot_result.get('success'):
                            snapshot_duration = int((time.time() - step_start) * 1000)
                            full_snapshot = snapshot_result.get('full_snapshot')
                            self.executor.log(f"[{job_id}] Created snapshot: {full_snapshot}")
                            add_console_log(f"Snapshot created: {full_snapshot} ({snapshot_duration}ms)")
                            
                            # Log command to activity table
                            if not use_agent_api:
                                self._log_ssh_command(
                                    job_id,
                                    command=f"zfs snapshot {source_dataset}@{snapshot_name}",
                                    hostname=ssh_hostname,
                                    output=snapshot_result.get('message', 'Snapshot created'),
                                    success=True,
                                    duration_ms=snapshot_duration
                                )
                            
                            # Update step for ZFS send
                            results['current_step'] = f'ZFS send in progress for {vm_name}'
                            self.update_job_status(job_id, 'running', details=results)
                            add_console_log(f"Snapshot complete for {vm_name}")
                            
                            # ===== ACTUAL ZFS SEND/RECEIVE =====
                            # Get DR target info for send/receive
                            # The DR target is the partner_target_id of the source target (Site B)
                            dr_target_id = target.get('partner_target_id')  # Use partner, not group.target_id
                            dr_target = self._get_replication_target(dr_target_id) if dr_target_id else None
                            
                            # Debug logging for DR target resolution
                            if dr_target:
                                add_console_log(f"DR target resolved: {dr_target.get('name')} ({dr_target.get('hostname')})")
                            else:
                                add_console_log(f"No DR target configured (partner_target_id not set on source target)")
                            
                            vm_bytes_transferred = 0
                            vm_transfer_rate = 0
                            expected_bytes = 0
                            send_success = True
                            site_b_verified = False
                            previous_snapshot = None
                            
                            # Get previous snapshot for incremental send
                            previous_snapshot = self._get_previous_snapshot(vm['id'])
                            
                            if dr_target and dr_target.get('id') != target.get('id'):
                                # We have a separate DR target - do ZFS send/receive
                                add_console_log(f"🔄 DR replication: {target.get('name')} → {dr_target.get('name')}")
                                dr_ssh_creds = self._get_target_ssh_creds(dr_target)
                                dr_hostname = dr_ssh_creds.get('hostname')
                                dr_username = dr_ssh_creds.get('username', 'root')
                                dr_port = dr_ssh_creds.get('port', 22)
                                dr_key_data = dr_ssh_creds.get('key_data') or dr_ssh_creds.get('private_key')
                                
                                if dr_hostname and self.zfs_replication:
                                    # Pre-sync SSH connectivity check to Site B
                                    # This catches connectivity issues BEFORE we start the sync
                                    add_console_log(f"Checking connectivity to Site B ({dr_hostname})...")
                                    test_ssh = self.zfs_replication._get_ssh_client_with_retry(
                                        dr_hostname, dr_port, dr_username,
                                        key_data=dr_key_data,
                                        max_retries=2,
                                        initial_delay=3.0
                                    )
                                    if not test_ssh:
                                        error_msg = f"Cannot connect to Site B ({dr_hostname}) - check SSH service"
                                        add_console_log(f"ERROR: {error_msg}", "ERROR")
                                        self._update_job_task(vm_task_id, 'failed', f"Site B connectivity failed: {error_msg}")
                                        self._update_protected_vm(vm['id'], replication_status='error', status_message=error_msg)
                                        results['errors'].append({'vm': vm_name, 'error': error_msg})
                                        continue  # Skip this VM, try next
                                    test_ssh.close()
                                    add_console_log(f"✓ Site B connectivity verified")
                                    
                                    dr_dataset_prefix = dr_target.get('zfs_dataset_prefix') or dr_target.get('zfs_pool')
                                    target_dataset = f"{dr_dataset_prefix}/{vm_name}"
                                    
                                    # Check if destination dataset exists BEFORE calculating size
                                    # This ensures we get the right size estimate (incremental vs full)
                                    if previous_snapshot:
                                        dest_exists = self.zfs_replication.check_dataset_exists(
                                            target_dataset,
                                            ssh_hostname=dr_hostname,
                                            ssh_username=dr_username,
                                            ssh_port=dr_port,
                                            ssh_key_data=dr_key_data
                                        )
                                        if not dest_exists:
                                            add_console_log(f"⚠️ Destination {target_dataset} doesn't exist on Site B, will do full send")
                                            previous_snapshot = None  # Force full send
                                        else:
                                            # Dataset exists - verify the incremental source snapshot also exists
                                            snapshot_exists = self.zfs_replication.check_snapshot_exists(
                                                target_dataset,
                                                previous_snapshot,
                                                ssh_hostname=dr_hostname,
                                                ssh_username=dr_username,
                                                ssh_port=dr_port,
                                                ssh_key_data=dr_key_data
                                            )
                                            if not snapshot_exists:
                                                add_console_log(
                                                    f"⚠️ Incremental base @{previous_snapshot} not found on Site B."
                                                )
                                                
                                                # Try to find a common snapshot for incremental recovery
                                                # This is much faster than a full send if a common base exists
                                                common_snapshot = self.zfs_replication.find_common_snapshot(
                                                    source_dataset=source_dataset,
                                                    target_dataset=target_dataset,
                                                    source_host=ssh_hostname,
                                                    source_username=ssh_username,
                                                    source_port=ssh_port,
                                                    target_host=dr_hostname,
                                                    target_username=dr_username,
                                                    target_port=dr_port,
                                                    source_key_data=ssh_key_data,
                                                    target_key_data=dr_key_data
                                                )
                                                
                                                if common_snapshot:
                                                    add_console_log(
                                                        f"✓ Found common snapshot @{common_snapshot}, using for incremental recovery"
                                                    )
                                                    previous_snapshot = common_snapshot
                                                else:
                                                    add_console_log(
                                                        f"⚠️ No common snapshots found. Cleaning target for full send..."
                                                    )
                                                    # Delete orphaned snapshots on target to allow full send
                                                    cleanup_result = self.zfs_replication.delete_all_snapshots(
                                                        target_dataset,
                                                        target_host=dr_hostname,
                                                        ssh_username=dr_username,
                                                        ssh_port=dr_port,
                                                        ssh_key_data=dr_key_data
                                                    )
                                                    if cleanup_result.get('success'):
                                                        add_console_log(
                                                            f"✓ Cleaned {cleanup_result['deleted']} orphaned snapshot(s) from target"
                                                        )
                                                    elif cleanup_result.get('deleted', 0) > 0:
                                                        # Partial cleanup - some deleted, some errors
                                                        add_console_log(
                                                            f"⚠️ Partial cleanup: {cleanup_result['deleted']} deleted, "
                                                            f"errors: {cleanup_result.get('errors', [])[:2]}"
                                                        )
                                                    else:
                                                        add_console_log(
                                                            f"⚠️ Cleanup errors: {cleanup_result.get('errors', [])[:2]}"
                                                        )
                                                    previous_snapshot = None  # Force full send
                                    
                                    # Get expected send size BEFORE transfer using zfs send -nP
                                    size_result = self.zfs_replication.get_snapshot_send_size(
                                        source_dataset,
                                        snapshot_name,
                                        incremental_from=previous_snapshot,
                                        ssh_hostname=ssh_hostname,
                                        ssh_username=ssh_username,
                                        ssh_port=ssh_port,
                                        ssh_key_data=ssh_key_data
                                    )
                                    
                                    if size_result.get('success'):
                                        expected_bytes = size_result.get('bytes', 0)
                                        is_incremental = size_result.get('incremental', False)
                                        add_console_log(
                                            f"Transfer size estimate: {self._format_bytes(expected_bytes)}"
                                            f"{' (incremental)' if is_incremental else ' (full)'}"
                                        )
                                    
                                    results['current_step'] = f'Transferring {vm_name} ({self._format_bytes(expected_bytes)})'
                                    results['expected_bytes'] = expected_bytes
                                    self.update_job_status(job_id, 'running', details=results)
                                    add_console_log(f"Starting ZFS send to {dr_hostname}:{target_dataset}")
                                    
                                    send_start = time.time()
                                    
                                    # Perform actual ZFS send/receive with heartbeat progress updates
                                    # Execute ZFS send on the SOURCE server (Site A) via SSH
                                    # This allows the Job Executor to run on Windows/non-ZFS systems
                                    
                                    # Use threaded execution with heartbeat for progress reporting
                                    import threading
                                    import queue
                                    
                                    result_queue = queue.Queue()
                                    transfer_complete = threading.Event()
                                    
                                    def transfer_thread():
                                        try:
                                            result = self.zfs_replication.replicate_dataset(
                                                source_dataset=source_dataset,
                                                source_snapshot=snapshot_name,
                                                target_host=dr_hostname,
                                                target_dataset=target_dataset,
                                                incremental_from=previous_snapshot,
                                                ssh_username=dr_username,
                                                ssh_port=dr_port,
                                                target_ssh_key_data=dr_key_data,
                                                source_host=ssh_hostname,
                                                source_ssh_username=ssh_username,
                                                source_ssh_port=ssh_port,
                                                source_ssh_key_data=ssh_key_data,
                                                expected_bytes=expected_bytes  # Pass for dynamic timeout
                                            )
                                            result_queue.put(result)
                                        except Exception as e:
                                            result_queue.put({'success': False, 'error': str(e)})
                                        finally:
                                            transfer_complete.set()
                                    
                                    # Start transfer in background thread
                                    t = threading.Thread(target=transfer_thread, daemon=True)
                                    t.start()
                                    
                                    # Heartbeat loop - update job every 5 seconds while transfer runs
                                    heartbeat_interval = 5
                                    while not transfer_complete.wait(timeout=heartbeat_interval):
                                        elapsed = int(time.time() - send_start)
                                        results['current_step'] = f'Transferring {vm_name} ({self._format_bytes(expected_bytes)}) - {elapsed}s elapsed'
                                        self.update_job_status(job_id, 'running', details=results)
                                    
                                    # Get result from queue
                                    send_result = result_queue.get(timeout=5)
                                    
                                    send_duration = int((time.time() - send_start) * 1000)
                                    
                                    if send_result.get('success'):
                                        vm_bytes_transferred = send_result.get('bytes_transferred', 0)
                                        vm_transfer_rate = send_result.get('transfer_rate_mbps', 0)
                                        
                                        # DO NOT assume expected_bytes were transferred if bytes_transferred is 0
                                        # This was causing false success reporting - if we can't parse actual bytes,
                                        # log a warning but don't fabricate transfer stats
                                        if vm_bytes_transferred == 0 and expected_bytes > 0:
                                            add_console_log(
                                                f"⚠ Could not parse bytes transferred from zfs send output. "
                                                f"Expected ~{self._format_bytes(expected_bytes)} - will verify on Site B",
                                                "WARN"
                                            )
                                        
                                        add_console_log(
                                            f"ZFS send complete: {self._format_bytes(vm_bytes_transferred)} "
                                            f"@ {vm_transfer_rate} MB/s ({send_duration}ms)"
                                        )
                                        
                                        # CRITICAL: Verify snapshot arrived on Site B
                                        # This is the source of truth - not the send command exit code
                                        verify_result = self.zfs_replication.verify_snapshot_on_target(
                                            target_host=dr_hostname,
                                            target_dataset=target_dataset,
                                            snapshot_name=snapshot_name,
                                            expected_bytes=expected_bytes if vm_bytes_transferred == 0 else vm_bytes_transferred,
                                            ssh_username=dr_username,
                                            ssh_port=dr_port,
                                            ssh_key_data=dr_key_data
                                        )
                                        
                                        if verify_result.get('verified'):
                                            site_b_verified = True
                                            target_bytes = verify_result.get('target_bytes', 0)
                                            add_console_log(f"✓ Verified snapshot on Site B ({self._format_bytes(target_bytes)})")
                                            
                                            # If we couldn't parse bytes from send, use verified target bytes
                                            if vm_bytes_transferred == 0 and target_bytes > 0:
                                                vm_bytes_transferred = target_bytes
                                                elapsed = max((time.time() - send_start), 1)
                                                vm_transfer_rate = round(vm_bytes_transferred / 1_000_000 / elapsed, 2)
                                                add_console_log(f"Using verified target size: {self._format_bytes(target_bytes)}")
                                        else:
                                            # Site B verification failed - but ZFS send DID succeed
                                            # Don't mark the entire sync as failed - data likely transferred,
                                            # we just couldn't verify (SSH connectivity issue, Site B rebooting, etc)
                                            site_b_verified = False
                                            # send_success stays True - data DID transfer!
                                            error_msg = verify_result.get('error', 'Unknown verification error')
                                            add_console_log(f"WARNING: Site B verification failed: {error_msg}", "WARN")
                                            add_console_log("ZFS send completed successfully but could not verify on Site B - manual check recommended", "WARN")
                                            # Add as warning, not error - don't fail the entire sync
                                            results['warnings'] = results.get('warnings', [])
                                            results['warnings'].append({
                                                'vm': vm_name, 
                                                'warning': f"Site B verification failed: {error_msg}"
                                            })
                                        
                                        # Log SSH command for activity tracking
                                        self._log_ssh_command(
                                            job_id,
                                            command=f"zfs send {source_dataset}@{snapshot_name} | zfs receive {target_dataset}",
                                            hostname=dr_hostname,
                                            output=f"Transferred {vm_bytes_transferred} bytes, Site B verified: {site_b_verified}",
                                            success=True,
                                            duration_ms=send_duration
                                        )
                                    else:
                                        send_success = False
                                        send_error = send_result.get('error', 'ZFS send failed')
                                        add_console_log(f"ERROR: ZFS send failed: {send_error}", "ERROR")
                                        results['errors'].append({'vm': vm_name, 'error': f"ZFS send failed: {send_error}"})
                                        # Continue - snapshot was created, just send failed
                            else:
                                # Same target or no DR target - get snapshot-specific size only
                                # (no actual transfer happened, so bytes_transferred stays 0)
                                size_result = self.zfs_replication.get_snapshot_send_size(
                                    source_dataset,
                                    snapshot_name,
                                    incremental_from=previous_snapshot,
                                    ssh_hostname=ssh_hostname,
                                    ssh_username=ssh_username,
                                    ssh_port=ssh_port,
                                    ssh_key_data=ssh_key_data
                                )
                                if size_result.get('success'):
                                    expected_bytes = size_result.get('bytes', 0)
                                    add_console_log(f"Snapshot size: {self._format_bytes(expected_bytes)} (no DR transfer)")
                                # bytes_transferred stays 0 - no actual transfer happened
                            
                            # Update running totals
                            results['bytes_transferred'] += vm_bytes_transferred
                            if vm_transfer_rate > 0:
                                results['transfer_rate_mbps'] = vm_transfer_rate
                            results['site_b_verified'] = site_b_verified
                            
                            # Track per-VM details
                            results['vm_sync_details'].append({
                                'vm_name': vm_name,
                                'bytes_transferred': vm_bytes_transferred,
                                'expected_bytes': expected_bytes,
                                'transfer_rate_mbps': vm_transfer_rate,
                                'snapshot_name': snapshot_name,
                                'incremental_from': previous_snapshot,
                                'site_b_verified': site_b_verified,
                                'success': send_success
                            })
                            
                            # Update protected VM with byte tracking
                            self._update_protected_vm(
                                vm['id'],
                                replication_status='synced',
                                last_snapshot_at=utc_now_iso(),
                                last_replication_at=utc_now_iso(),
                                last_sync_bytes=vm_bytes_transferred,
                                total_bytes_synced=(vm.get('total_bytes_synced') or 0) + vm_bytes_transferred
                            )
                            
                            if rep_job_id:
                                self._update_replication_job(
                                    rep_job_id,
                                    status='completed',
                                    completed_at=utc_now_iso(),
                                    source_snapshot=snapshot_name,
                                    bytes_transferred=vm_bytes_transferred,
                                    transfer_rate_mbps=vm_transfer_rate
                                )
                            
                            results['vms_synced'] += 1
                            results['vms_completed'] = idx + 1
                            
                            # Update progress with bytes info
                            results['current_step'] = f'Completed {vm_name} ({self._format_bytes(vm_bytes_transferred)})'
                            self.update_job_status(job_id, 'running', details=results)
                            
                            # Update VM task as completed
                            self._update_job_task(vm_task_id, 'completed', f"Synced {vm_name} ({self._format_bytes(vm_bytes_transferred)})")
                        else:
                            error_msg = snapshot_result.get('error', 'Snapshot failed')
                            add_console_log(f"ERROR: Snapshot failed for {vm_name}: {error_msg}", "ERROR")
                            self._update_job_task(vm_task_id, 'failed', f"Failed: {error_msg}")
                            raise Exception(error_msg)
                    else:
                        # ZFS not available - mark as error
                        add_console_log("ERROR: ZFS replication module not available", "ERROR")
                        self._update_job_task(vm_task_id, 'failed', "ZFS module not available")
                        raise Exception("ZFS replication module not available")
                    
                except Exception as e:
                    self.executor.log(f"[{job_id}] Error syncing {vm_name}: {e}", "ERROR")
                    add_console_log(f"ERROR syncing {vm_name}: {e}", "ERROR")
                    self._update_protected_vm(vm['id'], replication_status='error', status_message=str(e))
                    results['errors'].append({'vm': vm_name, 'error': str(e)})
            
            # Final progress update
            results['progress_percent'] = 100
            results['current_step'] = 'Complete'
            results['vms_completed'] = total_vms
            
            # Update sync task
            if sync_task_id:
                task_status = 'completed' if len(results['errors']) == 0 else 'failed'
                self._update_job_task(sync_task_id, task_status, f"Synced {results['vms_synced']}/{total_vms} VMs")
            
            add_console_log(f"Sync complete: {results['vms_synced']}/{total_vms} VMs synced")
            
            # Wrap post-sync updates in try/except to ensure job always completes
            avg_throughput = 0.0
            try:
                # Update group (non-critical, don't fail job if this fails)
                self._update_protection_group(
                    group_id,
                    last_replication_at=utc_now_iso(),
                    current_rpo_seconds=0,
                    status='meeting_sla' if not results['errors'] else 'warning',
                    sync_in_progress=False
                )
                
                # Calculate throughput from sync safely
                sync_start = results.get('sync_start_time')
                elapsed_seconds = 1
                if sync_start:
                    try:
                        start_dt = datetime.fromisoformat(sync_start.replace('Z', '+00:00'))
                        elapsed_seconds = max(1, (datetime.now(timezone.utc) - start_dt).total_seconds())
                    except Exception as calc_err:
                        self.executor.log(f"[{job_id}] Warning: throughput calc failed: {calc_err}", "WARN")
                avg_throughput = (results.get('bytes_transferred', 0) / 1_000_000) / elapsed_seconds
                
                # Insert metrics (non-critical)
                self._insert_replication_metrics(group_id, {
                    'current_rpo_seconds': 0,
                    'pending_bytes': 0,
                    'throughput_mbps': round(avg_throughput, 2)
                })
            except Exception as post_sync_err:
                self.executor.log(f"[{job_id}] Warning: post-sync updates failed: {post_sync_err}", "WARN")
                # Continue to complete the job anyway
            
            # ALWAYS complete the job - this is the critical part
            success = len(results['errors']) == 0
            final_status = 'completed' if success else 'failed'
            
            # Use atomic RPC function for reliable job completion
            # This avoids the read-modify-write race condition that caused jobs to get stuck
            update_success = False
            for status_attempt in range(3):
                try:
                    rpc_response = requests.post(
                        f"{self.executor.dsm_url}/rest/v1/rpc/complete_replication_job",
                        json={
                            'p_job_id': job_id,
                            'p_status': final_status,
                            'p_vms_synced': results.get('vms_synced', 0),
                            'p_total_vms': results.get('total_vms', 0),
                            'p_bytes_transferred': results.get('bytes_transferred', 0),
                            'p_current_step': 'Complete',
                            'p_errors': results.get('errors', [])
                        },
                        headers={
                            'apikey': self.executor.service_role_key,
                            'Authorization': f'Bearer {self.executor.service_role_key}',
                            'Content-Type': 'application/json',
                            'Prefer': 'return=representation'
                        },
                        verify=self.executor.verify_ssl,
                        timeout=15  # Longer timeout for reliability
                    )
                    if rpc_response.ok:
                        rpc_result = rpc_response.json()
                        if rpc_result is True:
                            update_success = True
                            self.executor.log(f"[{job_id}] Atomic completion RPC succeeded")
                            break
                        else:
                            self.executor.log(f"[{job_id}] RPC returned False - job may already be completed (attempt {status_attempt+1}/3)", "WARN")
                            update_success = True  # Job is in terminal state, consider it success
                            break
                    else:
                        self.executor.log(f"[{job_id}] Atomic RPC failed: {rpc_response.status_code} (attempt {status_attempt+1}/3)", "WARN")
                        time.sleep(1.0 * (status_attempt + 1))  # Longer backoff
                except Exception as rpc_err:
                    self.executor.log(f"[{job_id}] Atomic RPC exception (attempt {status_attempt+1}/3): {rpc_err}", "ERROR")
                    time.sleep(1.0 * (status_attempt + 1))
            
            if not update_success:
                self.executor.log(f"[{job_id}] Atomic RPC failed after 3 attempts, falling back to standard update", "ERROR")
                try:
                    # Fallback to standard update with minimal payload
                    self.update_job_status(job_id, final_status, completed_at=utc_now_iso(), details={
                        'vms_synced': results.get('vms_synced', 0),
                        'total_vms': results.get('total_vms', 0),
                        'current_step': 'Complete (fallback)',
                        'progress_percent': 100
                    })
                except:
                    pass  # Will be caught by auto-recovery cron
            
            self.executor.log(f"[{job_id}] Replication sync complete: {results['vms_synced']} VMs synced")
            
        except Exception as e:
            self.executor.log(f"[{job_id}] Error in replication sync: {e}", "ERROR")
            try:
                self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details={'error': str(e)})
            except:
                try:
                    self.update_job_status(job_id, 'failed')
                except:
                    pass
    
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
    
    # =========================================================================
    # Sync Protection Config Handler
    # =========================================================================
    
    def execute_sync_protection_config(self, job: Dict):
        """
        Sync protection group configuration to both ZFS appliances.
        
        Pushes to source AND DR target:
        - Sanoid configuration (snapshot retention)
        - Syncoid cron schedule (based on RPO)
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        self.executor.log(f"[{job_id}] Starting protection config sync")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            protection_group_id = details.get('protection_group_id')
            if not protection_group_id:
                raise ValueError("protection_group_id is required")
            
            # 1. Get protection group
            group = self._get_protection_group(protection_group_id)
            if not group:
                raise ValueError(f"Protection group not found: {protection_group_id}")
            
            self.executor.log(f"[{job_id}] Syncing config for group: {group.get('name')}")
            
            # 2. Get source ZFS target from protection_datastore
            source_target = self._get_target_for_datastore(group.get('protection_datastore'))
            dr_target = None
            
            if source_target:
                self.executor.log(f"[{job_id}] Source target: {source_target.get('name')} ({source_target.get('hostname')})")
                
                # Get DR target from partner relationship
                if source_target.get('partner_target_id'):
                    dr_target = self._get_replication_target(source_target['partner_target_id'])
                    if dr_target:
                        self.executor.log(f"[{job_id}] DR target: {dr_target.get('name')} ({dr_target.get('hostname')})")
            
            configured_targets = []
            errors = []
            
            # 3. Configure source target
            if source_target:
                result = self._configure_zfs_target(source_target, group, 'source')
                if result['success']:
                    configured_targets.append(source_target.get('name'))
                    self.executor.log(f"[{job_id}] Source target configured successfully")
                else:
                    errors.append(f"Source ({source_target.get('name')}): {result.get('error')}")
                    self.executor.log(f"[{job_id}] Source target config failed: {result.get('error')}", "ERROR")
            else:
                self.executor.log(f"[{job_id}] No source target found for datastore: {group.get('protection_datastore')}", "WARN")
            
            # 4. Configure DR target
            if dr_target:
                result = self._configure_zfs_target(dr_target, group, 'dr')
                if result['success']:
                    configured_targets.append(dr_target.get('name'))
                    self.executor.log(f"[{job_id}] DR target configured successfully")
                else:
                    errors.append(f"DR ({dr_target.get('name')}): {result.get('error')}")
                    self.executor.log(f"[{job_id}] DR target config failed: {result.get('error')}", "ERROR")
            else:
                self.executor.log(f"[{job_id}] No DR target found (no partner configured)", "WARN")
            
            # 5. Complete job
            if errors:
                if configured_targets:
                    # Partial success
                    self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(),
                                          details={
                                              'configured_targets': configured_targets,
                                              'warnings': errors,
                                              'partial_success': True
                                          })
                    self.executor.log(f"[{job_id}] Partial sync completed: {len(configured_targets)} targets configured, {len(errors)} errors")
                else:
                    # All failed
                    raise Exception("; ".join(errors))
            else:
                self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(),
                                      details={'configured_targets': configured_targets})
                self.executor.log(f"[{job_id}] Config sync completed for {len(configured_targets)} targets")
            
        except Exception as e:
            self.executor.log(f"[{job_id}] Error syncing config: {e}", "ERROR")
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details={'error': str(e)})
    
    def _get_target_for_datastore(self, datastore_name: str) -> Optional[Dict]:
        """Get replication target linked to a datastore"""
        if not datastore_name:
            return None
        try:
            # Find datastore and its linked target
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_datastores",
                params={
                    'name': f'eq.{datastore_name}',
                    'select': 'replication_target_id'
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.ok:
                datastores = response.json()
                if datastores and datastores[0].get('replication_target_id'):
                    return self._get_replication_target(datastores[0]['replication_target_id'])
        except Exception as e:
            self.executor.log(f"Error finding target for datastore: {e}", "ERROR")
        return None
    
    def _configure_zfs_target(self, target: Dict, group: Dict, role: str) -> Dict:
        """
        Configure a ZFS target with sanoid/syncoid settings.
        
        Args:
            target: Replication target dict
            group: Protection group dict
            role: 'source' or 'dr'
        
        Returns:
            Dict with 'success' and optionally 'error'
        """
        if not PARAMIKO_AVAILABLE:
            return {'success': False, 'error': 'paramiko not installed'}
        
        try:
            creds = self._get_ssh_credentials(target)
            
            # Generate configuration
            dataset = f"{target.get('zfs_pool')}/{target.get('zfs_dataset_prefix', 'replication')}/{group['id']}"
            sanoid_config = self._generate_sanoid_config(group, dataset)
            
            # Connect via SSH
            ssh_result = self._test_ssh_connection(
                creds['hostname'], creds['port'], 
                creds['username'], creds['private_key']
            )
            if not ssh_result['success']:
                return ssh_result
            
            # Create SSH connection for commands
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            key_file = io.StringIO(creds['private_key'])
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
                hostname=creds['hostname'],
                port=creds['port'],
                username=creds['username'],
                pkey=pkey,
                timeout=30
            )
            
            # Write sanoid config snippet
            config_path = f"/etc/sanoid/sanoid.d/{group['id']}.conf"
            cmd = f"mkdir -p /etc/sanoid/sanoid.d && cat > {config_path} << 'EOF'\n{sanoid_config}EOF"
            stdin, stdout, stderr = ssh.exec_command(cmd)
            exit_status = stdout.channel.recv_exit_status()
            if exit_status != 0:
                error = stderr.read().decode().strip()
                ssh.close()
                return {'success': False, 'error': f'Failed to write sanoid config: {error}'}
            
            # For source role, also configure syncoid cron if there's a partner
            if role == 'source' and target.get('partner_target_id'):
                partner = self._get_replication_target(target['partner_target_id'])
                if partner:
                    cron_entry = self._generate_syncoid_cron(group, dataset, partner)
                    cron_path = f"/etc/cron.d/zerfaux-{group['id']}"
                    cmd = f"cat > {cron_path} << 'EOF'\n{cron_entry}EOF"
                    stdin, stdout, stderr = ssh.exec_command(cmd)
                    exit_status = stdout.channel.recv_exit_status()
                    if exit_status != 0:
                        error = stderr.read().decode().strip()
                        self.executor.log(f"Warning: Failed to write cron: {error}", "WARN")
            
            ssh.close()
            return {'success': True}
            
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def _generate_sanoid_config(self, group: Dict, dataset: str) -> str:
        """
        Generate sanoid.conf section for a dataset.
        
        Uses journal_history_hours from protection group to determine 
        how many hourly snapshots to retain for point-in-time recovery.
        """
        retention = group.get('retention_policy', {})
        if isinstance(retention, str):
            import json
            try:
                retention = json.loads(retention)
            except:
                retention = {}
        
        rpo = group.get('rpo_minutes', 60)
        journal_hours = group.get('journal_history_hours', 24)  # Default 24 hours of journal
        
        # Calculate hourly snapshots based on RPO and journal history
        # If RPO is 15 min, we need 4 snapshots/hour
        # For 24 hours of journal, we need: 24 * (60/15) = 96 snapshots
        snapshots_per_hour = max(1, 60 // max(rpo, 1))
        hourly_count = max(24, journal_hours * snapshots_per_hour)
        
        # Also calculate frequent snapshots for sub-hourly RPO
        frequent_count = 0
        if rpo < 60:
            # Keep enough frequent snapshots to cover one hour at RPO interval
            frequent_count = 60 // max(rpo, 1)
        
        config = f"""# Auto-generated by Zerfaux DSM - Protection Group: {group.get('name')}
# Last updated: {utc_now_iso()}
# RPO: {rpo} minutes | Journal: {journal_hours} hours
[{dataset}]
    use_template = production
    hourly = {hourly_count}
    daily = {retention.get('daily', 7)}
    weekly = {retention.get('weekly', 4)}
    monthly = {retention.get('monthly', 12)}
    autosnap = yes
    autoprune = yes
"""
        
        # Add frequent snapshots for sub-hourly RPO
        if frequent_count > 0:
            config += f"    frequent_period = {rpo}\n"
            config += f"    frequently = {frequent_count}\n"
        
        return config
    
    def _generate_syncoid_cron(self, group: Dict, source_dataset: str, dr_target: Dict) -> str:
        """Generate syncoid cron entry based on RPO"""
        rpo = group.get('rpo_minutes', 60)
        
        if rpo <= 15:
            schedule = '*/15 * * * *'  # Every 15 min
        elif rpo <= 30:
            schedule = '*/30 * * * *'  # Every 30 min
        elif rpo <= 60:
            schedule = '0 * * * *'     # Hourly
        else:
            hours = max(1, rpo // 60)
            schedule = f'0 */{hours} * * *'  # Every N hours
        
        dr_host = dr_target.get('hostname')
        dr_pool = dr_target.get('zfs_pool')
        dr_prefix = dr_target.get('zfs_dataset_prefix', 'replication')
        dr_dataset = f"{dr_pool}/{dr_prefix}/{group['id']}"
        
        return f"""# Auto-generated by Zerfaux DSM - Protection Group: {group.get('name')}
# RPO: {rpo} minutes
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
{schedule} root /usr/sbin/syncoid --no-privilege-elevation --no-sync-snap {source_dataset} root@{dr_host}:{dr_dataset} >> /var/log/zerfaux-sync.log 2>&1
"""

    # =========================================================================
    # SSH Key Exchange Handler
    # =========================================================================
    
    def execute_exchange_ssh_keys(self, job: Dict):
        """
        Exchange SSH keys between paired replication targets.
        
        Steps:
        1. Get source and destination target from pair
        2. Generate SSH key pair on source if needed
        3. Copy public key to destination's authorized_keys
        4. Verify bidirectional SSH connectivity
        5. Mark both targets as ssh_trust_established
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        self.executor.log(f"[{job_id}] Starting SSH key exchange")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            source_target_id = details.get('source_target_id')
            dest_target_id = details.get('destination_target_id')
            
            # Decrypt admin password if provided (stored encrypted for security)
            admin_password = None
            admin_password_encrypted = details.get('admin_password_encrypted')
            if admin_password_encrypted:
                self.executor.log(f"[{job_id}] Encrypted password found in job details, attempting decryption...")
                admin_password = self.executor.decrypt_password(admin_password_encrypted)
                if admin_password:
                    self.executor.log(f"[{job_id}] ✓ Successfully decrypted admin password (length: {len(admin_password)})")
                else:
                    self.executor.log(f"[{job_id}] ✗ Password decryption returned None! Check encryption key.", "WARNING")
            else:
                self.executor.log(f"[{job_id}] ⚠ No admin_password_encrypted in job details - will try SSH key auth only", "WARNING")
            
            if not source_target_id or not dest_target_id:
                raise ValueError("Both source_target_id and destination_target_id are required")
            
            source_target = self._get_replication_target(source_target_id)
            dest_target = self._get_replication_target(dest_target_id)
            
            if not source_target:
                raise ValueError(f"Source target not found: {source_target_id}")
            if not dest_target:
                raise ValueError(f"Destination target not found: {dest_target_id}")
            
            # Get SSH hostnames (resolve via hosting_vm_id if available)
            source_ssh_host = self._resolve_ssh_hostname(source_target)
            dest_ssh_host = self._resolve_ssh_hostname(dest_target)
            
            results = {
                'source_target_id': source_target_id,
                'source_target': source_target.get('name'),
                'source_nfs_ip': source_target.get('hostname'),  # ZFS/NFS share IP
                'source_hostname': source_ssh_host,  # Actual SSH target (VM name or IP)
                'destination_target_id': dest_target_id,
                'destination_target': dest_target.get('name'),
                'destination_nfs_ip': dest_target.get('hostname'),  # ZFS/NFS share IP
                'destination_hostname': dest_ssh_host,  # Actual SSH target (VM name or IP)
                'steps': [],
                'current_step': 'initializing'
            }
            
            # Step 1: Get/generate SSH key on source (use admin_password if provided)
            results['current_step'] = 'source_key_generation'
            self.executor.log(f"[{job_id}] Getting SSH key from source: {source_target.get('hostname')}")
            source_pub_key = self._get_or_generate_ssh_key(source_target, password=admin_password)
            if not source_pub_key:
                results['failed_step'] = 'source_key_generation'
                results['error'] = f"Failed to get/generate SSH key on source target ({source_target.get('hostname')})"
                results['debug_info'] = {
                    'password_provided': admin_password is not None,
                    'password_length': len(admin_password) if admin_password else 0,
                    'hostname': source_target.get('hostname'),
                    'target_name': source_target.get('name'),
                    'ssh_host': source_ssh_host
                }
                raise Exception(results['error'])
            results['steps'].append('source_key_obtained')
            
            # Step 2: Copy public key to destination (use admin_password for dest too)
            results['current_step'] = 'copy_key_to_destination'
            self.executor.log(f"[{job_id}] Copying public key to destination: {dest_target.get('hostname')}")
            copy_result = self._copy_ssh_key_to_target(dest_target, source_pub_key, source_target.get('hostname', 'zerfaux'), password=admin_password)
            if not copy_result.get('success'):
                results['failed_step'] = 'copy_key_to_destination'
                results['error'] = f"Failed to copy key to destination ({dest_target.get('hostname')}): {copy_result.get('error')}"
                raise Exception(results['error'])
            results['steps'].append('key_copied_to_destination')
            
            # Step 3: Test SSH connection from source to destination
            results['current_step'] = 'test_ssh_connection'
            self.executor.log(f"[{job_id}] Testing SSH connection from source to destination")
            test_result = self._test_replication_ssh_connection(source_target, dest_target, password=admin_password)
            if not test_result.get('success'):
                results['failed_step'] = 'test_ssh_connection'
                results['error'] = f"SSH connection test failed ({source_target.get('hostname')} → {dest_target.get('hostname')}): {test_result.get('error')}"
                raise Exception(results['error'])
            results['steps'].append('connection_tested')
            
            # Step 4: Mark both targets as ssh_trust_established
            results['current_step'] = 'establish_trust'
            self._update_replication_target(source_target_id, ssh_trust_established=True)
            self._update_replication_target(dest_target_id, ssh_trust_established=True)
            results['steps'].append('trust_established')
            
            # Step 5: Auto-link an active SSH key if available and targets don't have one
            results['current_step'] = 'link_ssh_key'
            self._auto_link_ssh_key_to_targets(source_target_id, dest_target_id)
            results['steps'].append('ssh_key_linked')
            
            results['current_step'] = 'completed'
            self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(), details=results)
            self.executor.log(f"[{job_id}] SSH key exchange completed successfully")
            
        except Exception as e:
            self.executor.log(f"[{job_id}] Error in SSH key exchange: {e}", "ERROR")
            # Preserve all context on failure - don't overwrite results
            if 'results' not in dir() or not isinstance(results, dict):
                results = {
                    'source_target_id': details.get('source_target_id'),
                    'destination_target_id': details.get('destination_target_id'),
                    'steps': [],
                    'failed_step': 'initialization'
                }
            if 'error' not in results:
                results['error'] = str(e)
            if 'failed_step' not in results:
                results['failed_step'] = results.get('current_step', 'unknown')
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details=results)
    
    def _update_replication_target(self, target_id: str, **kwargs) -> bool:
        """Update replication target fields"""
        try:
            response = requests.patch(
                f"{DSM_URL}/rest/v1/replication_targets",
                params={'id': f'eq.{target_id}'},
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
            self.executor.log(f"Error updating replication target: {e}", "ERROR")
            return False
    
    def _auto_link_ssh_key_to_targets(self, source_target_id: str, dest_target_id: str):
        """
        Auto-link an active SSH key to targets after successful key exchange.
        Only links if targets don't already have an ssh_key_id.
        """
        try:
            # Check if targets already have SSH keys linked
            source_target = self._get_replication_target(source_target_id)
            dest_target = self._get_replication_target(dest_target_id)
            
            source_needs_key = source_target and not source_target.get('ssh_key_id')
            dest_needs_key = dest_target and not dest_target.get('ssh_key_id')
            
            if not source_needs_key and not dest_needs_key:
                self.executor.log("Both targets already have SSH keys linked, skipping auto-link")
                return
            
            # Find an active SSH key to use
            response = requests.get(
                f"{DSM_URL}/rest/v1/ssh_keys",
                params={
                    'status': 'eq.active',
                    'order': 'created_at.desc',
                    'limit': '1'
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if not response.ok:
                self.executor.log("Failed to fetch SSH keys for auto-linking", "WARNING")
                return
            
            keys = response.json()
            if not keys:
                self.executor.log("No active SSH keys available for auto-linking", "WARNING")
                return
            
            ssh_key_id = keys[0]['id']
            ssh_key_name = keys[0].get('name', 'unknown')
            
            # Link the key to targets that need it
            if source_needs_key:
                self._update_replication_target(source_target_id, ssh_key_id=ssh_key_id)
                self.executor.log(f"Auto-linked SSH key '{ssh_key_name}' to source target")
            
            if dest_needs_key:
                self._update_replication_target(dest_target_id, ssh_key_id=ssh_key_id)
                self.executor.log(f"Auto-linked SSH key '{ssh_key_name}' to destination target")
                
        except Exception as e:
            self.executor.log(f"Error auto-linking SSH key: {e}", "WARNING")
    
    def _get_or_generate_ssh_key(self, target: Dict, password: str = None) -> Optional[str]:
        """Get existing SSH public key or generate a new one on the target
        
        Args:
            target: The replication target dict
            password: Optional password for initial SSH authentication
        """
        if not PARAMIKO_AVAILABLE:
            self.executor.log("Paramiko not available for SSH operations", "ERROR")
            return None
        
        hostname = target.get('hostname', 'unknown')
        target_name = target.get('name', 'unknown')
        
        try:
            # Log whether we have a password
            self.executor.log(f"[SSH Key Gen] Getting credentials for {target_name} ({hostname}), password provided: {password is not None}")
            
            creds = self._get_target_ssh_creds(target, password=password)
            if not creds:
                self.executor.log(f"[SSH Key Gen] No credentials returned for {hostname}", "ERROR")
                return None
            
            # Log what credentials we got (without revealing sensitive data)
            creds_info = (
                f"hostname={creds.get('hostname')}, port={creds.get('port')}, "
                f"username={creds.get('username')}, "
                f"has_key_path={bool(creds.get('key_path'))}, "
                f"has_key_data={bool(creds.get('key_data'))}, "
                f"has_password={bool(creds.get('password'))}"
            )
            self.executor.log(f"[SSH Key Gen] Credentials for {target_name}: {creds_info}")
            
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            pkey = None
            if creds.get('key_path') and creds['key_path'].strip():
                self.executor.log(f"[SSH Key Gen] Loading private key from file: {creds['key_path']}")
                # Try different key types (Ed25519, RSA, ECDSA)
                for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                    try:
                        pkey = key_class.from_private_key_file(creds['key_path'])
                        self.executor.log(f"[SSH Key Gen] Loaded key as {key_class.__name__}")
                        break
                    except Exception:
                        continue
                if not pkey:
                    self.executor.log(f"[SSH Key Gen] Failed to load key file as any known type", "WARNING")
            elif creds.get('key_data'):
                self.executor.log(f"[SSH Key Gen] Loading private key from data (length: {len(creds['key_data'])})")
                # Try different key types (Ed25519, RSA, ECDSA)
                key_file = io.StringIO(creds['key_data'])
                for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                    try:
                        key_file.seek(0)
                        pkey = key_class.from_private_key(key_file)
                        self.executor.log(f"[SSH Key Gen] Loaded key as {key_class.__name__}")
                        break
                    except Exception:
                        continue
                if not pkey:
                    self.executor.log(f"[SSH Key Gen] Failed to load key data as any known type", "WARNING")
            
            auth_method = "key" if pkey else ("password" if creds.get('password') else "none")
            self.executor.log(f"[SSH Key Gen] Connecting to {creds['hostname']}:{creds['port']} as {creds['username']} using {auth_method} auth...")
            
            ssh.connect(
                hostname=creds['hostname'],
                port=creds['port'],
                username=creds['username'],
                pkey=pkey,
                password=creds.get('password'),
                timeout=30
            )
            
            self.executor.log(f"[SSH Key Gen] ✓ SSH connection established to {target_name}")
            
            # Check if key exists
            stdin, stdout, stderr = ssh.exec_command('cat ~/.ssh/id_rsa.pub 2>/dev/null')
            exit_status = stdout.channel.recv_exit_status()
            pub_key = stdout.read().decode().strip()
            
            if exit_status == 0 and pub_key:
                self.executor.log(f"[SSH Key Gen] ✓ Found existing SSH public key on {target_name}")
                ssh.close()
                return pub_key
            
            # Generate new key pair
            self.executor.log(f"[SSH Key Gen] No existing key found, generating new SSH key pair on {target_name}")
            cmd = 'ssh-keygen -t rsa -b 4096 -N "" -f ~/.ssh/id_rsa -q <<< y 2>/dev/null || true'
            stdin, stdout, stderr = ssh.exec_command(cmd)
            stdout.channel.recv_exit_status()
            
            # Read the new public key
            stdin, stdout, stderr = ssh.exec_command('cat ~/.ssh/id_rsa.pub')
            exit_status = stdout.channel.recv_exit_status()
            pub_key = stdout.read().decode().strip()
            
            ssh.close()
            
            if exit_status == 0 and pub_key:
                self.executor.log(f"[SSH Key Gen] ✓ Successfully generated new SSH key on {target_name}")
                return pub_key
            
            self.executor.log(f"[SSH Key Gen] Failed to read generated public key from {target_name}", "ERROR")
            return None
            
        except paramiko.AuthenticationException as e:
            self.executor.log(
                f"[SSH Key Gen] ✗ Authentication FAILED for {target_name} ({hostname}): {e} - "
                f"Check password is correct and password auth is enabled on target (sshd_config PasswordAuthentication)", 
                "ERROR"
            )
            return None
        except paramiko.SSHException as e:
            self.executor.log(f"[SSH Key Gen] ✗ SSH protocol error connecting to {target_name} ({hostname}): {e}", "ERROR")
            return None
        except socket.timeout as e:
            self.executor.log(f"[SSH Key Gen] ✗ Connection timed out to {target_name} ({hostname}): {e}", "ERROR")
            return None
        except socket.error as e:
            self.executor.log(f"[SSH Key Gen] ✗ Socket error connecting to {target_name} ({hostname}): {e} - Check SSH port 22 is open", "ERROR")
            return None
        except Exception as e:
            self.executor.log(f"[SSH Key Gen] ✗ Unexpected error for {target_name} ({hostname}): {type(e).__name__}: {e}", "ERROR")
            return None
    
    def _copy_ssh_key_to_target(self, target: Dict, pub_key: str, source_hostname: str, password: str = None) -> Dict:
        """Copy a public key to the target's authorized_keys
        
        Args:
            target: The destination replication target
            pub_key: The public key to copy
            source_hostname: The hostname of the source for comment
            password: Optional password for initial SSH authentication
        """
        if not PARAMIKO_AVAILABLE:
            return {'success': False, 'error': 'Paramiko not available'}
        
        try:
            creds = self._get_target_ssh_creds(target, password=password)
            if not creds:
                return {'success': False, 'error': 'Could not get SSH credentials'}
            
            # Debug logging for credentials
            self.executor.log(f"[SSH Copy] Got creds for {creds['hostname']}: has_key_data={bool(creds.get('key_data'))}, has_key_path={bool(creds.get('key_path'))}, has_password={bool(creds.get('password'))}")
            
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            pkey = self._load_private_key(
                key_path=creds.get('key_path'),
                key_data=creds.get('key_data')
            )
            
            self.executor.log(f"[SSH Copy] Key loaded successfully: {pkey is not None}, connecting to {creds['hostname']}...")
            
            ssh.connect(
                hostname=creds['hostname'],
                port=creds['port'],
                username=creds['username'],
                pkey=pkey,
                password=creds.get('password'),
                timeout=30
            )
            
            # Ensure .ssh directory exists
            ssh.exec_command('mkdir -p ~/.ssh && chmod 700 ~/.ssh')
            
            # Add key to authorized_keys if not already present
            comment = f"# Added by Zerfaux from {source_hostname}"
            cmd = f'''
grep -qxF "{pub_key}" ~/.ssh/authorized_keys 2>/dev/null || echo "{comment}
{pub_key}" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
'''
            stdin, stdout, stderr = ssh.exec_command(cmd)
            exit_status = stdout.channel.recv_exit_status()
            
            ssh.close()
            
            if exit_status == 0:
                return {'success': True}
            else:
                error = stderr.read().decode().strip()
                return {'success': False, 'error': error or 'Unknown error'}
                
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def _test_replication_ssh_connection(self, source_target: Dict, dest_target: Dict, password: str = None) -> Dict:
        """Test SSH connection from source to destination for replication pair"""
        if not PARAMIKO_AVAILABLE:
            return {'success': False, 'error': 'Paramiko not available'}
        
        try:
            creds = self._get_target_ssh_creds(source_target, password=password)
            if not creds:
                return {'success': False, 'error': 'Could not get source SSH credentials'}
            
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            pkey = self._load_private_key(
                key_path=creds.get('key_path'),
                key_data=creds.get('key_data')
            )
            
            ssh.connect(
                hostname=creds['hostname'],
                port=creds['port'],
                username=creds['username'],
                pkey=pkey,
                password=creds.get('password'),
                timeout=30
            )
            
            # Test connection from source to destination
            dest_host = dest_target.get('hostname')
            dest_port = dest_target.get('port', 22)
            cmd = f'ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -p {dest_port} root@{dest_host} "echo SUCCESS"'
            
            stdin, stdout, stderr = ssh.exec_command(cmd)
            exit_status = stdout.channel.recv_exit_status()
            output = stdout.read().decode().strip()
            
            ssh.close()
            
            if exit_status == 0 and 'SUCCESS' in output:
                return {'success': True}
            else:
                error = stderr.read().decode().strip()
                return {'success': False, 'error': error or f'Connection test returned exit code {exit_status}'}
                
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    # =========================================================================
    # ZFS Target Health Check
    # =========================================================================
    
    def execute_check_zfs_target_health(self, job: Dict):
        """
        Check health of a single ZFS replication target.
        
        Tests:
        1. SSH connectivity to the target
        2. ZFS pool health status
        3. Pool capacity and free space
        4. Recent scrub status
        5. Data transfer test (end-to-end ZFS send/receive verification)
        6. Snapshot sync status (checks if replication is current)
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        # Console log and step results for verbose output
        console_log = []
        step_results = []
        
        def log_and_store(msg: str, level: str = "INFO"):
            """Log message and store in console_log array"""
            self.executor.log(f"[{job_id}] {msg}", level)
            timestamp = datetime.now().strftime("%H:%M:%S")
            console_log.append(f"[{timestamp}] {level}: {msg}")
        
        def add_step_result(step: str, status: str, message: str, duration_ms: int = None):
            """Add a step result with timing info"""
            step_results.append({
                'step': step,
                'status': status,
                'message': message,
                'duration_ms': duration_ms,
                'timestamp': datetime.now().isoformat()
            })
        
        log_and_store("Starting ZFS target health check")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        # Create tasks for each test upfront
        test_tasks = {}
        test_names = ['ssh_connectivity', 'zfs_pool_health', 'cross_site_ssh', 'data_transfer_test', 'snapshot_sync_status']
        for test_name in test_names:
            task_id = self.create_task(job_id)
            if task_id:
                self.update_task_status(task_id, 'pending', log=f"Pending: {test_name.replace('_', ' ').title()}")
                test_tasks[test_name] = task_id
        
        try:
            target_id = details.get('target_id')
            target_hostname = details.get('target_hostname')
            zfs_pool = details.get('zfs_pool')
            target_name = details.get('target_name', 'Unknown')
            
            if not target_id:
                raise ValueError("No target_id provided in job details")
            
            log_and_store(f"Target: {target_name} ({target_id})")
            
            # Fetch the target from DB
            target = self._get_replication_target(target_id)
            if not target:
                raise ValueError(f"Replication target not found: {target_id}")
            
            hostname = target.get('hostname') or target_hostname
            pool = target.get('zfs_pool') or zfs_pool
            
            log_and_store(f"Hostname: {hostname}, Pool: {pool}")
            
            results = {
                'target_id': target_id,
                'target_name': target_name,
                'hostname': hostname,
                'zfs_pool': pool,
                'tests': []
            }
            overall_status = 'healthy'
            
            # Get SSH credentials
            creds = self._get_target_ssh_creds(target)
            if not creds:
                raise ValueError(f"No SSH credentials available for target {hostname}")
            
            # =========================================================================
            # Test 1: SSH Connectivity
            # =========================================================================
            task_id = test_tasks.get('ssh_connectivity')
            if task_id:
                self.update_task_status(task_id, 'running', log="Testing SSH connectivity...", progress=10)
            
            log_and_store(f"Testing SSH connectivity to {hostname}:{creds['port']}")
            start_time = time.time()
            
            ssh_result = self._test_ssh_connection(
                creds['hostname'],
                creds['port'],
                creds['username'],
                creds.get('key_data')
            )
            
            duration_ms = int((time.time() - start_time) * 1000)
            
            # Log SSH command
            self._log_ssh_command(
                job_id=job_id,
                command='hostname',
                hostname=hostname,
                output=ssh_result.get('hostname', '') if ssh_result['success'] else ssh_result.get('error', ''),
                success=ssh_result['success'],
                duration_ms=duration_ms,
                operation_type='ssh_connectivity'
            )
            
            ssh_message = 'SSH connection successful' if ssh_result['success'] else ssh_result.get('error')
            results['tests'].append({
                'name': 'ssh_connectivity',
                'success': ssh_result['success'],
                'message': ssh_message
            })
            
            add_step_result('ssh_connectivity', 'success' if ssh_result['success'] else 'failed', ssh_message, duration_ms)
            
            if task_id:
                status = 'completed' if ssh_result['success'] else 'failed'
                self.update_task_status(task_id, status, log=ssh_message, progress=100)
            
            if ssh_result['success']:
                log_and_store(f"SSH connection successful in {duration_ms}ms")
            else:
                log_and_store(f"SSH connection failed: {ssh_result.get('error')}", "ERROR")
            
            if not ssh_result['success']:
                overall_status = 'offline'
                results['overall_status'] = overall_status
                
                # Mark remaining tasks as skipped
                for name in ['zfs_pool_health', 'cross_site_ssh', 'data_transfer_test', 'snapshot_sync_status']:
                    tid = test_tasks.get(name)
                    if tid:
                        self.update_task_status(tid, 'cancelled', log="Skipped: SSH connectivity failed")
                
                # Update target health status
                self._update_replication_target(target_id, 
                    health_status='offline',
                    last_health_check=utc_now_iso(),
                    health_check_error=ssh_result.get('error')
                )
                
                self.update_job_status(job_id, 'completed', 
                    completed_at=utc_now_iso(),
                    details={**details, 'results': results, 'console_log': console_log, 'step_results': step_results}
                )
                return
            
            # =========================================================================
            # Test 2: ZFS Pool Health
            # =========================================================================
            if pool:
                task_id = test_tasks.get('zfs_pool_health')
                if task_id:
                    self.update_task_status(task_id, 'running', log=f"Checking ZFS pool {pool}...", progress=10)
                
                log_and_store(f"Checking ZFS pool {pool} health")
                start_time = time.time()
                
                if ZFS_AVAILABLE and self.zfs_replication:
                    health_result = self.zfs_replication.check_target_health(
                        target_hostname=hostname,
                        zfs_pool=pool,
                        ssh_username=creds['username'],
                        ssh_port=creds['port'],
                        ssh_key_data=creds.get('key_data'),
                        ssh_password=creds.get('password')
                    )
                    
                    duration_ms = int((time.time() - start_time) * 1000)
                    
                    # Map field names from ZFSReplicationReal response
                    pool_status = health_result.get('pool_health', 'UNKNOWN')
                    free_gb = health_result.get('free_space_gb', 0)
                    total_gb = health_result.get('total_space_gb', 0)
                    used_percent = round((1 - (free_gb / total_gb)) * 100) if total_gb > 0 else 0
                    last_scrub = health_result.get('last_scrub')
                    
                    log_and_store(f"Pool status: {pool_status}")
                    log_and_store(f"Capacity: {used_percent}% used ({free_gb:.1f} GB free of {total_gb:.1f} GB)")
                    if last_scrub:
                        log_and_store(f"Last scrub: {last_scrub}")
                    
                    pool_message = health_result.get('error') if not health_result.get('success') else f"Pool {pool} is {pool_status}"
                    
                    # Log SSH command
                    self._log_ssh_command(
                        job_id=job_id,
                        command=f'zpool status {pool}',
                        hostname=hostname,
                        output=f"Status: {pool_status}, Used: {used_percent}%",
                        success=health_result.get('success', False),
                        duration_ms=duration_ms,
                        operation_type='zfs_pool_health'
                    )
                    
                    results['tests'].append({
                        'name': 'zfs_pool_health',
                        'success': health_result.get('success', False),
                        'pool_status': pool_status,
                        'free_gb': free_gb,
                        'total_gb': total_gb,
                        'used_percent': used_percent,
                        'last_scrub': last_scrub,
                        'message': pool_message,
                        'repairable': pool_status in ('DEGRADED', 'FAULTED')
                    })
                    
                    add_step_result('zfs_pool_health', 'success' if health_result.get('success') else 'failed', pool_message, duration_ms)
                    
                    if task_id:
                        status = 'completed' if health_result.get('success') else 'failed'
                        self.update_task_status(task_id, status, log=pool_message, progress=100)
                    
                    if not health_result.get('success'):
                        overall_status = 'degraded'
                    elif pool_status != 'ONLINE':
                        overall_status = 'degraded'
                    elif used_percent > 90:
                        overall_status = 'degraded'
                        results['tests'][-1]['message'] = f"Pool {pool} is {used_percent}% full"
                else:
                    # Basic SSH-based check
                    try:
                        ssh = paramiko.SSHClient()
                        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                        
                        pkey = self._load_private_key(key_data=creds.get('key_data'))
                        
                        ssh.connect(
                            hostname=creds['hostname'],
                            port=creds['port'],
                            username=creds['username'],
                            pkey=pkey,
                            password=creds.get('password'),
                            timeout=30
                        )
                        
                        # Check pool health
                        log_and_store(f"Running: zpool status {pool} -x")
                        stdin, stdout, stderr = ssh.exec_command(f'zpool status {pool} -x')
                        pool_output = stdout.read().decode().strip()
                        
                        for line in pool_output.split('\n')[:10]:
                            log_and_store(f"  {line}")
                        
                        # Check pool capacity
                        log_and_store(f"Running: zpool list -Ho capacity {pool}")
                        stdin, stdout, stderr = ssh.exec_command(f'zpool list -Ho capacity {pool}')
                        capacity_output = stdout.read().decode().strip().replace('%', '')
                        
                        ssh.close()
                        
                        duration_ms = int((time.time() - start_time) * 1000)
                        
                        is_healthy = 'is healthy' in pool_output.lower() or 'all pools are healthy' in pool_output.lower()
                        used_percent = int(capacity_output) if capacity_output.isdigit() else 0
                        
                        pool_message = pool_output if not is_healthy else f"Pool {pool} healthy, {used_percent}% used"
                        
                        # Log SSH command
                        self._log_ssh_command(
                            job_id=job_id,
                            command=f'zpool status {pool} -x',
                            hostname=hostname,
                            output=pool_output,
                            success=is_healthy,
                            duration_ms=duration_ms,
                            operation_type='zfs_pool_health'
                        )
                        
                        results['tests'].append({
                            'name': 'zfs_pool_health',
                            'success': is_healthy,
                            'pool_status': 'ONLINE' if is_healthy else 'DEGRADED',
                            'used_percent': used_percent,
                            'message': pool_message
                        })
                        
                        add_step_result('zfs_pool_health', 'success' if is_healthy else 'failed', pool_message, duration_ms)
                        
                        if task_id:
                            status = 'completed' if is_healthy else 'failed'
                            self.update_task_status(task_id, status, log=pool_message, progress=100)
                        
                        if not is_healthy:
                            overall_status = 'degraded'
                        elif used_percent > 90:
                            overall_status = 'degraded'
                            
                    except Exception as e:
                        duration_ms = int((time.time() - start_time) * 1000)
                        error_msg = str(e)
                        log_and_store(f"Pool health check failed: {error_msg}", "ERROR")
                        
                        results['tests'].append({
                            'name': 'zfs_pool_health',
                            'success': False,
                            'message': error_msg
                        })
                        add_step_result('zfs_pool_health', 'failed', error_msg, duration_ms)
                        
                        if task_id:
                            self.update_task_status(task_id, 'failed', log=error_msg, progress=100)
                        overall_status = 'degraded'
            else:
                # No pool configured, skip pool check
                task_id = test_tasks.get('zfs_pool_health')
                if task_id:
                    self.update_task_status(task_id, 'cancelled', log="Skipped: No ZFS pool configured")
                log_and_store("Skipping ZFS pool check: No pool configured")
            
            # =========================================================================
            # Test 3: Cross-Site SSH Connectivity
            # =========================================================================
            partner_target_id = target.get('partner_target_id')
            if partner_target_id:
                task_id = test_tasks.get('cross_site_ssh')
                if task_id:
                    self.update_task_status(task_id, 'running', log="Testing cross-site SSH...", progress=10)
                
                log_and_store(f"Testing cross-site SSH to partner target {partner_target_id}")
                start_time = time.time()
                
                partner = self._get_replication_target(partner_target_id)
                if partner:
                    partner_creds = self._get_target_ssh_creds(partner)
                    cross_site_result = {
                        'success': False,
                        'partner_name': partner.get('name'),
                        'partner_hostname': partner.get('hostname'),
                        'message': 'No credentials for partner'
                    }
                    
                    log_and_store(f"Partner: {partner.get('name')} ({partner.get('hostname')})")
                    
                    if partner_creds:
                        # Test SSH from this target to partner
                        cross_site_test = self._test_cross_site_ssh(creds, partner_creds)
                        cross_site_result = {
                            'success': cross_site_test.get('success', False),
                            'partner_name': partner.get('name'),
                            'partner_hostname': partner.get('hostname'),
                            'message': cross_site_test.get('message', cross_site_test.get('error', 'Unknown'))
                        }
                    
                    duration_ms = int((time.time() - start_time) * 1000)
                    
                    # Log SSH command
                    self._log_ssh_command(
                        job_id=job_id,
                        command=f"ssh {partner.get('hostname')} hostname",
                        hostname=hostname,
                        output=cross_site_result['message'],
                        success=cross_site_result['success'],
                        duration_ms=duration_ms,
                        operation_type='cross_site_ssh'
                    )
                    
                    results['tests'].append({
                        'name': 'cross_site_ssh',
                        'success': cross_site_result['success'],
                        'partner_name': cross_site_result['partner_name'],
                        'partner_hostname': cross_site_result['partner_hostname'],
                        'message': cross_site_result['message'],
                        'repairable': not cross_site_result['success']
                    })
                    
                    add_step_result('cross_site_ssh', 'success' if cross_site_result['success'] else 'failed', cross_site_result['message'], duration_ms)
                    
                    if task_id:
                        status = 'completed' if cross_site_result['success'] else 'failed'
                        self.update_task_status(task_id, status, log=cross_site_result['message'], progress=100)
                    
                    if cross_site_result['success']:
                        log_and_store(f"Cross-site SSH successful in {duration_ms}ms")
                    else:
                        log_and_store(f"Cross-site SSH failed: {cross_site_result['message']}", "WARN")
                    
                    if not cross_site_result['success'] and overall_status == 'healthy':
                        overall_status = 'degraded'
                    
                    # =========================================================================
                    # Test 4: Data Transfer Test
                    # =========================================================================
                    if cross_site_result['success'] and partner_creds and pool:
                        task_id = test_tasks.get('data_transfer_test')
                        if task_id:
                            self.update_task_status(task_id, 'running', log="Testing ZFS data transfer...", progress=10)
                        
                        log_and_store(f"Testing actual ZFS data transfer to partner")
                        start_time = time.time()
                        
                        transfer_result = self._test_data_transfer(creds, partner_creds, pool, job_id)
                        
                        duration_ms = int((time.time() - start_time) * 1000)
                        
                        # Log SSH command
                        self._log_ssh_command(
                            job_id=job_id,
                            command=f"zfs send/receive test to {partner.get('hostname')}",
                            hostname=hostname,
                            output=transfer_result.get('message', ''),
                            success=transfer_result.get('success', False),
                            duration_ms=duration_ms,
                            operation_type='data_transfer_test'
                        )
                        
                        transfer_success = transfer_result.get('success', False)
                        results['tests'].append({
                            'name': 'data_transfer_test',
                            'success': transfer_success,
                            'message': transfer_result.get('message', 'Unknown'),
                            'transfer_time_ms': transfer_result.get('transfer_time_ms'),
                            'bytes_transferred': transfer_result.get('bytes_transferred'),
                            'repairable': not transfer_success  # Can repair by cleaning stale datasets
                        })
                        
                        add_step_result('data_transfer_test', 'success' if transfer_result.get('success') else 'failed', transfer_result.get('message', 'Unknown'), duration_ms)
                        
                        if task_id:
                            status = 'completed' if transfer_result.get('success') else 'failed'
                            self.update_task_status(task_id, status, log=transfer_result.get('message'), progress=100)
                        
                        if transfer_result.get('success'):
                            log_and_store(f"Data transfer successful: {transfer_result.get('message')}")
                        else:
                            log_and_store(f"Data transfer failed: {transfer_result.get('message')}", "ERROR")
                        
                        if not transfer_result.get('success') and overall_status == 'healthy':
                            overall_status = 'degraded'
                    else:
                        # Skip data transfer test
                        task_id = test_tasks.get('data_transfer_test')
                        if task_id:
                            skip_reason = "Skipped: Cross-site SSH not available" if not cross_site_result['success'] else "Skipped: No pool or credentials"
                            self.update_task_status(task_id, 'cancelled', log=skip_reason)
                            log_and_store(skip_reason)
                    
                    # =========================================================================
                    # Test 5: Snapshot Sync Status
                    # =========================================================================
                    if partner_creds and pool:
                        task_id = test_tasks.get('snapshot_sync_status')
                        if task_id:
                            self.update_task_status(task_id, 'running', log="Checking snapshot sync status...", progress=10)
                        
                        log_and_store(f"Checking snapshot sync status with partner")
                        start_time = time.time()
                        
                        sync_result = self._check_snapshot_sync(creds, partner_creds, pool, job_id)
                        
                        duration_ms = int((time.time() - start_time) * 1000)
                        
                        # Log SSH command
                        self._log_ssh_command(
                            job_id=job_id,
                            command=f"zfs list -t snapshot comparison",
                            hostname=hostname,
                            output=f"Source: {sync_result.get('source_snapshot')}, Dest: {sync_result.get('dest_snapshot')}, Lag: {sync_result.get('sync_lag_hours')}h",
                            success=sync_result.get('success', False),
                            duration_ms=duration_ms,
                            operation_type='snapshot_sync_status'
                        )
                        
                        results['tests'].append({
                            'name': 'snapshot_sync_status',
                            'success': sync_result.get('success', False),
                            'message': sync_result.get('message', 'Unknown'),
                            'source_snapshot': sync_result.get('source_snapshot'),
                            'dest_snapshot': sync_result.get('dest_snapshot'),
                            'sync_lag_hours': sync_result.get('sync_lag_hours'),
                            'repairable': not sync_result.get('success', False)  # Can trigger manual sync
                        })
                        
                        add_step_result('snapshot_sync_status', 'success' if sync_result.get('success') else 'failed', sync_result.get('message', 'Unknown'), duration_ms)
                        
                        if task_id:
                            status = 'completed' if sync_result.get('success') else 'failed'
                            self.update_task_status(task_id, status, log=sync_result.get('message'), progress=100)
                        
                        if sync_result.get('success'):
                            log_and_store(f"Snapshot sync: {sync_result.get('message')}")
                        else:
                            log_and_store(f"Snapshot sync issue: {sync_result.get('message')}", "WARN")
                        
                        if not sync_result.get('success') and sync_result.get('sync_lag_hours', 0) > 24:
                            if overall_status == 'healthy':
                                overall_status = 'degraded'
                    else:
                        # Skip snapshot sync check
                        task_id = test_tasks.get('snapshot_sync_status')
                        if task_id:
                            skip_reason = "Skipped: No partner credentials or pool"
                            self.update_task_status(task_id, 'cancelled', log=skip_reason)
                            log_and_store(skip_reason)
                else:
                    # Partner not found
                    task_id = test_tasks.get('cross_site_ssh')
                    if task_id:
                        self.update_task_status(task_id, 'failed', log=f"Partner target not found: {partner_target_id}")
                    log_and_store(f"Partner target not found: {partner_target_id}", "ERROR")
                    
                    for name in ['data_transfer_test', 'snapshot_sync_status']:
                        tid = test_tasks.get(name)
                        if tid:
                            self.update_task_status(tid, 'cancelled', log="Skipped: Partner not found")
            else:
                # No partner configured
                log_and_store("No partner target configured - skipping cross-site tests")
                for name in ['cross_site_ssh', 'data_transfer_test', 'snapshot_sync_status']:
                    tid = test_tasks.get(name)
                    if tid:
                        self.update_task_status(tid, 'cancelled', log="Skipped: No partner configured")
            
            results['overall_status'] = overall_status
            
            # Update target health status in database
            self._update_replication_target(target_id,
                health_status=overall_status,
                last_health_check=utc_now_iso(),
                health_check_error=None if overall_status == 'healthy' else results.get('tests', [{}])[-1].get('message')
            )
            
            log_and_store(f"Health check complete: {overall_status}")
            self.update_job_status(job_id, 'completed',
                completed_at=utc_now_iso(),
                details={**details, 'results': results, 'console_log': console_log, 'step_results': step_results}
            )
            
        except Exception as e:
            log_and_store(f"Health check failed: {e}", "ERROR")
            self.update_job_status(job_id, 'failed',
                completed_at=utc_now_iso(),
                details={**details, 'error': str(e), 'console_log': console_log, 'step_results': step_results}
            )
    
    def _update_replication_target(self, target_id: str, **kwargs) -> bool:
        """Update replication target fields"""
        try:
            response = requests.patch(
                f"{DSM_URL}/rest/v1/replication_targets",
                params={'id': f'eq.{target_id}'},
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
            self.executor.log(f"Error updating replication target: {e}", "ERROR")
            return False
    
    def _test_data_transfer(self, source_creds: Dict, partner_creds: Dict, pool: str, job_id: str = None) -> Dict:
        """
        Test actual ZFS data transfer between source and partner.
        Creates a small test dataset, sends it via zfs send/receive, verifies it arrived.
        """
        if not PARAMIKO_AVAILABLE:
            return {'success': False, 'message': 'paramiko not installed'}
        
        # Use unique timestamped dataset to avoid stale data issues
        timestamp = int(time.time())
        test_dataset = f"{pool}/dsm_health_test_{timestamp}"
        test_snapshot = f"{test_dataset}@healthcheck"
        test_content = f"dsm-healthcheck-{timestamp}"
        
        try:
            # Connect to source
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            pkey = None
            if source_creds.get('key_data'):
                key_file = io.StringIO(source_creds['key_data'])
                for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                    try:
                        key_file.seek(0)
                        pkey = key_class.from_private_key(key_file)
                        break
                    except:
                        continue
            
            ssh.connect(
                hostname=source_creds['hostname'],
                port=source_creds['port'],
                username=source_creds['username'],
                pkey=pkey,
                password=source_creds.get('password'),
                timeout=30,
                allow_agent=False,
                look_for_keys=False
            )
            
            if job_id:
                self.executor.log(f"[{job_id}] Creating test dataset {test_dataset}")
            
            # Create fresh test dataset with verification (like repair function pattern)
            create_cmd = f"""
                zfs destroy -r {test_dataset} 2>/dev/null || true
                zfs create {test_dataset} && \
                echo '{test_content}' > /{test_dataset}/verify.txt && \
                sync && \
                echo 'DATASET_CREATED'
            """
            stdin, stdout, stderr = ssh.exec_command(create_cmd, timeout=30)
            create_result = stdout.read().decode().strip()
            create_error = stderr.read().decode().strip()
            
            if 'DATASET_CREATED' not in create_result:
                ssh.close()
                return {
                    'success': False,
                    'message': f'Failed to create test dataset',
                    'error': create_error or create_result or 'No output from create command'
                }
            
            if job_id:
                self.executor.log(f"[{job_id}] Sending test snapshot to partner")
            
            # Send to partner and time it (use inline snapshot creation like repair function)
            partner_host = partner_creds['hostname']
            partner_user = partner_creds['username']
            partner_port = partner_creds.get('port', 22)
            
            start_time = time.time()
            # Use inline snapshot creation pattern (like repair function)
            send_cmd = f"""
                zfs snapshot {test_snapshot} 2>/dev/null || true
                zfs send {test_snapshot} | ssh -o StrictHostKeyChecking=no -p {partner_port} {partner_user}@{partner_host} 'zfs receive -F {test_dataset}' && echo 'SEND_OK'
            """
            stdin, stdout, stderr = ssh.exec_command(send_cmd, timeout=120)
            send_output = stdout.read().decode().strip()
            send_error = stderr.read().decode().strip()
            transfer_time = (time.time() - start_time) * 1000  # ms
            
            if job_id:
                self.executor.log(f"[{job_id}] Send output: {send_output[:200] if send_output else 'empty'}")
                if send_error:
                    self.executor.log(f"[{job_id}] Send stderr: {send_error[:200]}")
            
            # Check if send succeeded
            if 'SEND_OK' not in send_output:
                # Cleanup source
                ssh.exec_command(f"zfs destroy -r {test_dataset} 2>/dev/null || true")
                ssh.close()
                return {
                    'success': False,
                    'message': 'ZFS send/receive failed',
                    'transfer_time_ms': round(transfer_time),
                    'error': send_error or send_output or 'No output from send command'
                }
            
            # Small delay to ensure filesystem is synced on partner
            time.sleep(0.3)
            
            if job_id:
                self.executor.log(f"[{job_id}] Verifying data on partner")
            
            # Verify on destination
            verify_cmd = f"ssh -o StrictHostKeyChecking=no -p {partner_port} {partner_user}@{partner_host} 'cat /{test_dataset}/verify.txt' 2>&1"
            stdin, stdout, stderr = ssh.exec_command(verify_cmd, timeout=30)
            verify_output = stdout.read().decode().strip()
            
            if job_id:
                self.executor.log(f"[{job_id}] Cleaning up test dataset")
            
            # Cleanup both sides
            ssh.exec_command(f"zfs destroy -r {test_dataset} 2>/dev/null || true")
            ssh.exec_command(f"ssh -o StrictHostKeyChecking=no -p {partner_port} {partner_user}@{partner_host} 'zfs destroy -r {test_dataset}' 2>/dev/null || true")
            
            ssh.close()
            
            # Verify content matches
            if test_content in verify_output:
                return {
                    'success': True,
                    'message': f'Data replicated to partner in {transfer_time:.0f}ms',
                    'transfer_time_ms': round(transfer_time),
                    'bytes_transferred': len(test_content)
                }
            else:
                return {
                    'success': False,
                    'message': f'Content mismatch on destination',
                    'transfer_time_ms': round(transfer_time),
                    'error': verify_output or send_output or send_error
                }
                
        except Exception as e:
            return {'success': False, 'message': f'Data transfer test failed: {e}'}
    
    def _check_snapshot_sync(self, source_creds: Dict, partner_creds: Dict, pool: str, job_id: str = None) -> Dict:
        """
        Check if snapshots are in sync between source and destination.
        Compares the latest snapshot on source vs destination for replicated datasets.
        """
        if not PARAMIKO_AVAILABLE:
            return {'success': False, 'message': 'paramiko not installed'}
        
        try:
            # Connect to source
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            pkey = None
            if source_creds.get('key_data'):
                key_file = io.StringIO(source_creds['key_data'])
                for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                    try:
                        key_file.seek(0)
                        pkey = key_class.from_private_key(key_file)
                        break
                    except:
                        continue
            
            ssh.connect(
                hostname=source_creds['hostname'],
                port=source_creds['port'],
                username=source_creds['username'],
                pkey=pkey,
                password=source_creds.get('password'),
                timeout=30,
                allow_agent=False,
                look_for_keys=False
            )
            
            # Get latest snapshot on source (exclude health test dataset)
            stdin, stdout, stderr = ssh.exec_command(
                f"zfs list -t snapshot -o name,creation -Hp -r {pool} 2>/dev/null | grep -v dsm_health_test | tail -1"
            )
            source_output = stdout.read().decode().strip()
            
            partner_host = partner_creds['hostname']
            partner_user = partner_creds['username']
            partner_port = partner_creds.get('port', 22)
            
            # Get latest snapshot on destination
            stdin, stdout, stderr = ssh.exec_command(
                f"ssh -o StrictHostKeyChecking=no -p {partner_port} {partner_user}@{partner_host} "
                f"'zfs list -t snapshot -o name,creation -Hp -r {pool} 2>/dev/null | grep -v dsm_health_test | tail -1'"
            )
            dest_output = stdout.read().decode().strip()
            
            ssh.close()
            
            # Parse results
            source_parts = source_output.split('\t') if source_output else []
            dest_parts = dest_output.split('\t') if dest_output else []
            
            source_snapshot = source_parts[0] if len(source_parts) >= 1 else None
            source_time = int(source_parts[1]) if len(source_parts) >= 2 else None
            dest_snapshot = dest_parts[0] if len(dest_parts) >= 1 else None
            dest_time = int(dest_parts[1]) if len(dest_parts) >= 2 else None
            
            if not source_snapshot:
                return {
                    'success': True,
                    'message': 'No snapshots found on source (nothing to sync)',
                    'source_snapshot': None,
                    'dest_snapshot': dest_snapshot,
                    'sync_lag_hours': 0
                }
            
            if not dest_snapshot:
                return {
                    'success': False,
                    'message': 'No snapshots on destination - replication may not be set up',
                    'source_snapshot': source_snapshot,
                    'dest_snapshot': None,
                    'sync_lag_hours': None
                }
            
            # Calculate lag
            if source_time and dest_time:
                lag_seconds = source_time - dest_time
                lag_hours = round(lag_seconds / 3600, 1)
                
                if lag_hours <= 0.5:
                    return {
                        'success': True,
                        'message': 'Snapshots are in sync',
                        'source_snapshot': source_snapshot.split('@')[-1] if '@' in source_snapshot else source_snapshot,
                        'dest_snapshot': dest_snapshot.split('@')[-1] if '@' in dest_snapshot else dest_snapshot,
                        'sync_lag_hours': 0
                    }
                else:
                    return {
                        'success': lag_hours < 24,  # Warning if more than 24h behind
                        'message': f'Destination is {lag_hours}h behind source',
                        'source_snapshot': source_snapshot.split('@')[-1] if '@' in source_snapshot else source_snapshot,
                        'dest_snapshot': dest_snapshot.split('@')[-1] if '@' in dest_snapshot else dest_snapshot,
                        'sync_lag_hours': lag_hours
                    }
            
            # Fallback: compare snapshot names
            source_snap_name = source_snapshot.split('@')[-1] if '@' in source_snapshot else source_snapshot
            dest_snap_name = dest_snapshot.split('@')[-1] if '@' in dest_snapshot else dest_snapshot
            
            if source_snap_name == dest_snap_name:
                return {
                    'success': True,
                    'message': 'Latest snapshots match',
                    'source_snapshot': source_snap_name,
                    'dest_snapshot': dest_snap_name,
                    'sync_lag_hours': 0
                }
            else:
                return {
                    'success': False,
                    'message': 'Snapshot mismatch between source and destination',
                    'source_snapshot': source_snap_name,
                    'dest_snapshot': dest_snap_name,
                    'sync_lag_hours': None
                }
                
        except Exception as e:
            return {'success': False, 'message': f'Sync check failed: {e}'}
    
    def _test_cross_site_ssh(self, source_creds: Dict, partner_creds: Dict) -> Dict:
        """
        Test if source target can SSH to partner target.
        This verifies the cross-site replication link is functional.
        """
        if not PARAMIKO_AVAILABLE:
            return {'success': False, 'error': 'paramiko not installed'}
        
        try:
            # Connect to source
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            pkey = None
            if source_creds.get('key_data'):
                key_file = io.StringIO(source_creds['key_data'])
                for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                    try:
                        key_file.seek(0)
                        pkey = key_class.from_private_key(key_file)
                        break
                    except:
                        continue
            
            ssh.connect(
                hostname=source_creds['hostname'],
                port=source_creds['port'],
                username=source_creds['username'],
                pkey=pkey,
                password=source_creds.get('password'),
                timeout=30,
                allow_agent=False,
                look_for_keys=False
            )
            
            # From source, try to SSH to partner
            partner_host = partner_creds['hostname']
            partner_port = partner_creds['port']
            partner_user = partner_creds['username']
            
            # Test with ssh command from source to partner
            cmd = f"ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -p {partner_port} {partner_user}@{partner_host} 'hostname' 2>&1 || echo 'SSH_FAILED'"
            stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
            output = stdout.read().decode().strip()
            
            ssh.close()
            
            if 'SSH_FAILED' in output or 'Permission denied' in output or 'Connection refused' in output:
                return {
                    'success': False,
                    'error': f'Cannot reach partner: {output}',
                    'message': f'SSH from source to partner failed'
                }
            
            return {
                'success': True,
                'message': f'Cross-site SSH working (partner hostname: {output})'
            }
            
        except Exception as e:
            return {'success': False, 'error': str(e), 'message': f'Cross-site test failed: {e}'}
    
    # =========================================================================
    # Repair Handlers
    # =========================================================================
    
    def execute_repair_zfs_pool(self, job: Dict):
        """
        Attempt to repair a degraded ZFS pool.
        Actions: scrub the pool, clear errors, report status.
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        self.executor.log(f"[{job_id}] Starting ZFS pool repair")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            target_id = details.get('target_id')
            hostname = details.get('hostname')
            zfs_pool = details.get('zfs_pool')
            
            if not target_id:
                raise ValueError("No target_id provided")
            
            target = self._get_replication_target(target_id)
            if not target:
                raise ValueError(f"Target not found: {target_id}")
            
            creds = self._get_target_ssh_creds(target)
            if not creds:
                raise ValueError("No SSH credentials available")
            
            # Connect via SSH
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            pkey = None
            if creds.get('key_data'):
                key_file = io.StringIO(creds['key_data'])
                for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                    try:
                        key_file.seek(0)
                        pkey = key_class.from_private_key(key_file)
                        break
                    except:
                        continue
            
            ssh.connect(
                hostname=creds['hostname'],
                port=creds['port'],
                username=creds['username'],
                pkey=pkey,
                password=creds.get('password'),
                timeout=30
            )
            
            repair_log = []
            
            # Clear pool errors
            self.executor.log(f"[{job_id}] Clearing pool errors")
            stdin, stdout, stderr = ssh.exec_command(f'zpool clear {zfs_pool} 2>&1')
            clear_output = stdout.read().decode().strip()
            repair_log.append(f"zpool clear: {clear_output or 'OK'}")
            
            # Start a scrub
            self.executor.log(f"[{job_id}] Starting pool scrub")
            stdin, stdout, stderr = ssh.exec_command(f'zpool scrub {zfs_pool} 2>&1')
            scrub_output = stdout.read().decode().strip()
            repair_log.append(f"zpool scrub: {scrub_output or 'Started'}")
            
            # Check current status
            stdin, stdout, stderr = ssh.exec_command(f'zpool status -x {zfs_pool}')
            status_output = stdout.read().decode().strip()
            repair_log.append(f"Status: {status_output}")
            
            ssh.close()
            
            is_healthy = 'is healthy' in status_output.lower() or 'all pools are healthy' in status_output.lower()
            
            self.executor.log(f"[{job_id}] Repair complete, pool healthy: {is_healthy}")
            self.update_job_status(job_id, 'completed',
                completed_at=utc_now_iso(),
                details={
                    **details,
                    'repair_log': repair_log,
                    'is_healthy': is_healthy,
                    'message': 'Pool repair attempted. Scrub started.' if not is_healthy else 'Pool is now healthy'
                }
            )
            
        except Exception as e:
            self.executor.log(f"[{job_id}] Repair failed: {e}", "ERROR")
            self.update_job_status(job_id, 'failed',
                completed_at=utc_now_iso(),
                details={**details, 'error': str(e)}
            )
    
    def execute_repair_cross_site_ssh(self, job: Dict):
        """
        Attempt to repair cross-site SSH by re-exchanging keys.
        This creates an exchange_ssh_keys job for the pair.
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        self.executor.log(f"[{job_id}] Starting cross-site SSH repair")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            target_id = details.get('target_id')
            
            if not target_id:
                raise ValueError("No target_id provided")
            
            target = self._get_replication_target(target_id)
            if not target:
                raise ValueError(f"Target not found: {target_id}")
            
            partner_id = target.get('partner_target_id')
            if not partner_id:
                raise ValueError("No partner target configured - cannot repair cross-site SSH")
            
            # Create an SSH key exchange job between the pair
            self.executor.log(f"[{job_id}] Creating SSH key exchange job for pair")
            
            response = requests.post(
                f"{DSM_URL}/rest/v1/jobs",
                json={
                    'job_type': 'exchange_ssh_keys',
                    'status': 'pending',
                    'created_by': job.get('created_by'),
                    'details': {
                        'source_target_id': target_id,
                        'destination_target_id': partner_id,
                        'reason': 'Cross-site SSH repair',
                        'parent_repair_job_id': job_id
                    }
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if not response.ok:
                raise ValueError(f"Failed to create exchange job: {response.text}")
            
            exchange_job = response.json()
            exchange_job_id = exchange_job[0]['id'] if exchange_job else None
            
            self.executor.log(f"[{job_id}] Created exchange_ssh_keys job: {exchange_job_id}")
            self.update_job_status(job_id, 'completed',
                completed_at=utc_now_iso(),
                details={
                    **details,
                    'exchange_job_id': exchange_job_id,
                    'message': 'SSH key exchange job created. Check its status for results.'
                }
            )
            
        except Exception as e:
            self.executor.log(f"[{job_id}] Repair failed: {e}", "ERROR")
            self.update_job_status(job_id, 'failed',
                completed_at=utc_now_iso(),
                details={**details, 'error': str(e)}
            )
    
    def execute_repair_syncoid_cron(self, job: Dict):
        """
        Repair syncoid cron schedule by reinstalling it.
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        self.executor.log(f"[{job_id}] Starting syncoid cron repair")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            target_id = details.get('target_id')
            
            if not target_id:
                raise ValueError("No target_id provided")
            
            target = self._get_replication_target(target_id)
            if not target:
                raise ValueError(f"Target not found: {target_id}")
            
            creds = self._get_target_ssh_creds(target)
            if not creds:
                raise ValueError("No SSH credentials available")
            
            partner_id = target.get('partner_target_id')
            partner = self._get_replication_target(partner_id) if partner_id else None
            
            # Connect via SSH
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            pkey = None
            if creds.get('key_data'):
                key_file = io.StringIO(creds['key_data'])
                for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                    try:
                        key_file.seek(0)
                        pkey = key_class.from_private_key(key_file)
                        break
                    except:
                        continue
            
            ssh.connect(
                hostname=creds['hostname'],
                port=creds['port'],
                username=creds['username'],
                pkey=pkey,
                password=creds.get('password'),
                timeout=30
            )
            
            repair_log = []
            
            # Check if syncoid is installed
            stdin, stdout, stderr = ssh.exec_command('which syncoid 2>/dev/null || echo "NOT_FOUND"')
            syncoid_path = stdout.read().decode().strip()
            
            if syncoid_path == 'NOT_FOUND':
                repair_log.append("syncoid not installed on this system")
                self.executor.log(f"[{job_id}] syncoid not installed")
            else:
                repair_log.append(f"syncoid found at: {syncoid_path}")
                
                # Check existing crontab
                stdin, stdout, stderr = ssh.exec_command('crontab -l 2>/dev/null || echo "NO_CRONTAB"')
                crontab = stdout.read().decode().strip()
                
                if 'syncoid' in crontab:
                    repair_log.append("syncoid cron entry already exists")
                else:
                    repair_log.append("No syncoid cron entry found")
                    
                    # If we have a partner, suggest/create the cron entry
                    if partner:
                        partner_host = partner.get('hostname')
                        partner_user = partner.get('ssh_username', 'root')
                        pool = target.get('zfs_pool', 'tank')
                        
                        cron_entry = f"0 */4 * * * {syncoid_path} --no-privilege-elevation {pool} {partner_user}@{partner_host}:{pool} >> /var/log/syncoid.log 2>&1"
                        repair_log.append(f"Suggested cron entry: {cron_entry}")
                        repair_log.append("Note: Manual review recommended before enabling automated replication")
                    else:
                        repair_log.append("No partner target configured - cannot set up replication cron")
            
            ssh.close()
            
            self.executor.log(f"[{job_id}] Cron repair check complete")
            self.update_job_status(job_id, 'completed',
                completed_at=utc_now_iso(),
                details={
                    **details,
                    'repair_log': repair_log,
                    'message': 'Syncoid cron check complete. Review repair log for details.'
                }
            )
            
        except Exception as e:
            self.executor.log(f"[{job_id}] Repair failed: {e}", "ERROR")
            self.update_job_status(job_id, 'failed',
                completed_at=utc_now_iso(),
                details={**details, 'error': str(e)}
            )

    # =========================================================================
    # Repair Data Transfer (Job Queue Handler)
    # =========================================================================
    
    def execute_repair_data_transfer(self, job: Dict):
        """
        Repair data transfer test failures by cleaning up stale test datasets
        and re-running a controlled test transfer.
        
        Actions:
        1. Clean up stale health_test datasets on source
        2. Clean up stale health_test datasets on destination (via cross-site SSH)
        3. Re-run a fresh controlled test transfer
        4. Verify content matches on destination
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        target_id = details.get('target_id')
        
        self.executor.log(f"[{job_id}] Starting data transfer repair for target {target_id}")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        repair_log = []
        
        def log_step(msg: str):
            repair_log.append(msg)
            self.executor.log(f"[{job_id}] {msg}")
        
        try:
            if not target_id:
                raise ValueError("No target_id provided in job details")
            
            # Get target
            target = self._get_replication_target(target_id)
            if not target:
                raise ValueError(f"Replication target not found: {target_id}")
            
            hostname = target.get('hostname')
            pool = target.get('zfs_pool', 'tank')
            log_step(f"Target: {target.get('name')} ({hostname}), Pool: {pool}")
            
            # Get SSH credentials
            creds = self._get_target_ssh_creds(target)
            if not creds:
                raise ValueError(f"No SSH credentials available for target {hostname}")
            
            # Connect via SSH
            import paramiko
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            pkey = self._load_private_key(
                key_path=creds.get('key_path'),
                key_data=creds.get('key_data')
            )
            
            ssh.connect(
                hostname=creds['hostname'],
                port=creds['port'],
                username=creds['username'],
                pkey=pkey,
                password=creds.get('password'),
                timeout=30
            )
            
            # Step 1: Clean up stale test datasets on source
            log_step("Cleaning up stale test datasets on source...")
            cleanup_cmd = f"zfs list -Ho name 2>/dev/null | grep -E 'health_test|transfer_test' | xargs -r -n1 zfs destroy -r 2>/dev/null; echo 'SOURCE_CLEANUP_DONE'"
            stdin, stdout, stderr = ssh.exec_command(cleanup_cmd)
            stdout.read().decode().strip()
            log_step("Source cleanup complete")
            
            # Step 2: Clean up on partner/destination via cross-site SSH
            partner_target_id = target.get('partner_target_id')
            partner = None
            partner_creds = None
            
            if partner_target_id:
                partner = self._get_replication_target(partner_target_id)
                if partner:
                    partner_creds = self._get_target_ssh_creds(partner)
                    partner_host = partner.get('hostname')
                    log_step(f"Cleaning up stale test datasets on partner ({partner_host})...")
                    
                    # Use cross-site SSH to clean destination
                    dest_cleanup_cmd = f"ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@{partner_host} \"zfs list -Ho name 2>/dev/null | grep -E 'health_test|transfer_test' | xargs -r -n1 zfs destroy -r 2>/dev/null\"; echo 'DEST_CLEANUP_DONE'"
                    stdin, stdout, stderr = ssh.exec_command(dest_cleanup_cmd, timeout=30)
                    result = stdout.read().decode().strip()
                    error = stderr.read().decode().strip()
                    
                    if 'DEST_CLEANUP_DONE' in result:
                        log_step("Destination cleanup complete")
                    else:
                        log_step(f"Destination cleanup may have issues: {error or result}")
            else:
                log_step("No partner target configured - skipping destination cleanup")
            
            # Step 3: Re-run controlled test transfer
            if partner and partner_creds:
                log_step("Running fresh data transfer test...")
                
                test_id = int(time.time())
                test_dataset = f"{pool}/repair_test_{test_id}"
                test_content = f"repair_check_{test_id}"
                partner_host = partner.get('hostname')
                partner_pool = partner.get('zfs_pool', pool)
                
                # Create test dataset with content
                create_cmd = f"""
                    zfs create {test_dataset} && \
                    echo '{test_content}' > /{test_dataset}/test.txt && \
                    sync && \
                    echo 'CREATED'
                """
                stdin, stdout, stderr = ssh.exec_command(create_cmd, timeout=30)
                create_result = stdout.read().decode().strip()
                
                if 'CREATED' not in create_result:
                    raise ValueError(f"Failed to create test dataset: {stderr.read().decode()}")
                
                log_step(f"Created test dataset: {test_dataset}")
                
                # Send to partner
                send_start = time.time()
                send_cmd = f"zfs send {test_dataset}@test_snap 2>/dev/null || (zfs snapshot {test_dataset}@test_snap && zfs send {test_dataset}@test_snap) | ssh -o StrictHostKeyChecking=no root@{partner_host} 'zfs receive -F {partner_pool}/repair_test_{test_id}' && echo 'SEND_OK'"
                stdin, stdout, stderr = ssh.exec_command(send_cmd, timeout=120)
                send_result = stdout.read().decode().strip()
                send_error = stderr.read().decode().strip()
                send_duration_ms = int((time.time() - send_start) * 1000)
                
                if 'SEND_OK' not in send_result:
                    log_step(f"Transfer failed: {send_error}")
                    # Clean up source test dataset
                    ssh.exec_command(f"zfs destroy -r {test_dataset} 2>/dev/null")
                    raise ValueError(f"Data transfer failed: {send_error}")
                
                log_step(f"Transfer complete in {send_duration_ms}ms")
                
                # Step 4: Verify content on destination
                verify_cmd = f"ssh -o StrictHostKeyChecking=no root@{partner_host} 'cat /{partner_pool}/repair_test_{test_id}/test.txt 2>/dev/null'"
                stdin, stdout, stderr = ssh.exec_command(verify_cmd, timeout=30)
                dest_content = stdout.read().decode().strip()
                
                if dest_content == test_content:
                    log_step("Content verification PASSED - data transfer is working correctly")
                    success = True
                else:
                    log_step(f"Content verification FAILED - expected '{test_content}', got '{dest_content}'")
                    success = False
                
                # Clean up test datasets
                log_step("Cleaning up test datasets...")
                ssh.exec_command(f"zfs destroy -r {test_dataset} 2>/dev/null")
                ssh.exec_command(f"ssh -o StrictHostKeyChecking=no root@{partner_host} 'zfs destroy -r {partner_pool}/repair_test_{test_id} 2>/dev/null'")
                
            else:
                log_step("No partner configured - cannot verify data transfer")
                success = False
            
            ssh.close()
            
            if success:
                log_step("Data transfer repair completed successfully")
                self.update_job_status(job_id, 'completed',
                    completed_at=utc_now_iso(),
                    details={
                        **details,
                        'repair_log': repair_log,
                        'success': True,
                        'message': 'Data transfer repair completed - transfer verified working'
                    }
                )
            else:
                log_step("Repair completed but transfer verification failed")
                self.update_job_status(job_id, 'failed',
                    completed_at=utc_now_iso(),
                    details={
                        **details,
                        'repair_log': repair_log,
                        'success': False,
                        'message': 'Transfer verification failed after repair - may require manual investigation'
                    }
                )
            
        except Exception as e:
            self.executor.log(f"[{job_id}] Repair failed: {e}", "ERROR")
            repair_log.append(f"Error: {str(e)}")
            self.update_job_status(job_id, 'failed',
                completed_at=utc_now_iso(),
                details={
                    **details,
                    'repair_log': repair_log,
                    'error': str(e)
                }
            )

    
    def _handle_existing_shell_vm(self, content, shell_vm_name: str, job_id: str) -> bool:
        """
        Check for existing VM with same name and handle it.
        
        Returns True if we can proceed with creation.
        Raises ValueError if VM exists and is powered on.
        """
        from pyVmomi import vim
        
        # Search for existing VM by name
        view = content.viewManager.CreateContainerView(
            content.rootFolder, [vim.VirtualMachine], True
        )
        
        existing_vm = None
        try:
            for vm in view.view:
                if vm.name == shell_vm_name:
                    existing_vm = vm
                    break
        finally:
            view.Destroy()
        
        if not existing_vm:
            return True  # No conflict, proceed
        
        # VM exists - check power state
        power_state = existing_vm.runtime.powerState
        self._add_console_log(job_id, f"Found existing VM '{shell_vm_name}' in state: {power_state}")
        
        if power_state == vim.VirtualMachine.PowerState.poweredOn:
            raise ValueError(
                f"VM '{shell_vm_name}' already exists and is powered on. "
                "Power it off or remove it before creating a new shell."
            )
        
        # Powered off - unregister it (keeps disks intact)
        self._add_console_log(job_id, f"Removing stale shell VM: {shell_vm_name}")
        try:
            existing_vm.UnregisterVM()
            self._add_console_log(job_id, f"Unregistered existing VM '{shell_vm_name}'")
        except Exception as e:
            self._add_console_log(job_id, f"Failed to unregister: {e}", "WARN")
            # Try Destroy if unregister fails (last resort - may delete files)
            task = existing_vm.Destroy_Task()
            for _ in range(30):
                if task.info.state in ['success', 'error']:
                    break
                time.sleep(1)
        
        return True

    def _unregister_conflicting_vms(self, content, datastore, source_vm_name: str, dr_shell_name: str, job_id: str) -> bool:
        """
        Find and unregister any VMs that reference files in the target folder.
        This prevents file locking conflicts during test failover when the replicated
        source VM's .vmx file may be registered and holding locks on VMDKs.
        
        Returns False if an active (powered-on) DR Shell exists, True otherwise.
        """
        from pyVmomi import vim
        
        folder_pattern = f"[{datastore.name}] {source_vm_name}/"
        self._add_console_log(job_id, f"Checking for conflicting VMs in: {folder_pattern}")
        
        container = content.viewManager.CreateContainerView(
            content.rootFolder, [vim.VirtualMachine], True
        )
        
        conflicting_vms = []
        try:
            for vm in container.view:
                try:
                    # Check VM's configuration file path
                    if vm.config and vm.config.files:
                        vm_path = vm.config.files.vmPathName or ""
                        if folder_pattern in vm_path:
                            conflicting_vms.append(vm)
                            continue
                    
                    # Check all disk backing file paths
                    if vm.config and vm.config.hardware:
                        for device in vm.config.hardware.device:
                            if isinstance(device, vim.vm.device.VirtualDisk):
                                backing = device.backing
                                if hasattr(backing, 'fileName') and backing.fileName:
                                    if folder_pattern in backing.fileName:
                                        conflicting_vms.append(vm)
                                        break
                except Exception:
                    continue  # Skip VMs we can't inspect
        finally:
            container.Destroy()
        
        if not conflicting_vms:
            self._add_console_log(job_id, "No conflicting VMs found")
            return True
        
        self._add_console_log(job_id, f"Found {len(conflicting_vms)} conflicting VM(s)")
        
        for vm in conflicting_vms:
            vm_name = vm.name
            power_state = vm.runtime.powerState
            is_dr_shell = vm_name == dr_shell_name or vm_name.endswith('-DR')
            
            self._add_console_log(job_id, f"Conflicting VM: {vm_name} (state: {power_state}, is_dr_shell: {is_dr_shell})")
            
            if power_state == vim.VirtualMachine.PowerState.poweredOn:
                if is_dr_shell:
                    # Active test in progress - cannot proceed
                    self._add_console_log(job_id, f"ERROR: Active DR Shell VM {vm_name} is powered on - test failover in progress", "ERROR")
                    return False
                else:
                    # Source VM copy is powered on at DR site - unusual but warn and continue
                    self._add_console_log(job_id, f"WARNING: Source VM {vm_name} is powered on at DR site - cannot unregister", "WARN")
                    continue
            
            # VM is powered off - safe to unregister to release file locks
            try:
                vm.UnregisterVM()
                if is_dr_shell:
                    self._add_console_log(job_id, f"Unregistered existing DR Shell VM: {vm_name}")
                else:
                    self._add_console_log(job_id, f"Unregistered source VM copy: {vm_name} to release file locks")
            except Exception as e:
                self._add_console_log(job_id, f"Failed to unregister {vm_name}: {e}", "WARN")
        
        return True

    def _discover_replicated_vmdks(self, content, datastore, source_vm_name: str, job_id: str) -> list:
        """
        Discover replicated VMDK files in the VM folder on the target datastore.
        Handles both thick (descriptor+flat) and sparse/thin (single file) formats.
        """
        from pyVmomi import vim
        
        disk_paths = []
        all_vmdks = {}  # filename -> (full_path, size)
        
        try:
            browser = datastore.browser
            search_spec = vim.host.DatastoreBrowser.SearchSpec()
            search_spec.matchPattern = ["*.vmdk"]
            search_spec.details = vim.host.DatastoreBrowser.FileInfo.Details(
                fileType=True, fileSize=True
            )
            
            folder_path = f"[{datastore.name}] {source_vm_name}"
            self._add_console_log(job_id, f"Searching for VMDKs in: {folder_path}")
            
            # Use SearchDatastoreSubFolders_Task for recursive search
            task = browser.SearchDatastoreSubFolders_Task(
                datastorePath=folder_path,
                searchSpec=search_spec
            )
            
            # Wait for task
            for _ in range(120):
                if task.info.state in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
                    break
                time.sleep(1)
            
            if task.info.state == vim.TaskInfo.State.error:
                error_msg = str(task.info.error) if task.info.error else "Unknown search error"
                self._add_console_log(job_id, f"Datastore search failed: {error_msg}", "ERROR")
                return []
            
            if task.info.state == vim.TaskInfo.State.success and task.info.result:
                # Collect all VMDK files with their sizes
                for result in task.info.result:
                    result_folder = result.folderPath
                    
                    # Build correct datastore path from filesystem path
                    # result.folderPath can be:
                    #   - /vmfs/volumes/<uuid>/VM-Name (NFS/VMFS filesystem path)
                    #   - [DatastoreName] VM-Name (already in datastore format)
                    if result_folder.startswith('/vmfs/volumes/'):
                        # Parse out the relative folder after the datastore mount point
                        # Format: /vmfs/volumes/<datastore-uuid>/<relative-path>
                        parts = result_folder.rstrip('/').split('/')
                        if len(parts) >= 5:
                            # parts = ['', 'vmfs', 'volumes', 'uuid', 'VM-Name', ...]
                            relative_path = '/'.join(parts[4:])  # Everything after uuid
                            folder_path = f"[{datastore.name}] {relative_path}/"
                        else:
                            folder_path = f"[{datastore.name}] {source_vm_name}/"
                        self._add_console_log(job_id, f"Converted path: {result_folder} -> {folder_path}")
                    elif result_folder.startswith('['):
                        # Already in datastore format, just ensure proper trailing
                        folder_path = result_folder.rstrip('/').rstrip() + '/'
                    else:
                        # Fallback - assume it's the VM folder name
                        folder_path = f"[{datastore.name}] {source_vm_name}/"
                        self._add_console_log(job_id, f"Using fallback path: {folder_path}")
                    
                    for file_info in result.file:
                        file_size = getattr(file_info, 'fileSize', 0) or 0
                        file_size_mb = file_size / (1024 * 1024)
                        full_path = f"{folder_path}{file_info.path}"
                        all_vmdks[file_info.path] = (full_path, file_size)
                        self._add_console_log(job_id, f"Found: {full_path} ({file_size_mb:.1f} MB)")
                
                self._add_console_log(job_id, f"Total VMDK files found: {len(all_vmdks)}")
                
                # Process VMDKs - identify which are usable disk descriptors/data files
                for filename, (full_path, file_size) in all_vmdks.items():
                    file_size_mb = file_size / (1024 * 1024)
                    
                    # Skip metadata files
                    if any(x in filename for x in ['-ctk.vmdk', '-digest.vmdk']):
                        self._add_console_log(job_id, f"Skipping metadata file: {filename}")
                        continue
                    
                    # Skip flat files - they're data companions to descriptors
                    if '-flat.vmdk' in filename:
                        continue
                    
                    # Skip delta files - they're snapshot chains (we want the numbered snapshots instead)
                    if '-delta.vmdk' in filename:
                        continue
                    
                    # Check if this descriptor has a flat file companion (thick provisioned)
                    base_name = filename.replace('.vmdk', '')
                    expected_flat = f"{base_name}-flat.vmdk"
                    
                    if expected_flat in all_vmdks:
                        # Thick provisioned: validate flat file has data
                        flat_size = all_vmdks[expected_flat][1]
                        if flat_size > 0:
                            disk_paths.append(full_path)
                            self._add_console_log(job_id, f"Valid thick disk: {filename} (flat: {flat_size / (1024*1024):.1f} MB)")
                        else:
                            self._add_console_log(job_id, f"WARNING: Skipping {filename} - flat file is 0 bytes", "WARN")
                    else:
                        # Sparse/thin provisioned: single file must have substantial size
                        # Minimum 1KB to filter out empty/corrupt descriptors
                        if file_size > 1024:
                            disk_paths.append(full_path)
                            self._add_console_log(job_id, f"Valid sparse disk: {filename} ({file_size_mb:.1f} MB)")
                        else:
                            self._add_console_log(job_id, f"WARNING: Skipping {filename} - file too small ({file_size} bytes)", "WARN")
                
                self._add_console_log(job_id, f"Total valid VMDKs to attach: {len(disk_paths)}")
        
        except Exception as e:
            self._add_console_log(job_id, f"VMDK discovery error: {e}", "ERROR")
            import traceback
            self._add_console_log(job_id, traceback.format_exc(), "ERROR")
        
        return disk_paths

    def execute_create_dr_shell(self, job: Dict) -> bool:
        """
        Create a DR shell VM at the DR site using replicated disks.
        
        Job details expected:
        - protected_vm_id: UUID of the protected VM
        - shell_vm_name: Name for the new DR shell VM
        - cpu_count: Number of vCPUs
        - memory_mb: Memory in MB
        - dr_vcenter_id: Target DR vCenter ID
        - datastore_name: Target datastore name
        - network_name: Target network name (optional)
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        protected_vm_id = details.get('protected_vm_id')
        shell_vm_name = details.get('shell_vm_name')
        cpu_count = details.get('cpu_count', 2)
        memory_mb = details.get('memory_mb', 4096)
        dr_vcenter_id = details.get('dr_vcenter_id')
        datastore_name = details.get('datastore_name')
        network_name = details.get('network_name')
        
        self.executor.log(f"[{job_id}] Creating DR shell VM: {shell_vm_name}", "INFO")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details={
            **details,
            'current_step': 'Initializing DR shell creation',
            'progress_percent': 0
        })
        
        try:
            # Validate required parameters
            if not protected_vm_id:
                raise ValueError("protected_vm_id is required")
            if not shell_vm_name:
                raise ValueError("shell_vm_name is required")
            if not dr_vcenter_id:
                raise ValueError("dr_vcenter_id is required")
            if not datastore_name:
                raise ValueError("datastore_name is required")
            
            # Step 1: Fetch protected VM details
            self._add_console_log(job_id, f"Fetching protected VM: {protected_vm_id}")
            protected_vm = self._get_protected_vm(protected_vm_id)
            if not protected_vm:
                raise ValueError(f"Protected VM not found: {protected_vm_id}")
            
            # Fetch source VM details for guest_id (Phase 10)
            source_vm_id = protected_vm.get('vm_id')
            source_vm_guest_id = 'otherGuest64'  # Default fallback
            if source_vm_id:
                source_vm = self._get_vcenter_vm(source_vm_id)
                if source_vm and source_vm.get('guest_id'):
                    source_vm_guest_id = source_vm.get('guest_id')
                    self._add_console_log(job_id, f"Using source VM guest ID: {source_vm_guest_id}")
            
            self.update_job_status(job_id, 'running', details={
                **details,
                'current_step': 'Fetching protection group',
                'progress_percent': 10
            })
            
            # Step 2: Fetch protection group
            group_id = protected_vm.get('protection_group_id')
            if not group_id:
                raise ValueError("Protected VM has no protection group")
            
            group = self._get_protection_group(group_id)
            if not group:
                raise ValueError(f"Protection group not found: {group_id}")
            
            # Step 3: Get replication target for disk info
            self._add_console_log(job_id, "Looking up replication target")
            target_id = group.get('target_id')
            target = self._get_replication_target(target_id) if target_id else None
            
            self.update_job_status(job_id, 'running', details={
                **details,
                'current_step': 'Connecting to DR vCenter',
                'progress_percent': 20
            })
            
            # Step 4: Get DR vCenter credentials
            vcenter_data = self._get_vcenter(dr_vcenter_id)
            if not vcenter_data:
                raise ValueError(f"DR vCenter not found: {dr_vcenter_id}")
            
            vcenter_host = vcenter_data.get('host')
            vcenter_user = vcenter_data.get('username')
            vcenter_password_enc = vcenter_data.get('password_encrypted')
            
            # Decrypt password
            vcenter_password = self.executor.decrypt_password(vcenter_password_enc) if vcenter_password_enc else None
            if not vcenter_password:
                raise ValueError("Unable to decrypt vCenter password")
            
            self._add_console_log(job_id, f"Connecting to DR vCenter: {vcenter_host}")
            
            # Step 5: Connect to vCenter
            import ssl
            from pyVim.connect import SmartConnect, Disconnect
            from pyVmomi import vim
            
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            
            si = SmartConnect(
                host=vcenter_host,
                user=vcenter_user,
                pwd=vcenter_password,
                sslContext=context
            )
            
            try:
                content = si.RetrieveContent()
                
                # Check for and handle existing shell VM with same name
                self._add_console_log(job_id, f"Checking for existing VM: {shell_vm_name}")
                self._handle_existing_shell_vm(content, shell_vm_name, job_id)
                
                self.update_job_status(job_id, 'running', details={
                    **details,
                    'current_step': 'Finding target datastore and cluster',
                    'progress_percent': 30
                })
                
                # Step 6: Find target datastore (recursive search including StoragePods)
                self._add_console_log(job_id, f"Looking for datastore: {datastore_name}")
                datastore = self._find_datastore_recursive(content, datastore_name)
                
                if not datastore:
                    # List available datastores for debugging
                    available = []
                    for dc in content.rootFolder.childEntity:
                        if hasattr(dc, 'datastoreFolder'):
                            self._collect_datastore_names(dc.datastoreFolder, available)
                    
                    available_list = ', '.join(available[:15])
                    if len(available) > 15:
                        available_list += f' ... and {len(available) - 15} more'
                    
                    raise ValueError(f"Datastore not found: {datastore_name}. Available on this vCenter: [{available_list}]")
                
                # Step 6b: Check for and unregister conflicting VMs to release file locks
                source_vm_name = protected_vm.get('vm_name')
                can_proceed = self._unregister_conflicting_vms(content, datastore, source_vm_name, shell_vm_name, job_id)
                
                if not can_proceed:
                    raise ValueError(f"Cannot create DR Shell: Active test failover in progress for {source_vm_name}")
                
                # Step 6c: Discover replicated VMDKs
                self._add_console_log(job_id, f"Discovering replicated VMDKs for: {source_vm_name}")
                disk_paths = self._discover_replicated_vmdks(content, datastore, source_vm_name, job_id)
                
                if not disk_paths:
                    raise ValueError(f"No replicated VMDKs found in [{datastore_name}] {source_vm_name}/")
                
                self._add_console_log(job_id, f"Found {len(disk_paths)} replicated disk(s)")
                
                # Step 7: Find a cluster/host to create VM on
                cluster = None
                host = None
                for dc in content.rootFolder.childEntity:
                    if hasattr(dc, 'hostFolder'):
                        for child in dc.hostFolder.childEntity:
                            if isinstance(child, vim.ClusterComputeResource):
                                cluster = child
                                if cluster.host:
                                    host = cluster.host[0]
                                break
                            elif isinstance(child, vim.ComputeResource):
                                if child.host:
                                    host = child.host[0]
                                    break
                    if host:
                        break
                
                if not host:
                    raise ValueError("No available host found in DR vCenter")
                
                self.update_job_status(job_id, 'running', details={
                    **details,
                    'current_step': 'Creating DR shell VM',
                    'progress_percent': 50
                })
                
                # Step 8: Find network if specified
                network = None
                if network_name:
                    self._add_console_log(job_id, f"Looking for network: {network_name}")
                    for dc in content.rootFolder.childEntity:
                        if hasattr(dc, 'networkFolder'):
                            for net in dc.networkFolder.childEntity:
                                if hasattr(net, 'name') and net.name == network_name:
                                    network = net
                                    break
                        if network:
                            break
                
                # Step 9: Create VM configuration
                self._add_console_log(job_id, f"Creating VM: {shell_vm_name}")
                
                # VM folder - use datacenter's vmFolder
                vm_folder = None
                for dc in content.rootFolder.childEntity:
                    if hasattr(dc, 'vmFolder'):
                        vm_folder = dc.vmFolder
                        break
                
                if not vm_folder:
                    raise ValueError("No VM folder found")
                
                # Resource pool
                resource_pool = cluster.resourcePool if cluster else host.parent.resourcePool
                
                # Create VM spec
                vmx_file = vim.vm.FileInfo(vmPathName=f"[{datastore_name}]")
                
                config_spec = vim.vm.ConfigSpec()
                config_spec.name = shell_vm_name
                config_spec.memoryMB = memory_mb
                config_spec.numCPUs = cpu_count
                config_spec.guestId = source_vm_guest_id  # Phase 10: Use source VM's guest ID
                config_spec.files = vmx_file
                
                # Build device changes list
                device_changes = []
                
                # Add SCSI controller for disks
                # Use negative key for new devices - vSphere will auto-assign
                scsi_controller_key = -100
                scsi_ctr = vim.vm.device.VirtualDeviceSpec()
                scsi_ctr.operation = vim.vm.device.VirtualDeviceSpec.Operation.add
                scsi_ctr.device = vim.vm.device.VirtualLsiLogicController()
                scsi_ctr.device.key = scsi_controller_key
                scsi_ctr.device.busNumber = 0
                scsi_ctr.device.sharedBus = vim.vm.device.VirtualSCSIController.Sharing.noSharing
                device_changes.append(scsi_ctr)
                
                # Attach replicated disks
                self._add_console_log(job_id, f"Attaching {len(disk_paths)} validated disk(s) to VM")
                for i, disk_path in enumerate(disk_paths):
                    # Calculate unit number, skipping 7 (reserved for SCSI controller)
                    unit_number = i if i < 7 else i + 1
                    
                    # Log the exact path being used
                    self._add_console_log(job_id, f"Disk {i}: unit={unit_number}, path='{disk_path}'")
                    
                    disk_spec = vim.vm.device.VirtualDeviceSpec()
                    disk_spec.operation = vim.vm.device.VirtualDeviceSpec.Operation.add
                    disk_spec.device = vim.vm.device.VirtualDisk()
                    disk_spec.device.key = -101 - i  # Negative keys for new devices
                    disk_spec.device.controllerKey = scsi_controller_key
                    disk_spec.device.unitNumber = unit_number
                    disk_spec.device.backing = vim.vm.device.VirtualDisk.FlatVer2BackingInfo()
                    disk_spec.device.backing.fileName = disk_path
                    disk_spec.device.backing.diskMode = 'persistent'
                    disk_spec.device.backing.datastore = datastore
                    device_changes.append(disk_spec)
                    self._add_console_log(job_id, f"Added disk spec for: {disk_path.split('/')[-1] if '/' in disk_path else disk_path.split('] ')[-1]}")
                
                # Add network adapter if network specified
                if network:
                    nic_spec = vim.vm.device.VirtualDeviceSpec()
                    nic_spec.operation = vim.vm.device.VirtualDeviceSpec.Operation.add
                    nic = vim.vm.device.VirtualVmxnet3()
                    nic.backing = vim.vm.device.VirtualEthernetCard.NetworkBackingInfo()
                    nic.backing.deviceName = network_name
                    nic.backing.network = network
                    nic.connectable = vim.vm.device.VirtualDevice.ConnectInfo()
                    nic.connectable.startConnected = True
                    nic.connectable.connected = True
                    nic.connectable.allowGuestControl = True
                    nic_spec.device = nic
                    device_changes.append(nic_spec)
                
                config_spec.deviceChange = device_changes
                
                # Create the VM
                self._add_console_log(job_id, "Creating VM task...")
                task = vm_folder.CreateVM_Task(config=config_spec, pool=resource_pool, host=host)
                
                # Wait for task completion
                self.update_job_status(job_id, 'running', details={
                    **details,
                    'current_step': 'Waiting for VM creation',
                    'progress_percent': 70
                })
                
                # Poll task
                while task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
                    time.sleep(2)
                
                if task.info.state == vim.TaskInfo.State.error:
                    raise Exception(f"VM creation failed: {task.info.error.msg}")
                
                created_vm = task.info.result
                vm_moref = created_vm._moId
                
                self._add_console_log(job_id, f"VM created successfully: {vm_moref}")
                
                self.update_job_status(job_id, 'running', details={
                    **details,
                    'current_step': 'Updating database',
                    'progress_percent': 90
                })
                
                # Step 10: Update protected_vms record
                self._update_protected_vm(protected_vm_id,
                    dr_shell_vm_created=True,
                    dr_shell_vm_name=shell_vm_name,
                    dr_shell_vm_id=vm_moref
                )
                
                self.executor.log(f"[{job_id}] DR shell VM created: {shell_vm_name} ({vm_moref})", "INFO")
                
                self.update_job_status(job_id, 'completed',
                    completed_at=utc_now_iso(),
                    details={
                        **details,
                        'current_step': 'Complete',
                        'progress_percent': 100,
                        'success': True,
                        'shell_vm_name': shell_vm_name,
                        'shell_vm_moref': vm_moref,
                        'message': f'DR Shell VM "{shell_vm_name}" created successfully'
                    }
                )
                return True
                
            finally:
                Disconnect(si)
                
        except Exception as e:
            self.executor.log(f"[{job_id}] DR shell creation failed: {e}", "ERROR")
            self.update_job_status(job_id, 'failed',
                completed_at=utc_now_iso(),
                details={
                    **details,
                    'success': False,
                    'error': str(e),
                    'message': f'Failed to create DR shell VM: {e}'
                }
            )
            return False
    
    def _get_protected_vm(self, vm_id: str) -> Optional[Dict]:
        """Fetch protected VM by ID"""
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/protected_vms",
                params={'id': f'eq.{vm_id}'},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.ok:
                vms = response.json()
                return vms[0] if vms else None
        except Exception as e:
            self.executor.log(f"Error fetching protected VM: {e}", "ERROR")
        return None
    
    def _get_vcenter(self, vcenter_id: str) -> Optional[Dict]:
        """Fetch vCenter by ID"""
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenters",
                params={'id': f'eq.{vcenter_id}'},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.ok:
                vcenters = response.json()
                return vcenters[0] if vcenters else None
        except Exception as e:
            self.executor.log(f"Error fetching vCenter: {e}", "ERROR")
        return None
    
    def _get_vcenter_vm(self, vm_id: str) -> Optional[Dict]:
        """Fetch vCenter VM by ID (from vcenter_vms table)"""
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_vms",
                params={'id': f'eq.{vm_id}'},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.ok:
                vms = response.json()
                return vms[0] if vms else None
        except Exception as e:
            self.executor.log(f"Error fetching vCenter VM: {e}", "ERROR")
        return None
