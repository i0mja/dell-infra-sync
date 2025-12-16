"""
Centralized SSH Credential Management for Job Executor

This module provides a unified interface for SSH credential lookup, connection
testing, and key management across all handlers (failover, replication, templates).

Usage:
    from job_executor.ssh_utils import SSHCredentialManager
    
    ssh_manager = SSHCredentialManager(executor)
    creds = ssh_manager.get_credentials(target)
    result = ssh_manager.test_connection(hostname, creds)
"""

import io
import re
import socket
from typing import Dict, Optional, List

import requests

from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL

try:
    import paramiko
    PARAMIKO_AVAILABLE = True
except ImportError:
    PARAMIKO_AVAILABLE = False
    paramiko = None


class SSHCredentialManager:
    """
    Centralized SSH credential management for all handlers.
    
    Provides comprehensive SSH credential lookup with multiple fallback paths,
    connection testing, and private key loading for all key types (Ed25519, RSA, ECDSA).
    """
    
    def __init__(self, executor):
        """
        Initialize SSH credential manager.
        
        Args:
            executor: Job executor instance (for logging and decrypt_password)
        """
        self.executor = executor
    
    def log(self, message: str, level: str = "INFO"):
        """Log a message via the executor."""
        self.executor.log(message, level)
    
    def decrypt_password(self, encrypted: str) -> Optional[str]:
        """Decrypt an encrypted password/key via the executor."""
        return self.executor.decrypt_password(encrypted)
    
    # =========================================================================
    # Public API
    # =========================================================================
    
    def get_credentials(self, target: Dict, password: str = None) -> Optional[Dict]:
        """
        Get SSH credentials for connecting to a replication target.
        
        Returns dict with hostname, port, username, and key_path/key_data/password.
        
        Lookup order:
        1. Direct ssh_key_encrypted on target
        2. ssh_key_id reference on target → ssh_keys table
        3. hosting_vm_id → vcenter_vms → zfs_target_templates → ssh_key_id
        4. source_template_id → zfs_target_templates → ssh_key_id
        5. ssh_key_deployments table (any status - active/deployed/pending)
        6. Global activity_settings SSH config
        7. Provided password fallback
        
        Args:
            target: The replication target dict
            password: Optional password to use for authentication (e.g., from job details)
            
        Returns:
            Dict with hostname, port, username, key_path/key_data/password, or None
        """
        try:
            # Default to target hostname (NFS/ZFS share IP)
            nfs_hostname = target.get('hostname')
            port = target.get('port', 22)
            username = target.get('ssh_username', 'root')
            
            # Determine SSH hostname - prefer vCenter VM IP when hosting_vm_id is present
            ssh_hostname = nfs_hostname
            if target.get('hosting_vm_id'):
                vm_hostname = self._get_hosting_vm_hostname(target['hosting_vm_id'])
                if vm_hostname:
                    self.log(f"[SSH] Using hosting VM '{vm_hostname}' instead of NFS IP '{nfs_hostname}'")
                    ssh_hostname = vm_hostname
            
            if not ssh_hostname:
                self.log("Target has no hostname or hosting VM", "ERROR")
                return None
            
            creds = {
                'hostname': ssh_hostname,
                'nfs_hostname': nfs_hostname,
                'port': port,
                'username': username,
                'key_path': None,
                'key_data': None,
                'password': None,
                'key_source': None  # Track where we got the key from
            }
            
            # Try to get SSH key from target's encrypted key first
            if target.get('ssh_key_encrypted'):
                key_data = self.decrypt_password(target['ssh_key_encrypted'])
                if key_data:
                    creds['key_data'] = key_data
                    creds['key_source'] = 'target_ssh_key_encrypted'
                    self.log(f"[SSH] Using target-specific SSH key for {ssh_hostname}")
                    return creds
            
            # Check if target has an ssh_key_id reference to ssh_keys table
            if target.get('ssh_key_id'):
                key_data = self._fetch_ssh_key_by_id(target['ssh_key_id'], ssh_hostname)
                if key_data:
                    creds['key_data'] = key_data
                    creds['key_source'] = f"ssh_key_id:{target['ssh_key_id']}"
                    return creds
            
            # Check via hosting_vm_id → vcenter_vms → zfs_target_templates chain
            if target.get('hosting_vm_id'):
                key_data = self._fetch_ssh_key_via_hosting_vm(target['hosting_vm_id'], ssh_hostname)
                if key_data:
                    creds['key_data'] = key_data
                    creds['key_source'] = f"hosting_vm:{target['hosting_vm_id']}"
                    return creds
            
            # Check via source_template_id → zfs_target_templates chain
            if target.get('source_template_id'):
                key_data = self._fetch_ssh_key_via_template(target['source_template_id'], ssh_hostname)
                if key_data:
                    creds['key_data'] = key_data
                    creds['key_source'] = f"source_template:{target['source_template_id']}"
                    return creds
            
            # Check ssh_key_deployments table for keys deployed to this target
            # Note: We don't require 'deployed' status - any key that was deployed is worth trying
            if target.get('id'):
                key_data = self._fetch_ssh_key_via_deployment(target['id'], ssh_hostname)
                if key_data:
                    creds['key_data'] = key_data
                    creds['key_source'] = f"deployment:target:{target['id']}"
                    return creds
            
            # Fallback to activity_settings SSH configuration
            key_data, key_path, password_from_settings = self._fetch_ssh_key_from_settings()
            if key_data:
                creds['key_data'] = key_data
                creds['key_source'] = 'activity_settings:key_data'
                self.log(f"[SSH] Using global SSH key for {ssh_hostname}")
                return creds
            if key_path:
                creds['key_path'] = key_path
                creds['key_source'] = 'activity_settings:key_path'
                self.log(f"[SSH] Using SSH key path for {ssh_hostname}")
                return creds
            if password_from_settings:
                creds['password'] = password_from_settings
                creds['key_source'] = 'activity_settings:password'
                self.log(f"[SSH] Using SSH password from settings for {ssh_hostname}")
                return creds
            
            # Use provided password as fallback (from job details)
            if password:
                creds['password'] = password
                creds['key_source'] = 'provided_password'
                self.log(f"[SSH] Using provided password for {ssh_hostname}")
                return creds
            
            # No credentials found - build helpful error message
            vm_name = target.get('hosting_vm_name') or target.get('hosting_vm', {}).get('name')
            if vm_name:
                self.log(f"[SSH] No credentials available for VM {vm_name} ({ssh_hostname}). Assign an SSH key or run SSH Key Exchange.", "ERROR")
            else:
                self.log(f"[SSH] No credentials available for {ssh_hostname}. Assign an SSH key or run SSH Key Exchange.", "ERROR")
            return None
            
        except Exception as e:
            self.log(f"[SSH] Error getting target credentials: {e}", "ERROR")
            return None
    
    def test_connection(self, creds: Dict, timeout: int = 15) -> Dict:
        """
        Test SSH connection using the provided credentials.
        
        Args:
            creds: Credentials dict from get_credentials()
            timeout: Connection timeout in seconds
            
        Returns:
            Dict with 'success' bool and optional 'error' message
        """
        if not PARAMIKO_AVAILABLE:
            return {'success': False, 'error': 'paramiko not installed'}
        
        hostname = creds.get('hostname')
        port = creds.get('port', 22)
        username = creds.get('username', 'root')
        
        if not hostname:
            return {'success': False, 'error': 'No hostname in credentials'}
        
        self.log(f"[SSH] Testing connection to {username}@{hostname}:{port}")
        
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            # Load private key if available
            pkey = None
            if creds.get('key_data'):
                pkey = self.load_private_key(key_data=creds['key_data'])
                if not pkey:
                    return {'success': False, 'error': 'Failed to load SSH private key'}
            elif creds.get('key_path'):
                pkey = self.load_private_key(key_path=creds['key_path'])
                if not pkey:
                    return {'success': False, 'error': f"Failed to load SSH key from {creds['key_path']}"}
            
            # Connect with key or password
            if pkey:
                client.connect(
                    hostname=hostname,
                    port=port,
                    username=username,
                    pkey=pkey,
                    timeout=timeout,
                    banner_timeout=timeout,
                    auth_timeout=timeout
                )
            elif creds.get('password'):
                client.connect(
                    hostname=hostname,
                    port=port,
                    username=username,
                    password=creds['password'],
                    timeout=timeout,
                    banner_timeout=timeout,
                    auth_timeout=timeout
                )
            else:
                return {'success': False, 'error': 'No SSH key or password available'}
            
            # Test with a simple command
            stdin, stdout, stderr = client.exec_command('echo ok', timeout=10)
            result = stdout.read().decode().strip()
            client.close()
            
            if result == 'ok':
                self.log(f"[SSH] Connection to {hostname} successful")
                return {'success': True}
            else:
                return {'success': False, 'error': 'SSH test command did not return expected output'}
                
        except paramiko.AuthenticationException as e:
            return {'success': False, 'error': f'Authentication failed: {e}'}
        except paramiko.SSHException as e:
            return {'success': False, 'error': f'SSH error: {e}'}
        except socket.timeout:
            return {'success': False, 'error': f'Connection timed out after {timeout}s'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def load_private_key(self, key_path: str = None, key_data: str = None):
        """
        Load SSH private key, trying Ed25519, RSA, and ECDSA formats.
        
        Args:
            key_path: Path to private key file
            key_data: Private key data as string
            
        Returns:
            paramiko key object or None
        """
        if not PARAMIKO_AVAILABLE:
            self.log("[SSH] paramiko not available", "ERROR")
            return None
            
        if not key_path and not key_data:
            self.log("[SSH] load_private_key: No key_path or key_data provided", "DEBUG")
            return None
        
        self.log(f"[SSH] load_private_key: key_path={bool(key_path)}, key_data_len={len(key_data) if key_data else 0}", "DEBUG")
        
        # Try Ed25519 first (most common modern key type), then RSA, ECDSA
        key_classes = [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]
        
        for key_class in key_classes:
            try:
                if key_path and key_path.strip():
                    pkey = key_class.from_private_key_file(key_path)
                    self.log(f"[SSH] Loaded key as {key_class.__name__} from file")
                    return pkey
                elif key_data:
                    key_file = io.StringIO(key_data)
                    pkey = key_class.from_private_key(key_file)
                    self.log(f"[SSH] Loaded key as {key_class.__name__} from data")
                    return pkey
            except Exception as e:
                self.log(f"[SSH] {key_class.__name__} parse failed: {type(e).__name__}", "DEBUG")
                continue
        
        self.log("[SSH] Failed to load key as any known type (Ed25519, RSA, ECDSA)", "WARNING")
        return None
    
    # =========================================================================
    # Private Helper Methods
    # =========================================================================
    
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
                        self.log(f"[SSH] Resolved hosting VM '{vm_name}' to IP: {vm_ip}")
                        return vm_ip
                    if vm_name:
                        self.log(f"[SSH] Using VM name (no IP available): {vm_name}")
                        return vm_name
            return None
        except Exception as e:
            self.log(f"[SSH] Error fetching hosting VM {hosting_vm_id}: {e}", "WARNING")
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
                    # Accept active, pending, or deployed keys
                    if key.get('status') in ('active', 'pending', 'deployed'):
                        key_data = self.decrypt_password(key['private_key_encrypted'])
                        if key_data:
                            self.log(f"[SSH] Using SSH key '{key.get('name', ssh_key_id)}' for {hostname}")
                            return key_data
                    else:
                        self.log(f"[SSH] Key {ssh_key_id} has status '{key.get('status')}' - skipping", "DEBUG")
        except Exception as e:
            self.log(f"[SSH] Error fetching SSH key {ssh_key_id}: {e}", "WARNING")
        return None
    
    def _fetch_ssh_key_via_hosting_vm(self, hosting_vm_id: str, hostname: str) -> Optional[str]:
        """
        Fetch SSH key by following: hosting_vm_id → vcenter_vms → zfs_target_templates → ssh_key_id
        """
        self.log(f"[SSH Lookup] Starting key search for hosting_vm_id={hosting_vm_id}")
        
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
                self.log(f"[SSH Lookup] Failed to fetch hosting VM: HTTP {response.status_code}", "WARNING")
                return None
                
            vms = response.json()
            if not vms:
                self.log(f"[SSH Lookup] Hosting VM {hosting_vm_id} not found in vcenter_vms", "WARNING")
                return None
            
            vm = vms[0]
            vm_name = vm.get('name', '')
            vm_vcenter_id = vm.get('vcenter_id', '')
            self.log(f"[SSH Lookup] Found hosting VM: name='{vm_name}', vcenter_id='{vm_vcenter_id}'")
            
            # Find a zfs_target_template that matches this VM
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
                self.log(f"[SSH Lookup] Failed to fetch templates: HTTP {response.status_code}", "WARNING")
                return None
            
            templates = response.json()
            if not templates:
                self.log("[SSH Lookup] No active templates found in zfs_target_templates", "WARNING")
                return None
            
            self.log(f"[SSH Lookup] Found {len(templates)} active templates to check")
            
            # Helper to extract site prefix (e.g., "S06" from "S06-VREP-02")
            def extract_site_prefix(name: str) -> Optional[str]:
                match = re.match(r'^(S\d{2})-', name, re.IGNORECASE)
                return match.group(1).upper() if match else None
            
            # Helper to check if name contains replication patterns
            def is_replication_appliance(name: str) -> bool:
                patterns = ['VRP', 'VREP', 'REPL', '-REP-', '-REP']
                name_upper = name.upper()
                return any(p in name_upper for p in patterns)
            
            vm_site = extract_site_prefix(vm_name)
            vm_is_repl = is_replication_appliance(vm_name)
            self.log(f"[SSH Lookup] VM analysis: site='{vm_site}', is_repl={vm_is_repl}")
            
            # Track templates with keys for vCenter fallback
            vcenter_fallback_templates = []
            
            for template in templates:
                template_name = template.get('name', '')
                template_vm_name = template.get('template_name', '')
                template_vcenter_id = template.get('vcenter_id', '')
                has_key = bool(template.get('ssh_key_id'))
                
                self.log(f"[SSH Lookup] Checking template '{template_name}': has_key={has_key}, vcenter={template_vcenter_id}")
                
                if not has_key:
                    continue
                
                # Track for vCenter fallback
                if template_vcenter_id and template_vcenter_id == vm_vcenter_id:
                    vcenter_fallback_templates.append(template)
                    
                # Match if VM name starts with template name prefix
                name_base = template_name.replace('-TMP', '').replace('-TEMPLATE', '').replace('_TMP', '').replace('_TEMPLATE', '')
                if name_base and vm_name.startswith(name_base):
                    self.log(f"[SSH Lookup] ✓ Name prefix match: template '{template_name}' for VM '{vm_name}'")
                    return self._fetch_ssh_key_by_id(template['ssh_key_id'], hostname)
                
                # Also check template_name field
                template_name_base = template_vm_name.replace('-TMP', '').replace('-TEMPLATE', '').replace('_TMP', '').replace('_TEMPLATE', '') if template_vm_name else ''
                if template_name_base and vm_name.startswith(template_name_base):
                    self.log(f"[SSH Lookup] ✓ Template VM name match: '{template_name}' via template_name field")
                    return self._fetch_ssh_key_by_id(template['ssh_key_id'], hostname)
                
                # Site-based fuzzy matching for replication appliances
                template_site = extract_site_prefix(template_name)
                template_is_repl = is_replication_appliance(template_name)
                
                self.log(f"[SSH Lookup]   Template '{template_name}': site='{template_site}', is_repl={template_is_repl}")
                
                if vm_site and template_site and vm_site == template_site:
                    if vm_is_repl and template_is_repl:
                        self.log(f"[SSH Lookup] ✓ Site + replication pattern match: template '{template_name}' to VM '{vm_name}'")
                        return self._fetch_ssh_key_by_id(template['ssh_key_id'], hostname)
            
            # vCenter-based fallback
            if vcenter_fallback_templates:
                fallback = vcenter_fallback_templates[0]
                self.log(f"[SSH Lookup] ⚡ vCenter fallback: using template '{fallback.get('name')}' (same vCenter)")
                return self._fetch_ssh_key_by_id(fallback['ssh_key_id'], hostname)
            
            self.log(f"[SSH Lookup] ✗ No template matched VM '{vm_name}' by name patterns", "WARNING")
            
            # Check ssh_key_deployments for this hosting VM
            self.log(f"[SSH Lookup] Checking ssh_key_deployments for hosting_vm_id={hosting_vm_id}")
            response = requests.get(
                f"{DSM_URL}/rest/v1/ssh_key_deployments",
                params={
                    'hosting_vm_id': f"eq.{hosting_vm_id}",
                    'status': 'in.(deployed,active,pending)',
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
                    self.log(f"[SSH Lookup] ✓ Found SSH key deployment for hosting VM '{vm_name}'")
                    return self._fetch_ssh_key_by_id(deployments[0]['ssh_key_id'], hostname)
                else:
                    self.log("[SSH Lookup] No ssh_key_deployments found for this VM", "WARNING")
                    
        except Exception as e:
            self.log(f"[SSH Lookup] Error: {e}", "WARNING")
        
        self.log("[SSH Lookup] ✗ No SSH key found via hosting VM", "WARNING")
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
                self.log(f"[SSH] Template {template_id} not found", "WARNING")
                return None
            
            template = templates[0]
            if template.get('ssh_key_id'):
                self.log(f"[SSH] Found SSH key via source template '{template.get('name', template_id)}'")
                return self._fetch_ssh_key_by_id(template['ssh_key_id'], hostname)
                
        except Exception as e:
            self.log(f"[SSH] Error fetching SSH key via template: {e}", "WARNING")
        return None
    
    def _fetch_ssh_key_via_deployment(self, target_id: str, hostname: str) -> Optional[str]:
        """
        Fetch SSH key from ssh_key_deployments table for a replication target.
        Accepts any status (deployed, active, pending) - if a key was deployed, try it.
        """
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/ssh_key_deployments",
                params={
                    'replication_target_id': f"eq.{target_id}",
                    'select': 'ssh_key_id,status'
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
                    # Prefer deployed status, but accept any
                    deployment = next((d for d in deployments if d.get('status') == 'deployed'), deployments[0])
                    self.log(f"[SSH] Found deployed key (status: {deployment.get('status')}) for target {target_id}")
                    return self._fetch_ssh_key_by_id(deployment['ssh_key_id'], hostname)
        except Exception as e:
            self.log(f"[SSH] Error checking ssh_key_deployments: {e}", "WARNING")
        return None
    
    def _fetch_ssh_key_from_settings(self) -> tuple:
        """
        Fetch SSH credentials from activity_settings as fallback.
        Returns tuple: (key_data, key_path, password) - any may be None
        """
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
                    
                    # Check for encrypted SSH key
                    if settings.get('ssh_private_key_encrypted'):
                        key_data = self.decrypt_password(settings['ssh_private_key_encrypted'])
                        if key_data:
                            return (key_data, None, None)
                    
                    # Check for SSH key path
                    if settings.get('ssh_private_key_path'):
                        return (None, settings['ssh_private_key_path'], None)
                    
                    # Check for encrypted password
                    if settings.get('ssh_password_encrypted'):
                        password = self.decrypt_password(settings['ssh_password_encrypted'])
                        if password:
                            return (None, None, password)
        except Exception as e:
            self.log(f"[SSH] Error fetching activity_settings: {e}", "WARNING")
        return (None, None, None)
