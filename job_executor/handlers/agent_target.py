"""
Agent Target Registration Handler

Handles the register_agent_target job type for agent-based onboarding:
1. Verify agent is online via /v1/health
2. Query pool information via /v1/pools
3. Create/update replication_targets record with agent linkage
4. Update zfs_agents.target_id
5. Optionally register vCenter datastore
"""

import time
from typing import Dict, Optional, Any
from datetime import datetime, timezone

import requests

from job_executor.handlers.base import BaseHandler
from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
from job_executor.utils import utc_now_iso


class AgentTargetHandler(BaseHandler):
    """
    Handler for register_agent_target job type.
    
    Registers an existing ZFS agent as a replication target using the
    agent's REST API instead of SSH-based configuration.
    """
    
    # Default agent API settings
    DEFAULT_API_PORT = 8080
    DEFAULT_API_PROTOCOL = 'http'
    HEALTH_CHECK_TIMEOUT = 30
    API_TIMEOUT = 60
    
    def execute_register_agent_target(self, job: Dict):
        """
        Main entry point for agent-based target registration.
        
        Job details should contain:
        - agent_id: UUID of the ZFS agent to register
        - target_name: Name for the replication target
        - datastore_name: Optional vCenter datastore name
        - vcenter_id: Optional vCenter for datastore registration
        - protection_group_id: Optional protection group to assign
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        self.executor.log(f"[{job_id}] Starting agent target registration")
        
        # Initialize result tracking
        results = {
            'phase': 'initializing',
            'agent_id': details.get('agent_id'),
            'target_name': details.get('target_name'),
            'console_log': [],
            'steps_completed': []
        }
        
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details=results)
        
        def add_log(message: str, level: str = 'INFO'):
            """Add log entry to job results"""
            timestamp = datetime.now(timezone.utc).strftime('%H:%M:%S')
            log_entry = f"[{timestamp}] {level}: {message}"
            results['console_log'].append(log_entry)
            self.executor.log(f"[{job_id}] {message}", level)
            # Update job with latest logs
            self.update_job_status(job_id, 'running', details=results)
        
        try:
            # Extract job parameters
            agent_id = details.get('agent_id')
            target_name = details.get('target_name')
            datastore_name = details.get('datastore_name')
            vcenter_id = details.get('vcenter_id')
            protection_group_id = details.get('protection_group_id')
            
            if not agent_id:
                raise ValueError("No agent_id provided")
            if not target_name:
                raise ValueError("No target_name provided")
            
            add_log(f"Registering agent {agent_id} as target '{target_name}'")
            
            # Step 1: Fetch agent from database
            results['phase'] = 'fetching_agent'
            add_log("Fetching agent details from database...")
            
            agent = self._fetch_agent(agent_id)
            if not agent:
                raise ValueError(f"Agent not found: {agent_id}")
            
            agent_hostname = agent.get('hostname')
            add_log(f"Agent found: {agent_hostname} (status: {agent.get('status')})")
            results['steps_completed'].append('fetch_agent')
            
            # Step 2: Verify agent is online via /v1/health
            results['phase'] = 'health_check'
            add_log(f"Checking agent health at {agent_hostname}...")
            
            health = self._call_agent_api(agent, 'GET', '/v1/health', timeout=self.HEALTH_CHECK_TIMEOUT)
            if not health:
                raise ValueError(f"Agent health check failed - no response from {agent_hostname}")
            
            agent_status = health.get('status', 'unknown')
            pool_status = health.get('pool_status', {})
            agent_version = health.get('version', 'unknown')
            
            if agent_status not in ('healthy', 'warning', 'online'):
                raise ValueError(f"Agent not healthy: status={agent_status}")
            
            add_log(f"Agent healthy: version={agent_version}, pool={pool_status.get('health', 'unknown')}")
            results['agent_version'] = agent_version
            results['pool_health'] = pool_status.get('health')
            results['steps_completed'].append('health_check')
            
            # Step 3: Query pool information via /v1/pools
            results['phase'] = 'pool_discovery'
            add_log("Discovering ZFS pools...")
            
            pools_response = self._call_agent_api(agent, 'GET', '/v1/pools')
            if not pools_response:
                # Fallback: use health endpoint pool info
                add_log("Pool endpoint unavailable, using health data", "WARN")
                pools = [{
                    'name': pool_status.get('name', agent.get('pool_name', 'tank')),
                    'size_bytes': pool_status.get('size_bytes', 0),
                    'free_bytes': pool_status.get('free_bytes', 0),
                    'health': pool_status.get('health', 'unknown')
                }]
            else:
                pools = pools_response.get('pools', [])
            
            if not pools:
                raise ValueError("No ZFS pools discovered on agent")
            
            # Use primary pool (first one)
            primary_pool = pools[0]
            pool_name = primary_pool.get('name', 'tank')
            pool_size = primary_pool.get('size_bytes', 0)
            pool_free = primary_pool.get('free_bytes', 0)
            pool_health = primary_pool.get('health', 'unknown')
            
            add_log(f"Primary pool: {pool_name} ({self._format_bytes(pool_size)}, {pool_health})")
            results['pool_name'] = pool_name
            results['pool_size_bytes'] = pool_size
            results['pool_free_bytes'] = pool_free
            results['steps_completed'].append('pool_discovery')
            
            # Step 4: Query capabilities
            results['phase'] = 'capabilities_check'
            add_log("Checking agent capabilities...")
            
            capabilities = self._call_agent_api(agent, 'GET', '/v1/capabilities')
            if capabilities:
                features = capabilities.get('features', [])
                syncoid_available = capabilities.get('syncoid_available', False)
                add_log(f"Capabilities: syncoid={syncoid_available}, features={features}")
                results['capabilities'] = capabilities
            else:
                add_log("Capabilities endpoint not available (older agent version)", "WARN")
            
            results['steps_completed'].append('capabilities_check')
            
            # Step 5: Create/update replication_targets record
            results['phase'] = 'register_target'
            add_log("Creating replication target record...")
            
            # Build NFS export path
            nfs_export_path = f"/{pool_name}"
            
            target_data = {
                'name': target_name,
                'hostname': agent_hostname,
                'zfs_pool': pool_name,
                'zfs_dataset_prefix': pool_name,
                'nfs_export_path': nfs_export_path,
                'agent_id': agent_id,
                'status': 'online',
                'pool_health': pool_health,
                'pool_size_bytes': pool_size,
                'pool_free_bytes': pool_free,
                'last_health_check': utc_now_iso()
            }
            
            # Check if target already exists for this agent
            existing_target = self._get_target_by_agent(agent_id)
            
            if existing_target:
                # Update existing target
                target_id = existing_target['id']
                add_log(f"Updating existing target: {target_id}")
                self._update_replication_target(target_id, **target_data)
            else:
                # Create new target
                target_id = self._create_replication_target(target_data)
                if not target_id:
                    raise ValueError("Failed to create replication target record")
                add_log(f"Created target: {target_id}")
            
            results['target_id'] = target_id
            results['steps_completed'].append('register_target')
            
            # Step 6: Update zfs_agents.target_id to link back
            results['phase'] = 'link_agent'
            add_log("Linking agent to target...")
            
            link_success = self._update_agent_target_link(agent_id, target_id)
            if not link_success:
                add_log("Warning: Failed to link agent to target", "WARN")
            else:
                add_log("Agent linked to target successfully")
            
            results['steps_completed'].append('link_agent')
            
            # Step 7: Optionally register vCenter datastore
            if vcenter_id and datastore_name:
                results['phase'] = 'register_datastore'
                add_log(f"Registering vCenter datastore: {datastore_name}")
                
                try:
                    ds_success = self._register_vcenter_datastore(
                        vcenter_id=vcenter_id,
                        datastore_name=datastore_name,
                        nfs_host=agent_hostname,
                        nfs_path=nfs_export_path,
                        target_id=target_id
                    )
                    if ds_success:
                        add_log(f"Datastore '{datastore_name}' registered successfully")
                        results['datastore_registered'] = True
                    else:
                        add_log(f"Datastore registration returned false", "WARN")
                except Exception as ds_err:
                    add_log(f"Datastore registration failed: {ds_err}", "WARN")
                    results['datastore_error'] = str(ds_err)
                
                results['steps_completed'].append('register_datastore')
            
            # Step 8: Optionally assign to protection group
            if protection_group_id:
                results['phase'] = 'assign_protection_group'
                add_log(f"Assigning to protection group: {protection_group_id}")
                
                try:
                    self._assign_protection_group(protection_group_id, target_id)
                    add_log("Protection group assignment complete")
                    results['protection_group_assigned'] = True
                except Exception as pg_err:
                    add_log(f"Protection group assignment failed: {pg_err}", "WARN")
                
                results['steps_completed'].append('assign_protection_group')
            
            # Complete
            results['phase'] = 'completed'
            add_log("Agent target registration completed successfully")
            
            self.update_job_status(
                job_id,
                'completed',
                completed_at=utc_now_iso(),
                details=results
            )
            
        except Exception as e:
            error_msg = str(e)
            self.executor.log(f"[{job_id}] Agent registration failed: {error_msg}", "ERROR")
            results['phase'] = 'failed'
            results['error'] = error_msg
            self.update_job_status(
                job_id,
                'failed',
                completed_at=utc_now_iso(),
                details=results
            )
    
    # =========================================================================
    # Agent API Helper Methods
    # =========================================================================
    
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
            path: API path (e.g., /v1/health)
            body: Request body for POST/PUT/PATCH
            timeout: Request timeout in seconds
            
        Returns:
            JSON response dict or None on error
        """
        if timeout is None:
            timeout = self.API_TIMEOUT
        
        protocol = agent.get('api_protocol', self.DEFAULT_API_PROTOCOL)
        port = agent.get('api_port', self.DEFAULT_API_PORT)
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
    
    # =========================================================================
    # Database Helper Methods
    # =========================================================================
    
    def _fetch_agent(self, agent_id: str) -> Optional[Dict]:
        """Fetch ZFS agent from database"""
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
            if response.ok:
                agents = response.json()
                return agents[0] if agents else None
        except Exception as e:
            self.executor.log(f"Error fetching agent: {e}", "ERROR")
        return None
    
    def _get_target_by_agent(self, agent_id: str) -> Optional[Dict]:
        """Get replication target linked to an agent"""
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/replication_targets",
                params={'agent_id': f'eq.{agent_id}'},
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
            self.executor.log(f"Error fetching target by agent: {e}", "ERROR")
        return None
    
    def _create_replication_target(self, data: Dict) -> Optional[str]:
        """Create new replication target record"""
        try:
            response = requests.post(
                f"{DSM_URL}/rest/v1/replication_targets",
                json={**data, 'created_at': utc_now_iso(), 'updated_at': utc_now_iso()},
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
            self.executor.log(f"Error creating replication target: {e}", "ERROR")
        return None
    
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
    
    def _update_agent_target_link(self, agent_id: str, target_id: str) -> bool:
        """Update zfs_agents.target_id to link agent to target"""
        try:
            response = requests.patch(
                f"{DSM_URL}/rest/v1/zfs_agents",
                params={'id': f'eq.{agent_id}'},
                json={
                    'target_id': target_id,
                    'updated_at': utc_now_iso()
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
            self.executor.log(f"Error linking agent to target: {e}", "ERROR")
            return False
    
    def _assign_protection_group(self, group_id: str, target_id: str) -> bool:
        """Assign target to protection group"""
        try:
            response = requests.patch(
                f"{DSM_URL}/rest/v1/protection_groups",
                params={'id': f'eq.{group_id}'},
                json={
                    'target_id': target_id,
                    'updated_at': utc_now_iso()
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
            self.executor.log(f"Error assigning protection group: {e}", "ERROR")
            return False
    
    def _register_vcenter_datastore(
        self,
        vcenter_id: str,
        datastore_name: str,
        nfs_host: str,
        nfs_path: str,
        target_id: str
    ) -> bool:
        """
        Register NFS export as vCenter datastore.
        
        This creates a pending job to mount the NFS share in vCenter.
        The actual vCenter operation is handled by the vCenter handlers.
        """
        try:
            # Create a register_datastore job for vCenter handler
            job_data = {
                'job_type': 'register_nfs_datastore',
                'status': 'pending',
                'details': {
                    'vcenter_id': vcenter_id,
                    'datastore_name': datastore_name,
                    'nfs_host': nfs_host,
                    'nfs_path': nfs_path,
                    'target_id': target_id,
                    'triggered_by': 'agent_registration'
                }
            }
            
            response = requests.post(
                f"{DSM_URL}/rest/v1/jobs",
                json=job_data,
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.ok:
                self.executor.log("Created register_nfs_datastore job for vCenter")
                return True
            else:
                self.executor.log(f"Failed to create datastore job: {response.status_code}", "WARN")
                return False
                
        except Exception as e:
            self.executor.log(f"Error creating datastore registration job: {e}", "ERROR")
            return False
    
    # =========================================================================
    # Utility Methods
    # =========================================================================
    
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
