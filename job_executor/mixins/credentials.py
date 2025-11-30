"""Credential resolution functionality for Job Executor"""

import ipaddress
import requests
from typing import List, Dict, Optional

from job_executor.config import (
    DSM_URL,
    SERVICE_ROLE_KEY,
    VERIFY_SSL,
    IDRAC_DEFAULT_USER,
    IDRAC_DEFAULT_PASSWORD,
)
from job_executor.utils import _safe_json_parse


class CredentialsMixin:
    """Mixin providing credential resolution functionality for Job Executor"""
    
    # Class attributes (will be set by JobExecutor)
    encryption_key: Optional[str] = None
    
    def get_encryption_key(self) -> Optional[str]:
        """Fetch the encryption key from activity_settings (cached)"""
        if self.encryption_key:
            return self.encryption_key
            
        try:
            url = f"{DSM_URL}/rest/v1/activity_settings"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            }
            params = {"select": "encryption_key", "limit": "1"}
            
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            self._handle_supabase_auth_error(response, "loading encryption key")
            if response.status_code == 200:
                settings = _safe_json_parse(response)
                if settings and len(settings) > 0:
                    self.encryption_key = settings[0].get('encryption_key')
                    if self.encryption_key:
                        self.log("Encryption key loaded successfully", "INFO")
                    return self.encryption_key
            
            self.log("Failed to load encryption key", "WARN")
            return None
        except Exception as e:
            self.log(f"Error loading encryption key: {e}", "ERROR")
            return None

    def decrypt_password(self, encrypted_password: str) -> Optional[str]:
        """Decrypt a password using the database decrypt function"""
        if not encrypted_password:
            return None
            
        try:
            encryption_key = self.get_encryption_key()
            if not encryption_key:
                self.log("Cannot decrypt: encryption key not available", "ERROR")
                return None
            
            # Call the decrypt_password database function
            url = f"{DSM_URL}/rest/v1/rpc/decrypt_password"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "Content-Type": "application/json"
            }
            payload = {
                "encrypted": encrypted_password,
                "key": encryption_key
            }
            
            response = requests.post(url, headers=headers, json=payload, verify=VERIFY_SSL)
            self._handle_supabase_auth_error(response, "decrypting password")
            if response.status_code == 200:
                # RPC returns the decrypted string directly
                decrypted = _safe_json_parse(response)
                if decrypted:
                    return decrypted
                else:
                    self.log("Decryption returned null - possibly corrupted data", "WARN")
                    return None
            else:
                self.log(f"Decryption failed: {response.status_code} - {response.text}", "ERROR")
                return None
        except Exception as e:
            self.log(f"Error decrypting password: {e}", "ERROR")
            return None

    def ip_in_range(self, ip_address: str, ip_range: str) -> bool:
        """
        Check if an IP address is within a given range.
        Supports CIDR notation (10.0.0.0/8) and hyphenated ranges (192.168.1.1-192.168.1.50)
        """
        try:
            ip = ipaddress.ip_address(ip_address)
            
            # CIDR notation
            if '/' in ip_range:
                network = ipaddress.ip_network(ip_range, strict=False)
                return ip in network
            
            # Hyphenated range
            elif '-' in ip_range:
                start_ip, end_ip = ip_range.split('-')
                start = ipaddress.ip_address(start_ip.strip())
                end = ipaddress.ip_address(end_ip.strip())
                return start <= ip <= end
            
            # Single IP
            else:
                return ip == ipaddress.ip_address(ip_range)
                
        except ValueError:
            self.log(f"Invalid IP range format: {ip_range}", "ERROR")
            return False

    def get_credential_sets(self, credential_set_ids: List[str]) -> List[Dict]:
        """Fetch credential sets from database"""
        if not credential_set_ids:
            return []
        
        try:
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            url = f"{DSM_URL}/rest/v1/credential_sets"
            params = {"id": f"in.({','.join(credential_set_ids)})", "order": "priority.asc"}
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            
            if response.status_code == 200:
                return _safe_json_parse(response)
            return []
        except Exception as e:
            self.log(f"Error fetching credential sets: {e}", "ERROR")
            return []

    def get_credential_sets_for_ip(self, ip_address: str) -> List[Dict]:
        """
        Get credential sets that match the given IP address based on IP ranges.
        Returns credential sets ordered by priority.
        """
        try:
            # Fetch all credential_ip_ranges with their credential_sets
            url = f"{DSM_URL}/rest/v1/credential_ip_ranges"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            }
            params = {
                "select": "*, credential_sets(*)"
            }
            
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            
            if response.status_code != 200:
                self.log(f"Error fetching credential IP ranges: {response.status_code}", "WARN")
                return []
            
            matching_sets = []
            ip_range_entries = _safe_json_parse(response)
            
            for ip_range_entry in ip_range_entries:
                ip_range = ip_range_entry['ip_range']
                
                # Check if IP matches range
                if self.ip_in_range(ip_address, ip_range):
                    cred_set = ip_range_entry['credential_sets']
                    matching_sets.append({
                        'id': cred_set['id'],
                        'name': cred_set['name'],
                        'username': cred_set['username'],
                        'password': self.decrypt_password(cred_set['password_encrypted']),
                        'priority': ip_range_entry['priority'],
                        'matched_range': ip_range
                    })
            
            # Sort by priority (lower = higher priority)
            matching_sets.sort(key=lambda x: x['priority'])
            
            if matching_sets:
                self.log(f"Found {len(matching_sets)} credential set(s) for IP {ip_address}", "INFO")
            
            return matching_sets
            
        except Exception as e:
            self.log(f"Error fetching credential sets for IP: {e}", "ERROR")
            return []

    def get_esxi_credentials_for_host(self, host_id: str, host_ip: str, credential_set_id: Optional[str] = None) -> Optional[Dict]:
        """
        Get ESXi SSH credentials for a host with priority:
        1. Explicit credential_set_id (passed from job details)
        2. Direct vcenter_host_id match (per-host credentials)
        3. IP range match with credential_type='esxi'
        4. Default ESXi credential set (is_default=true, credential_type='esxi')
        
        Returns: {'username': 'root', 'password': 'decrypted_password', 'source': 'credential_set_id'}
        """
        headers = {
            "apikey": SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        }
        
        # Priority 1: Explicit credential_set_id
        if credential_set_id:
            try:
                url = f"{DSM_URL}/rest/v1/credential_sets"
                params = {
                    "id": f"eq.{credential_set_id}",
                    "credential_type": "eq.esxi"
                }
                response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
                if response.status_code == 200:
                    creds = _safe_json_parse(response)
                    if creds:
                        cred = creds[0]
                        password = None
                        if cred.get('password_encrypted'):
                            password = self.decrypt_password(cred['password_encrypted'])
                        if password:
                            self.log(f"ESXi credentials for {host_ip}: using explicit credential_set_id", "DEBUG")
                            return {
                                'username': cred['username'],
                                'password': password,
                                'source': 'credential_set_id'
                            }
            except Exception as e:
                self.log(f"Error fetching explicit ESXi credential set: {e}", "WARN")
        
        # Priority 2: Direct vcenter_host_id match
        try:
            url = f"{DSM_URL}/rest/v1/credential_sets"
            params = {
                "vcenter_host_id": f"eq.{host_id}",
                "credential_type": "eq.esxi"
            }
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            if response.status_code == 200:
                creds = _safe_json_parse(response)
                if creds:
                    cred = creds[0]
                    password = None
                    if cred.get('password_encrypted'):
                        password = self.decrypt_password(cred['password_encrypted'])
                    if password:
                        self.log(f"ESXi credentials for {host_ip}: using per-host credential", "DEBUG")
                        return {
                            'username': cred['username'],
                            'password': password,
                            'source': 'vcenter_host_id'
                        }
        except Exception as e:
            self.log(f"Error fetching per-host ESXi credentials: {e}", "WARN")
        
        # Priority 3: IP range match with ESXi type
        try:
            url = f"{DSM_URL}/rest/v1/credential_ip_ranges"
            params = {
                "select": "*, credential_sets(*)"
            }
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            if response.status_code == 200:
                ip_range_entries = _safe_json_parse(response)
                matching_sets = []
                
                for ip_range_entry in ip_range_entries:
                    cred_set = ip_range_entry.get('credential_sets')
                    if not cred_set or cred_set.get('credential_type') != 'esxi':
                        continue
                    
                    ip_range = ip_range_entry['ip_range']
                    if self.ip_in_range(host_ip, ip_range):
                        password = None
                        if cred_set.get('password_encrypted'):
                            password = self.decrypt_password(cred_set['password_encrypted'])
                        if password:
                            matching_sets.append({
                                'username': cred_set['username'],
                                'password': password,
                                'priority': ip_range_entry['priority'],
                                'source': 'ip_range'
                            })
                
                # Sort by priority and return first match
                if matching_sets:
                    matching_sets.sort(key=lambda x: x['priority'])
                    self.log(f"ESXi credentials for {host_ip}: using IP range match", "DEBUG")
                    return matching_sets[0]
        except Exception as e:
            self.log(f"Error fetching IP range ESXi credentials: {e}", "WARN")
        
        # Priority 4: Default ESXi credential
        try:
            url = f"{DSM_URL}/rest/v1/credential_sets"
            params = {
                "credential_type": "eq.esxi",
                "is_default": "eq.true"
            }
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            if response.status_code == 200:
                creds = _safe_json_parse(response)
                if creds:
                    cred = creds[0]
                    password = None
                    if cred.get('password_encrypted'):
                        password = self.decrypt_password(cred['password_encrypted'])
                    if password:
                        self.log(f"ESXi credentials for {host_ip}: using default ESXi credential", "DEBUG")
                        return {
                            'username': cred['username'],
                            'password': password,
                            'source': 'default'
                        }
        except Exception as e:
            self.log(f"Error fetching default ESXi credentials: {e}", "WARN")
        
        # No credentials found
        self.log(f"No ESXi credentials found for host {host_ip} (ID: {host_id})", "WARN")
        return None

    def resolve_credentials_for_server(self, server: Dict) -> tuple:
        """
        Resolve credentials for a server following priority order.
        Returns: (username, password, source, used_cred_set_id)
        Sources: 'credential_set_id', 'server_specific', 'discovered_by_credential_set_id', 
                 'ip_range', 'defaults', 'decrypt_failed'
        """
        ip = server.get('ip_address', 'unknown')
        
        # 1) Explicit server.credential_set_id
        if server.get('credential_set_id'):
            cred_sets = self.get_credential_sets([server['credential_set_id']])
            if cred_sets:
                cred = cred_sets[0]
                username = cred.get('username')
                password = cred.get('password')
                if not password and cred.get('password_encrypted'):
                    password = self.decrypt_password(cred['password_encrypted'])
                    if password is None:
                        self.log(f"  Credential resolution for {ip}: decrypt_failed (credential_set_id)", "ERROR")
                        return (None, None, 'decrypt_failed', None)
                if username and password:
                    self.log(f"  Credential resolution for {ip}: using credential_set_id", "DEBUG")
                    return (username, password, 'credential_set_id', server['credential_set_id'])
        
        # 2) Server-specific idrac_username + idrac_password_encrypted
        if server.get('idrac_username') and server.get('idrac_password_encrypted'):
            username = server['idrac_username']
            password = self.decrypt_password(server['idrac_password_encrypted'])
            if password is None:
                self.log(f"  Credential resolution for {ip}: decrypt_failed (server_specific)", "ERROR")
                return (None, None, 'decrypt_failed', None)
            self.log(f"  Credential resolution for {ip}: using server_specific credentials", "DEBUG")
            return (username, password, 'server_specific', None)
        
        # 3) Fallback to discovered_by_credential_set_id
        if server.get('discovered_by_credential_set_id'):
            cred_sets = self.get_credential_sets([server['discovered_by_credential_set_id']])
            if cred_sets:
                cred = cred_sets[0]
                username = cred.get('username')
                password = cred.get('password')
                if not password and cred.get('password_encrypted'):
                    password = self.decrypt_password(cred['password_encrypted'])
                    if password is None:
                        self.log(f"  Credential resolution for {ip}: decrypt_failed (discovered_by_credential_set_id)", "ERROR")
                        return (None, None, 'decrypt_failed', None)
                if username and password:
                    self.log(f"  Credential resolution for {ip}: using discovered_by_credential_set_id", "DEBUG")
                    return (username, password, 'discovered_by_credential_set_id', server['discovered_by_credential_set_id'])
        
        # 4) IP-range mapped credentials
        matching_sets = self.get_credential_sets_for_ip(server.get('ip_address', ''))
        if matching_sets:
            cred = matching_sets[0]  # Highest priority
            username = cred.get('username')
            password = cred.get('password')
            if not password and cred.get('password_encrypted'):
                password = self.decrypt_password(cred['password_encrypted'])
                if password is None:
                    self.log(f"  Credential resolution for {ip}: decrypt_failed (ip_range)", "ERROR")
                    return (None, None, 'decrypt_failed', None)
            if username and password:
                self.log(f"  Credential resolution for {ip}: using ip_range credentials", "DEBUG")
                return (username, password, 'ip_range', cred.get('id'))
        
        # 5) Final fallback: environment defaults
        if IDRAC_DEFAULT_USER and IDRAC_DEFAULT_PASSWORD:
            self.log(f"  Credential resolution for {ip}: using environment defaults", "DEBUG")
            return (IDRAC_DEFAULT_USER, IDRAC_DEFAULT_PASSWORD, 'defaults', None)
        
        # No credentials available
        self.log(f"  Credential resolution for {ip}: no credentials available", "WARN")
        return (None, None, 'none', None)

    def get_server_credentials(self, server_id: str) -> tuple:
        """Resolve credentials for a server using the full credential resolution pipeline."""
        try:
            server = self.get_server_by_id(server_id)
            if not server:
                self.log(f"Server {server_id} not found while resolving credentials", "WARN")
                return (None, None)

            username, password, source, cred_set_id = self.resolve_credentials_for_server(server)

            if source == 'decrypt_failed':
                self.log(
                    f"Credential resolution for {server.get('ip_address', 'unknown')}: "
                    "decryption failed (check encryption key)",
                    "ERROR",
                )
                return (None, None)

            if not username or not password or source == 'none':
                self.log(
                    f"No credentials available for server {server.get('ip_address', 'unknown')} (ID: {server_id})",
                    "WARN",
                )
                return (None, None)

            source_msg = (
                f"credential_set_id {cred_set_id}" if source == 'credential_set_id' else source
            )
            self.log(
                f"Using {source_msg} credentials for server {server.get('ip_address', 'unknown')} (ID: {server_id})",
                "INFO",
            )

            return (username, password)
        except Exception as e:
            self.log(f"Error resolving credentials for server {server_id}: {e}", "ERROR")
            return (None, None)

    def get_credentials_for_server(self, server: Dict) -> tuple:
        """
        Get credentials for a server, simplified wrapper around resolve_credentials_for_server.
        Returns: (username, password) tuple
        Raises: Exception if credentials cannot be resolved
        """
        username, password, cred_source, used_cred_set_id = self.resolve_credentials_for_server(server)
        
        if cred_source == 'decrypt_failed':
            raise Exception("Cannot decrypt credentials - encryption key not configured")
        
        if cred_source == 'none' or not username or not password:
            raise Exception("No valid credentials available for server")
        
        return (username, password)
