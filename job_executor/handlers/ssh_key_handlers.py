"""SSH Key Management Handlers for Job Executor"""

import paramiko
import io
import time
import requests
from typing import Dict, Optional, List
from datetime import datetime, timezone

from job_executor.handlers.base import BaseHandler
from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL


class SshKeyHandler(BaseHandler):
    """Handler for SSH key deployment, verification, and removal operations"""
    
    def _get_ssh_key_by_id(self, key_id: str) -> Optional[Dict]:
        """Fetch SSH key record from database"""
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
        }
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/ssh_keys",
                params={'id': f'eq.{key_id}', 'select': '*'},
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.status_code == 200:
                data = response.json()
                return data[0] if data else None
            return None
        except Exception as e:
            self.log(f"Error fetching SSH key {key_id}: {e}", "ERROR")
            return None
    
    def _get_replication_target(self, target_id: str) -> Optional[Dict]:
        """Fetch replication target from database"""
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
        }
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/replication_targets",
                params={'id': f'eq.{target_id}', 'select': '*'},
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.status_code == 200:
                data = response.json()
                return data[0] if data else None
            return None
        except Exception as e:
            self.log(f"Error fetching replication target {target_id}: {e}", "ERROR")
            return None
    
    def _update_deployment_status(
        self,
        deployment_id: str,
        status: str,
        error: Optional[str] = None,
        **kwargs
    ) -> bool:
        """Update SSH key deployment status"""
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
        }
        
        update_data = {
            'status': status,
            'updated_at': datetime.now(timezone.utc).isoformat(),
            **kwargs
        }
        
        if error:
            update_data['last_error'] = error
        
        if status == 'deployed':
            update_data['deployed_at'] = datetime.now(timezone.utc).isoformat()
        elif status == 'verified':
            update_data['verified_at'] = datetime.now(timezone.utc).isoformat()
        elif status == 'removed':
            update_data['removed_at'] = datetime.now(timezone.utc).isoformat()
        elif status == 'failed':
            # Increment retry count on failure
            update_data['retry_count'] = self._get_deployment_retry_count(deployment_id) + 1
        
        try:
            response = requests.patch(
                f"{DSM_URL}/rest/v1/ssh_key_deployments",
                params={'id': f'eq.{deployment_id}'},
                json=update_data,
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            return response.status_code in (200, 204)
        except Exception as e:
            self.log(f"Error updating deployment {deployment_id}: {e}", "ERROR")
            return False
    
    def _get_deployment_retry_count(self, deployment_id: str) -> int:
        """Get current retry count for a deployment"""
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
        }
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/ssh_key_deployments",
                params={'id': f'eq.{deployment_id}', 'select': 'retry_count'},
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.status_code == 200:
                data = response.json()
                return data[0].get('retry_count', 0) if data else 0
            return 0
        except:
            return 0
    
    def _create_or_get_deployment(
        self,
        ssh_key_id: str,
        replication_target_id: Optional[str] = None,
        zfs_template_id: Optional[str] = None
    ) -> Optional[str]:
        """Create or get existing deployment record"""
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
        }
        
        # Check if deployment exists
        query_params = {
            'ssh_key_id': f'eq.{ssh_key_id}',
            'select': 'id'
        }
        if replication_target_id:
            query_params['replication_target_id'] = f'eq.{replication_target_id}'
        if zfs_template_id:
            query_params['zfs_template_id'] = f'eq.{zfs_template_id}'
        
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/ssh_key_deployments",
                params=query_params,
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.status_code == 200:
                data = response.json()
                if data:
                    return data[0]['id']
            
            # Create new deployment
            create_data = {
                'ssh_key_id': ssh_key_id,
                'status': 'pending',
            }
            if replication_target_id:
                create_data['replication_target_id'] = replication_target_id
            if zfs_template_id:
                create_data['zfs_template_id'] = zfs_template_id
            
            response = requests.post(
                f"{DSM_URL}/rest/v1/ssh_key_deployments",
                json=create_data,
                headers={**headers, 'Prefer': 'return=representation'},
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.status_code in (200, 201):
                data = response.json()
                return data[0]['id'] if data else None
            return None
        except Exception as e:
            self.log(f"Error creating deployment: {e}", "ERROR")
            return None
    
    def _update_key_usage(self, ssh_key_id: str) -> bool:
        """Update SSH key last_used_at and increment use_count"""
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
        }
        
        # First get current use_count
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/ssh_keys",
                params={'id': f'eq.{ssh_key_id}', 'select': 'use_count'},
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            current_count = 0
            if response.status_code == 200:
                data = response.json()
                current_count = data[0].get('use_count', 0) if data else 0
            
            # Update with incremented count
            response = requests.patch(
                f"{DSM_URL}/rest/v1/ssh_keys",
                params={'id': f'eq.{ssh_key_id}'},
                json={
                    'last_used_at': datetime.now(timezone.utc).isoformat(),
                    'use_count': current_count + 1
                },
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            return response.status_code in (200, 204)
        except Exception as e:
            self.log(f"Error updating key usage: {e}", "ERROR")
            return False
    
    def _log_audit_event(
        self,
        action: str,
        details: Dict,
        user_id: Optional[str] = None
    ) -> bool:
        """Log SSH key operation to audit_logs"""
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
        }
        
        try:
            response = requests.post(
                f"{DSM_URL}/rest/v1/audit_logs",
                json={
                    'action': action,
                    'details': details,
                    'user_id': user_id,
                    'auth_source': 'job_executor',
                },
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            return response.status_code in (200, 201)
        except Exception as e:
            self.log(f"Error logging audit event: {e}", "WARN")
            return False
    
    def _connect_ssh_with_key(
        self,
        hostname: str,
        port: int,
        username: str,
        private_key_pem: str,
        timeout: int = 30
    ) -> Optional[paramiko.SSHClient]:
        """Connect to target using SSH private key"""
        try:
            # Parse private key from PEM string
            key_file = io.StringIO(private_key_pem)
            
            # Try different key types
            pkey = None
            for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                try:
                    key_file.seek(0)
                    pkey = key_class.from_private_key(key_file)
                    break
                except:
                    continue
            
            if not pkey:
                self.log("Failed to parse private key", "ERROR")
                return None
            
            # Connect
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(
                hostname=hostname,
                port=port,
                username=username,
                pkey=pkey,
                timeout=timeout,
                allow_agent=False,
                look_for_keys=False
            )
            return client
        except Exception as e:
            self.log(f"SSH connection failed: {e}", "ERROR")
            return None
    
    def _deploy_key_to_target(
        self,
        target: Dict,
        public_key: str,
        admin_password: Optional[str] = None
    ) -> Dict:
        """
        Deploy public key to target's authorized_keys
        
        Args:
            target: Replication target dict with hostname, port, ssh_username
            public_key: Public key to deploy
            admin_password: Optional password for initial connection
            
        Returns:
            Dict with success status and details
        """
        hostname = target['hostname']
        port = target.get('port', 22)
        username = target.get('ssh_username', 'root')
        
        self.log(f"Deploying SSH key to {hostname}:{port} as {username}")
        
        try:
            # Try password auth first if password provided
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            if admin_password:
                client.connect(
                    hostname=hostname,
                    port=port,
                    username=username,
                    password=admin_password,
                    timeout=30,
                    allow_agent=False,
                    look_for_keys=False
                )
            else:
                # Try existing key from target if encrypted
                existing_key = target.get('ssh_key_encrypted')
                if existing_key:
                    decrypted = self.executor.decrypt_password(existing_key)
                    if decrypted:
                        key_file = io.StringIO(decrypted)
                        for key_class in [paramiko.Ed25519Key, paramiko.RSAKey]:
                            try:
                                key_file.seek(0)
                                pkey = key_class.from_private_key(key_file)
                                client.connect(
                                    hostname=hostname,
                                    port=port,
                                    username=username,
                                    pkey=pkey,
                                    timeout=30
                                )
                                break
                            except:
                                continue
                else:
                    return {'success': False, 'error': 'No credentials available for initial connection'}
            
            # Check if authorized_keys exists, create .ssh dir if needed
            stdin, stdout, stderr = client.exec_command('mkdir -p ~/.ssh && chmod 700 ~/.ssh')
            stdout.channel.recv_exit_status()
            
            # Read current authorized_keys
            stdin, stdout, stderr = client.exec_command('cat ~/.ssh/authorized_keys 2>/dev/null || echo ""')
            current_keys = stdout.read().decode('utf-8')
            
            # Check if key already exists
            key_content = public_key.strip()
            if key_content in current_keys:
                self.log(f"Key already deployed to {hostname}")
                client.close()
                return {'success': True, 'message': 'Key already deployed', 'already_deployed': True}
            
            # Append new key
            stdin, stdout, stderr = client.exec_command(
                f'echo "{key_content}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
            )
            exit_code = stdout.channel.recv_exit_status()
            
            client.close()
            
            if exit_code == 0:
                self.log(f"Successfully deployed key to {hostname}")
                return {'success': True, 'message': 'Key deployed successfully'}
            else:
                error = stderr.read().decode('utf-8')
                return {'success': False, 'error': f'Failed to write authorized_keys: {error}'}
                
        except Exception as e:
            self.log(f"Key deployment failed: {e}", "ERROR")
            return {'success': False, 'error': str(e)}
    
    def _verify_key_on_target(
        self,
        target: Dict,
        private_key_pem: str
    ) -> Dict:
        """
        Verify SSH key works on target
        
        Args:
            target: Replication target dict
            private_key_pem: Decrypted private key PEM
            
        Returns:
            Dict with success status
        """
        hostname = target['hostname']
        port = target.get('port', 22)
        username = target.get('ssh_username', 'root')
        
        self.log(f"Verifying SSH key on {hostname}:{port}")
        
        try:
            client = self._connect_ssh_with_key(hostname, port, username, private_key_pem)
            if not client:
                return {'success': False, 'error': 'Failed to connect with key'}
            
            # Execute simple command to verify
            stdin, stdout, stderr = client.exec_command('echo "SSH key verification successful"')
            exit_code = stdout.channel.recv_exit_status()
            output = stdout.read().decode('utf-8')
            
            client.close()
            
            if exit_code == 0 and 'successful' in output:
                self.log(f"Key verified on {hostname}")
                return {'success': True, 'message': 'Key verified successfully'}
            else:
                return {'success': False, 'error': 'Verification command failed'}
                
        except Exception as e:
            self.log(f"Key verification failed: {e}", "ERROR")
            return {'success': False, 'error': str(e)}
    
    def _remove_key_from_target(
        self,
        target: Dict,
        public_key: str,
        private_key_pem: Optional[str] = None,
        admin_password: Optional[str] = None
    ) -> Dict:
        """
        Remove public key from target's authorized_keys
        
        Args:
            target: Replication target dict
            public_key: Public key to remove
            private_key_pem: Private key for authentication (if available)
            admin_password: Admin password as fallback
            
        Returns:
            Dict with success status
        """
        hostname = target['hostname']
        port = target.get('port', 22)
        username = target.get('ssh_username', 'root')
        
        self.log(f"Removing SSH key from {hostname}:{port}")
        
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            # Try key auth first
            connected = False
            if private_key_pem:
                try:
                    key_file = io.StringIO(private_key_pem)
                    for key_class in [paramiko.Ed25519Key, paramiko.RSAKey]:
                        try:
                            key_file.seek(0)
                            pkey = key_class.from_private_key(key_file)
                            client.connect(
                                hostname=hostname,
                                port=port,
                                username=username,
                                pkey=pkey,
                                timeout=30
                            )
                            connected = True
                            break
                        except:
                            continue
                except:
                    pass
            
            # Fall back to password
            if not connected and admin_password:
                client.connect(
                    hostname=hostname,
                    port=port,
                    username=username,
                    password=admin_password,
                    timeout=30
                )
                connected = True
            
            if not connected:
                return {'success': False, 'error': 'No valid credentials for removal'}
            
            # Get key fingerprint or unique part for removal
            key_parts = public_key.strip().split()
            if len(key_parts) >= 2:
                # Use the key data part for matching
                key_data = key_parts[1][:50]  # First 50 chars of key data
            else:
                key_data = public_key.strip()[:50]
            
            # Remove matching line from authorized_keys
            cmd = f'grep -v "{key_data}" ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp 2>/dev/null; ' \
                  f'mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys 2>/dev/null || true'
            
            stdin, stdout, stderr = client.exec_command(cmd)
            exit_code = stdout.channel.recv_exit_status()
            
            client.close()
            
            self.log(f"Removed key from {hostname}")
            return {'success': True, 'message': 'Key removed successfully'}
            
        except Exception as e:
            self.log(f"Key removal failed: {e}", "ERROR")
            return {'success': False, 'error': str(e)}
    
    # ========================================================================
    # Job Handlers
    # ========================================================================
    
    def execute_ssh_key_deploy(self, job: Dict):
        """
        Deploy SSH key to specified targets
        
        Job details:
            - ssh_key_id: UUID of the SSH key to deploy
            - target_ids: List of replication_target UUIDs
            - admin_password: Optional password for initial connection
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        ssh_key_id = details.get('ssh_key_id')
        target_ids = details.get('target_ids', [])
        admin_password = details.get('admin_password')
        
        if not ssh_key_id:
            self.mark_job_failed(job, "ssh_key_id is required")
            return
        
        if not target_ids:
            self.mark_job_failed(job, "target_ids list is required")
            return
        
        self.log(f"Starting SSH key deployment for key {ssh_key_id} to {len(target_ids)} targets")
        self.mark_job_running(job)
        
        # Fetch the SSH key
        ssh_key = self._get_ssh_key_by_id(ssh_key_id)
        if not ssh_key:
            self.mark_job_failed(job, f"SSH key {ssh_key_id} not found")
            return
        
        if ssh_key['status'] not in ('active', 'pending'):
            self.mark_job_failed(job, f"SSH key is {ssh_key['status']}, cannot deploy")
            return
        
        public_key = ssh_key['public_key']
        results = []
        success_count = 0
        
        for target_id in target_ids:
            if self.check_cancelled(job_id):
                self.log("Job cancelled, stopping deployment")
                break
            
            target = self._get_replication_target(target_id)
            if not target:
                results.append({
                    'target_id': target_id,
                    'success': False,
                    'error': 'Target not found'
                })
                continue
            
            # Create/get deployment record
            deployment_id = self._create_or_get_deployment(ssh_key_id, replication_target_id=target_id)
            
            # Deploy the key
            result = self._deploy_key_to_target(target, public_key, admin_password)
            
            if result['success']:
                success_count += 1
                if deployment_id:
                    self._update_deployment_status(deployment_id, 'deployed')
            else:
                if deployment_id:
                    self._update_deployment_status(deployment_id, 'failed', error=result.get('error'))
            
            results.append({
                'target_id': target_id,
                'hostname': target['hostname'],
                **result
            })
        
        # Log audit event
        self._log_audit_event('ssh_key_deployed', {
            'ssh_key_id': ssh_key_id,
            'ssh_key_name': ssh_key['name'],
            'targets': len(target_ids),
            'successful': success_count,
            'failed': len(target_ids) - success_count
        }, job.get('created_by'))
        
        # Update key usage
        if success_count > 0:
            self._update_key_usage(ssh_key_id)
        
        # Complete job
        if success_count == len(target_ids):
            self.mark_job_completed(job, {
                'message': f'Key deployed to all {success_count} targets',
                'results': results
            })
        elif success_count > 0:
            self.update_job_status(job_id, 'completed', details={
                'message': f'Key deployed to {success_count}/{len(target_ids)} targets',
                'results': results,
                'partial_failure': True
            })
        else:
            self.mark_job_failed(job, f'Failed to deploy key to any targets', details={'results': results})
    
    def execute_ssh_key_verify(self, job: Dict):
        """
        Verify SSH key works on specified targets
        
        Job details:
            - ssh_key_id: UUID of the SSH key to verify
            - target_ids: List of replication_target UUIDs
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        ssh_key_id = details.get('ssh_key_id')
        target_ids = details.get('target_ids', [])
        
        if not ssh_key_id or not target_ids:
            self.mark_job_failed(job, "ssh_key_id and target_ids are required")
            return
        
        self.log(f"Starting SSH key verification for key {ssh_key_id} on {len(target_ids)} targets")
        self.mark_job_running(job)
        
        # Fetch the SSH key
        ssh_key = self._get_ssh_key_by_id(ssh_key_id)
        if not ssh_key:
            self.mark_job_failed(job, f"SSH key {ssh_key_id} not found")
            return
        
        # Decrypt private key
        private_key_encrypted = ssh_key.get('private_key_encrypted')
        if not private_key_encrypted:
            self.mark_job_failed(job, "No private key found for SSH key")
            return
        
        private_key_pem = self.executor.decrypt_password(private_key_encrypted)
        if not private_key_pem:
            self.mark_job_failed(job, "Failed to decrypt private key")
            return
        
        results = []
        success_count = 0
        
        for target_id in target_ids:
            if self.check_cancelled(job_id):
                break
            
            target = self._get_replication_target(target_id)
            if not target:
                results.append({
                    'target_id': target_id,
                    'success': False,
                    'error': 'Target not found'
                })
                continue
            
            result = self._verify_key_on_target(target, private_key_pem)
            
            # Update deployment status
            deployment_id = self._create_or_get_deployment(ssh_key_id, replication_target_id=target_id)
            if deployment_id:
                if result['success']:
                    self._update_deployment_status(deployment_id, 'verified')
                    success_count += 1
                else:
                    self._update_deployment_status(deployment_id, 'failed', error=result.get('error'))
            
            results.append({
                'target_id': target_id,
                'hostname': target['hostname'],
                **result
            })
        
        # Log audit
        self._log_audit_event('ssh_key_verified', {
            'ssh_key_id': ssh_key_id,
            'ssh_key_name': ssh_key['name'],
            'verified': success_count,
            'failed': len(target_ids) - success_count
        }, job.get('created_by'))
        
        # Update usage
        if success_count > 0:
            self._update_key_usage(ssh_key_id)
        
        if success_count == len(target_ids):
            self.mark_job_completed(job, {
                'message': f'Key verified on all {success_count} targets',
                'results': results
            })
        else:
            self.mark_job_failed(job, f'Verification failed on {len(target_ids) - success_count} targets', 
                               details={'results': results})
    
    def execute_ssh_key_remove(self, job: Dict):
        """
        Remove SSH key from specified targets
        
        Job details:
            - ssh_key_id: UUID of the SSH key to remove
            - target_ids: List of replication_target UUIDs (optional, defaults to all deployments)
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        ssh_key_id = details.get('ssh_key_id')
        target_ids = details.get('target_ids')
        admin_password = details.get('admin_password')
        
        if not ssh_key_id:
            self.mark_job_failed(job, "ssh_key_id is required")
            return
        
        self.log(f"Starting SSH key removal for key {ssh_key_id}")
        self.mark_job_running(job)
        
        # Fetch the SSH key
        ssh_key = self._get_ssh_key_by_id(ssh_key_id)
        if not ssh_key:
            self.mark_job_failed(job, f"SSH key {ssh_key_id} not found")
            return
        
        public_key = ssh_key['public_key']
        
        # Decrypt private key if available
        private_key_pem = None
        private_key_encrypted = ssh_key.get('private_key_encrypted')
        if private_key_encrypted:
            private_key_pem = self.executor.decrypt_password(private_key_encrypted)
        
        # Get target IDs from deployments if not specified
        if not target_ids:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            }
            response = requests.get(
                f"{DSM_URL}/rest/v1/ssh_key_deployments",
                params={
                    'ssh_key_id': f'eq.{ssh_key_id}',
                    'status': 'in.(deployed,verified)',
                    'select': 'replication_target_id'
                },
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.status_code == 200:
                deployments = response.json()
                target_ids = [d['replication_target_id'] for d in deployments if d.get('replication_target_id')]
        
        if not target_ids:
            self.mark_job_completed(job, {'message': 'No deployed targets to remove key from'})
            return
        
        results = []
        success_count = 0
        
        for target_id in target_ids:
            if self.check_cancelled(job_id):
                break
            
            target = self._get_replication_target(target_id)
            if not target:
                results.append({
                    'target_id': target_id,
                    'success': False,
                    'error': 'Target not found'
                })
                continue
            
            result = self._remove_key_from_target(target, public_key, private_key_pem, admin_password)
            
            # Update deployment status
            deployment_id = self._create_or_get_deployment(ssh_key_id, replication_target_id=target_id)
            if deployment_id:
                if result['success']:
                    self._update_deployment_status(deployment_id, 'removed')
                    success_count += 1
                else:
                    self._update_deployment_status(deployment_id, 'failed', error=result.get('error'))
            
            results.append({
                'target_id': target_id,
                'hostname': target['hostname'],
                **result
            })
        
        # Log audit
        self._log_audit_event('ssh_key_removed', {
            'ssh_key_id': ssh_key_id,
            'ssh_key_name': ssh_key['name'],
            'removed': success_count,
            'failed': len(target_ids) - success_count
        }, job.get('created_by'))
        
        if success_count == len(target_ids):
            self.mark_job_completed(job, {
                'message': f'Key removed from all {success_count} targets',
                'results': results
            })
        else:
            self.update_job_status(job_id, 'completed', details={
                'message': f'Key removed from {success_count}/{len(target_ids)} targets',
                'results': results,
                'partial_failure': True
            })
    
    def execute_ssh_key_health_check(self, job: Dict):
        """
        Check health of all SSH key deployments
        
        Job details:
            - ssh_key_id: Optional - check specific key, or all if not specified
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        ssh_key_id = details.get('ssh_key_id')
        
        self.log(f"Starting SSH key health check" + (f" for key {ssh_key_id}" if ssh_key_id else " for all keys"))
        self.mark_job_running(job)
        
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
        }
        
        # Get deployments to check
        query_params = {
            'status': 'in.(deployed,verified)',
            'select': '*,ssh_keys(id,name,public_key,private_key_encrypted,status)'
        }
        if ssh_key_id:
            query_params['ssh_key_id'] = f'eq.{ssh_key_id}'
        
        response = requests.get(
            f"{DSM_URL}/rest/v1/ssh_key_deployments",
            params=query_params,
            headers=headers,
            verify=VERIFY_SSL,
            timeout=10
        )
        
        if response.status_code != 200:
            self.mark_job_failed(job, "Failed to fetch deployments")
            return
        
        deployments = response.json()
        results = []
        healthy = 0
        unhealthy = 0
        
        for deployment in deployments:
            if self.check_cancelled(job_id):
                break
            
            ssh_key = deployment.get('ssh_keys')
            if not ssh_key or ssh_key['status'] == 'revoked':
                continue
            
            target_id = deployment.get('replication_target_id')
            if not target_id:
                continue
            
            target = self._get_replication_target(target_id)
            if not target:
                continue
            
            # Decrypt private key
            private_key_pem = self.executor.decrypt_password(ssh_key.get('private_key_encrypted', ''))
            if not private_key_pem:
                results.append({
                    'deployment_id': deployment['id'],
                    'target': target['hostname'],
                    'healthy': False,
                    'error': 'Cannot decrypt private key'
                })
                unhealthy += 1
                continue
            
            # Verify connection
            result = self._verify_key_on_target(target, private_key_pem)
            
            if result['success']:
                healthy += 1
                self._update_deployment_status(deployment['id'], 'verified')
            else:
                unhealthy += 1
                self._update_deployment_status(deployment['id'], 'failed', error=result.get('error'))
            
            results.append({
                'deployment_id': deployment['id'],
                'target': target['hostname'],
                'key_name': ssh_key['name'],
                'healthy': result['success'],
                'error': result.get('error')
            })
        
        self.mark_job_completed(job, {
            'message': f'Health check complete: {healthy} healthy, {unhealthy} unhealthy',
            'healthy': healthy,
            'unhealthy': unhealthy,
            'results': results
        })
