"""IDM (FreeIPA/LDAP) authentication and sync handlers with verbose logging"""

from typing import Dict, Optional
from datetime import datetime
from .base import BaseHandler
import json
import requests
import socket
import ssl
import time


class IDMHandler(BaseHandler):
    """Handles IDM authentication, testing, and user sync operations"""
    
    def _build_ldap_url(self, host: str, port: int, use_ssl: bool) -> str:
        """Build LDAP URL based on settings."""
        protocol = 'ldaps' if use_ssl else 'ldap'
        return f"{protocol}://{host}:{port}"
    
    def _log_ldap_operation(
        self,
        job_id: str,
        endpoint: str,
        full_url: str,
        success: bool,
        response_time_ms: int = 0,
        request_body: Dict = None,
        response_body: Dict = None,
        error_message: str = None,
        command_type: str = 'ldap'
    ):
        """Log LDAP operation to idrac_commands table for Activity Monitor visibility."""
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            response = requests.post(
                f"{DSM_URL}/rest/v1/idrac_commands",
                headers={
                    "apikey": SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal"
                },
                json={
                    'job_id': job_id,
                    'operation_type': 'ldap_api',
                    'endpoint': endpoint,
                    'full_url': full_url,
                    'command_type': command_type,
                    'success': success,
                    'response_time_ms': response_time_ms,
                    'request_body': request_body,
                    'response_body': response_body,
                    'error_message': error_message,
                    'source': 'job_executor',
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.status_code not in [200, 201]:
                self.log(f"Failed to log LDAP operation: {response.status_code} - {response.text}", "WARN")
        except Exception as e:
            self.log(f"Failed to log LDAP operation: {e}", "WARN")
    
    def _create_task(self, job_id: str, task_name: str) -> Optional[str]:
        """Create a job task for tracking individual steps."""
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            response = requests.post(
                f"{DSM_URL}/rest/v1/job_tasks",
                headers={
                    "apikey": SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation"
                },
                json={
                    'job_id': job_id,
                    'status': 'running',
                    'started_at': datetime.now().isoformat(),
                    'log': f"Starting: {task_name}",
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            if response.status_code in [200, 201]:
                tasks = response.json()
                if tasks and len(tasks) > 0:
                    return tasks[0]['id']
        except Exception as e:
            self.log(f"Failed to create task: {e}", "WARN")
        return None
    
    def _update_task(self, task_id: str, status: str, log: str, progress: int = None):
        """Update job task status and log."""
        if not task_id:
            return
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            update = {
                'status': status,
                'log': log,
            }
            if progress is not None:
                update['progress'] = progress
            if status in ('completed', 'failed'):
                update['completed_at'] = datetime.now().isoformat()
            
            response = requests.patch(
                f"{DSM_URL}/rest/v1/job_tasks",
                headers={
                    "apikey": SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal"
                },
                params={'id': f'eq.{task_id}'},
                json=update,
                verify=VERIFY_SSL,
                timeout=10
            )
        except Exception as e:
            self.log(f"Failed to update task: {e}", "WARN")
    
    def execute_idm_authenticate(self, job: Dict):
        """Authenticate user against FreeIPA LDAP."""
        try:
            self.log(f"Starting IDM authentication job: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            details = job.get('details') or {}
            username = details.get('username')
            password = details.get('password')  # Passed securely from edge function
            
            if not username or not password:
                raise ValueError("Username and password required")
            
            # Get IDM settings
            idm_settings = self.executor.get_idm_settings()
            if not idm_settings:
                raise ValueError("IDM not configured")
            
            if idm_settings['auth_mode'] == 'local_only':
                raise ValueError("IDM authentication not enabled (auth_mode: local_only)")
            
            # Create authenticator
            authenticator = self.executor.create_freeipa_authenticator(idm_settings)
            if not authenticator:
                raise ValueError("Failed to initialize FreeIPA authenticator")
            
            # Authenticate user with service account for group lookup
            self.log(f"Authenticating user '{username}' against FreeIPA: {idm_settings['server_host']}")
            
            # Get decrypted service account password for AD Trust group lookup
            service_bind_password = None
            if idm_settings.get('bind_password_encrypted'):
                service_bind_password = self.executor.decrypt_bind_password(idm_settings['bind_password_encrypted'])
            
            auth_result = authenticator.authenticate_user(
                username,
                password,
                service_bind_dn=idm_settings.get('bind_dn'),
                service_bind_password=service_bind_password
            )
            
            if auth_result['success']:
                self.log(f"[OK] User '{username}' authenticated successfully")
                self.log(f"  User DN: {auth_result.get('user_dn')}")
                self.log(f"  Groups: {len(auth_result.get('groups', []))} group(s)")
                
                # Add canonical identity information
                try:
                    normalized = authenticator.normalize_identity(username)
                    if normalized:
                        auth_result['canonical_principal'] = normalized.canonical_principal
                        auth_result['realm'] = normalized.realm
                        auth_result['is_ad_trust_user'] = normalized.is_ad_trust
                        self.log(f"  Canonical Principal: {normalized.canonical_principal}")
                        self.log(f"  Realm: {normalized.realm}")
                except Exception as e:
                    self.log(f"Could not normalize identity: {e}", "WARN")
            else:
                self.log(f"[X] Authentication failed for '{username}': {auth_result.get('error')}", "WARN")
            
            # Clear password from details before updating job (security best practice)
            sanitized_details = {k: v for k, v in details.items() if k != 'password'}
            sanitized_details['auth_result'] = auth_result
            
            # Complete job with auth result (password removed)
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details=sanitized_details
            )
            
        except Exception as e:
            self.log(f"IDM authentication job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={
                    'error': str(e),
                    'auth_result': {'success': False, 'error': str(e)}
                }
            )

    def execute_idm_test_auth(self, job: Dict):
        """Test IDM authentication with username/password and simulate role mapping."""
        job_id = job['id']
        start_time = datetime.now()
        
        try:
            self.log(f"Starting IDM test authentication job: {job_id}")
            self.update_job_status(job_id, 'running', started_at=start_time.isoformat())
            
            details = job.get('details') or {}
            username = details.get('username')
            password = details.get('password')
            
            if not username or not password:
                raise ValueError("Username and password required")
            
            # Create task for tracking
            task_id = self._create_task(job_id, f"Test authentication for {username}")
            
            # Get IDM settings
            idm_settings = self.executor.get_idm_settings()
            if not idm_settings:
                raise ValueError("IDM not configured")
            
            server_host = idm_settings.get('server_host', 'unknown')
            base_dn = idm_settings.get('base_dn', '')
            ad_dc_host = idm_settings.get('ad_dc_host')
            ad_dc_port = idm_settings.get('ad_dc_port', 389)
            ad_dc_use_ssl = idm_settings.get('ad_dc_use_ssl', False)
            
            # FreeIPA connection settings
            ipa_use_ssl = idm_settings.get('use_ldaps', True)
            ipa_port = idm_settings.get('ldaps_port', 636) if ipa_use_ssl else idm_settings.get('server_port', 389)
            
            # Log verbose connection details
            self._update_task(task_id, 'running', f"Connecting to FreeIPA: {server_host}", 10)
            
            # Create authenticator
            authenticator = self.executor.create_freeipa_authenticator(idm_settings)
            if not authenticator:
                raise ValueError("Failed to initialize FreeIPA authenticator")
            
            # Check if this is an AD trust user
            is_ad_user, clean_username, domain = authenticator._is_ad_trust_user(username)
            
            # Build the LDAP URL based on whether this is AD or FreeIPA auth
            if is_ad_user and ad_dc_host:
                bind_url = self._build_ldap_url(ad_dc_host, ad_dc_port, ad_dc_use_ssl)
            else:
                bind_url = self._build_ldap_url(server_host, ipa_port, ipa_use_ssl)
            
            # Log the authentication attempt details
            auth_details = {
                'username': username,
                'is_ad_trust_user': is_ad_user,
                'ad_domain': domain if is_ad_user else None,
                'server_host': server_host,
                'base_dn': base_dn,
                'ad_dc_host': ad_dc_host if is_ad_user else None,
                'ad_dc_port': ad_dc_port if is_ad_user else None,
                'ad_dc_use_ssl': ad_dc_use_ssl if is_ad_user else None,
            }
            
            if is_ad_user:
                if ad_dc_host:
                    self.log(f"AD Trust user detected - will authenticate via AD DC: {ad_dc_host}:{ad_dc_port} (SSL: {ad_dc_use_ssl})")
                    auth_details['auth_method'] = 'ad_dc_passthrough'
                    auth_details['bind_target'] = ad_dc_host
                else:
                    self.log(f"AD Trust user detected - attempting FreeIPA compat bind")
                    auth_details['auth_method'] = 'freeipa_compat'
                    auth_details['bind_target'] = server_host
                    auth_details['search_base'] = f"cn=users,cn=compat,{base_dn}"
            else:
                self.log(f"Native FreeIPA user - standard DN bind")
                auth_details['auth_method'] = 'freeipa_native'
                auth_details['bind_target'] = server_host
                auth_details['bind_dn'] = f"uid={clean_username},cn=users,cn=accounts,{base_dn}"
            
            self._update_task(task_id, 'running', f"Attempting LDAP bind: {auth_details.get('auth_method')} via {bind_url}", 30)
            
            # Log the LDAP bind attempt
            self._log_ldap_operation(
                job_id=job_id,
                endpoint='/ldap/bind',
                full_url=bind_url,
                success=False,  # Will update after
                request_body={
                    'username': username,
                    'is_ad_trust_user': is_ad_user,
                    'auth_method': auth_details.get('auth_method'),
                    'bind_target': auth_details.get('bind_target'),
                },
                command_type='ldap_bind_attempt'
            )
            
            # Get decrypted service account password for AD Trust group lookup
            service_bind_password = None
            if idm_settings.get('bind_password_encrypted'):
                service_bind_password = self.executor.decrypt_bind_password(idm_settings['bind_password_encrypted'])
            
            # Authenticate user with service account for group lookup
            self.log(f"Testing authentication for user '{username}'")
            auth_result = authenticator.authenticate_user(
                username,
                password,
                service_bind_dn=idm_settings.get('bind_dn'),
                service_bind_password=service_bind_password
            )
            
            elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # Log the result
            self._log_ldap_operation(
                job_id=job_id,
                endpoint='/ldap/bind',
                full_url=bind_url,
                success=auth_result['success'],
                response_time_ms=auth_result.get('response_time_ms', elapsed_ms),
                response_body={
                    'success': auth_result['success'],
                    'user_dn': auth_result.get('user_dn'),
                    'group_count': len(auth_result.get('groups', [])),
                    'is_ad_trust_user': auth_result.get('is_ad_trust_user'),
                },
                error_message=auth_result.get('error') or auth_result.get('error_details'),
                command_type='ldap_bind_result'
            )
            
            if not auth_result['success']:
                error_msg = auth_result.get('error', 'Unknown error')
                error_details = auth_result.get('error_details', '')
                full_error = f"{error_msg}\n\nDetails: {error_details}" if error_details else error_msg
                
                self._update_task(task_id, 'failed', f"Authentication failed: {full_error}", 100)
                self.log(f"[X] Test authentication failed: {error_msg}", "WARN")
                self.log(f"  Error details: {error_details}", "DEBUG")
                
                self.update_job_status(
                    job_id,
                    'completed',
                    completed_at=datetime.now().isoformat(),
                    details={
                        'test_result': {
                            **auth_result,
                            'auth_details': auth_details,
                        },
                        'username': username
                    }
                )
                return
            
            self._update_task(task_id, 'running', "Authentication successful, retrieving groups", 60)
            self.log(f"[OK] Test authentication successful for '{username}'")
            self.log(f"  User DN: {auth_result.get('user_dn')}")
            self.log(f"  Full Name: {auth_result.get('user_info', {}).get('full_name', 'N/A')}")
            self.log(f"  Email: {auth_result.get('user_info', {}).get('email', 'N/A')}")
            self.log(f"  Groups: {len(auth_result.get('groups', []))} group(s)")
            
            # Log group retrieval - use IPA URL for group searches
            ipa_url = self._build_ldap_url(server_host, ipa_port, ipa_use_ssl)
            user_groups = auth_result.get('groups', [])
            if user_groups:
                self._log_ldap_operation(
                    job_id=job_id,
                    endpoint='/ldap/search/groups',
                    full_url=ipa_url,
                    success=True,
                    response_body={'groups': user_groups[:10], 'total_count': len(user_groups)},
                    command_type='ldap_group_search'
                )
            
            # Simulate role mapping (read from idm_group_mappings)
            self._update_task(task_id, 'running', "Simulating role mapping", 80)
            mapped_role = None
            matched_group = None
            
            if user_groups:
                self.log("Simulating role mapping...")
                group_mappings = self.executor.get_idm_group_mappings()
                
                # Sort by priority (lower number = higher priority)
                sorted_mappings = sorted(
                    group_mappings,
                    key=lambda x: x.get('priority', 999)
                )
                
                for mapping in sorted_mappings:
                    if not mapping.get('is_active'):
                        continue
                        
                    mapping_group_dn = mapping.get('idm_group_dn', '')
                    
                    # Check if user's groups contain this mapping's group DN
                    for user_group_dn in user_groups:
                        if mapping_group_dn.lower() in user_group_dn.lower():
                            mapped_role = mapping.get('app_role')
                            matched_group = mapping.get('idm_group_name')
                            self.log(f"[OK] Matched group '{matched_group}' → role '{mapped_role}'")
                            break
                    
                    if mapped_role:
                        break
                
                if not mapped_role:
                    self.log("[WARN] No matching group mappings found, would default to 'viewer'")
                    mapped_role = 'viewer'
            else:
                self.log("[WARN] User has no groups, would default to 'viewer'")
                mapped_role = 'viewer'
            
            # Prepare test result
            test_result = {
                'success': True,
                'user_dn': auth_result.get('user_dn'),
                'full_name': auth_result.get('user_info', {}).get('full_name') or auth_result.get('full_name'),
                'email': auth_result.get('user_info', {}).get('email') or auth_result.get('email'),
                'title': auth_result.get('user_info', {}).get('title') or auth_result.get('title'),
                'department': auth_result.get('user_info', {}).get('department') or auth_result.get('department'),
                'groups': user_groups,
                'group_count': len(user_groups),
                'mapped_role': mapped_role,
                'matched_group': matched_group,
                'is_ad_trust_user': auth_result.get('is_ad_trust_user', False),
                'ad_domain': auth_result.get('ad_domain'),
                'auth_details': auth_details,
                'response_time_ms': auth_result.get('response_time_ms', elapsed_ms),
                'is_test': True,
            }
            
            self._update_task(task_id, 'completed', f"Test completed - role: {mapped_role}", 100)
            self.log(f"[OK] Test completed - would assign role: {mapped_role}")
            
            self.update_job_status(
                job_id,
                'completed',
                completed_at=datetime.now().isoformat(),
                details={'test_result': test_result, 'username': username}
            )
            
        except Exception as e:
            self.log(f"IDM test authentication failed: {e}", "ERROR")
            
            # Log the failure - try to get settings for URL, fallback to unknown
            try:
                idm_settings = self.executor.get_idm_settings() or {}
                error_host = idm_settings.get('server_host', 'unknown')
                error_port = idm_settings.get('ldaps_port', 636) if idm_settings.get('use_ldaps', True) else idm_settings.get('server_port', 389)
                error_ssl = idm_settings.get('use_ldaps', True)
                error_url = self._build_ldap_url(error_host, error_port, error_ssl)
            except:
                error_url = 'ldap://unknown:389'
            
            self._log_ldap_operation(
                job_id=job_id,
                endpoint='/ldap/bind',
                full_url=error_url,
                success=False,
                error_message=str(e),
                command_type='ldap_error'
            )
            
            self.update_job_status(
                job_id,
                'failed',
                completed_at=datetime.now().isoformat(),
                details={
                    'error': str(e),
                    'test_result': {'success': False, 'error': str(e)}
                }
            )
    
    def execute_idm_test_connection(self, job: Dict):
        """Test FreeIPA LDAP connection with service account."""
        job_id = job['id']
        start_time = datetime.now()
        
        try:
            self.log(f"Starting IDM connection test job: {job_id}")
            self.update_job_status(job_id, 'running', started_at=start_time.isoformat())
            
            details = job.get('details') or {}
            
            # Create task for tracking
            task_id = self._create_task(job_id, "Test FreeIPA connection")
            
            # Check if we should use saved password from database
            use_saved_password = details.get('use_saved_password', False)
            
            # Get settings from job details or database
            server_host = details.get('server_host')
            bind_dn = details.get('bind_dn')
            bind_password = details.get('bind_password')
            
            # If use_saved_password flag is set, retrieve password from database
            if use_saved_password and not bind_password:
                idm_settings = self.executor.get_idm_settings()
                if idm_settings and idm_settings.get('bind_password_encrypted'):
                    bind_password = self.executor.decrypt_bind_password(idm_settings['bind_password_encrypted'])
                    self.log("Using saved bind password from database")
            
            if not server_host:
                # Use settings from database
                idm_settings = self.executor.get_idm_settings()
                if not idm_settings:
                    raise ValueError("IDM not configured and no settings provided")
                
                server_host = idm_settings['server_host']
                bind_dn = idm_settings.get('bind_dn')
                if not bind_password:
                    bind_password = self.executor.decrypt_bind_password(idm_settings.get('bind_password_encrypted'))
            
            if not server_host or not bind_dn or not bind_password:
                raise ValueError("Server host, bind DN, and bind password required")
            
            # Get connection settings for URL building
            use_ldaps = details.get('use_ldaps', True) if details.get('server_host') else (self.executor.get_idm_settings() or {}).get('use_ldaps', True)
            ldap_port = details.get('ldaps_port', 636) if use_ldaps else details.get('server_port', 389)
            conn_url = self._build_ldap_url(server_host, ldap_port, use_ldaps)
            
            self._update_task(task_id, 'running', f"Connecting to {conn_url}", 20)
            
            # Log connection attempt
            self._log_ldap_operation(
                job_id=job_id,
                endpoint='/ldap/connect',
                full_url=conn_url,
                success=False,
                request_body={
                    'server_host': server_host,
                    'bind_dn': bind_dn,
                    'use_ldaps': use_ldaps,
                    'port': ldap_port,
                },
                command_type='ldap_connection_test'
            )
            
            # Build authenticator settings
            auth_settings = details if details.get('server_host') else self.executor.get_idm_settings()
            if details.get('server_host'):
                # Add defaults for testing
                auth_settings.setdefault('base_dn', details.get('base_dn', 'dc=example,dc=com'))
                auth_settings.setdefault('use_ldaps', details.get('use_ldaps', True))
            
            authenticator = self.executor.create_freeipa_authenticator(auth_settings)
            if not authenticator:
                raise ValueError("Failed to initialize FreeIPA authenticator")
            
            self._update_task(task_id, 'running', f"Testing LDAP bind with service account", 50)
            
            # Test connection
            self.log(f"Testing connection to FreeIPA: {server_host}")
            test_result = authenticator.test_connection(bind_dn, bind_password)
            
            elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # Log result
            self._log_ldap_operation(
                job_id=job_id,
                endpoint='/ldap/connect',
                full_url=conn_url,
                success=test_result['success'],
                response_time_ms=test_result.get('response_time_ms', elapsed_ms),
                response_body={
                    'success': test_result['success'],
                    'server_info': test_result.get('server_info'),
                },
                error_message=test_result.get('message') if not test_result['success'] else None,
                command_type='ldap_connection_result'
            )
            
            if test_result['success']:
                self._update_task(task_id, 'completed', f"Connection successful", 100)
                self.log(f"[OK] FreeIPA connection successful")
                self.log(f"  Server: {test_result.get('server_info', {}).get('vendor', 'Unknown')}")
                self.log(f"  Response time: {test_result.get('response_time_ms', 0)}ms")
            else:
                self._update_task(task_id, 'failed', f"Connection failed: {test_result.get('message')}", 100)
                self.log(f"[X] FreeIPA connection failed: {test_result.get('message')}", "ERROR")
            
            self.update_job_status(
                job_id,
                'completed',
                completed_at=datetime.now().isoformat(),
                details={'test_result': test_result}
            )
            
        except Exception as e:
            self.log(f"IDM connection test failed: {e}", "ERROR")
            
            self._log_ldap_operation(
                job_id=job_id,
                endpoint='/ldap/connect',
                full_url='ldap://unknown:389',
                success=False,
                error_message=str(e),
                command_type='ldap_error'
            )
            
            self.update_job_status(
                job_id,
                'failed',
                completed_at=datetime.now().isoformat(),
                details={
                    'error': str(e),
                    'test_result': {'success': False, 'message': str(e)}
                }
            )
    
    def execute_idm_sync_users(self, job: Dict):
        """Sync all users from FreeIPA to local database."""
        try:
            self.log(f"Starting IDM user sync job: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            # Get IDM settings
            idm_settings = self.executor.get_idm_settings()
            if not idm_settings:
                raise ValueError("IDM not configured")
            
            if not idm_settings.get('sync_enabled'):
                raise ValueError("IDM user sync is not enabled")
            
            bind_dn = idm_settings.get('bind_dn')
            bind_password = self.executor.decrypt_bind_password(idm_settings.get('bind_password_encrypted'))
            
            if not bind_dn or not bind_password:
                raise ValueError("Service account credentials required for user sync")
            
            authenticator = self.executor.create_freeipa_authenticator(idm_settings)
            if not authenticator:
                raise ValueError("Failed to initialize FreeIPA authenticator")
            
            # Sync users
            self.log(f"Syncing users from FreeIPA: {idm_settings['server_host']}")
            users = authenticator.sync_all_users(bind_dn, bind_password)
            
            self.log(f"Found {len(users)} user(s) in FreeIPA")
            
            # Process users (update profiles table)
            synced_count = 0
            error_count = 0
            
            for user in users:
                try:
                    # Upsert user to profiles based on idm_uid
                    self.executor._sync_idm_user_to_profile(user)
                    synced_count += 1
                except Exception as e:
                    self.log(f"  Error syncing user {user.get('uid')}: {e}", "WARN")
                    error_count += 1
            
            # Update last sync timestamp
            self.executor._update_idm_sync_status(
                success=error_count == 0,
                error=f"{error_count} user(s) failed to sync" if error_count > 0 else None
            )
            
            self.log(f"[OK] User sync complete: {synced_count} synced, {error_count} errors")
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details={
                    'total_users': len(users),
                    'synced_count': synced_count,
                    'error_count': error_count
                }
            )
            
        except Exception as e:
            self.log(f"IDM user sync failed: {e}", "ERROR")
            self.executor._update_idm_sync_status(success=False, error=str(e))
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
    
    def execute_idm_search_groups(self, job: Dict):
        """Search for groups in FreeIPA LDAP."""
        try:
            self.log(f"Starting IDM group search job: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            details = job.get('details') or {}
            search_term = details.get('search_term', '')
            max_results = details.get('max_results', 100)
            
            # Get IDM settings
            idm_settings = self.executor.get_idm_settings()
            if not idm_settings:
                raise ValueError("IDM not configured")
            
            bind_dn = idm_settings.get('bind_dn')
            bind_password = self.executor.decrypt_bind_password(
                idm_settings.get('bind_password_encrypted')
            )
            
            if not bind_dn or not bind_password:
                raise ValueError("Service account credentials required")
            
            authenticator = self.executor.create_freeipa_authenticator(idm_settings)
            if not authenticator:
                raise ValueError("Failed to initialize FreeIPA authenticator")
            
            # Search groups
            self.log(f"Searching groups matching: '{search_term}' (max {max_results})")
            groups = authenticator.search_groups(bind_dn, bind_password, search_term, max_results)
            
            self.log(f"[OK] Found {len(groups)} group(s)")
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details={'groups': groups, 'count': len(groups)}
            )
            
        except Exception as e:
            self.log(f"IDM group search failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e), 'groups': []}
            )

    def _test_dns_resolution(self, hostname: str) -> dict:
        """Test DNS resolution for hostname."""
        try:
            start = time.time()
            ip_addresses = socket.getaddrinfo(hostname, None)
            elapsed = (time.time() - start) * 1000
            resolved_ips = list(set(addr[4][0] for addr in ip_addresses))
            return {
                'success': True,
                'resolved_ips': resolved_ips,
                'response_time_ms': round(elapsed, 2),
                'message': f'Resolved to {len(resolved_ips)} address(es): {", ".join(resolved_ips[:3])}'
            }
        except socket.gaierror as e:
            return {'success': False, 'error': str(e), 'message': f'DNS resolution failed: {e}'}
        except Exception as e:
            return {'success': False, 'error': str(e), 'message': f'DNS error: {e}'}

    def _test_port_connectivity(self, host: str, port: int, timeout: int = 5) -> dict:
        """Test TCP connectivity to port."""
        try:
            start = time.time()
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            result = sock.connect_ex((host, port))
            elapsed = (time.time() - start) * 1000
            sock.close()
            
            if result == 0:
                return {
                    'success': True,
                    'response_time_ms': round(elapsed, 2),
                    'message': f'Port {port} is accessible ({round(elapsed)}ms)'
                }
            else:
                return {
                    'success': False,
                    'error_code': result,
                    'message': f'Port {port} is not accessible (error code: {result}) - check firewall'
                }
        except socket.timeout:
            return {'success': False, 'error': 'Connection timed out', 'message': f'Port {port} connection timed out after {timeout}s'}
        except Exception as e:
            return {'success': False, 'error': str(e), 'message': f'Connection failed: {e}'}

    def _test_ssl_certificate(self, host: str, port: int, timeout: int = 5) -> dict:
        """Test SSL certificate validity."""
        try:
            start = time.time()
            context = ssl.create_default_context()
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE  # Allow self-signed
            
            with socket.create_connection((host, port), timeout=timeout) as sock:
                with context.wrap_socket(sock, server_hostname=host) as ssock:
                    elapsed = (time.time() - start) * 1000
                    cert = ssock.getpeercert(binary_form=False)
                    cipher = ssock.cipher()
                    return {
                        'success': True,
                        'response_time_ms': round(elapsed, 2),
                        'message': f'SSL handshake successful ({cipher[0] if cipher else "unknown cipher"})',
                        'cipher': cipher[0] if cipher else None,
                    }
        except ssl.SSLError as e:
            return {'success': False, 'error': str(e), 'message': f'SSL error: {e}'}
        except socket.timeout:
            return {'success': False, 'error': 'Connection timed out', 'message': f'SSL connection timed out after {timeout}s'}
        except Exception as e:
            return {'success': False, 'error': str(e), 'message': f'SSL connection failed: {e}'}

    def execute_idm_network_check(self, job: Dict):
        """Perform network connectivity checks for FreeIPA and AD DC servers."""
        job_id = job['id']
        start_time = datetime.now()
        
        try:
            self.log(f"Starting IDM network connectivity check: {job_id}")
            self.update_job_status(job_id, 'running', started_at=start_time.isoformat())
            
            details = job.get('details') or {}
            results = {
                'freeipa': {},
                'ad_dc': {},
                'summary': {}
            }
            
            # === FreeIPA Server Tests ===
            ipa_host = details.get('server_host')
            ipa_use_ssl = details.get('use_ldaps', True)
            ipa_port = details.get('ldaps_port', 636) if ipa_use_ssl else details.get('server_port', 389)
            
            if ipa_host:
                self.log(f"Testing FreeIPA connectivity: {ipa_host}:{ipa_port} (SSL: {ipa_use_ssl})")
                
                # DNS Resolution
                self.log(f"  [1/3] DNS resolution for {ipa_host}...")
                results['freeipa']['dns'] = self._test_dns_resolution(ipa_host)
                self._log_ldap_operation(
                    job_id=job_id,
                    endpoint='/network/dns',
                    full_url=f"dns://{ipa_host}",
                    success=results['freeipa']['dns'].get('success', False),
                    response_time_ms=int(results['freeipa']['dns'].get('response_time_ms', 0)),
                    response_body=results['freeipa']['dns'],
                    command_type='network_dns'
                )
                
                # Port Connectivity
                self.log(f"  [2/3] Port connectivity to {ipa_host}:{ipa_port}...")
                results['freeipa']['port'] = self._test_port_connectivity(ipa_host, ipa_port)
                self._log_ldap_operation(
                    job_id=job_id,
                    endpoint='/network/port',
                    full_url=self._build_ldap_url(ipa_host, ipa_port, ipa_use_ssl),
                    success=results['freeipa']['port'].get('success', False),
                    response_time_ms=int(results['freeipa']['port'].get('response_time_ms', 0)),
                    response_body=results['freeipa']['port'],
                    command_type='network_port'
                )
                
                # SSL Certificate (if LDAPS)
                if ipa_use_ssl:
                    self.log(f"  [3/3] SSL handshake to {ipa_host}:{ipa_port}...")
                    results['freeipa']['ssl'] = self._test_ssl_certificate(ipa_host, ipa_port)
                    self._log_ldap_operation(
                        job_id=job_id,
                        endpoint='/network/ssl',
                        full_url=self._build_ldap_url(ipa_host, ipa_port, ipa_use_ssl),
                        success=results['freeipa']['ssl'].get('success', False),
                        response_time_ms=int(results['freeipa']['ssl'].get('response_time_ms', 0)),
                        response_body=results['freeipa']['ssl'],
                        command_type='network_ssl'
                    )
                
                # Log summary for FreeIPA
                ipa_results = [f"{k}: {'✓' if v.get('success') else '✗'}" for k, v in results['freeipa'].items()]
                self.log(f"  FreeIPA results: {', '.join(ipa_results)}")
            
            # === AD DC Tests (if configured) ===
            ad_host = details.get('ad_dc_host')
            ad_port = details.get('ad_dc_port', 389)
            ad_use_ssl = details.get('ad_dc_use_ssl', False)
            
            if ad_host:
                self.log(f"Testing AD DC connectivity: {ad_host}:{ad_port} (SSL: {ad_use_ssl})")
                
                # DNS Resolution
                self.log(f"  [1/3] DNS resolution for {ad_host}...")
                results['ad_dc']['dns'] = self._test_dns_resolution(ad_host)
                self._log_ldap_operation(
                    job_id=job_id,
                    endpoint='/network/ad_dc/dns',
                    full_url=f"dns://{ad_host}",
                    success=results['ad_dc']['dns'].get('success', False),
                    response_time_ms=int(results['ad_dc']['dns'].get('response_time_ms', 0)),
                    response_body=results['ad_dc']['dns'],
                    command_type='network_ad_dns'
                )
                
                # Port Connectivity
                self.log(f"  [2/3] Port connectivity to {ad_host}:{ad_port}...")
                results['ad_dc']['port'] = self._test_port_connectivity(ad_host, ad_port)
                self._log_ldap_operation(
                    job_id=job_id,
                    endpoint='/network/ad_dc/port',
                    full_url=self._build_ldap_url(ad_host, ad_port, ad_use_ssl),
                    success=results['ad_dc']['port'].get('success', False),
                    response_time_ms=int(results['ad_dc']['port'].get('response_time_ms', 0)),
                    response_body=results['ad_dc']['port'],
                    command_type='network_ad_port'
                )
                
                # SSL Certificate (if LDAPS)
                if ad_use_ssl:
                    self.log(f"  [3/3] SSL handshake to {ad_host}:{ad_port}...")
                    results['ad_dc']['ssl'] = self._test_ssl_certificate(ad_host, ad_port)
                    self._log_ldap_operation(
                        job_id=job_id,
                        endpoint='/network/ad_dc/ssl',
                        full_url=self._build_ldap_url(ad_host, ad_port, ad_use_ssl),
                        success=results['ad_dc']['ssl'].get('success', False),
                        response_time_ms=int(results['ad_dc']['ssl'].get('response_time_ms', 0)),
                        response_body=results['ad_dc']['ssl'],
                        command_type='network_ad_ssl'
                    )
                
                # Log summary for AD DC
                ad_results = [f"{k}: {'✓' if v.get('success') else '✗'}" for k, v in results['ad_dc'].items()]
                self.log(f"  AD DC results: {', '.join(ad_results)}")
            
            # === Calculate Summary ===
            ipa_ok = all(r.get('success') for r in results['freeipa'].values()) if results['freeipa'] else False
            ad_ok = all(r.get('success') for r in results['ad_dc'].values()) if results['ad_dc'] else True
            
            results['summary'] = {
                'freeipa_reachable': ipa_ok,
                'ad_dc_reachable': ad_ok if ad_host else None,
                'ad_dc_configured': bool(ad_host),
                'all_tests_passed': ipa_ok and (ad_ok if ad_host else True),
                'total_time_ms': int((datetime.now() - start_time).total_seconds() * 1000)
            }
            
            status = 'completed' if results['summary']['all_tests_passed'] else 'completed'  # Always complete, success is in results
            self.log(f"Network check completed: {'All tests passed' if results['summary']['all_tests_passed'] else 'Some tests failed'}")
            
            self.update_job_status(
                job_id,
                status,
                completed_at=datetime.now().isoformat(),
                details={'network_results': results}
            )
            
        except Exception as e:
            self.log(f"IDM network check failed: {e}", "ERROR")
            self.update_job_status(
                job_id,
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e), 'network_results': {}}
            )
