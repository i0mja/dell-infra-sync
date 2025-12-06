"""HTTP API Server for instant operations"""

import json
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread
from typing import Dict
from datetime import datetime, timezone
import ssl


class APIHandler(BaseHTTPRequestHandler):
    """HTTP request handler for instant operations"""
    
    executor = None  # Will be set by APIServer
    
    def _set_headers(self, status=200, content_type='application/json'):
        """Set response headers with CORS"""
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()
    
    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self._set_headers()
    
    def _send_json(self, data: Dict, status=200):
        """Send JSON response"""
        self._set_headers(status)
        self.wfile.write(json.dumps(data).encode('utf-8'))
    
    def _send_error(self, message: str, status=500):
        """Send error response"""
        self._send_json({'error': message, 'success': False}, status)
    
    def _read_json_body(self) -> Dict:
        """Read and parse JSON request body"""
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        return json.loads(body.decode('utf-8'))
    
    def _log_operation(
        self,
        server_id: str,
        operation_name: str,
        endpoint: str,
        full_url: str,
        request_body: Dict,
        status_code: int,
        response_time_ms: int,
        response_body: Dict,
        success: bool,
        error_message: str = None,
        operation_type: str = 'idrac_api'
    ):
        """Log an instant API operation to the activity monitor"""
        try:
            self.executor.log_idrac_command(
                server_id=server_id,
                job_id=None,  # No job for instant operations
                task_id=None,
                command_type=operation_name,
                endpoint=endpoint,
                full_url=full_url,
                request_headers=None,
                request_body=request_body,
                status_code=status_code,
                response_time_ms=response_time_ms,
                response_body=response_body,
                success=success,
                error_message=error_message,
                operation_type=operation_type,
                source='instant_api'
            )
        except Exception as e:
            self.executor.log(f"Failed to log API operation: {e}", "ERROR")
    
    def do_POST(self):
        """Handle POST requests"""
        try:
            if self.path == '/api/console-launch':
                self._handle_console_launch()
            elif self.path == '/api/power-control':
                self._handle_power_control()
            elif self.path == '/api/connectivity-test':
                self._handle_connectivity_test()
            elif self.path == '/api/browse-datastore':
                self._handle_browse_datastore()
            elif self.path == '/api/idm-authenticate':
                self._handle_idm_authenticate()
            elif self.path == '/api/network-config-read':
                self._handle_network_config_read()
            elif self.path == '/api/network-config-write':
                self._handle_network_config_write()
            elif self.path == '/api/health-check':
                self._handle_health_check()
            elif self.path == '/api/event-logs':
                self._handle_event_logs()
            elif self.path == '/api/boot-config-read':
                self._handle_boot_config_read()
            elif self.path == '/api/bios-config-read':
                self._handle_bios_config_read()
            elif self.path == '/api/firmware-inventory':
                self._handle_firmware_inventory()
            elif self.path == '/api/idrac-jobs':
                self._handle_idrac_jobs()
            elif self.path == '/api/preflight-check':
                self._handle_preflight_check()
            else:
                self._send_error(f'Unknown endpoint: {self.path}', 404)
        except Exception as e:
            self.executor.log(f"API error: {e}", "ERROR")
            self.executor.log(f"Traceback: {traceback.format_exc()}", "ERROR")
            self._send_error(str(e), 500)
    
    def do_GET(self):
        """Handle GET requests"""
        try:
            if self.path == '/api/health':
                self._send_json({'status': 'ok', 'version': '1.0.0'})
            elif self.path.startswith('/api/preflight-check-stream'):
                self._handle_preflight_check_stream()
            else:
                self._send_error(f'Unknown endpoint: {self.path}', 404)
        except Exception as e:
            self.executor.log(f"API error: {e}", "ERROR")
            self._send_error(str(e), 500)
    
    def _handle_console_launch(self):
        """Launch iDRAC console"""
        start_time = datetime.now()
        data = self._read_json_body()
        server_id = data.get('server_id')
        
        if not server_id:
            self._send_error('server_id is required', 400)
            return
        
        self.executor.log(f"API: Console launch for server {server_id}")
        
        try:
            # Get server and credentials
            server = self.executor.get_server_by_id(server_id)
            if not server:
                self._send_error(f'Server {server_id} not found', 404)
                return
            
            username, password = self.executor.get_server_credentials(server_id)
            if not username or not password:
                self._send_error('No credentials available for server', 400)
                return
            
            ip_address = server['ip_address']
            
            # Get KVM launch info using Dell Redfish operations
            dell_ops = self.executor._get_dell_operations()
            kvm_info = dell_ops.get_kvm_launch_info(
                ip=ip_address,
                username=username,
                password=password,
                server_id=server_id,
                job_id=None  # No job for instant operations
            )
            
            console_url = kvm_info.get('console_url')
            
            if not console_url:
                self._send_error('No console URL returned from KVM launch endpoint', 500)
                return
            
            # Success response
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            response = {
                'success': True,
                'console_url': console_url,
                'server_id': server_id,
                'ip_address': ip_address,
                'session_type': kvm_info.get('session_type', 'HTML5'),
                'requires_login': kvm_info.get('requires_login', False),
                'message': kvm_info.get('message')
            }
            
            # Log operation
            self._log_operation(
                server_id=server_id,
                operation_name='console_launch',
                endpoint='/api/console-launch',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/console-launch',
                request_body=data,
                status_code=200,
                response_time_ms=response_time_ms,
                response_body=response,
                success=True,
                operation_type='idrac_api'
            )
            
            self._send_json(response)
            
        except Exception as e:
            self.executor.log(f"Console launch failed: {e}", "ERROR")
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # Log failed operation
            self._log_operation(
                server_id=server_id,
                operation_name='console_launch',
                endpoint='/api/console-launch',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/console-launch',
                request_body=data,
                status_code=500,
                response_time_ms=response_time_ms,
                response_body={'error': str(e)},
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            
            self._send_error(str(e), 500)
    
    def _handle_power_control(self):
        """Control server power"""
        start_time = datetime.now()
        data = self._read_json_body()
        server_id = data.get('server_id')
        action = data.get('action')
        
        if not server_id or not action:
            self._send_error('server_id and action are required', 400)
            return
        
        self.executor.log(f"API: Power {action} for server {server_id}")
        
        try:
            # Get server and credentials
            server = self.executor.get_server_by_id(server_id)
            if not server:
                self._send_error(f'Server {server_id} not found', 404)
                return
            
            username, password = self.executor.get_server_credentials(server_id)
            if not username or not password:
                self._send_error('No credentials available for server', 400)
                return
            
            ip_address = server['ip_address']
            
            # Execute power action using Dell Redfish operations
            dell_ops = self.executor._get_dell_operations()
            
            # Map action to Redfish reset type
            action_map = {
                'on': 'On',
                'off': 'ForceOff',
                'graceful_shutdown': 'GracefulShutdown',
                'reset': 'ForceRestart',
                'graceful_restart': 'GracefulRestart',
            }
            
            reset_type = action_map.get(action.lower())
            if not reset_type:
                self._send_error(f'Invalid action: {action}', 400)
                return
            
            result = dell_ops.set_power_state(
                ip=ip_address,
                username=username,
                password=password,
                reset_type=reset_type,
                server_id=server_id,
                job_id=None
            )
            
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            if result.get('success'):
                response = {
                    'success': True,
                    'action': action,
                    'server_id': server_id,
                    'message': result.get('message', 'Power action completed')
                }
                
                # Log successful operation
                self._log_operation(
                    server_id=server_id,
                    operation_name=f'power_{action}',
                    endpoint='/api/power-control',
                    full_url=f'http://localhost:{self.executor.api_server.port}/api/power-control',
                    request_body=data,
                    status_code=200,
                    response_time_ms=response_time_ms,
                    response_body=response,
                    success=True,
                    operation_type='idrac_api'
                )
                
                self._send_json(response)
            else:
                error_msg = result.get('error', 'Power action failed')
                
                # Log failed operation
                self._log_operation(
                    server_id=server_id,
                    operation_name=f'power_{action}',
                    endpoint='/api/power-control',
                    full_url=f'http://localhost:{self.executor.api_server.port}/api/power-control',
                    request_body=data,
                    status_code=500,
                    response_time_ms=response_time_ms,
                    response_body={'error': error_msg},
                    success=False,
                    error_message=error_msg,
                    operation_type='idrac_api'
                )
                
                self._send_error(error_msg, 500)
                
        except Exception as e:
            self.executor.log(f"Power control failed: {e}", "ERROR")
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # Log exception
            self._log_operation(
                server_id=server_id,
                operation_name=f'power_{action}',
                endpoint='/api/power-control',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/power-control',
                request_body=data,
                status_code=500,
                response_time_ms=response_time_ms,
                response_body={'error': str(e)},
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            
            self._send_error(str(e), 500)
    
    def _handle_connectivity_test(self):
        """Test server connectivity"""
        start_time = datetime.now()
        data = self._read_json_body()
        server_id = data.get('server_id')
        
        if not server_id:
            self._send_error('server_id is required', 400)
            return
        
        self.executor.log(f"API: Connectivity test for server {server_id}")
        
        try:
            # Get server
            server = self.executor.get_server_by_id(server_id)
            if not server:
                self._send_error(f'Server {server_id} not found', 404)
                return
            
            ip_address = server['ip_address']
            
            # Test connectivity
            result = self.executor.test_idrac_connectivity(ip_address)
            
            # Update server status in database
            if result.get('reachable'):
                self.executor.update_server_status(
                    server_id,
                    'online',
                    datetime.now().isoformat()
                )
            else:
                self.executor.update_server_status(
                    server_id,
                    'offline',
                    None
                )
            
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            response = {
                'success': True,
                'server_id': server_id,
                'ip_address': ip_address,
                'reachable': result.get('reachable', False),
                'response_time_ms': result.get('response_time_ms'),
                'message': result.get('message')
            }
            
            # Log operation
            self._log_operation(
                server_id=server_id,
                operation_name='connectivity_test',
                endpoint='/api/connectivity-test',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/connectivity-test',
                request_body=data,
                status_code=200,
                response_time_ms=response_time_ms,
                response_body=response,
                success=True,
                operation_type='idrac_api'
            )
            
            self._send_json(response)
            
        except Exception as e:
            self.executor.log(f"Connectivity test failed: {e}", "ERROR")
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # Log failed operation
            self._log_operation(
                server_id=server_id,
                operation_name='connectivity_test',
                endpoint='/api/connectivity-test',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/connectivity-test',
                request_body=data,
                status_code=500,
                response_time_ms=response_time_ms,
                response_body={'error': str(e)},
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            
            self._send_error(str(e), 500)
    
    def _handle_browse_datastore(self):
        """Browse vCenter datastore"""
        start_time = datetime.now()
        data = self._read_json_body()
        vcenter_id = data.get('vcenter_id')
        datastore_name = data.get('datastore_name')
        folder_path = data.get('folder_path', '')
        file_patterns = data.get('file_patterns', ['*.zip', '*.iso'])
        
        if not vcenter_id or not datastore_name:
            self._send_error('vcenter_id and datastore_name are required', 400)
            return
        
        self.executor.log(f"API: Browse datastore {datastore_name}")
        
        try:
            from pyVim.connect import Disconnect
            from pyVmomi import vim
            import time
            
            # Get vCenter settings
            vcenter_settings = self.executor.get_vcenter_settings(vcenter_id)
            if not vcenter_settings:
                self._send_error(f'vCenter {vcenter_id} not found', 404)
                return
            
            # Connect to vCenter
            si = self.executor._connect_vcenter(vcenter_settings)
            content = si.RetrieveContent()
            
            # Find datastore
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.Datastore], True
            )
            
            datastore = None
            for ds in container.view:
                if ds.summary.name == datastore_name:
                    datastore = ds
                    break
            
            container.Destroy()
            
            if not datastore:
                Disconnect(si)
                self._send_error(f"Datastore '{datastore_name}' not found", 404)
                return
            
            # Browse datastore
            browser = datastore.browser
            search_spec = vim.host.DatastoreBrowser.SearchSpec()
            search_spec.matchPattern = file_patterns
            search_spec.sortFoldersFirst = True
            
            datastore_path = f"[{datastore_name}] {folder_path}"
            task = browser.SearchDatastoreSubFolders_Task(datastore_path, search_spec)
            
            # Wait for task
            while task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
                time.sleep(0.5)
            
            if task.info.state == vim.TaskInfo.State.error:
                Disconnect(si)
                self._send_error(f"Datastore browse failed: {task.info.error.msg}", 500)
                return
            
            # Collect results
            files = []
            results = task.info.result
            
            for folder_result in results:
                folder_path_result = folder_result.folderPath
                
                if hasattr(folder_result, 'file') and folder_result.file:
                    for file_info in folder_result.file:
                        full_path = f"{folder_path_result}{file_info.path}"
                        
                        files.append({
                            'name': file_info.path,
                            'size': file_info.fileSize if hasattr(file_info, 'fileSize') else 0,
                            'modified': file_info.modification.isoformat() if hasattr(file_info, 'modification') else None,
                            'folder': folder_path_result,
                            'full_path': full_path,
                            'is_directory': isinstance(file_info, vim.host.DatastoreBrowser.FolderInfo)
                        })
            
            Disconnect(si)
            
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            response = {
                'success': True,
                'datastore_name': datastore_name,
                'files': files,
                'total_files': len(files)
            }
            
            # Log operation (no server_id for datastore browsing)
            self._log_operation(
                server_id=None,
                operation_name='browse_datastore',
                endpoint='/api/browse-datastore',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/browse-datastore',
                request_body=data,
                status_code=200,
                response_time_ms=response_time_ms,
                response_body={'datastore': datastore_name, 'file_count': len(files)},
                success=True,
                operation_type='vcenter_api'
            )
            
            self._send_json(response)
            
        except Exception as e:
            self.executor.log(f"Datastore browse failed: {e}", "ERROR")
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # Log failed operation
            self._log_operation(
                server_id=None,
                operation_name='browse_datastore',
                endpoint='/api/browse-datastore',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/browse-datastore',
                request_body=data,
                status_code=500,
                response_time_ms=response_time_ms,
                response_body={'error': str(e)},
                success=False,
                error_message=str(e),
                operation_type='vcenter_api'
            )
            
            self._send_error(str(e), 500)
    
    def _handle_idm_authenticate(self):
        """Authenticate user against FreeIPA/AD directly (synchronous)"""
        start_time = datetime.now()
        data = self._read_json_body()
        username = data.get('username')
        password = data.get('password')
        
        if not username or not password:
            self._send_error('username and password are required', 400)
            return
        
        self.executor.log(f"API: IDM authenticate for {username}")
        
        try:
            # Load IDM settings from database
            idm_settings = self.executor.get_idm_settings()
            if not idm_settings:
                self._send_error('IDM authentication not configured', 503)
                return
            
            if idm_settings.get('auth_mode') == 'local_only':
                self._send_error('IDM authentication not enabled', 403)
                return
            
            # Initialize FreeIPA authenticator
            from job_executor.ldap_auth import FreeIPAAuthenticator, LDAP3_AVAILABLE
            
            if not LDAP3_AVAILABLE:
                self._send_error('LDAP3 library not installed on Job Executor', 503)
                return
            
            authenticator = FreeIPAAuthenticator(
                server_host=idm_settings.get('server_host'),
                base_dn=idm_settings.get('base_dn'),
                user_search_base=idm_settings.get('user_search_base', 'cn=users,cn=accounts'),
                group_search_base=idm_settings.get('group_search_base', 'cn=groups,cn=accounts'),
                use_ldaps=idm_settings.get('use_ldaps', True),
                ldaps_port=idm_settings.get('ldaps_port', 636),
                ldap_port=idm_settings.get('server_port', 389),
                verify_certificate=idm_settings.get('verify_certificate', False),
                ca_certificate=idm_settings.get('ca_certificate'),
                connection_timeout=idm_settings.get('connection_timeout_seconds', 10),
                trusted_domains=idm_settings.get('trusted_domains', []),
                ad_dc_host=idm_settings.get('ad_dc_host'),
                ad_dc_port=idm_settings.get('ad_dc_port', 636),
                ad_dc_use_ssl=idm_settings.get('ad_dc_use_ssl', True),
                ad_domain_fqdn=idm_settings.get('ad_domain_fqdn'),
            )
            
            # Decrypt service account password for FreeIPA group lookup after AD auth
            bind_dn = idm_settings.get('bind_dn')
            bind_password_encrypted = idm_settings.get('bind_password_encrypted')
            bind_password = None
            
            if bind_dn and bind_password_encrypted:
                try:
                    bind_password = self.executor.decrypt_password(bind_password_encrypted)
                    self.executor.log(f"Service account credentials available for group lookup: {bind_dn}", "DEBUG")
                except Exception as e:
                    self.executor.log(f"Failed to decrypt service account password: {e}", "WARNING")
            
            # Perform authentication with service account for group lookup
            auth_result = authenticator.authenticate_user(
                username=username,
                password=password,
                service_bind_dn=bind_dn,
                service_bind_password=bind_password
            )
            
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # Log operation to activity monitor
            self._log_operation(
                server_id=None,
                operation_name='idm_authenticate',
                endpoint='/api/idm-authenticate',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/idm-authenticate',
                request_body={'username': username},  # Don't log password
                status_code=200 if auth_result.get('success') else 401,
                response_time_ms=response_time_ms,
                response_body={
                    'success': auth_result.get('success'),
                    'user_dn': auth_result.get('user_dn'),
                    'is_ad_trust_user': auth_result.get('is_ad_trust_user', False),
                },
                success=auth_result.get('success', False),
                error_message=auth_result.get('error') if not auth_result.get('success') else None,
                operation_type='idm_api'
            )
            
            if auth_result.get('success'):
                # Normalize identity to get realm and canonical_principal for AD users
                realm = auth_result.get('realm')
                canonical_principal = auth_result.get('canonical_principal')
                
                if not realm or not canonical_principal:
                    try:
                        normalized = authenticator.normalize_identity(username)
                        if normalized:
                            realm = getattr(normalized, 'realm', None) or realm
                            canonical_principal = getattr(normalized, 'canonical_principal', None) or canonical_principal
                            self.executor.log(f"Normalized identity: {canonical_principal} (realm: {realm})", "DEBUG")
                    except Exception as e:
                        self.executor.log(f"Identity normalization failed (non-fatal): {e}", "WARNING")
                
                # Return auth result for provisioning
                response = {
                    'success': True,
                    'user_dn': auth_result.get('user_dn'),
                    'user_info': auth_result.get('user_info', {}),
                    'groups': auth_result.get('groups', []),
                    'is_ad_trust_user': auth_result.get('is_ad_trust_user', False),
                    'ad_domain': auth_result.get('ad_domain'),
                    'realm': realm,
                    'canonical_principal': canonical_principal,
                    'response_time_ms': response_time_ms,
                }
                self._send_json(response)
            else:
                self._send_json({
                    'success': False,
                    'error': auth_result.get('error', 'Authentication failed'),
                    'error_details': auth_result.get('error_details'),
                    'response_time_ms': response_time_ms,
                }, 401)
                
        except Exception as e:
            self.executor.log(f"IDM authenticate failed: {e}", "ERROR")
            self.executor.log(f"Traceback: {traceback.format_exc()}", "ERROR")
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # Log failed operation
            self._log_operation(
                server_id=None,
                operation_name='idm_authenticate',
                endpoint='/api/idm-authenticate',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/idm-authenticate',
                request_body={'username': username},
                status_code=500,
                response_time_ms=response_time_ms,
                response_body={'error': str(e)},
                success=False,
                error_message=str(e),
                operation_type='idm_api'
            )
            
            self._send_error(str(e), 500)
    
    def _handle_network_config_read(self):
        """Read iDRAC network configuration instantly"""
        start_time = datetime.now()
        data = self._read_json_body()
        server_id = data.get('server_id')
        
        if not server_id:
            self._send_error('server_id is required', 400)
            return
        
        self.executor.log(f"API: Network config read for server {server_id}")
        
        try:
            # Get server and credentials
            server = self.executor.get_server_by_id(server_id)
            if not server:
                self._send_error(f'Server {server_id} not found', 404)
                return
            
            username, password = self.executor.get_server_credentials(server_id)
            if not username or not password:
                self._send_error('No credentials available for server', 400)
                return
            
            ip_address = server['ip_address']
            
            # Get network settings using Dell Redfish operations
            dell_ops = self.executor._get_dell_operations()
            network_data = dell_ops.get_idrac_network_settings(
                ip=ip_address,
                username=username,
                password=password,
                server_id=server_id,
                job_id=None
            )
            
            if not network_data:
                self._send_error('Failed to retrieve network settings', 500)
                return
            
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            response = {
                'success': True,
                'server_id': server_id,
                'ip_address': ip_address,
                'ipv4': network_data.get('ipv4', {}),
                'nic': network_data.get('nic', {}),
                'ntp': network_data.get('ntp', {}),
            }
            
            # Log operation
            self._log_operation(
                server_id=server_id,
                operation_name='network_config_read',
                endpoint='/api/network-config-read',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/network-config-read',
                request_body=data,
                status_code=200,
                response_time_ms=response_time_ms,
                response_body={'success': True},
                success=True,
                operation_type='idrac_api'
            )
            
            self._send_json(response)
            
        except Exception as e:
            self.executor.log(f"Network config read failed: {e}", "ERROR")
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # Log failed operation
            self._log_operation(
                server_id=server_id,
                operation_name='network_config_read',
                endpoint='/api/network-config-read',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/network-config-read',
                request_body=data,
                status_code=500,
                response_time_ms=response_time_ms,
                response_body={'error': str(e)},
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            
            self._send_error(str(e), 500)
    
    def _handle_network_config_write(self):
        """Write iDRAC network configuration instantly"""
        start_time = datetime.now()
        data = self._read_json_body()
        server_id = data.get('server_id')
        changes = data.get('changes', {})
        
        if not server_id:
            self._send_error('server_id is required', 400)
            return
        
        if not changes:
            self._send_error('changes dict is required', 400)
            return
        
        self.executor.log(f"API: Network config write for server {server_id}")
        self.executor.log(f"  Changes to apply: {list(changes.keys())}")
        
        try:
            # Get server and credentials
            server = self.executor.get_server_by_id(server_id)
            if not server:
                self._send_error(f'Server {server_id} not found', 404)
                return
            
            username, password = self.executor.get_server_credentials(server_id)
            if not username or not password:
                self._send_error('No credentials available for server', 400)
                return
            
            ip_address = server['ip_address']
            
            # Apply network settings using Dell Redfish operations
            dell_ops = self.executor._get_dell_operations()
            result = dell_ops.set_idrac_network_settings(
                ip=ip_address,
                username=username,
                password=password,
                settings=changes,
                server_id=server_id,
                job_id=None
            )
            
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            if result.get('success'):
                # Check if IP address was changed
                ip_changed = 'IPv4.1.Address' in changes
                new_ip = changes.get('IPv4.1.Address')
                
                # Update server record if IP changed
                if ip_changed and new_ip:
                    try:
                        import requests
                        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
                        
                        update_resp = requests.patch(
                            f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}",
                            json={'ip_address': new_ip},
                            headers={
                                'apikey': SERVICE_ROLE_KEY,
                                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                'Content-Type': 'application/json',
                                'Prefer': 'return=minimal'
                            },
                            verify=VERIFY_SSL,
                            timeout=10
                        )
                        if update_resp.ok:
                            self.executor.log(f"  Updated server IP to {new_ip}")
                        else:
                            self.executor.log(f"  Failed to update server IP: {update_resp.text}", "WARN")
                    except Exception as update_err:
                        self.executor.log(f"  Error updating server IP: {update_err}", "WARN")
                
                response = {
                    'success': True,
                    'server_id': server_id,
                    'applied_changes': list(changes.keys()),
                    'ip_changed': ip_changed,
                    'new_ip': new_ip if ip_changed else None,
                    'message': result.get('message', 'Network settings applied successfully')
                }
                
                # Log successful operation
                self._log_operation(
                    server_id=server_id,
                    operation_name='network_config_write',
                    endpoint='/api/network-config-write',
                    full_url=f'http://localhost:{self.executor.api_server.port}/api/network-config-write',
                    request_body={'server_id': server_id, 'changes_count': len(changes)},
                    status_code=200,
                    response_time_ms=response_time_ms,
                    response_body={'success': True, 'applied_changes': list(changes.keys())},
                    success=True,
                    operation_type='idrac_api'
                )
                
                self._send_json(response)
            else:
                error_msg = result.get('error', 'Failed to apply network settings')
                
                # Log failed operation
                self._log_operation(
                    server_id=server_id,
                    operation_name='network_config_write',
                    endpoint='/api/network-config-write',
                    full_url=f'http://localhost:{self.executor.api_server.port}/api/network-config-write',
                    request_body={'server_id': server_id, 'changes_count': len(changes)},
                    status_code=500,
                    response_time_ms=response_time_ms,
                    response_body={'error': error_msg},
                    success=False,
                    error_message=error_msg,
                    operation_type='idrac_api'
                )
                
                self._send_error(error_msg, 500)
                
        except Exception as e:
            self.executor.log(f"Network config write failed: {e}", "ERROR")
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # Log failed operation
            self._log_operation(
                server_id=server_id,
                operation_name='network_config_write',
                endpoint='/api/network-config-write',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/network-config-write',
                request_body={'server_id': server_id, 'changes_count': len(changes)},
                status_code=500,
                response_time_ms=response_time_ms,
                response_body={'error': str(e)},
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            
            self._send_error(str(e), 500)
    
    def _handle_health_check(self):
        """Get server health status instantly"""
        start_time = datetime.now()
        data = self._read_json_body()
        server_id = data.get('server_id')
        
        if not server_id:
            self._send_error('server_id is required', 400)
            return
        
        self.executor.log(f"API: Health check for server {server_id}")
        
        try:
            server = self.executor.get_server_by_id(server_id)
            if not server:
                self._send_error(f'Server {server_id} not found', 404)
                return
            
            username, password = self.executor.get_server_credentials(server_id)
            if not username or not password:
                self._send_error('No credentials available for server', 400)
                return
            
            ip_address = server['ip_address']
            dell_ops = self.executor._get_dell_operations()
            
            health_data = dell_ops.get_health_status(
                ip=ip_address,
                username=username,
                password=password,
                server_id=server_id,
                job_id=None
            )
            
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            response = {
                'success': True,
                'server_id': server_id,
                'ip_address': ip_address,
                'power_state': health_data.get('power_state'),
                'overall_health': health_data.get('overall_health'),
                'health_rollup': health_data.get('health_rollup'),
                'processor': health_data.get('processor'),
                'memory': health_data.get('memory'),
                'chassis_status': health_data.get('chassis_status'),
                'temperature_celsius': health_data.get('temperature_celsius'),
                'fan_health': health_data.get('fan_health'),
                'psu_health': health_data.get('psu_health'),
                'storage_health': health_data.get('storage_health'),
                'network_health': health_data.get('network_health'),
                'sensors': health_data.get('sensors'),
            }
            
            self._log_operation(
                server_id=server_id,
                operation_name='health_check',
                endpoint='/api/health-check',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/health-check',
                request_body=data,
                status_code=200,
                response_time_ms=response_time_ms,
                response_body={'success': True},
                success=True,
                operation_type='idrac_api'
            )
            
            self._send_json(response)
            
        except Exception as e:
            self.executor.log(f"Health check failed: {e}", "ERROR")
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            self._log_operation(
                server_id=server_id,
                operation_name='health_check',
                endpoint='/api/health-check',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/health-check',
                request_body=data,
                status_code=500,
                response_time_ms=response_time_ms,
                response_body={'error': str(e)},
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            self._send_error(str(e), 500)
    
    def _handle_event_logs(self):
        """Fetch system event logs instantly"""
        start_time = datetime.now()
        data = self._read_json_body()
        server_id = data.get('server_id')
        limit = data.get('limit', 50)
        
        if not server_id:
            self._send_error('server_id is required', 400)
            return
        
        self.executor.log(f"API: Event logs for server {server_id}")
        
        try:
            server = self.executor.get_server_by_id(server_id)
            if not server:
                self._send_error(f'Server {server_id} not found', 404)
                return
            
            username, password = self.executor.get_server_credentials(server_id)
            if not username or not password:
                self._send_error('No credentials available for server', 400)
                return
            
            ip_address = server['ip_address']
            dell_ops = self.executor._get_dell_operations()
            
            events = dell_ops.get_sel_logs(
                ip=ip_address,
                username=username,
                password=password,
                limit=limit,
                server_id=server_id,
                job_id=None
            )
            
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            response = {
                'success': True,
                'server_id': server_id,
                'events': events or [],
                'count': len(events) if events else 0,
            }
            
            self._log_operation(
                server_id=server_id,
                operation_name='event_logs',
                endpoint='/api/event-logs',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/event-logs',
                request_body=data,
                status_code=200,
                response_time_ms=response_time_ms,
                response_body={'success': True, 'count': len(events) if events else 0},
                success=True,
                operation_type='idrac_api'
            )
            
            self._send_json(response)
            
        except Exception as e:
            self.executor.log(f"Event logs fetch failed: {e}", "ERROR")
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            self._log_operation(
                server_id=server_id,
                operation_name='event_logs',
                endpoint='/api/event-logs',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/event-logs',
                request_body=data,
                status_code=500,
                response_time_ms=response_time_ms,
                response_body={'error': str(e)},
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            self._send_error(str(e), 500)
    
    def _handle_boot_config_read(self):
        """Read boot configuration instantly"""
        start_time = datetime.now()
        data = self._read_json_body()
        server_id = data.get('server_id')
        
        if not server_id:
            self._send_error('server_id is required', 400)
            return
        
        self.executor.log(f"API: Boot config read for server {server_id}")
        
        try:
            server = self.executor.get_server_by_id(server_id)
            if not server:
                self._send_error(f'Server {server_id} not found', 404)
                return
            
            username, password = self.executor.get_server_credentials(server_id)
            if not username or not password:
                self._send_error('No credentials available for server', 400)
                return
            
            ip_address = server['ip_address']
            dell_ops = self.executor._get_dell_operations()
            
            boot_data = dell_ops.get_boot_order(
                ip=ip_address,
                username=username,
                password=password,
                server_id=server_id,
                job_id=None
            )
            
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            response = {
                'success': True,
                'server_id': server_id,
                'boot_order': boot_data.get('boot_order', []),
                'boot_mode': boot_data.get('boot_mode'),
                'boot_source_override_enabled': boot_data.get('boot_source_override_enabled'),
                'boot_source_override_target': boot_data.get('boot_source_override_target'),
                'uefi_target': boot_data.get('uefi_target'),
            }
            
            # Update server record with boot config
            try:
                self.executor.supabase.table('servers').update({
                    'boot_order': boot_data.get('boot_order'),
                    'boot_mode': boot_data.get('boot_mode'),
                    'boot_source_override_enabled': boot_data.get('boot_source_override_enabled'),
                    'boot_source_override_target': boot_data.get('boot_source_override_target'),
                    'last_boot_config_check': datetime.now().isoformat(),
                }).eq('id', server_id).execute()
            except Exception as db_error:
                self.executor.log(f"Failed to update server boot config: {db_error}", "WARNING")
            
            self._log_operation(
                server_id=server_id,
                operation_name='boot_config_read',
                endpoint='/api/boot-config-read',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/boot-config-read',
                request_body=data,
                status_code=200,
                response_time_ms=response_time_ms,
                response_body={'success': True},
                success=True,
                operation_type='idrac_api'
            )
            
            self._send_json(response)
            
        except Exception as e:
            self.executor.log(f"Boot config read failed: {e}", "ERROR")
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            self._log_operation(
                server_id=server_id,
                operation_name='boot_config_read',
                endpoint='/api/boot-config-read',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/boot-config-read',
                request_body=data,
                status_code=500,
                response_time_ms=response_time_ms,
                response_body={'error': str(e)},
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            self._send_error(str(e), 500)
    
    def _handle_bios_config_read(self):
        """Read BIOS configuration instantly"""
        start_time = datetime.now()
        data = self._read_json_body()
        server_id = data.get('server_id')
        notes = data.get('notes', 'Instant API snapshot')
        
        if not server_id:
            self._send_error('server_id is required', 400)
            return
        
        self.executor.log(f"API: BIOS config read for server {server_id}")
        
        try:
            server = self.executor.get_server_by_id(server_id)
            if not server:
                self._send_error(f'Server {server_id} not found', 404)
                return
            
            username, password = self.executor.get_server_credentials(server_id)
            if not username or not password:
                self._send_error('No credentials available for server', 400)
                return
            
            ip_address = server['ip_address']
            dell_ops = self.executor._get_dell_operations()
            
            bios_data = dell_ops.get_bios_attributes(
                ip=ip_address,
                username=username,
                password=password,
                server_id=server_id,
                job_id=None
            )
            
            # Insert new record to bios_configurations table
            config_id = None
            try:
                result = self.executor.supabase.table('bios_configurations').insert({
                    'server_id': server_id,
                    'attributes': bios_data.get('attributes', {}),
                    'bios_version': bios_data.get('bios_version'),
                    'snapshot_type': 'current',
                    'notes': notes,
                    'captured_at': datetime.now().isoformat(),
                }).execute()
                if result.data:
                    config_id = result.data[0].get('id')
            except Exception as db_error:
                self.executor.log(f"Failed to save BIOS config: {db_error}", "WARNING")
            
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            response = {
                'success': True,
                'server_id': server_id,
                'config_id': config_id,
                'attributes': bios_data.get('attributes', {}),
                'bios_version': bios_data.get('bios_version'),
                'attribute_registry': bios_data.get('attribute_registry'),
            }
            
            self._log_operation(
                server_id=server_id,
                operation_name='bios_config_read',
                endpoint='/api/bios-config-read',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/bios-config-read',
                request_body=data,
                status_code=200,
                response_time_ms=response_time_ms,
                response_body={'success': True, 'config_id': config_id},
                success=True,
                operation_type='idrac_api'
            )
            
            self._send_json(response)
            
        except Exception as e:
            self.executor.log(f"BIOS config read failed: {e}", "ERROR")
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            self._log_operation(
                server_id=server_id,
                operation_name='bios_config_read',
                endpoint='/api/bios-config-read',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/bios-config-read',
                request_body=data,
                status_code=500,
                response_time_ms=response_time_ms,
                response_body={'error': str(e)},
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            self._send_error(str(e), 500)
    
    def _handle_firmware_inventory(self):
        """Get firmware inventory instantly"""
        start_time = datetime.now()
        data = self._read_json_body()
        server_id = data.get('server_id')
        
        if not server_id:
            self._send_error('server_id is required', 400)
            return
        
        self.executor.log(f"API: Firmware inventory for server {server_id}")
        
        try:
            server = self.executor.get_server_by_id(server_id)
            if not server:
                self._send_error(f'Server {server_id} not found', 404)
                return
            
            username, password = self.executor.get_server_credentials(server_id)
            if not username or not password:
                self._send_error('No credentials available for server', 400)
                return
            
            ip_address = server['ip_address']
            dell_ops = self.executor._get_dell_operations()
            
            firmware = dell_ops.get_firmware_inventory(
                ip=ip_address,
                username=username,
                password=password,
                server_id=server_id,
                job_id=None
            )
            
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            response = {
                'success': True,
                'server_id': server_id,
                'firmware': firmware or [],
                'count': len(firmware) if firmware else 0,
            }
            
            self._log_operation(
                server_id=server_id,
                operation_name='firmware_inventory',
                endpoint='/api/firmware-inventory',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/firmware-inventory',
                request_body=data,
                status_code=200,
                response_time_ms=response_time_ms,
                response_body={'success': True, 'count': len(firmware) if firmware else 0},
                success=True,
                operation_type='idrac_api'
            )
            
            self._send_json(response)
            
        except Exception as e:
            self.executor.log(f"Firmware inventory failed: {e}", "ERROR")
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            self._log_operation(
                server_id=server_id,
                operation_name='firmware_inventory',
                endpoint='/api/firmware-inventory',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/firmware-inventory',
                request_body=data,
                status_code=500,
                response_time_ms=response_time_ms,
                response_body={'error': str(e)},
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            self._send_error(str(e), 500)
    
    def _handle_idrac_jobs(self):
        """Get iDRAC job queue instantly"""
        start_time = datetime.now()
        data = self._read_json_body()
        server_id = data.get('server_id')
        include_details = data.get('include_details', True)
        
        if not server_id:
            self._send_error('server_id is required', 400)
            return
        
        self.executor.log(f"API: iDRAC jobs for server {server_id}")
        
        try:
            server = self.executor.get_server_by_id(server_id)
            if not server:
                self._send_error(f'Server {server_id} not found', 404)
                return
            
            username, password = self.executor.get_server_credentials(server_id)
            if not username or not password:
                self._send_error('No credentials available for server', 400)
                return
            
            ip_address = server['ip_address']
            dell_ops = self.executor._get_dell_operations()
            
            jobs = dell_ops.get_idrac_job_queue(
                ip=ip_address,
                username=username,
                password=password,
                include_details=include_details,
                server_id=server_id,
                job_id=None
            )
            
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            response = {
                'success': True,
                'server_id': server_id,
                'jobs': jobs or [],
                'count': len(jobs) if jobs else 0,
            }
            
            self._log_operation(
                server_id=server_id,
                operation_name='idrac_jobs',
                endpoint='/api/idrac-jobs',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/idrac-jobs',
                request_body=data,
                status_code=200,
                response_time_ms=response_time_ms,
                response_body={'success': True, 'count': len(jobs) if jobs else 0},
                success=True,
                operation_type='idrac_api'
            )
            
            self._send_json(response)
            
        except Exception as e:
            self.executor.log(f"iDRAC jobs fetch failed: {e}", "ERROR")
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            self._log_operation(
                server_id=server_id,
                operation_name='idrac_jobs',
                endpoint='/api/idrac-jobs',
                full_url=f'http://localhost:{self.executor.api_server.port}/api/idrac-jobs',
                request_body=data,
                status_code=500,
                response_time_ms=response_time_ms,
                response_body={'error': str(e)},
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            self._send_error(str(e), 500)
    
    def _handle_preflight_check(self):
        """Run comprehensive pre-flight checks for cluster/server update"""
        start_time = datetime.now()
        data = self._read_json_body()
        server_ids = data.get('server_ids', [])
        firmware_source = data.get('firmware_source', 'local_repository')
        
        if not server_ids:
            self._send_error('server_ids is required', 400)
            return
        
        self.executor.log(f"API: Pre-flight check for {len(server_ids)} servers, firmware_source={firmware_source}")
        
        try:
            results = {
                'servers': [],
                'firmware_source_checks': {},
                'overall_ready': True,
                'blockers': [],
                'warnings': []
            }
            
            dell_ops = self.executor._get_dell_operations()
            first_server_with_creds = None
            
            for server_id in server_ids:
                server_result = self._run_server_preflight(server_id, dell_ops)
                results['servers'].append(server_result)
                
                if not server_result['ready']:
                    results['overall_ready'] = False
                    for blocker in server_result.get('blockers', []):
                        results['blockers'].append({
                            'server_id': server_id,
                            'hostname': server_result.get('hostname', 'Unknown'),
                            **blocker
                        })
                
                for warning in server_result.get('warnings', []):
                    results['warnings'].append({
                        'server_id': server_id,
                        'hostname': server_result.get('hostname', 'Unknown'),
                        'message': warning
                    })
                
                # Track first server with valid credentials for Dell repo check
                if first_server_with_creds is None and server_result.get('checks', {}).get('auth', {}).get('passed'):
                    first_server_with_creds = server_result
            
            # If using Dell online catalog, check DNS and Dell repo reachability
            if firmware_source == 'dell_online_catalog' and first_server_with_creds:
                results['firmware_source_checks'] = self._check_dell_repo_access(
                    first_server_with_creds['server_id'],
                    dell_ops
                )
                
                if not results['firmware_source_checks'].get('dell_reachable'):
                    results['blockers'].append({
                        'type': 'dell_repo_unreachable',
                        'message': 'iDRAC cannot reach Dell repository (downloads.dell.com)',
                        'suggestion': 'Configure gateway/DNS in iDRAC Network Settings, or switch to Local Repository'
                    })
                    results['overall_ready'] = False
                
                if not results['firmware_source_checks'].get('dns_configured'):
                    results['warnings'].append({
                        'server_id': first_server_with_creds['server_id'],
                        'hostname': first_server_with_creds.get('hostname', 'Unknown'),
                        'message': 'DNS may not be configured - online catalog updates may fail'
                    })
            
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            response = {
                'success': True,
                'response_time_ms': response_time_ms,
                **results
            }
            
            self._send_json(response)
            
        except Exception as e:
            self.executor.log(f"Pre-flight check failed: {e}", "ERROR")
            import traceback
            self.executor.log(f"Traceback: {traceback.format_exc()}", "ERROR")
            self._send_error(str(e), 500)
    
    def _run_server_preflight(self, server_id: str, dell_ops) -> dict:
        """Run pre-flight checks for a single server"""
        result = {
            'server_id': server_id,
            'hostname': None,
            'ip_address': None,
            'ready': True,
            'checks': {
                'connectivity': {'passed': False, 'message': 'Not checked'},
                'auth': {'passed': False, 'message': 'Not checked'},
                'lifecycle_controller': {'passed': False, 'status': 'Unknown'},
                'pending_jobs': {'passed': False, 'count': None},
                'power_state': {'passed': False, 'state': 'Unknown'},
                'system_health': {'passed': False, 'overall': 'Unknown'},
            },
            'blockers': [],
            'warnings': []
        }
        
        try:
            # Get server info
            server = self.executor.get_server_by_id(server_id)
            if not server:
                result['ready'] = False
                result['blockers'].append({'type': 'server_not_found', 'message': 'Server not found in database'})
                return result
            
            result['hostname'] = server.get('hostname', 'Unknown')
            result['ip_address'] = server.get('ip_address')
            ip = result['ip_address']
            
            # Check 1: Connectivity
            try:
                conn_result = self.executor.test_idrac_connectivity(ip)
                if conn_result.get('reachable'):
                    result['checks']['connectivity'] = {
                        'passed': True, 
                        'message': f"Reachable ({conn_result.get('response_time_ms', 0)}ms)"
                    }
                else:
                    result['checks']['connectivity'] = {'passed': False, 'message': 'iDRAC not reachable'}
                    result['ready'] = False
                    result['blockers'].append({'type': 'connectivity', 'message': 'iDRAC not reachable'})
                    return result  # Can't proceed without connectivity
            except Exception as e:
                result['checks']['connectivity'] = {'passed': False, 'message': str(e)}
                result['ready'] = False
                result['blockers'].append({'type': 'connectivity', 'message': str(e)})
                return result
            
            # Check 2: Credentials/Auth
            try:
                username, password = self.executor.get_server_credentials(server_id)
                if not username or not password:
                    result['checks']['auth'] = {'passed': False, 'message': 'No credentials configured'}
                    result['ready'] = False
                    result['blockers'].append({'type': 'auth', 'message': 'No credentials configured for server'})
                    return result
                
                # Test auth by getting system info
                system_info = dell_ops.get_system_info(ip, username, password, server_id=server_id)
                result['checks']['auth'] = {'passed': True, 'message': 'Authentication successful'}
            except Exception as e:
                result['checks']['auth'] = {'passed': False, 'message': str(e)}
                result['ready'] = False
                result['blockers'].append({'type': 'auth', 'message': f'Authentication failed: {str(e)}'})
                return result
            
            # Check 3: Lifecycle Controller Status
            try:
                lc_status = dell_ops.get_lifecycle_controller_status(ip, username, password, server_id=server_id)
                lc_state = lc_status.get('status', 'Unknown')
                server_state = lc_status.get('server_status', 'Unknown')
                
                if lc_state == 'Ready':
                    result['checks']['lifecycle_controller'] = {
                        'passed': True, 
                        'status': lc_state,
                        'server_status': server_state,
                        'message': lc_status.get('message', '')
                    }
                else:
                    result['checks']['lifecycle_controller'] = {
                        'passed': False, 
                        'status': lc_state,
                        'server_status': server_state,
                        'message': lc_status.get('message', '')
                    }
                    result['ready'] = False
                    result['blockers'].append({
                        'type': 'lifecycle_controller', 
                        'message': f'Lifecycle Controller not ready: {lc_state} (Server: {server_state})'
                    })
            except Exception as e:
                # Handle older iDRAC versions that may not support this endpoint
                result['checks']['lifecycle_controller'] = {'passed': False, 'status': f'Error: {str(e)}'}
                result['warnings'].append(f'Could not check LC status: {str(e)}')
            
            # Check 4: Pending iDRAC Jobs
            try:
                jobs_result = dell_ops.get_idrac_job_queue(ip, username, password, include_details=True, server_id=server_id)
                # Fix: Extract jobs list from dict return value
                all_jobs = jobs_result.get('jobs', []) if isinstance(jobs_result, dict) else (jobs_result or [])
                pending_jobs = [j for j in all_jobs if j.get('job_state') in ['Scheduled', 'Running', 'Waiting', 'New']]
                count = len(pending_jobs)
                
                if count == 0:
                    result['checks']['pending_jobs'] = {'passed': True, 'count': 0, 'jobs': []}
                else:
                    result['checks']['pending_jobs'] = {'passed': False, 'count': count, 'jobs': pending_jobs[:5]}
                    result['ready'] = False
                    result['blockers'].append({
                        'type': 'pending_jobs',
                        'message': f'{count} pending iDRAC job(s) must be cleared first'
                    })
            except Exception as e:
                result['checks']['pending_jobs'] = {'passed': False, 'count': None, 'jobs': [], 'message': str(e)}
                result['warnings'].append(f'Could not check iDRAC jobs: {str(e)}')
            
            # Check 5: Power State
            try:
                power_state = system_info.get('system', {}).get('power_state', 'Unknown')
                result['checks']['power_state'] = {'passed': True, 'state': power_state}
                if power_state == 'Off':
                    result['warnings'].append('Server is powered off - will need to be powered on for updates')
            except Exception as e:
                result['checks']['power_state'] = {'passed': False, 'state': 'Unknown'}
            
            # Check 6: System Health (warning only, not a blocker)
            try:
                health = system_info.get('system', {}).get('health', 'Unknown')
                result['checks']['system_health'] = {'passed': health in ['OK', 'Warning'], 'overall': health}
                if health == 'Critical':
                    result['warnings'].append(f'System health is Critical - review before updating')
                elif health == 'Warning':
                    result['warnings'].append(f'System health shows warnings')
            except Exception as e:
                result['checks']['system_health'] = {'passed': False, 'overall': 'Unknown'}
            
        except Exception as e:
            result['ready'] = False
            result['blockers'].append({'type': 'unknown', 'message': str(e)})
        
        return result
    
    def _handle_preflight_check_stream(self):
        """Stream pre-flight check progress using Server-Sent Events (SSE)
        
        Optimized with parallel server checking using ThreadPoolExecutor.
        """
        from urllib.parse import urlparse, parse_qs
        from concurrent.futures import ThreadPoolExecutor, as_completed
        import threading
        
        start_time = datetime.now()
        
        # Parse query parameters from URL
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        server_ids = params.get('server_ids', [''])[0].split(',')
        server_ids = [s.strip() for s in server_ids if s.strip()]
        firmware_source = params.get('firmware_source', ['local_repository'])[0]
        
        if not server_ids:
            self._send_error('server_ids query parameter is required', 400)
            return
        
        self.executor.log(f"API: Pre-flight check stream for {len(server_ids)} servers (parallel), firmware_source={firmware_source}")
        
        # Set up SSE headers
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        
        # Thread-safe counter and lock for progress
        progress_lock = threading.Lock()
        progress_state = {
            'completed': 0,
            'passed': 0,
            'failed': 0,
            'current_hostname': 'Starting...'
        }
        
        def send_event(event_type: str, data: dict):
            """Send an SSE event (thread-safe)"""
            try:
                event_data = json.dumps(data)
                self.wfile.write(f"event: {event_type}\n".encode())
                self.wfile.write(f"data: {event_data}\n\n".encode())
                self.wfile.flush()
            except Exception as e:
                self.executor.log(f"SSE write error: {e}", "ERROR")
        
        def check_server(server_id: str, dell_ops, index: int) -> dict:
            """Check a single server (runs in thread pool)"""
            server = self.executor.get_server_by_id(server_id)
            hostname = server.get('hostname', server.get('ip_address', 'Unknown')) if server else 'Unknown'
            
            # Update current hostname being checked
            with progress_lock:
                progress_state['current_hostname'] = hostname
            
            # Run the actual preflight check
            result = self._run_server_preflight_optimized(server_id, dell_ops)
            result['_index'] = index
            return result
        
        try:
            results = {
                'servers': [],
                'firmware_source_checks': {},
                'overall_ready': True,
                'blockers': [],
                'warnings': []
            }
            
            dell_ops = self.executor._get_dell_operations()
            first_server_with_creds = None
            total_servers = len(server_ids)
            
            # Send initial progress
            send_event('progress', {
                'current': 0,
                'total': total_servers,
                'percent': 0,
                'current_hostname': 'Starting...',
                'passed': 0,
                'failed': 0
            })
            
            # Use ThreadPoolExecutor for parallel checking (limit to 4 concurrent)
            max_workers = min(4, total_servers)
            server_results = []
            
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                # Submit all server checks
                future_to_server = {
                    executor.submit(check_server, server_id, dell_ops, i): (server_id, i)
                    for i, server_id in enumerate(server_ids)
                }
                
                # Process results as they complete
                for future in as_completed(future_to_server):
                    server_id, original_index = future_to_server[future]
                    try:
                        server_result = future.result()
                        server_results.append(server_result)
                        
                        # Update progress counters
                        with progress_lock:
                            progress_state['completed'] += 1
                            if server_result['ready']:
                                progress_state['passed'] += 1
                            else:
                                progress_state['failed'] += 1
                        
                        # Send progress update
                        send_event('progress', {
                            'current': progress_state['completed'],
                            'total': total_servers,
                            'percent': int((progress_state['completed'] / total_servers) * 100),
                            'current_hostname': server_result.get('hostname', 'Unknown'),
                            'passed': progress_state['passed'],
                            'failed': progress_state['failed'],
                            'status': 'completed'
                        })
                        
                        # Send individual server result
                        send_event('server_result', {
                            'server_id': server_id,
                            'hostname': server_result.get('hostname'),
                            'ready': server_result['ready'],
                            'index': progress_state['completed']
                        })
                        
                    except Exception as e:
                        self.executor.log(f"Preflight check failed for {server_id}: {e}", "ERROR")
                        # Create a failed result
                        server_results.append({
                            'server_id': server_id,
                            'hostname': 'Unknown',
                            'ready': False,
                            'blockers': [{'type': 'error', 'message': str(e)}],
                            'warnings': [],
                            'checks': {}
                        })
                        with progress_lock:
                            progress_state['completed'] += 1
                            progress_state['failed'] += 1
            
            # Sort results back to original order and process
            server_results.sort(key=lambda x: x.get('_index', 0))
            
            for server_result in server_results:
                # Remove internal index
                server_result.pop('_index', None)
                results['servers'].append(server_result)
                
                if not server_result['ready']:
                    results['overall_ready'] = False
                    for blocker in server_result.get('blockers', []):
                        results['blockers'].append({
                            'server_id': server_result.get('server_id'),
                            'hostname': server_result.get('hostname', 'Unknown'),
                            **blocker
                        })
                
                for warning in server_result.get('warnings', []):
                    results['warnings'].append({
                        'server_id': server_result.get('server_id'),
                        'hostname': server_result.get('hostname', 'Unknown'),
                        'message': warning
                    })
                
                # Track first server with valid credentials for Dell repo check
                if first_server_with_creds is None and server_result.get('checks', {}).get('auth', {}).get('passed'):
                    first_server_with_creds = server_result
            
            # If using Dell online catalog, check DNS and Dell repo reachability
            if firmware_source == 'dell_online_catalog' and first_server_with_creds:
                send_event('progress', {
                    'current': total_servers,
                    'total': total_servers,
                    'percent': 95,
                    'current_hostname': 'Checking Dell repository...',
                    'passed': passed_count,
                    'failed': failed_count,
                    'status': 'dell_repo_check'
                })
                
                results['firmware_source_checks'] = self._check_dell_repo_access(
                    first_server_with_creds['server_id'],
                    dell_ops
                )
                
                if not results['firmware_source_checks'].get('dell_reachable'):
                    results['blockers'].append({
                        'type': 'dell_repo_unreachable',
                        'message': 'iDRAC cannot reach Dell repository (downloads.dell.com)',
                        'suggestion': 'Configure gateway/DNS in iDRAC Network Settings, or switch to Local Repository'
                    })
                    results['overall_ready'] = False
                
                if not results['firmware_source_checks'].get('dns_configured'):
                    results['warnings'].append({
                        'server_id': first_server_with_creds['server_id'],
                        'hostname': first_server_with_creds.get('hostname', 'Unknown'),
                        'message': 'DNS may not be configured - online catalog updates may fail'
                    })
            
            response_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # Send final done event with full results
            send_event('done', {
                'success': True,
                'response_time_ms': response_time_ms,
                **results
            })
            
        except Exception as e:
            self.executor.log(f"Pre-flight check stream failed: {e}", "ERROR")
            import traceback
            self.executor.log(f"Traceback: {traceback.format_exc()}", "ERROR")
            send_event('error', {'error': str(e)})
    
    def _check_dell_repo_access(self, server_id: str, dell_ops) -> dict:
        """Check if iDRAC can reach Dell repository"""
        result = {
            'dns_configured': False,
            'dns1': None,
            'dns2': None,
            'dell_reachable': False,
            'dell_error': None
        }
        
        try:
            server = self.executor.get_server_by_id(server_id)
            if not server:
                result['dell_error'] = 'Server not found'
                return result
            
            ip = server.get('ip_address')
            username, password = self.executor.get_server_credentials(server_id)
            
            if not username or not password:
                result['dell_error'] = 'No credentials'
                return result
            
            # Get network config to check DNS
            try:
                network_config = dell_ops.get_idrac_network_config(ip, username, password, server_id=server_id)
                ipv4 = network_config.get('ipv4', {})
                dns1 = ipv4.get('dns1') or ipv4.get('dns_servers', [None, None])[0]
                dns2 = ipv4.get('dns2') or (ipv4.get('dns_servers', [None, None])[1] if len(ipv4.get('dns_servers', [])) > 1 else None)
                
                result['dns1'] = dns1
                result['dns2'] = dns2
                result['dns_configured'] = bool(dns1 and dns1 not in ['0.0.0.0', ''])
            except Exception as e:
                self.executor.log(f"Could not get DNS config: {e}", "WARN")
            
            # Test Dell repo reachability
            try:
                reachable = dell_ops.test_dell_repo_reachability(ip, username, password, server_id=server_id)
                result['dell_reachable'] = reachable.get('reachable', False)
                if not reachable.get('reachable'):
                    result['dell_error'] = reachable.get('error', 'Cannot reach Dell repository')
            except Exception as e:
                result['dell_reachable'] = False
                result['dell_error'] = str(e)
        
        except Exception as e:
            result['dell_error'] = str(e)
        
        return result
    
    def _run_server_preflight_optimized(self, server_id: str, dell_ops) -> dict:
        """Optimized pre-flight checks for a single server.
        
        Reduces HTTP requests by:
        1. Using get_system_info as combined connectivity+auth test
        2. Combining LC status and job queue checks where possible
        """
        result = {
            'server_id': server_id,
            'hostname': None,
            'ip_address': None,
            'ready': True,
            'checks': {
                'connectivity': {'passed': False, 'message': 'Not checked'},
                'auth': {'passed': False, 'message': 'Not checked'},
                'lifecycle_controller': {'passed': False, 'status': 'Unknown'},
                'pending_jobs': {'passed': False, 'count': None},
                'power_state': {'passed': False, 'state': 'Unknown'},
                'system_health': {'passed': False, 'overall': 'Unknown'},
            },
            'blockers': [],
            'warnings': []
        }
        
        try:
            # Get server info
            server = self.executor.get_server_by_id(server_id)
            if not server:
                result['ready'] = False
                result['blockers'].append({'type': 'server_not_found', 'message': 'Server not found in database'})
                return result
            
            result['hostname'] = server.get('hostname', 'Unknown')
            result['ip_address'] = server.get('ip_address')
            ip = result['ip_address']
            
            # Get credentials first
            username, password = self.executor.get_server_credentials(server_id)
            if not username or not password:
                result['checks']['auth'] = {'passed': False, 'message': 'No credentials configured'}
                result['ready'] = False
                result['blockers'].append({'type': 'auth', 'message': 'No credentials configured for server'})
                return result
            
            # OPTIMIZED: Combined connectivity + auth check via get_system_info
            # This is ONE request that validates both connectivity and auth
            try:
                system_info = dell_ops.get_system_info(ip, username, password, server_id=server_id)
                
                # If we get here, both connectivity and auth passed
                result['checks']['connectivity'] = {'passed': True, 'message': 'Reachable'}
                result['checks']['auth'] = {'passed': True, 'message': 'Authentication successful'}
                
                # Extract power state and health from the same response
                power_state = system_info.get('system', {}).get('power_state', 'Unknown')
                result['checks']['power_state'] = {'passed': True, 'state': power_state}
                if power_state == 'Off':
                    result['warnings'].append('Server is powered off - will need to be powered on for updates')
                
                health = system_info.get('system', {}).get('health', 'Unknown')
                result['checks']['system_health'] = {'passed': health in ['OK', 'Warning'], 'overall': health}
                if health == 'Critical':
                    result['warnings'].append('System health is Critical - review before updating')
                elif health == 'Warning':
                    result['warnings'].append('System health shows warnings')
                    
            except Exception as e:
                error_str = str(e).lower()
                if 'timeout' in error_str or 'connection' in error_str or 'refused' in error_str:
                    result['checks']['connectivity'] = {'passed': False, 'message': 'iDRAC not reachable'}
                    result['blockers'].append({'type': 'connectivity', 'message': 'iDRAC not reachable'})
                elif '401' in error_str or 'unauthorized' in error_str or 'authentication' in error_str:
                    result['checks']['connectivity'] = {'passed': True, 'message': 'Reachable'}
                    result['checks']['auth'] = {'passed': False, 'message': 'Authentication failed'}
                    result['blockers'].append({'type': 'auth', 'message': 'Authentication failed'})
                else:
                    result['checks']['connectivity'] = {'passed': False, 'message': str(e)}
                    result['blockers'].append({'type': 'connectivity', 'message': str(e)})
                
                result['ready'] = False
                return result
            
            # Check 3: Lifecycle Controller Status (separate request required)
            try:
                lc_status = dell_ops.get_lifecycle_controller_status(ip, username, password, server_id=server_id)
                lc_state = lc_status.get('status', 'Unknown')
                server_state = lc_status.get('server_status', 'Unknown')
                
                if lc_state == 'Ready':
                    result['checks']['lifecycle_controller'] = {
                        'passed': True, 
                        'status': lc_state,
                        'server_status': server_state,
                        'message': lc_status.get('message', '')
                    }
                else:
                    result['checks']['lifecycle_controller'] = {
                        'passed': False, 
                        'status': lc_state,
                        'server_status': server_state,
                        'message': lc_status.get('message', '')
                    }
                    result['ready'] = False
                    result['blockers'].append({
                        'type': 'lifecycle_controller', 
                        'message': f'Lifecycle Controller not ready: {lc_state} (Server: {server_state})'
                    })
            except Exception as e:
                result['checks']['lifecycle_controller'] = {'passed': False, 'status': f'Error: {str(e)}'}
                result['warnings'].append(f'Could not check LC status: {str(e)}')
            
            # Check 4: Pending iDRAC Jobs (separate request required)
            try:
                jobs_result = dell_ops.get_idrac_job_queue(ip, username, password, include_details=True, server_id=server_id)
                all_jobs = jobs_result.get('jobs', []) if isinstance(jobs_result, dict) else (jobs_result or [])
                pending_jobs = [j for j in all_jobs if j.get('job_state') in ['Scheduled', 'Running', 'Waiting', 'New']]
                count = len(pending_jobs)
                
                if count == 0:
                    result['checks']['pending_jobs'] = {'passed': True, 'count': 0, 'jobs': []}
                else:
                    result['checks']['pending_jobs'] = {'passed': False, 'count': count, 'jobs': pending_jobs[:5]}
                    result['ready'] = False
                    result['blockers'].append({
                        'type': 'pending_jobs',
                        'message': f'{count} pending iDRAC job(s) must be cleared first'
                    })
            except Exception as e:
                result['checks']['pending_jobs'] = {'passed': False, 'count': None, 'jobs': [], 'message': str(e)}
                result['warnings'].append(f'Could not check iDRAC jobs: {str(e)}')
            
        except Exception as e:
            result['ready'] = False
            result['blockers'].append({'type': 'unknown', 'message': str(e)})
        
        return result
    
    def log_message(self, format, *args):
        """Override to suppress default request logging"""
        pass


class APIServer:
    """HTTP API server for instant operations"""
    
    def __init__(self, executor, port: int):
        self.executor = executor
        self.port = port
        self.server = None
        self.thread = None
        self.ssl_enabled = False
        
        # Set executor reference for handler
        APIHandler.executor = executor
    
    def start(self):
        """Start the API server in a background thread"""
        from job_executor import config
        
        try:
            self.server = HTTPServer(('0.0.0.0', self.port), APIHandler)
            
            # Wrap with SSL if enabled
            protocol = "http"
            if config.API_SERVER_SSL_ENABLED:
                try:
                    import os
                    if os.path.exists(config.API_SERVER_SSL_CERT) and os.path.exists(config.API_SERVER_SSL_KEY):
                        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                        context.load_cert_chain(config.API_SERVER_SSL_CERT, config.API_SERVER_SSL_KEY)
                        self.server.socket = context.wrap_socket(self.server.socket, server_side=True)
                        self.ssl_enabled = True
                        protocol = "https"
                        self.executor.log(f"SSL enabled with certificate: {config.API_SERVER_SSL_CERT}")
                    else:
                        self.executor.log(f"SSL enabled but certificate files not found:", "WARN")
                        self.executor.log(f"  Certificate: {config.API_SERVER_SSL_CERT}", "WARN")
                        self.executor.log(f"  Key: {config.API_SERVER_SSL_KEY}", "WARN")
                        self.executor.log(f"  Generate with: /opt/job-executor/generate-ssl-cert.sh", "WARN")
                        self.executor.log(f"  Starting without SSL...", "WARN")
                except Exception as ssl_error:
                    self.executor.log(f"Failed to enable SSL: {ssl_error}", "ERROR")
                    self.executor.log(f"Starting without SSL...", "WARN")
            
            self.thread = Thread(target=self.server.serve_forever, daemon=True)
            self.thread.start()
            self.executor.log(f"API server started on {protocol}://0.0.0.0:{self.port}")
            self.executor.log(f"Available endpoints:")
            self.executor.log(f"  GET  /api/health")
            self.executor.log(f"  POST /api/console-launch")
            self.executor.log(f"  POST /api/power-control")
            self.executor.log(f"  POST /api/connectivity-test")
            self.executor.log(f"  POST /api/browse-datastore")
            self.executor.log(f"  POST /api/idm-authenticate")
            self.executor.log(f"  POST /api/network-config-read")
            self.executor.log(f"  POST /api/health-check")
            self.executor.log(f"  POST /api/event-logs")
            self.executor.log(f"  POST /api/boot-config-read")
            self.executor.log(f"  POST /api/bios-config-read")
            self.executor.log(f"  POST /api/firmware-inventory")
            self.executor.log(f"  POST /api/idrac-jobs")
            self.executor.log(f"  POST /api/preflight-check")
            
            if not self.ssl_enabled and config.API_SERVER_SSL_ENABLED:
                self.executor.log(f"WARNING: SSL was requested but not enabled. Remote HTTPS access may not work.", "WARN")
        except Exception as e:
            self.executor.log(f"Failed to start API server: {e}", "ERROR")
            raise
    
    def stop(self):
        """Stop the API server"""
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.executor.log("API server stopped")
