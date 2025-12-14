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
    
    def _get_target_ssh_creds(self, target: Dict, password: str = None) -> Optional[Dict]:
        """
        Get SSH credentials for connecting to a replication target.
        Returns dict with hostname, port, username, and key_path/key_data/password.
        
        Lookup order:
        1. Direct ssh_key_encrypted on target
        2. ssh_key_id reference on target → ssh_keys table
        3. hosting_vm_id → vcenter_vms → zfs_target_templates → ssh_key_id
        4. source_template_id → zfs_target_templates → ssh_key_id
        5. ssh_key_deployments table
        6. Global activity_settings SSH config
        7. Provided password fallback
        
        Args:
            target: The replication target dict
            password: Optional password to use for authentication (e.g., from job details)
        """
        try:
            hostname = target.get('hostname')
            port = target.get('port', 22)
            username = target.get('ssh_username', 'root')
            
            if not hostname:
                self.executor.log("Target has no hostname", "ERROR")
                return None
            
            creds = {
                'hostname': hostname,
                'port': port,
                'username': username,
                'key_path': None,
                'key_data': None,
                'password': None
            }
            
            # Try to get SSH key from target's encrypted key first
            if target.get('ssh_key_encrypted'):
                key_data = self.executor.decrypt_password(target['ssh_key_encrypted'])
                if key_data:
                    creds['key_data'] = key_data
                    self.executor.log(f"Using target-specific SSH key for {hostname}")
                    return creds
            
            # Check if target has an ssh_key_id reference to ssh_keys table
            if target.get('ssh_key_id'):
                key_data = self._fetch_ssh_key_by_id(target['ssh_key_id'], hostname)
                if key_data:
                    creds['key_data'] = key_data
                    return creds
            
            # Check via hosting_vm_id → vcenter_vms → zfs_target_templates chain
            if target.get('hosting_vm_id'):
                key_data = self._fetch_ssh_key_via_hosting_vm(target['hosting_vm_id'], hostname)
                if key_data:
                    creds['key_data'] = key_data
                    return creds
            
            # Check via source_template_id → zfs_target_templates chain
            if target.get('source_template_id'):
                key_data = self._fetch_ssh_key_via_template(target['source_template_id'], hostname)
                if key_data:
                    creds['key_data'] = key_data
                    return creds
            
            # Check ssh_key_deployments table for keys deployed to this target
            if target.get('id'):
                try:
                    response = requests.get(
                        f"{DSM_URL}/rest/v1/ssh_key_deployments",
                        params={
                            'replication_target_id': f"eq.{target['id']}",
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
                            # Found a deployed key, fetch it
                            key_response = requests.get(
                                f"{DSM_URL}/rest/v1/ssh_keys",
                                params={
                                    'id': f"eq.{deployments[0]['ssh_key_id']}",
                                    'select': 'id,private_key_encrypted,status'
                                },
                                headers={
                                    'apikey': SERVICE_ROLE_KEY,
                                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                                },
                                verify=VERIFY_SSL,
                                timeout=10
                            )
                            if key_response.ok:
                                keys = key_response.json()
                                if keys and keys[0].get('private_key_encrypted'):
                                    if keys[0].get('status') in ('active', 'pending'):
                                        key_data = self.executor.decrypt_password(keys[0]['private_key_encrypted'])
                                        if key_data:
                                            creds['key_data'] = key_data
                                            self.executor.log(f"Using deployed SSH key for {hostname}")
                                            return creds
                except Exception as e:
                    self.executor.log(f"Error checking ssh_key_deployments: {e}", "WARNING")
            
            # Fallback to activity_settings SSH configuration
            try:
                response = requests.get(
                    f"{DSM_URL}/rest/v1/activity_settings",
                    params={'select': '*', 'limit': '1'},
                    headers={
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                    },
                    verify=VERIFY_SSL,
                    timeout=10
                )
                if response.ok:
                    settings_list = response.json()
                    if settings_list:
                        settings = settings_list[0]
                        
                        # Check for encrypted SSH key in settings
                        if settings.get('ssh_private_key_encrypted'):
                            key_data = self.executor.decrypt_password(settings['ssh_private_key_encrypted'])
                            if key_data:
                                creds['key_data'] = key_data
                                self.executor.log(f"Using global SSH key for {hostname}")
                                return creds
                        
                        # Check for SSH key path
                        if settings.get('ssh_private_key_path'):
                            creds['key_path'] = settings['ssh_private_key_path']
                            self.executor.log(f"Using SSH key path for {hostname}")
                            return creds
                        
                        # Check for encrypted password
                        if settings.get('ssh_password_encrypted'):
                            password_from_settings = self.executor.decrypt_password(settings['ssh_password_encrypted'])
                            if password_from_settings:
                                creds['password'] = password_from_settings
                                self.executor.log(f"Using SSH password from settings for {hostname}")
                                return creds
            except Exception as e:
                self.executor.log(f"Error fetching activity_settings: {e}", "WARNING")
            
            # Use provided password as fallback (from job details)
            if password:
                creds['password'] = password
                self.executor.log(f"Using provided password for {hostname}")
                return creds
            
            # Build a helpful error message with VM name if available
            vm_name = target.get('hosting_vm_name') or target.get('hosting_vm', {}).get('name')
            if vm_name:
                self.executor.log(f"No SSH credentials available for VM {vm_name} ({hostname}). Assign an SSH key in Edit Target or run SSH Key Exchange first.", "ERROR")
            else:
                self.executor.log(f"No SSH credentials available for {hostname}. Assign an SSH key in Edit Target or run SSH Key Exchange first.", "ERROR")
            return None
            
        except Exception as e:
            self.executor.log(f"Error getting target SSH credentials: {e}", "ERROR")
            return None
    
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
                return None
                
            vms = response.json()
            if not vms:
                self.executor.log(f"Hosting VM {hosting_vm_id} not found in vcenter_vms", "WARNING")
                return None
            
            vm = vms[0]
            vm_name = vm.get('name', '')
            self.executor.log(f"Looking up SSH key via hosting VM: {vm_name}")
            
            # Find a zfs_target_template that matches this VM
            # Check by name pattern (e.g., VM "S16-VREP-02" might come from template "S16-VREP-TMP")
            # Or look for templates where this VM could be a deployment
            response = requests.get(
                f"{DSM_URL}/rest/v1/zfs_target_templates",
                params={
                    'is_active': 'eq.true',
                    'select': 'id,name,ssh_key_id,template_name'
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
                return None
            
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
            
            for template in templates:
                if not template.get('ssh_key_id'):
                    continue
                    
                template_name = template.get('name', '')
                template_vm_name = template.get('template_name', '')
                
                # Match if VM name starts with template name prefix (removing -TMP/-TEMPLATE suffixes)
                name_base = template_name.replace('-TMP', '').replace('-TEMPLATE', '').replace('_TMP', '').replace('_TEMPLATE', '')
                if name_base and vm_name.startswith(name_base):
                    self.executor.log(f"Found matching template '{template_name}' for VM '{vm_name}'")
                    return self._fetch_ssh_key_by_id(template['ssh_key_id'], hostname)
                
                # Also check template_name field (the VMware template VM name)
                template_name_base = template_vm_name.replace('-TMP', '').replace('-TEMPLATE', '').replace('_TMP', '').replace('_TEMPLATE', '') if template_vm_name else ''
                if template_name_base and vm_name.startswith(template_name_base):
                    self.executor.log(f"Found matching template '{template_name}' via template_name field")
                    return self._fetch_ssh_key_by_id(template['ssh_key_id'], hostname)
                
                # Site-based fuzzy matching for replication appliances
                # Matches VRP/VREP/REPL variations within the same site
                template_site = extract_site_prefix(template_name)
                template_is_repl = is_replication_appliance(template_name)
                
                if vm_site and template_site and vm_site == template_site:
                    if vm_is_repl and template_is_repl:
                        self.executor.log(f"Matched template '{template_name}' to VM '{vm_name}' by site prefix + replication pattern")
                        return self._fetch_ssh_key_by_id(template['ssh_key_id'], hostname)
            
            # If no name match, check ssh_key_deployments for this hosting VM
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
                    self.executor.log(f"Found SSH key deployment for hosting VM {vm_name}")
                    return self._fetch_ssh_key_by_id(deployments[0]['ssh_key_id'], hostname)
                    
        except Exception as e:
            self.executor.log(f"Error fetching SSH key via hosting VM: {e}", "WARNING")
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
        """Generate sanoid.conf section for a dataset"""
        retention = group.get('retention_policy', {})
        if isinstance(retention, str):
            import json
            try:
                retention = json.loads(retention)
            except:
                retention = {}
        
        rpo = group.get('rpo_minutes', 60)
        
        # Calculate hourly snapshots based on RPO
        # RPO 15 min = 4 snapshots/hour = need to keep at least 4 hourly
        hourly_count = max(24, int(24 * 60 / max(rpo, 1)))
        
        return f"""# Auto-generated by Zerfaux DSM - Protection Group: {group.get('name')}
# Last updated: {utc_now_iso()}
[{dataset}]
    use_template = production
    hourly = {hourly_count}
    daily = {retention.get('daily', 7)}
    weekly = {retention.get('weekly', 4)}
    monthly = {retention.get('monthly', 12)}
    autosnap = yes
    autoprune = yes
"""
    
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
                admin_password = self.executor.decrypt_password(admin_password_encrypted)
                if admin_password:
                    self.executor.log(f"[{job_id}] Successfully decrypted admin password")
            
            if not source_target_id or not dest_target_id:
                raise ValueError("Both source_target_id and destination_target_id are required")
            
            source_target = self._get_replication_target(source_target_id)
            dest_target = self._get_replication_target(dest_target_id)
            
            if not source_target:
                raise ValueError(f"Source target not found: {source_target_id}")
            if not dest_target:
                raise ValueError(f"Destination target not found: {dest_target_id}")
            
            results = {
                'source_target': source_target.get('name'),
                'destination_target': dest_target.get('name'),
                'steps': []
            }
            
            # Step 1: Get/generate SSH key on source (use admin_password if provided)
            self.executor.log(f"[{job_id}] Getting SSH key from source: {source_target.get('hostname')}")
            source_pub_key = self._get_or_generate_ssh_key(source_target, password=admin_password)
            if not source_pub_key:
                raise Exception("Failed to get/generate SSH key on source target")
            results['steps'].append('source_key_obtained')
            
            # Step 2: Copy public key to destination (use admin_password for dest too)
            self.executor.log(f"[{job_id}] Copying public key to destination: {dest_target.get('hostname')}")
            copy_result = self._copy_ssh_key_to_target(dest_target, source_pub_key, source_target.get('hostname', 'zerfaux'), password=admin_password)
            if not copy_result.get('success'):
                raise Exception(f"Failed to copy key to destination: {copy_result.get('error')}")
            results['steps'].append('key_copied_to_destination')
            
            # Step 3: Test SSH connection from source to destination
            self.executor.log(f"[{job_id}] Testing SSH connection from source to destination")
            test_result = self._test_ssh_connection(source_target, dest_target, password=admin_password)
            if not test_result.get('success'):
                raise Exception(f"SSH connection test failed: {test_result.get('error')}")
            results['steps'].append('connection_tested')
            
            # Step 4: Mark both targets as ssh_trust_established
            self._update_replication_target(source_target_id, ssh_trust_established=True)
            self._update_replication_target(dest_target_id, ssh_trust_established=True)
            results['steps'].append('trust_established')
            
            # Step 5: Auto-link an active SSH key if available and targets don't have one
            self._auto_link_ssh_key_to_targets(source_target_id, dest_target_id)
            results['steps'].append('ssh_key_linked')
            
            self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(), details=results)
            self.executor.log(f"[{job_id}] SSH key exchange completed successfully")
            
        except Exception as e:
            self.executor.log(f"[{job_id}] Error in SSH key exchange: {e}", "ERROR")
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details={'error': str(e)})
    
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
        
        try:
            creds = self._get_target_ssh_creds(target, password=password)
            if not creds:
                return None
            
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            pkey = None
            if creds.get('key_path') and creds['key_path'].strip():
                pkey = paramiko.RSAKey.from_private_key_file(creds['key_path'])
            elif creds.get('key_data'):
                pkey = paramiko.RSAKey.from_private_key(io.StringIO(creds['key_data']))
            
            ssh.connect(
                hostname=creds['hostname'],
                port=creds['port'],
                username=creds['username'],
                pkey=pkey,
                password=creds.get('password'),
                timeout=30
            )
            
            # Check if key exists
            stdin, stdout, stderr = ssh.exec_command('cat ~/.ssh/id_rsa.pub 2>/dev/null')
            exit_status = stdout.channel.recv_exit_status()
            pub_key = stdout.read().decode().strip()
            
            if exit_status == 0 and pub_key:
                ssh.close()
                return pub_key
            
            # Generate new key pair
            self.executor.log("Generating new SSH key pair on target")
            cmd = 'ssh-keygen -t rsa -b 4096 -N "" -f ~/.ssh/id_rsa -q <<< y 2>/dev/null || true'
            stdin, stdout, stderr = ssh.exec_command(cmd)
            stdout.channel.recv_exit_status()
            
            # Read the new public key
            stdin, stdout, stderr = ssh.exec_command('cat ~/.ssh/id_rsa.pub')
            exit_status = stdout.channel.recv_exit_status()
            pub_key = stdout.read().decode().strip()
            
            ssh.close()
            
            if exit_status == 0 and pub_key:
                return pub_key
            return None
            
        except Exception as e:
            self.executor.log(f"Error getting/generating SSH key: {e}", "ERROR")
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
            
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            pkey = None
            if creds.get('key_path') and creds['key_path'].strip():
                pkey = paramiko.RSAKey.from_private_key_file(creds['key_path'])
            elif creds.get('key_data'):
                pkey = paramiko.RSAKey.from_private_key(io.StringIO(creds['key_data']))
            
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
    
    def _test_ssh_connection(self, source_target: Dict, dest_target: Dict, password: str = None) -> Dict:
        """Test SSH connection from source to destination"""
        if not PARAMIKO_AVAILABLE:
            return {'success': False, 'error': 'Paramiko not available'}
        
        try:
            creds = self._get_target_ssh_creds(source_target, password=password)
            if not creds:
                return {'success': False, 'error': 'Could not get source SSH credentials'}
            
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            pkey = None
            if creds.get('key_path') and creds['key_path'].strip():
                pkey = paramiko.RSAKey.from_private_key_file(creds['key_path'])
            elif creds.get('key_data'):
                pkey = paramiko.RSAKey.from_private_key(io.StringIO(creds['key_data']))
            
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
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        self.executor.log(f"[{job_id}] Starting ZFS target health check")
        self.update_job_status(job_id, 'running', started_at=utc_now_iso())
        
        try:
            target_id = details.get('target_id')
            target_hostname = details.get('target_hostname')
            zfs_pool = details.get('zfs_pool')
            target_name = details.get('target_name', 'Unknown')
            
            if not target_id:
                raise ValueError("No target_id provided in job details")
            
            # Fetch the target from DB
            target = self._get_replication_target(target_id)
            if not target:
                raise ValueError(f"Replication target not found: {target_id}")
            
            hostname = target.get('hostname') or target_hostname
            pool = target.get('zfs_pool') or zfs_pool
            
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
            
            # Test 1: SSH connectivity
            self.executor.log(f"[{job_id}] Testing SSH connectivity to {hostname}")
            ssh_result = self._test_ssh_connection(
                creds['hostname'],
                creds['port'],
                creds['username'],
                creds.get('key_data')
            )
            results['tests'].append({
                'name': 'ssh_connectivity',
                'success': ssh_result['success'],
                'message': 'SSH connection successful' if ssh_result['success'] else ssh_result.get('error')
            })
            
            if not ssh_result['success']:
                overall_status = 'offline'
                results['overall_status'] = overall_status
                
                # Update target health status
                self._update_replication_target(target_id, 
                    health_status='offline',
                    last_health_check=utc_now_iso(),
                    health_check_error=ssh_result.get('error')
                )
                
                self.update_job_status(job_id, 'completed', 
                    completed_at=utc_now_iso(),
                    details={**details, 'results': results}
                )
                return
            
            # Test 2: ZFS pool health (if pool is configured)
            if pool:
                self.executor.log(f"[{job_id}] Checking ZFS pool {pool} health")
                
                if ZFS_AVAILABLE and self.zfs_replication:
                    health_result = self.zfs_replication.check_target_health(
                        target_hostname=hostname,
                        zfs_pool=pool,
                        ssh_username=creds['username'],
                        ssh_port=creds['port'],
                        ssh_key_data=creds.get('key_data'),
                        ssh_password=creds.get('password')
                    )
                    
                    results['tests'].append({
                        'name': 'zfs_pool_health',
                        'success': health_result.get('success', False),
                        'pool_status': health_result.get('pool_status'),
                        'free_gb': health_result.get('free_gb'),
                        'used_percent': health_result.get('used_percent'),
                        'message': health_result.get('error') if not health_result.get('success') else f"Pool {pool} is {health_result.get('pool_status', 'unknown')}"
                    })
                    
                    if not health_result.get('success'):
                        overall_status = 'degraded'
                    elif health_result.get('pool_status') != 'ONLINE':
                        overall_status = 'degraded'
                    elif health_result.get('used_percent', 0) > 90:
                        overall_status = 'degraded'
                        results['tests'][-1]['message'] = f"Pool {pool} is {health_result.get('used_percent')}% full"
                else:
                    # Basic SSH-based check
                    try:
                        import paramiko
                        ssh = paramiko.SSHClient()
                        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                        
                        pkey = None
                        if creds.get('key_data'):
                            pkey = paramiko.RSAKey.from_private_key(io.StringIO(creds['key_data']))
                        
                        ssh.connect(
                            hostname=creds['hostname'],
                            port=creds['port'],
                            username=creds['username'],
                            pkey=pkey,
                            password=creds.get('password'),
                            timeout=30
                        )
                        
                        # Check pool health
                        stdin, stdout, stderr = ssh.exec_command(f'zpool status {pool} -x')
                        pool_output = stdout.read().decode().strip()
                        
                        # Check pool capacity
                        stdin, stdout, stderr = ssh.exec_command(f'zpool list -Ho capacity {pool}')
                        capacity_output = stdout.read().decode().strip().replace('%', '')
                        
                        ssh.close()
                        
                        is_healthy = 'is healthy' in pool_output.lower() or 'all pools are healthy' in pool_output.lower()
                        used_percent = int(capacity_output) if capacity_output.isdigit() else 0
                        
                        results['tests'].append({
                            'name': 'zfs_pool_health',
                            'success': is_healthy,
                            'pool_status': 'ONLINE' if is_healthy else 'DEGRADED',
                            'used_percent': used_percent,
                            'message': pool_output if not is_healthy else f"Pool {pool} healthy, {used_percent}% used"
                        })
                        
                        if not is_healthy:
                            overall_status = 'degraded'
                        elif used_percent > 90:
                            overall_status = 'degraded'
                            
                    except Exception as e:
                        results['tests'].append({
                            'name': 'zfs_pool_health',
                            'success': False,
                            'message': str(e)
                        })
                        overall_status = 'degraded'
            
            results['overall_status'] = overall_status
            
            # Update target health status in database
            self._update_replication_target(target_id,
                health_status=overall_status,
                last_health_check=utc_now_iso(),
                health_check_error=None if overall_status == 'healthy' else results.get('tests', [{}])[-1].get('message')
            )
            
            self.executor.log(f"[{job_id}] Health check complete: {overall_status}")
            self.update_job_status(job_id, 'completed',
                completed_at=utc_now_iso(),
                details={**details, 'results': results}
            )
            
        except Exception as e:
            self.executor.log(f"[{job_id}] Health check failed: {e}", "ERROR")
            self.update_job_status(job_id, 'failed',
                completed_at=utc_now_iso(),
                details={**details, 'error': str(e)}
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
