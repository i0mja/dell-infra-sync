"""IDM (FreeIPA/LDAP) authentication and sync handlers"""

from typing import Dict, Optional
from datetime import datetime
from .base import BaseHandler


class IDMHandler(BaseHandler):
    """Handles IDM authentication, testing, and user sync operations"""
    
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
            
            # Authenticate user
            self.log(f"Authenticating user '{username}' against FreeIPA: {idm_settings['server_host']}")
            auth_result = authenticator.authenticate_user(username, password)
            
            if auth_result['success']:
                self.log(f"[OK] User '{username}' authenticated successfully")
                self.log(f"  User DN: {auth_result.get('user_dn')}")
                self.log(f"  Groups: {len(auth_result.get('groups', []))} group(s)")
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
        try:
            self.log(f"Starting IDM test authentication job: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            details = job.get('details') or {}
            username = details.get('username')
            password = details.get('password')
            
            if not username or not password:
                raise ValueError("Username and password required")
            
            # Get IDM settings
            idm_settings = self.executor.get_idm_settings()
            if not idm_settings:
                raise ValueError("IDM not configured")
            
            # Create authenticator
            authenticator = self.executor.create_freeipa_authenticator(idm_settings)
            if not authenticator:
                raise ValueError("Failed to initialize FreeIPA authenticator")
            
            # Authenticate user
            self.log(f"Testing authentication for user '{username}'")
            auth_result = authenticator.authenticate_user(username, password)
            
            if not auth_result['success']:
                self.log(f"[X] Test authentication failed: {auth_result.get('error')}", "WARN")
                self.update_job_status(
                    job['id'],
                    'completed',
                    completed_at=datetime.now().isoformat(),
                    details={'test_result': auth_result, 'username': username}
                )
                return
            
            self.log(f"[OK] Test authentication successful for '{username}'")
            self.log(f"  User DN: {auth_result.get('user_dn')}")
            self.log(f"  Full Name: {auth_result.get('full_name', 'N/A')}")
            self.log(f"  Email: {auth_result.get('email', 'N/A')}")
            self.log(f"  Groups: {len(auth_result.get('groups', []))} group(s)")
            
            # Simulate role mapping (read from idm_group_mappings)
            user_groups = auth_result.get('groups', [])
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
                'is_test': True,
            }
            
            self.log(f"[OK] Test completed - would assign role: {mapped_role}")
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details={'test_result': test_result, 'username': username}
            )
            
        except Exception as e:
            self.log(f"IDM test authentication failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={
                    'error': str(e),
                    'test_result': {'success': False, 'error': str(e)}
                }
            )
    
    def execute_idm_test_connection(self, job: Dict):
        """Test FreeIPA LDAP connection with service account."""
        try:
            self.log(f"Starting IDM connection test job: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            details = job.get('details') or {}
            
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
            
            # Build authenticator settings
            auth_settings = details if details.get('server_host') else self.executor.get_idm_settings()
            if details.get('server_host'):
                # Add defaults for testing
                auth_settings.setdefault('base_dn', details.get('base_dn', 'dc=example,dc=com'))
                auth_settings.setdefault('use_ldaps', details.get('use_ldaps', True))
            
            authenticator = self.executor.create_freeipa_authenticator(auth_settings)
            if not authenticator:
                raise ValueError("Failed to initialize FreeIPA authenticator")
            
            # Test connection
            self.log(f"Testing connection to FreeIPA: {server_host}")
            test_result = authenticator.test_connection(bind_dn, bind_password)
            
            if test_result['success']:
                self.log(f"[OK] FreeIPA connection successful")
                self.log(f"  Server: {test_result.get('server_info', {}).get('vendor', 'Unknown')}")
                self.log(f"  Response time: {test_result.get('response_time_ms', 0)}ms")
            else:
                self.log(f"[X] FreeIPA connection failed: {test_result.get('message')}", "ERROR")
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details={'test_result': test_result}
            )
            
        except Exception as e:
            self.log(f"IDM connection test failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
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
