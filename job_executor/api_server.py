"""HTTP API Server for instant operations"""

import json
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread
from typing import Dict
from datetime import datetime
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
        
        # Set executor reference for handler
        APIHandler.executor = executor
    
    def start(self):
        """Start the API server in a background thread"""
        try:
            self.server = HTTPServer(('0.0.0.0', self.port), APIHandler)
            self.thread = Thread(target=self.server.serve_forever, daemon=True)
            self.thread.start()
            self.executor.log(f"API server started on http://0.0.0.0:{self.port}")
            self.executor.log(f"Available endpoints:")
            self.executor.log(f"  GET  /api/health")
            self.executor.log(f"  POST /api/console-launch")
            self.executor.log(f"  POST /api/power-control")
            self.executor.log(f"  POST /api/connectivity-test")
            self.executor.log(f"  POST /api/browse-datastore")
        except Exception as e:
            self.executor.log(f"Failed to start API server: {e}", "ERROR")
            raise
    
    def stop(self):
        """Stop the API server"""
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.executor.log("API server stopped")
