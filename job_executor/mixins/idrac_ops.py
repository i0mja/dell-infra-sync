"""
IdracMixin - Server information, health monitoring, and discovery operations
Handles all iDRAC Redfish API interactions for server management
"""
 
import json
import time
import hashlib
import requests
import concurrent.futures
from datetime import datetime
from typing import Dict, List, Optional

from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL


def _safe_json_parse(response):
    """Safely parse JSON response"""
    try:
        if response.status_code in [200, 201] and response.text:
            return response.json()
    except Exception:
        pass
    return None


class IdracMixin:
    """Mixin for iDRAC server information, health, and discovery operations"""
    
    def test_idrac_connectivity(self, ip: str, port: int = 443, timeout: float = 5.0) -> dict:
        """
        Test basic network connectivity to iDRAC (TCP socket test).
        Does NOT require credentials - just checks if we can reach the port.
        
        Args:
            ip: iDRAC IP address
            port: Port to test (default 443 for HTTPS)
            timeout: Connection timeout in seconds
            
        Returns:
            dict with keys:
                - reachable: bool
                - response_time_ms: int (if reachable)
                - message: str
        """
        import socket
        
        start = time.time()
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            result = sock.connect_ex((ip, port))
            elapsed_ms = int((time.time() - start) * 1000)
            sock.close()
            
            if result == 0:
                return {
                    'reachable': True,
                    'response_time_ms': elapsed_ms,
                    'message': f'Port {port} reachable ({elapsed_ms}ms)'
                }
            else:
                return {
                    'reachable': False,
                    'response_time_ms': elapsed_ms,
                    'message': f'Connection refused or timed out (error code: {result})'
                }
        except socket.timeout:
            elapsed_ms = int((time.time() - start) * 1000)
            return {
                'reachable': False,
                'response_time_ms': elapsed_ms,
                'message': 'Connection timed out'
            }
        except Exception as e:
            elapsed_ms = int((time.time() - start) * 1000)
            return {
                'reachable': False,
                'response_time_ms': elapsed_ms,
                'message': str(e)
            }
    
    def get_comprehensive_server_info(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None, max_retries: int = 3, full_onboarding: bool = True) -> Optional[Dict]:
        """Get comprehensive server information from iDRAC Redfish API using throttler with optional full onboarding"""
        system_data = None
        
        # Get system information with throttler (handles retries internally)
        system_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1"
        
        try:
            system_response, response_time_ms = self.throttler.request_with_safety(
                method='GET',
                url=system_url,
                ip=ip,
                logger=self.log,
                auth=(username, password),
                timeout=(2, 15)  # 2s connect, 15s read
            )
            
            # Try to parse JSON, but handle parse errors gracefully
            response_json = None
            json_error = None
            if system_response and system_response.content:
                try:
                    response_json = system_response.json()
                except json.JSONDecodeError as json_err:
                    json_error = str(json_err)
                    self.log(f"  Warning: Could not parse response as JSON: {json_err}", "WARN")
            
            # Log the system info request
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Systems/System.Embedded.1',
                full_url=system_url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=system_response.status_code if system_response else None,
                response_time_ms=response_time_ms,
                response_body=response_json,
                success=(system_response and system_response.status_code == 200 and response_json is not None),
                error_message=json_error if json_error else (None if (system_response and system_response.status_code == 200) else f"HTTP {system_response.status_code}" if system_response else "Request failed"),
                operation_type='idrac_api'
            )
            
            if system_response and system_response.status_code == 200 and response_json is not None:
                system_data = response_json
                # Record success
                self.throttler.record_success(ip)
            else:
                self.log(f"  Failed to get system info from {ip}", "ERROR")
                if system_response and system_response.status_code in [401, 403]:
                    self.throttler.record_failure(ip, system_response.status_code, self.log)
                return None
                    
        except Exception as e:
            # Record failure
            self.throttler.record_failure(ip, None, self.log)
            
            # Log the error
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Systems/System.Embedded.1',
                full_url=system_url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=None,
                response_time_ms=0,
                response_body=None,
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            
            self.log(f"  Error getting system info from {ip}: {e}", "ERROR")
            return None
        
        if system_data is None:
            return None
        
        # Get manager (iDRAC) information with retry logic
        manager_url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1"
        manager_data = {}
        
        try:
            manager_response, response_time_ms = self.throttler.request_with_safety(
                method='GET',
                url=manager_url,
                ip=ip,
                logger=self.log,
                auth=(username, password),
                timeout=(2, 15)  # 2s connect, 15s read
            )
            
            # Parse JSON
            response_json = None
            json_error = None
            if manager_response and manager_response.content:
                try:
                    response_json = manager_response.json()
                except json.JSONDecodeError as json_err:
                    json_error = str(json_err)
                    self.log(f"  Warning: Could not parse manager response as JSON: {json_err}", "WARN")
            
            # Log the request
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Managers/iDRAC.Embedded.1',
                full_url=manager_url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=manager_response.status_code if manager_response else None,
                response_time_ms=response_time_ms,
                response_body=response_json,
                success=(manager_response and manager_response.status_code == 200 and response_json is not None),
                error_message=json_error if json_error else (None if (manager_response and manager_response.status_code == 200) else f"HTTP {manager_response.status_code}" if manager_response else "Request failed"),
                operation_type='idrac_api'
            )
            
            if manager_response and manager_response.status_code == 200 and response_json is not None:
                manager_data = response_json
                # Record success
                self.throttler.record_success(ip)
            else:
                # Manager data is optional, log warning and continue
                self.log(f"  Warning: Could not get manager info from {ip} (continuing with system data only)", "WARN")
                if manager_response and manager_response.status_code in [401, 403]:
                    self.throttler.record_failure(ip, manager_response.status_code, self.log)
                    
        except Exception as e:
            # Record failure
            self.throttler.record_failure(ip, None, self.log)
            
            # Log the error
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Managers/iDRAC.Embedded.1',
                full_url=manager_url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=None,
                response_time_ms=0,
                response_body=None,
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            
            self.log(f"  Warning: Error getting manager info from {ip}: {e} (continuing with system data only)", "WARN")
        
        # Extract comprehensive info
        try:
            processor_summary = system_data.get("ProcessorSummary", {})
            memory_summary = system_data.get("MemorySummary", {})
            
            # Extract Redfish version from @odata.type
            redfish_version = None
            if "@odata.type" in system_data:
                odata_type = system_data.get("@odata.type", "")
                # Extract version from something like "#ComputerSystem.v1_13_0.ComputerSystem"
                if "." in odata_type:
                    parts = odata_type.split(".")
                    if len(parts) >= 2:
                        redfish_version = parts[1].replace("v", "").replace("_", ".")
            
            # Sanitize types for database columns
            cpu_count_val = processor_summary.get("Count")
            if cpu_count_val is not None:
                try:
                    cpu_count = int(cpu_count_val) if isinstance(cpu_count_val, (int, float)) else (int(cpu_count_val) if str(cpu_count_val).replace('.','',1).isdigit() else None)
                except (ValueError, TypeError):
                    cpu_count = None
            else:
                cpu_count = None
            
            mem_gib_val = memory_summary.get("TotalSystemMemoryGiB")
            if mem_gib_val is not None:
                try:
                    memory_gb = int(mem_gib_val) if isinstance(mem_gib_val, (int, float)) else (int(float(mem_gib_val)) if isinstance(mem_gib_val, str) and mem_gib_val.replace('.','',1).isdigit() else None)
                except (ValueError, TypeError):
                    memory_gb = None
            else:
                memory_gb = None
            
            base_info = {
                "manufacturer": system_data.get("Manufacturer", "Unknown"),
                "model": system_data.get("Model", "Unknown"),
                "service_tag": system_data.get("SKU") or system_data.get("SerialNumber", None),  # Dell Service Tag is in SKU field
                "hostname": system_data.get("HostName", None) or None,  # Convert empty string to None
                "bios_version": system_data.get("BiosVersion", None),
                "cpu_count": cpu_count,
                "memory_gb": memory_gb,
                "idrac_firmware": manager_data.get("FirmwareVersion", None) if manager_data else None,
                "manager_mac_address": None,  # Would need to query EthernetInterfaces
                "product_name": system_data.get("Model", None),
                "redfish_version": redfish_version,
                "supported_endpoints": None,  # Can be populated from Oem data if needed
                "power_state": system_data.get("PowerState", None),  # Add power state
                "username": username,
                "password": password,
            }
            
            # If full onboarding is requested, fetch additional data IN PARALLEL
            if full_onboarding:
                self.log(f"  Starting full onboarding for {ip} (parallel fetch)...", "INFO")
                
                # Use ThreadPoolExecutor to fetch independent endpoints in parallel
                # This reduces per-server time from ~15-30s to ~5-8s
                with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
                    # Submit all independent tasks
                    future_health = executor.submit(
                        self._fetch_health_status, ip, username, password, server_id, job_id
                    )
                    future_bios = executor.submit(
                        self._fetch_bios_attributes, ip, username, password, server_id, job_id
                    )
                    future_drives = executor.submit(
                        self._fetch_storage_drives, ip, username, password, server_id, job_id
                    )
                    future_nics = executor.submit(
                        self._fetch_network_adapters, ip, username, password, server_id, job_id
                    )
                    # Note: Event logs skipped for speed - they're not critical for discovery
                    
                    # Collect results with timeouts
                    try:
                        health_data = future_health.result(timeout=45)
                        if health_data:
                            base_info['health_status'] = health_data
                            self.log(f"  ✓ Health status fetched", "INFO")
                    except Exception as e:
                        self.log(f"  ⚠ Health fetch failed: {e}", "DEBUG")
                    
                    try:
                        bios_data = future_bios.result(timeout=30)
                        if bios_data:
                            base_info['bios_attributes'] = bios_data
                            self.log(f"  ✓ BIOS attributes captured", "INFO")
                            
                            # Extract key BIOS fields for server record
                            base_info['cpu_model'] = bios_data.get('Proc1Brand')
                            base_info['cpu_cores_per_socket'] = bios_data.get('Proc1NumCores')
                            base_info['cpu_speed'] = bios_data.get('ProcCoreSpeed')
                            base_info['boot_mode'] = bios_data.get('BootMode')
                            boot_order_str = bios_data.get('SetBootOrderEn', '')
                            base_info['boot_order'] = boot_order_str.split(',') if boot_order_str else None
                            base_info['secure_boot'] = bios_data.get('SecureBoot')
                            base_info['virtualization_enabled'] = bios_data.get('ProcVirtualization') == 'Enabled'
                    except Exception as e:
                        self.log(f"  ⚠ BIOS fetch failed: {e}", "DEBUG")
                    
                    try:
                        drives = future_drives.result(timeout=60)
                        if drives:
                            base_info['drives'] = drives
                            base_info['total_drives'] = len(drives)
                            total_bytes = sum(d.get('capacity_bytes', 0) for d in drives)
                            base_info['total_storage_tb'] = round(total_bytes / (1024**4), 2) if total_bytes else None
                            self.log(f"  ✓ Discovered {len(drives)} drives ({base_info['total_storage_tb']} TB)", "INFO")
                    except Exception as e:
                        self.log(f"  ⚠ Storage fetch failed: {e}", "DEBUG")
                    
                    try:
                        nics = future_nics.result(timeout=45)
                        if nics:
                            base_info['nics'] = nics
                            base_info['total_nics'] = len(nics)
                            self.log(f"  ✓ Discovered {len(nics)} NIC ports", "INFO")
                    except Exception as e:
                        self.log(f"  ⚠ NIC fetch failed: {e}", "DEBUG")
            
            return base_info
        except Exception as e:
            self.log(f"Error extracting server info from {ip}: {e}", "ERROR")
            self.log(f"  system_data keys: {list(system_data.keys()) if system_data else 'None'}", "DEBUG")
            self.log(f"  manager_data keys: {list(manager_data.keys()) if manager_data else 'None'}", "DEBUG")
            return None
    
    def create_idrac_session(
        self, 
        ip: str, 
        username: str, 
        password: str, 
        log_to_db: bool = True,
        server_id: str = None,
        job_id: str = None
    ) -> Optional[Dict]:
        """
        Create a Redfish session with iDRAC using Dell's official session endpoint.
        
        Uses: POST /redfish/v1/SessionService/Sessions
        
        Returns session dict with:
        - token: X-Auth-Token for subsequent requests
        - location: Session URI for deletion
        - ip: iDRAC IP address
        - username: Username used
        - authenticated: True if successful
        - timestamp: ISO timestamp of session creation
        
        Returns None on failure.
        """
        url = f"https://{ip}/redfish/v1/SessionService/Sessions"
        payload = {
            "UserName": username,
            "Password": password
        }
        
        try:
            response, response_time_ms = self.throttler.request_with_safety(
                method='POST',
                url=url,
                ip=ip,
                logger=self.log,
                json=payload,
                timeout=(5, 15),
                headers={'Content-Type': 'application/json'}
            )
            
            # Log to idrac_commands table
            if log_to_db:
                # Sanitize request body for logging
                sanitized_payload = {
                    "UserName": username,
                    "Password": "***"
                }
                
                self.log_idrac_command(
                    server_id=server_id,
                    job_id=job_id,
                    task_id=None,
                    command_type='POST',
                    endpoint='/redfish/v1/SessionService/Sessions',
                    full_url=url,
                    request_headers={'Content-Type': 'application/json'},
                    request_body=sanitized_payload,
                    status_code=response.status_code if response else None,
                    response_time_ms=response_time_ms,
                    response_body=None,  # Don't log response (contains token)
                    success=(response and response.status_code in [200, 201]),
                    error_message=None if (response and response.status_code in [200, 201]) 
                                 else f"HTTP {response.status_code}" if response else "Connection failed",
                    operation_type='session_create'
                )
            
            if response and response.status_code in [200, 201]:
                # Extract session token and location from response headers
                token = response.headers.get('X-Auth-Token')
                location = response.headers.get('Location')
                
                if token and location:
                    self.throttler.record_success(ip)
                    self.log(f"  ✓ Redfish session created for {ip}", "INFO")
                    return {
                        'token': token,
                        'location': location,
                        'ip': ip,
                        'username': username,
                        'authenticated': True,
                        'timestamp': datetime.now().isoformat()
                    }
                else:
                    self.log(f"  Session created but missing token or location headers", "ERROR")
                    return None
            else:
                if response and response.status_code in [401, 403]:
                    self.throttler.record_failure(ip, response.status_code, self.log)
                self.log(f"  Session creation failed: HTTP {response.status_code if response else 'no response'}", "ERROR")
                return None
                
        except Exception as e:
            self.throttler.record_failure(ip, None, self.log)
            if log_to_db:
                sanitized_payload = {
                    "UserName": username,
                    "Password": "***"
                }
                self.log_idrac_command(
                    server_id=server_id,
                    job_id=job_id,
                    task_id=None,
                    command_type='POST',
                    endpoint='/redfish/v1/SessionService/Sessions',
                    full_url=url,
                    request_headers={'Content-Type': 'application/json'},
                    request_body=sanitized_payload,
                    status_code=None,
                    response_time_ms=0,
                    response_body=None,
                    success=False,
                    error_message=str(e),
                    operation_type='session_create'
                )
            self.log(f"  Session creation failed for {ip}: {e}", "ERROR")
            return None
    
    def delete_idrac_session(
        self,
        session: Dict,
        ip: str = None,
        server_id: str = None,
        job_id: str = None
    ) -> bool:
        """
        Delete a Redfish session (logout) to free up iDRAC resources.
        
        Uses: DELETE /redfish/v1/SessionService/Sessions/{SessionId}
        with X-Auth-Token header
        
        Args:
            session: Session dict from create_idrac_session() containing token and location
            ip: iDRAC IP (optional, extracted from session if not provided)
            server_id: For logging
            job_id: For logging
            
        Returns:
            bool: True if deleted successfully or nothing to delete, False on error
        """
        if not session:
            self.log(f"  No session to delete (None provided)", "DEBUG")
            return True  # Nothing to delete
        
        # Handle both session dict formats (with token or basic auth)
        if not session.get('token') or not session.get('location'):
            # Session was created with basic auth, nothing to delete
            self.log(f"  Session cleanup: No token-based session to delete", "DEBUG")
            return True
        
        session_ip = ip or session.get('ip')
        location = session['location']
        token = session['token']
        
        # Build delete URL from location header
        if location.startswith('http'):
            delete_url = location
        else:
            # Location is relative path, build full URL
            delete_url = f"https://{session_ip}{location}"
        
        try:
            response, response_time_ms = self.throttler.request_with_safety(
                method='DELETE',
                url=delete_url,
                ip=session_ip,
                logger=self.log,
                headers={'X-Auth-Token': token},
                timeout=(5, 10)
            )
            
            # Log to idrac_commands table
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='DELETE',
                endpoint=location,
                full_url=delete_url,
                request_headers={'X-Auth-Token': '[REDACTED]'},
                request_body=None,
                status_code=response.status_code if response else None,
                response_time_ms=response_time_ms,
                response_body=None,
                success=(response and response.status_code in [200, 204]),
                error_message=None if (response and response.status_code in [200, 204])
                             else f"HTTP {response.status_code}" if response else "Connection failed",
                operation_type='session_delete'
            )
            
            if response and response.status_code in [200, 204]:
                self.log(f"  ✓ Redfish session deleted for {session_ip}", "INFO")
                return True
            else:
                self.log(f"  Session deletion returned {response.status_code if response else 'no response'}", "WARN")
                # Don't return False - session cleanup is best-effort
                return True
                
        except Exception as e:
            self.log(f"  Session deletion failed for {session_ip}: {e}", "WARN")
            # Don't raise - session cleanup is best-effort, don't fail the job
            return True

    def _fetch_health_status(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None) -> Optional[Dict]:
        """Fetch comprehensive health status from multiple Redfish endpoints"""
        health = {
            'overall_status': 'Unknown',
            'storage_healthy': None,
            'thermal_healthy': None,
            'power_healthy': None,
            'power_state': None,
            'temperature_celsius': None,
            'fan_health': None
        }
        
        # First get system info for power state
        try:
            system_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1"
            system_response, system_time = self.throttler.request_with_safety(
                method='GET',
                url=system_url,
                ip=ip,
                logger=self.log,
                auth=(username, password),
                timeout=(2, 15)
            )
            
            if system_response and system_response.status_code == 200:
                system_json = system_response.json()
                health['power_state'] = system_json.get('PowerState')
                self.throttler.record_success(ip)
        except Exception as e:
            self.log(f"  Could not fetch power state: {e}", "WARN")
        
        endpoints = [
            ('/redfish/v1/Systems/System.Embedded.1/Storage', 'storage'),
            ('/redfish/v1/Chassis/System.Embedded.1/Thermal', 'thermal'),
            ('/redfish/v1/Chassis/System.Embedded.1/Power', 'power')
        ]
        
        for endpoint, health_type in endpoints:
            try:
                url = f"https://{ip}{endpoint}"
                response, response_time = self.throttler.request_with_safety(
                    method='GET',
                    url=url,
                    ip=ip,
                    logger=self.log,
                    auth=(username, password),
                    timeout=(2, 15)
                )
                
                response_json = None
                if response and response.status_code == 200 and response.content:
                    try:
                        response_json = response.json()
                    except json.JSONDecodeError:
                        pass
                
                # Log the API call
                self.log_idrac_command(
                    server_id=server_id,
                    job_id=job_id,
                    task_id=None,
                    command_type='GET',
                    endpoint=endpoint,
                    full_url=url,
                    request_headers={'Authorization': f'Basic {username}:***'},
                    request_body=None,
                    status_code=response.status_code if response else None,
                    response_time_ms=response_time,
                    response_body=response_json,
                    success=(response and response.status_code == 200),
                    error_message=None if (response and response.status_code == 200) else f"HTTP {response.status_code}" if response else "Request failed",
                    operation_type='idrac_api'
                )
                
                if response and response.status_code == 200 and response_json:
                    health[f'{health_type}_healthy'] = self._parse_health_from_response(response_json)
                    
                    # Extract additional thermal data
                    if health_type == 'thermal':
                        # Get temperature readings
                        temps = response_json.get('Temperatures', [])
                        if temps:
                            avg_temp = sum(t.get('ReadingCelsius', 0) for t in temps if t.get('ReadingCelsius')) / len([t for t in temps if t.get('ReadingCelsius')])
                            health['temperature_celsius'] = round(avg_temp, 1) if avg_temp else None
                        
                        # Get fan health
                        fans = response_json.get('Fans', [])
                        if fans:
                            all_fans_ok = all(
                                f.get('Status', {}).get('Health') == 'OK' 
                                for f in fans 
                                if f.get('Status', {}).get('Health')
                            )
                            health['fan_health'] = 'OK' if all_fans_ok else 'Warning'
                    
                    self.throttler.record_success(ip)
                    
            except Exception as e:
                self.log(f"  Could not fetch {health_type} health: {e}", "WARN")
        
        return health

    def _parse_health_from_response(self, data: Dict) -> bool:
        """Parse health status from various Redfish health response formats"""
        try:
            # Try Status.Health field (common pattern)
            if 'Status' in data and isinstance(data['Status'], dict):
                health = data['Status'].get('Health', 'Unknown')
                return health == 'OK'
            
            # Try Members array with Status fields
            if 'Members' in data and isinstance(data['Members'], list):
                all_ok = True
                for member in data['Members']:
                    if 'Status' in member and isinstance(member['Status'], dict):
                        health = member['Status'].get('Health', 'Unknown')
                        if health != 'OK':
                            all_ok = False
                            break
                return all_ok
            
            # Default to unknown
            return None
        except Exception as e:
            self.log(f"  Error parsing health status: {e}", "DEBUG")
            return None

    def _fetch_initial_event_logs(self, ip: str, username: str, password: str, server_id: str, job_id: str) -> int:
        """Fetch recent event logs (SEL + Lifecycle) and store in database"""
        total_logs = 0
        
        # Fetch SEL logs (System Event Log)
        try:
            url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/Logs/Sel"
            response, response_time = self.throttler.request_with_safety(
                method='GET',
                url=url,
                ip=ip,
                logger=self.log,
                auth=(username, password),
                timeout=(2, 15)
            )
            
            response_json = None
            if response and response.status_code == 200 and response.content:
                try:
                    response_json = response.json()
                except json.JSONDecodeError:
                    pass
            
            # Log the API call
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Logs/Sel',
                full_url=url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=response.status_code if response else None,
                response_time_ms=response_time,
                response_body=response_json,
                success=(response and response.status_code == 200),
                error_message=None if (response and response.status_code == 200) else f"HTTP {response.status_code}" if response else "Request failed",
                operation_type='idrac_api'
            )
            
            if response and response.status_code == 200 and response_json:
                log_count = self._store_event_logs(response_json, server_id, log_type='SEL')
                total_logs += log_count
                self.log(f"  Fetched {log_count} SEL logs")
                self.throttler.record_success(ip)
                
        except Exception as e:
            self.log(f"  Could not fetch SEL logs: {e}", "WARN")
        
        # Fetch Lifecycle logs
        try:
            url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Lclog/Entries"
            response, response_time = self.throttler.request_with_safety(
                method='GET',
                url=url,
                ip=ip,
                logger=self.log,
                auth=(username, password),
                timeout=(2, 15)
            )
            
            response_json = None
            if response and response.status_code == 200 and response.content:
                try:
                    response_json = response.json()
                except json.JSONDecodeError:
                    pass
            
            # Log the API call
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Lclog/Entries',
                full_url=url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=response.status_code if response else None,
                response_time_ms=response_time,
                response_body=response_json,
                success=(response and response.status_code == 200),
                error_message=None if (response and response.status_code == 200) else f"HTTP {response.status_code}" if response else "Request failed",
                operation_type='idrac_api'
            )
            
            if response and response.status_code == 200 and response_json:
                log_count = self._store_event_logs(response_json, server_id, log_type='Lifecycle')
                total_logs += log_count
                self.log(f"  Fetched {log_count} Lifecycle logs")
                self.throttler.record_success(ip)
                
        except Exception as e:
            self.log(f"  Could not fetch Lifecycle logs: {e}", "WARN")
        
        return total_logs

    def _store_event_logs(self, data: Dict, server_id: str, log_type: str = 'SEL') -> int:
        """Parse and store event log entries in database (limit to last 50)"""
        try:
            members = data.get('Members', [])
            if not members:
                return 0
            
            # Limit to last 50 entries
            recent_logs = members[-50:] if len(members) > 50 else members
            
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            stored_count = 0
            
            for log_entry in recent_logs:
                try:
                    # Extract fields from log entry
                    # Differentiate between SEL and Lifecycle log formats
                    category = log_entry.get('EntryType', log_type)
                    
                    log_data = {
                        'server_id': server_id,
                        'event_id': log_entry.get('Id'),
                        'timestamp': log_entry.get('Created', datetime.utcnow().isoformat() + 'Z'),
                        'severity': log_entry.get('Severity'),
                        'message': log_entry.get('Message'),
                        'category': f"{log_type}:{category}" if category else log_type,
                        'sensor_type': log_entry.get('SensorType'),
                        'sensor_number': log_entry.get('SensorNumber'),
                        'raw_data': log_entry
                    }
                    
                    # Insert into server_event_logs table
                    insert_url = f"{DSM_URL}/rest/v1/server_event_logs"
                    response = requests.post(insert_url, headers=headers, json=log_data, verify=VERIFY_SSL)
                    
                    if response.status_code in [200, 201]:
                        stored_count += 1
                except Exception as e:
                    self.log(f"  Error storing event log: {e}", "DEBUG")
            
            return stored_count
            
        except Exception as e:
            self.log(f"  Error parsing event logs: {e}", "WARN")
            return 0

    def _fetch_bios_attributes(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None) -> Optional[Dict]:
        """Fetch BIOS attributes for initial snapshot"""
        try:
            url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Bios"
            response, response_time = self.throttler.request_with_safety(
                method='GET',
                url=url,
                ip=ip,
                logger=self.log,
                auth=(username, password),
                timeout=(2, 15)
            )
            
            response_json = None
            if response and response.content:
                try:
                    response_json = response.json()
                except json.JSONDecodeError:
                    pass
            
            # Log the request
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Systems/System.Embedded.1/Bios',
                full_url=url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=response.status_code if response else None,
                response_time_ms=response_time,
                response_body=response_json,
                success=(response and response.status_code == 200 and response_json is not None),
                error_message=None if (response and response.status_code == 200) else f"HTTP {response.status_code}" if response else "Request failed",
                operation_type='idrac_api'
            )
            
            if response and response.status_code == 200 and response_json:
                return response_json.get('Attributes', {})
            
            return None
            
        except Exception as e:
            self.log(f"  Could not fetch BIOS attributes: {e}", "DEBUG")
            return None
    
    def _fetch_storage_drives(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None) -> List[Dict]:
        """
        Fetch drive inventory using Dell Redfish Storage API with $expand optimization.
        
        OPTIMIZED: Uses $expand to reduce N+1 queries to 1-2 calls per controller.
        
        Dell Redfish Pattern:
        1. GET /redfish/v1/Systems/System.Embedded.1/Storage?$expand=Members → controllers with data
        2. For each controller, use $expand=Drives,Volumes to get all in one call
        
        Returns drives with RAID/Volume info and WWN/NAA for ESXi correlation.
        """
        drives = []
        volumes_info = {}  # Map drive IDs to volume info
        
        try:
            # OPTIMIZED: Get storage controllers with $expand
            storage_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Storage?$expand=Members"
            storage_response, storage_time = self.throttler.request_with_safety(
                method='GET',
                url=storage_url,
                ip=ip,
                logger=self.log,
                auth=(username, password),
                timeout=(2, 30)  # Longer timeout for expanded data
            )
            
            # Fallback to non-expanded if $expand not supported
            if not storage_response or storage_response.status_code != 200:
                storage_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Storage"
                storage_response, storage_time = self.throttler.request_with_safety(
                    method='GET',
                    url=storage_url,
                    ip=ip,
                    logger=self.log,
                    auth=(username, password),
                    timeout=(2, 15)
                )
            
            if not storage_response or storage_response.status_code != 200:
                return drives
            
            storage_data = storage_response.json()
            controllers = storage_data.get('Members', [])
            
            for controller_item in controllers:
                try:
                    # If $expand worked, controller_item has full data; else it's a reference
                    if '@odata.id' in controller_item and 'Id' not in controller_item:
                        # Need to fetch controller with $expand=Drives,Volumes
                        controller_url = f"https://{ip}{controller_item['@odata.id']}?$expand=Drives,Volumes"
                        ctrl_resp, _ = self.throttler.request_with_safety(
                            method='GET',
                            url=controller_url,
                            ip=ip,
                            logger=self.log,
                            auth=(username, password),
                            timeout=(2, 30)
                        )
                        
                        if not ctrl_resp or ctrl_resp.status_code != 200:
                            # Fallback without $expand
                            controller_url = f"https://{ip}{controller_item['@odata.id']}"
                            ctrl_resp, _ = self.throttler.request_with_safety(
                                method='GET',
                                url=controller_url,
                                ip=ip,
                                logger=self.log,
                                auth=(username, password),
                                timeout=(2, 15)
                            )
                            if not ctrl_resp or ctrl_resp.status_code != 200:
                                continue
                        
                        ctrl_data = ctrl_resp.json()
                    else:
                        ctrl_data = controller_item
                    
                    controller_name = ctrl_data.get('Id', 'Unknown')
                    
                    # Process Volumes to build drive-to-volume mapping
                    volumes = ctrl_data.get('Volumes', {})
                    if isinstance(volumes, dict) and 'Members' in volumes:
                        # Volumes were expanded
                        for vol in volumes.get('Members', []):
                            vol_data = vol if 'Id' in vol else None
                            if vol_data:
                                self._map_volume_to_drives(vol_data, volumes_info, controller_name)
                    elif isinstance(volumes, dict) and '@odata.id' in volumes:
                        # Need to fetch volumes separately with $expand
                        volumes_url = f"https://{ip}{volumes['@odata.id']}?$expand=Members"
                        vol_resp, _ = self.throttler.request_with_safety(
                            method='GET',
                            url=volumes_url,
                            ip=ip,
                            logger=self.log,
                            auth=(username, password),
                            timeout=(2, 20)
                        )
                        if vol_resp and vol_resp.status_code == 200:
                            vol_collection = vol_resp.json()
                            for vol in vol_collection.get('Members', []):
                                vol_data = vol if 'Id' in vol else None
                                if vol_data:
                                    self._map_volume_to_drives(vol_data, volumes_info, controller_name)
                    
                    # Process Drives
                    drives_data = ctrl_data.get('Drives', [])
                    for drive_item in drives_data:
                        try:
                            # If drive_item has full data (from $expand), use it
                            if 'Id' in drive_item and 'SerialNumber' in drive_item:
                                drive_data = drive_item
                            elif '@odata.id' in drive_item:
                                # Need to fetch individual drive
                                drive_url = f"https://{ip}{drive_item['@odata.id']}"
                                drive_resp, _ = self.throttler.request_with_safety(
                                    method='GET',
                                    url=drive_url,
                                    ip=ip,
                                    logger=self.log,
                                    auth=(username, password),
                                    timeout=(2, 15)
                                )
                                if not drive_resp or drive_resp.status_code != 200:
                                    continue
                                drive_data = drive_resp.json()
                            else:
                                continue
                            
                            drive_info = self._extract_drive_info(drive_data, controller_name, volumes_info)
                            if drive_info:
                                drives.append(drive_info)
                                
                        except Exception as e:
                            self.log(f"  Error processing drive: {e}", "DEBUG")
                            continue
                            
                except Exception as e:
                    self.log(f"  Error fetching controller: {e}", "DEBUG")
                    continue
            
            return drives
            
        except Exception as e:
            self.log(f"  Could not fetch storage drives: {e}", "DEBUG")
            return []
    
    def _map_volume_to_drives(self, vol_data: Dict, volumes_info: Dict, controller_name: str):
        """Map volume/RAID info to constituent drives"""
        try:
            volume_id = vol_data.get('Id')
            volume_name = vol_data.get('Name')
            raid_level = vol_data.get('RAIDType')  # e.g., "RAID1", "RAID5"
            
            # Get Dell OEM data for additional RAID details
            dell_volume = vol_data.get('Oem', {}).get('Dell', {}).get('DellVolume', {})
            span_depth = dell_volume.get('SpanDepth')
            span_length = dell_volume.get('SpanLength')
            
            # Get identifiers (WWN/NAA for ESXi correlation)
            identifiers = vol_data.get('Identifiers', [])
            wwn = None
            naa = None
            for ident in identifiers:
                if ident.get('DurableNameFormat') == 'NAA':
                    naa = ident.get('DurableName')
                    wwn = naa  # NAA is the WWN format ESXi uses
                elif ident.get('DurableNameFormat') == 'UUID':
                    if not wwn:
                        wwn = ident.get('DurableName')
            
            # Map to each drive in this volume
            links = vol_data.get('Links', {})
            for drive_link in links.get('Drives', []):
                drive_odata_id = drive_link.get('@odata.id', '')
                # Extract drive ID from path like /redfish/v1/.../Drives/Disk.Bay.0:Enclosure.Internal.0-1:AHCI.Slot.0-1
                drive_id = drive_odata_id.split('/')[-1] if drive_odata_id else None
                if drive_id:
                    volumes_info[drive_id] = {
                        'volume_id': volume_id,
                        'volume_name': volume_name,
                        'raid_level': raid_level,
                        'span_depth': span_depth,
                        'span_length': span_length,
                        'wwn': wwn,
                        'naa': naa,
                        'controller': controller_name
                    }
        except Exception as e:
            pass  # Non-critical, continue without volume mapping
    
    def _extract_drive_info(self, drive_data: Dict, controller_name: str, volumes_info: Dict) -> Optional[Dict]:
        """Extract drive information from Redfish response"""
        try:
            drive_id = drive_data.get('Id') or drive_data.get('Name')
            capacity_bytes = drive_data.get('CapacityBytes', 0)
            physical_location = drive_data.get('PhysicalLocation', {}).get('PartLocation', {})
            
            # Get volume info if this drive is part of a RAID volume
            vol_info = volumes_info.get(drive_id, {})
            
            # Get drive's own identifiers
            identifiers = drive_data.get('Identifiers', [])
            drive_wwn = None
            for ident in identifiers:
                if ident.get('DurableNameFormat') in ['NAA', 'UUID', 'EUI']:
                    drive_wwn = ident.get('DurableName')
                    break
            
            return {
                'name': drive_id,
                'manufacturer': drive_data.get('Manufacturer'),
                'model': drive_data.get('Model'),
                'serial_number': drive_data.get('SerialNumber'),
                'part_number': drive_data.get('PartNumber'),
                'media_type': drive_data.get('MediaType'),  # HDD, SSD
                'protocol': drive_data.get('Protocol'),      # SATA, SAS, NVMe
                'capacity_bytes': capacity_bytes,
                'capacity_gb': round(capacity_bytes / (1024**3), 2) if capacity_bytes else None,
                'slot': str(physical_location.get('LocationOrdinalValue')) if physical_location.get('LocationOrdinalValue') is not None else None,
                'enclosure': physical_location.get('ServiceLabel'),
                'controller': controller_name,
                'health': drive_data.get('Status', {}).get('Health'),
                'status': drive_data.get('Status', {}).get('State'),
                'predicted_failure': drive_data.get('PredictedMediaLifeLeftPercent', 100) < 10 if drive_data.get('PredictedMediaLifeLeftPercent') else False,
                'life_remaining_percent': drive_data.get('PredictedMediaLifeLeftPercent'),
                'firmware_version': drive_data.get('Revision'),
                'rotation_speed_rpm': drive_data.get('RotationSpeedRPM'),
                'capable_speed_gbps': drive_data.get('CapableSpeedGbs'),
                # RAID/Volume info (from volumes_info mapping)
                'volume_id': vol_info.get('volume_id'),
                'volume_name': vol_info.get('volume_name'),
                'raid_level': vol_info.get('raid_level'),
                'span_depth': vol_info.get('span_depth'),
                'span_length': vol_info.get('span_length'),
                'wwn': vol_info.get('wwn') or drive_wwn,
                'naa': vol_info.get('naa'),
            }
        except Exception as e:
            return None
    
    def _sync_server_drives(self, server_id: str, drives: List[Dict]):
        """Sync drive inventory to server_drives table"""
        try:
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            
            for drive in drives:
                if not drive.get('serial_number'):
                    continue  # Skip drives without serial numbers
                
                drive_data = {
                    'server_id': server_id,
                    'name': drive.get('name'),
                    'manufacturer': drive.get('manufacturer'),
                    'model': drive.get('model'),
                    'serial_number': drive.get('serial_number'),
                    'part_number': drive.get('part_number'),
                    'media_type': drive.get('media_type'),
                    'protocol': drive.get('protocol'),
                    'capacity_bytes': drive.get('capacity_bytes'),
                    'capacity_gb': drive.get('capacity_gb'),
                    'slot': drive.get('slot'),
                    'enclosure': drive.get('enclosure'),
                    'controller': drive.get('controller'),
                    'health': drive.get('health'),
                    'status': drive.get('status'),
                    'predicted_failure': drive.get('predicted_failure'),
                    'life_remaining_percent': drive.get('life_remaining_percent'),
                    'firmware_version': drive.get('firmware_version'),
                    'rotation_speed_rpm': drive.get('rotation_speed_rpm'),
                    'capable_speed_gbps': drive.get('capable_speed_gbps'),
                    # RAID/Volume info for ESXi correlation
                    'volume_id': drive.get('volume_id'),
                    'volume_name': drive.get('volume_name'),
                    'raid_level': drive.get('raid_level'),
                    'wwn': drive.get('wwn'),
                    'last_sync': datetime.utcnow().isoformat() + 'Z',
                }
                
                # Upsert drive (update if exists, insert if new)
                upsert_url = f"{DSM_URL}/rest/v1/server_drives"
                upsert_params = {
                    "on_conflict": "server_id,serial_number",
                    "resolution": "merge-duplicates"
                }
                requests.post(upsert_url, headers=headers, json=drive_data, params=upsert_params, verify=VERIFY_SSL)
                
        except Exception as e:
            self.log(f"  Error syncing drives for server {server_id}: {e}", "WARN")

    def _fetch_network_adapters(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None) -> List[Dict]:
        """
        Fetch NIC inventory using Dell Redfish Network Adapters API with $expand optimization.
        
        OPTIMIZED: Uses $expand to reduce N+1 queries.
        
        Dell Redfish Pattern (optimized):
        1. GET /redfish/v1/Chassis/System.Embedded.1/NetworkAdapters?$expand=Members → all adapters
        2. For each adapter, GET NetworkDeviceFunctions?$expand=Members → all functions in one call
        
        This reduces calls from ~20+ to ~3-5 per server.
        """
        nics = []
        
        try:
            # OPTIMIZED: Get network adapters with $expand
            adapters_url = f"https://{ip}/redfish/v1/Chassis/System.Embedded.1/NetworkAdapters?$expand=Members"
            adapters_response, _ = self.throttler.request_with_safety(
                method='GET',
                url=adapters_url,
                ip=ip,
                logger=self.log,
                auth=(username, password),
                timeout=(2, 30)
            )
            
            # Fallback to non-expanded if $expand not supported
            if not adapters_response or adapters_response.status_code != 200:
                adapters_url = f"https://{ip}/redfish/v1/Chassis/System.Embedded.1/NetworkAdapters"
                adapters_response, _ = self.throttler.request_with_safety(
                    method='GET',
                    url=adapters_url,
                    ip=ip,
                    logger=self.log,
                    auth=(username, password),
                    timeout=(2, 15)
                )
            
            if not adapters_response or adapters_response.status_code != 200:
                return nics
            
            adapters_data = adapters_response.json()
            adapter_items = adapters_data.get('Members', [])
            
            for adapter_item in adapter_items:
                try:
                    # If $expand worked, adapter_item has full data
                    if 'Id' in adapter_item and 'Manufacturer' in adapter_item:
                        adapter_data = adapter_item
                    elif '@odata.id' in adapter_item:
                        # Need to fetch adapter
                        adapter_url = f"https://{ip}{adapter_item['@odata.id']}"
                        adapter_resp, _ = self.throttler.request_with_safety(
                            method='GET',
                            url=adapter_url,
                            ip=ip,
                            logger=self.log,
                            auth=(username, password),
                            timeout=(2, 15)
                        )
                        
                        if not adapter_resp or adapter_resp.status_code != 200:
                            continue
                        
                        adapter_data = adapter_resp.json()
                    else:
                        continue
                    
                    adapter_id = adapter_data.get('Id')
                    manufacturer = adapter_data.get('Manufacturer')
                    model = adapter_data.get('Model')
                    serial = adapter_data.get('SerialNumber')
                    part_number = adapter_data.get('PartNumber')
                    
                    # Get NetworkDeviceFunctions with $expand
                    functions_link = adapter_data.get('NetworkDeviceFunctions', {}).get('@odata.id')
                    if functions_link:
                        # OPTIMIZED: Request with $expand=Members
                        functions_url = f"https://{ip}{functions_link}?$expand=Members"
                        functions_resp, _ = self.throttler.request_with_safety(
                            method='GET',
                            url=functions_url,
                            ip=ip,
                            logger=self.log,
                            auth=(username, password),
                            timeout=(2, 30)
                        )
                        
                        # Fallback without $expand
                        if not functions_resp or functions_resp.status_code != 200:
                            functions_url = f"https://{ip}{functions_link}"
                            functions_resp, _ = self.throttler.request_with_safety(
                                method='GET',
                                url=functions_url,
                                ip=ip,
                                logger=self.log,
                                auth=(username, password),
                                timeout=(2, 15)
                            )
                        
                        if not functions_resp or functions_resp.status_code != 200:
                            continue
                        
                        functions_data = functions_resp.json()
                        
                        for func_item in functions_data.get('Members', []):
                            try:
                                # If $expand worked, func_item has full data
                                if 'Id' in func_item and 'Ethernet' in func_item:
                                    func_data = func_item
                                elif '@odata.id' in func_item:
                                    # Need to fetch individual function
                                    func_url = f"https://{ip}{func_item['@odata.id']}"
                                    func_resp, _ = self.throttler.request_with_safety(
                                        method='GET',
                                        url=func_url,
                                        ip=ip,
                                        logger=self.log,
                                        auth=(username, password),
                                        timeout=(2, 15)
                                    )
                                    
                                    if not func_resp or func_resp.status_code != 200:
                                        continue
                                    
                                    func_data = func_resp.json()
                                else:
                                    continue
                                
                                nic_info = self._extract_nic_info(func_data, manufacturer, model, serial, part_number)
                                if nic_info:
                                    nics.append(nic_info)
                                    
                            except Exception as e:
                                self.log(f"  Error processing NIC function: {e}", "DEBUG")
                                continue
                except Exception as e:
                    self.log(f"  Error fetching adapter: {e}", "DEBUG")
                    continue
            
            return nics
            
        except Exception as e:
            self.log(f"  Could not fetch network adapters: {e}", "DEBUG")
            return []
    
    def _extract_nic_info(self, func_data: Dict, manufacturer: str, model: str, serial: str, part_number: str) -> Optional[Dict]:
        """Extract NIC information from Redfish NetworkDeviceFunction response"""
        try:
            # Extract ethernet info (contains MAC addresses)
            ethernet = func_data.get('Ethernet', {})
            
            # Get Dell OEM data for link status and speed
            dell_oem = func_data.get('Oem', {}).get('Dell', {}).get('DellNIC', {})
            
            # Parse speed - Dell returns it as string like "25000" or integer
            current_speed = dell_oem.get('LinkSpeed')
            if current_speed is not None:
                try:
                    current_speed = int(current_speed)
                except (ValueError, TypeError):
                    current_speed = None
            
            # Get switch connection info from LLDP if available
            switch_connection_id = dell_oem.get('SwitchConnectionID')
            switch_port_desc = dell_oem.get('SwitchPortConnectionID')
            
            return {
                'fqdd': func_data.get('Id'),  # e.g., "NIC.Integrated.1-1-1"
                'name': func_data.get('Name'),
                'mac_address': ethernet.get('MACAddress'),
                'permanent_mac_address': ethernet.get('PermanentMACAddress'),
                'manufacturer': manufacturer,
                'model': model,
                'serial_number': serial,
                'part_number': part_number,
                'link_status': dell_oem.get('LinkStatus'),
                'current_speed_mbps': current_speed,
                'health': func_data.get('Status', {}).get('Health'),
                'status': func_data.get('Status', {}).get('State'),
                'switch_connection_id': switch_connection_id,
                'switch_port_description': switch_port_desc,
            }
        except Exception as e:
            return None
    
    def _sync_server_nics(self, server_id: str, nics: List[Dict]):
        """Sync NIC inventory to server_nics table"""
        try:
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            
            for nic in nics:
                if not nic.get('fqdd'):
                    continue  # Skip NICs without FQDD
                
                nic_data = {
                    'server_id': server_id,
                    'fqdd': nic.get('fqdd'),
                    'name': nic.get('name'),
                    'mac_address': nic.get('mac_address'),
                    'permanent_mac_address': nic.get('permanent_mac_address'),
                    'manufacturer': nic.get('manufacturer'),
                    'model': nic.get('model'),
                    'serial_number': nic.get('serial_number'),
                    'part_number': nic.get('part_number'),
                    'link_status': nic.get('link_status'),
                    'current_speed_mbps': nic.get('current_speed_mbps'),
                    'health': nic.get('health'),
                    'status': nic.get('status'),
                    'switch_connection_id': nic.get('switch_connection_id'),
                    'switch_port_description': nic.get('switch_port_description'),
                    'last_sync': datetime.utcnow().isoformat() + 'Z',
                }
                
                # Upsert NIC (update if exists, insert if new)
                upsert_url = f"{DSM_URL}/rest/v1/server_nics"
                upsert_params = {
                    "on_conflict": "server_id,fqdd",
                    "resolution": "merge-duplicates"
                }
                requests.post(upsert_url, headers=headers, json=nic_data, params=upsert_params, verify=VERIFY_SSL)
                
        except Exception as e:
            self.log(f"  Error syncing NICs for server {server_id}: {e}", "WARN")

    def _perform_inline_scp_export(self, server_id: str, ip: str, username: str, password: str, backup_name: str, job_id: str) -> bool:
        """Execute SCP export inline without creating a separate job (alias for _execute_inline_scp_export)"""
        return self._execute_inline_scp_export(server_id, ip, username, password, backup_name, job_id)

    def _execute_inline_scp_export(self, server_id: str, ip: str, username: str, password: str, backup_name: str, job_id: str) -> bool:
        """Execute SCP export inline without creating a separate job"""
        try:
            # Use simpler SCP export for initial sync
            export_url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration"
            
            # Export all components in XML format
            payload = {
                "ExportFormat": "XML",
                "ShareParameters": {
                    "Target": "BIOS,IDRAC,NIC,RAID"
                },
                "ExportUse": "Clone",
                "IncludeInExport": "Default"
            }
            
            start_time = time.time()
            response = requests.post(
                export_url,
                auth=(username, password),
                json=payload,
                verify=False,
                timeout=30
            )
            response_time_ms = int((time.time() - start_time) * 1000)
            
            # Log the command
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='POST',
                endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration',
                full_url=export_url,
                request_headers={'Authorization': '[REDACTED]'},
                request_body=payload,
                response_body=_safe_json_parse(response),
                status_code=response.status_code,
                response_time_ms=response_time_ms,
                success=response.status_code in [200, 202],
                operation_type='idrac_api'
            )
            
            if response.status_code not in [200, 202]:
                self.log(f"    SCP export failed: {response.status_code}", "WARN")
                return False
            
            # Wait for export to complete and get content
            if response.status_code == 202:
                scp_content = self._wait_for_scp_export(
                    ip,
                    username,
                    password,
                    response.headers,
                    _safe_json_parse(response),
                    {'id': job_id},  # Minimal job dict
                    server_id
                )
            else:
                export_data = _safe_json_parse(response)
                scp_content = self._extract_scp_content(export_data) or export_data
            
            if not scp_content:
                self.log(f"    SCP export returned no content", "WARN")
                return False
            
            # Save to database
            if isinstance(scp_content, (dict, list)):
                serialized_content = json.dumps(scp_content, indent=2)
                checksum_content = json.dumps(scp_content, separators=(',', ':'))
            else:
                serialized_content = str(scp_content)
                checksum_content = serialized_content
            
            file_size = len(serialized_content.encode('utf-8'))
            checksum = hashlib.sha256(checksum_content.encode()).hexdigest()
            
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            backup_data = {
                'server_id': server_id,
                'export_job_id': job_id,
                'backup_name': backup_name,
                'description': 'Automatic backup during initial server sync',
                'scp_content': scp_content,
                'scp_file_size_bytes': file_size,
                'include_bios': True,
                'include_idrac': True,
                'include_nic': True,
                'include_raid': True,
                'scp_checksum': checksum,
                'is_valid': True
            }
            
            insert_url = f"{DSM_URL}/rest/v1/scp_backups"
            backup_response = requests.post(insert_url, headers=headers, json=backup_data, verify=VERIFY_SSL)
            
            return backup_response.status_code in [200, 201]
            
        except Exception as e:
            self.log(f"    Inline SCP export error: {e}", "WARN")
            return False

    def test_idrac_connection(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None) -> Optional[Dict]:
        """Test iDRAC connection and get basic info (lightweight version using throttler)"""
        url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1"
        
        try:
            # Use throttler for safe request handling
            response, response_time_ms = self.throttler.request_with_safety(
                method='GET',
                url=url,
                ip=ip,
                logger=self.log,
                auth=(username, password),
                timeout=(2, 10)  # 2s connect, 10s read
            )
            
            # Log the test connection request
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Systems/System.Embedded.1',
                full_url=url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=response.status_code if response else None,
                response_time_ms=response_time_ms,
                response_body=_safe_json_parse(response) if response and response.content else None,
                success=response.status_code == 200 if response else False,
                error_message=None if (response and response.status_code == 200) else (f"HTTP {response.status_code}" if response else "Request failed"),
                operation_type='idrac_api'
            )
            
            if response and response.status_code == 200:
                data = _safe_json_parse(response)
                # Record success for circuit breaker
                self.throttler.record_success(ip)
                return {
                    "success": True,
                    "idrac_detected": True,
                    "manufacturer": data.get("Manufacturer", "Unknown"),
                    "model": data.get("Model", "Unknown"),
                    "service_tag": data.get("SKU", None),
                    "serial": data.get("SerialNumber", None),
                    "hostname": data.get("HostName", None),
                    "username": username,
                    "password": password,
                }
            elif response and response.status_code in [401, 403]:
                # Authentication failure BUT iDRAC exists - this is key!
                self.throttler.record_failure(ip, response.status_code, self.log)
                return {
                    "success": False,
                    "idrac_detected": True,  # iDRAC is present, just auth failed
                    "auth_failed": True
                }
            else:
                # Other HTTP error - not a confirmed iDRAC
                return {
                    "success": False,
                    "idrac_detected": False,
                    "auth_failed": False
                }
        except Exception as e:
            # Record failure for circuit breaker
            self.throttler.record_failure(ip, None, self.log)
            
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Systems/System.Embedded.1',
                full_url=url,
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None,
                status_code=None,
                response_time_ms=0,
                response_body=None,
                success=False,
                error_message=str(e),
                operation_type='idrac_api'
            )
            self.log(f"Error testing iDRAC {ip}: {e}", "DEBUG")
            # Connection error - no iDRAC detected
            return {
                "success": False,
                "idrac_detected": False,
                "auth_failed": False
            }

    def refresh_existing_servers(self, job: Dict, server_ids: List[str]):
        """Refresh information for existing servers by querying iDRAC"""
        self.log(f"Refreshing {len(server_ids)} existing server(s)")
        
        try:
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=representation"
            }
            
            # Fetch server records
            servers_url = f"{DSM_URL}/rest/v1/servers"
            servers_params = {"id": f"in.({','.join(server_ids)})", "select": "*"}
            servers_response = requests.get(servers_url, headers=headers, params=servers_params, verify=VERIFY_SSL)
            
            if servers_response.status_code != 200:
                raise Exception(f"Failed to fetch servers: {servers_response.status_code}")
            
            servers = _safe_json_parse(servers_response)
            self.log(f"Found {len(servers)} server(s) to refresh")
            
            # Fetch job tasks to track progress
            tasks = self.get_job_tasks(job['id'])
            task_by_server = {t['server_id']: t for t in tasks if t.get('server_id')}
            
            total_servers = len(servers)
            refreshed_count = 0
            failed_count = 0
            update_errors = []
            servers_with_scp_queued = []  # Track servers with deferred SCP backup jobs
            
            for index, server in enumerate(servers):
                ip = server['ip_address']
                task = task_by_server.get(server['id'])
                
                # Calculate base progress percentage for this server
                base_progress = int((index / total_servers) * 100) if total_servers > 0 else 0
                
                # Update task to running
                if task:
                    self.update_task_status(
                        task['id'],
                        'running',
                        log=f"Querying iDRAC at {ip}...",
                        progress=base_progress,
                        started_at=datetime.now().isoformat()
                    )
                
                self.log(f"Refreshing server {ip}...")
                
                # Resolve credentials using priority order
                username, password, cred_source, used_cred_set_id = self.resolve_credentials_for_server(server)
                
                # Handle credential resolution failures
                if cred_source == 'decrypt_failed':
                    # Update server with decryption error
                    update_data = {
                        'connection_status': 'offline',
                        'connection_error': 'Encryption key not configured; cannot decrypt credentials',
                        'credential_test_status': 'invalid',
                        'credential_last_tested': datetime.utcnow().isoformat() + 'Z'
                    }
                    update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server['id']}"
                    requests.patch(update_url, headers=headers, json=update_data, verify=VERIFY_SSL)
                    self.log(f"  ✗ Cannot decrypt credentials for {ip}", "ERROR")
                    
                    # Mark task as failed
                    if task:
                        self.update_task_status(
                            task['id'],
                            'failed',
                            log=f"✗ Cannot decrypt credentials for {ip}",
                            progress=100,
                            completed_at=datetime.now().isoformat()
                        )
                    
                    failed_count += 1
                    continue
                
                if not username or not password:
                    self.log(f"  ✗ No credentials available for {ip}", "WARN")
                    
                    # Mark task as failed
                    if task:
                        self.update_task_status(
                            task['id'],
                            'failed',
                            log=f"✗ No credentials available for {ip}",
                            progress=100,
                            completed_at=datetime.now().isoformat()
                        )
                    
                    failed_count += 1
                    continue
                
                # Query iDRAC for comprehensive info
                info = self.get_comprehensive_server_info(ip, username, password, server_id=server['id'], job_id=job['id'])
                
                if info:
                    # Define allowed server columns for update
                    allowed_fields = {
                        "manufacturer", "model", "product_name", "service_tag", "hostname",
                        "bios_version", "cpu_count", "memory_gb", "idrac_firmware",
                        "manager_mac_address", "redfish_version", "supported_endpoints",
                        "cpu_model", "cpu_cores_per_socket", "cpu_speed",
                        "boot_mode", "boot_order", "secure_boot", "virtualization_enabled",
                        "total_drives", "total_storage_tb", "power_state"
                    }
                    
                    # Build filtered update payload (exclude None values and credentials)
                    update_data = {k: v for k, v in info.items() if k in allowed_fields and v is not None}
                    
                    # Add status fields
                    update_data.update({
                        'connection_status': 'online',
                        'connection_error': None,
                        'last_seen': datetime.utcnow().isoformat() + 'Z',
                        'credential_test_status': 'valid',
                        'credential_last_tested': datetime.utcnow().isoformat() + 'Z',
                    })
                    
                    # Add health fields from health_status if available
                    if info.get('health_status'):
                        health_status = info['health_status']
                        
                        # Calculate overall_health
                        all_healthy = all([
                            health_status.get('storage_healthy', True) != False,
                            health_status.get('thermal_healthy', True) != False,
                            health_status.get('power_healthy', True) != False
                        ])
                        update_data['overall_health'] = 'OK' if all_healthy else 'Warning'
                        update_data['last_health_check'] = datetime.utcnow().isoformat() + 'Z'
                    
                    # Promote credential_set_id if we used discovered_by or ip_range and server doesn't have one
                    if not server.get('credential_set_id') and used_cred_set_id and cred_source in ['discovered_by_credential_set_id', 'ip_range']:
                        update_data['credential_set_id'] = used_cred_set_id
                        self.log(f"  → Promoting credential_set_id {used_cred_set_id} from {cred_source}", "INFO")
                    
                    # Mirror model to product_name if missing
                    if 'product_name' not in update_data and info.get('model'):
                        update_data['product_name'] = info['model']
                    
                    self.log(f"  Updating {ip} with fields: {list(update_data.keys())}", "DEBUG")
                    
                    update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server['id']}"
                    update_response = requests.patch(update_url, headers=headers, json=update_data, verify=VERIFY_SSL)
                    
                    if update_response.status_code in [200, 204]:
                        self.log(f"  ✓ Refreshed {ip}: {info.get('model')} - {info.get('hostname')}")
                        refreshed_count += 1
                        
                        # Insert health record to server_health table if health data exists
                        if info.get('health_status'):
                            health_status = info['health_status']
                            health_record = {
                                'server_id': server['id'],
                                'timestamp': datetime.utcnow().isoformat() + 'Z',
                                'overall_health': update_data.get('overall_health', 'Unknown'),
                                'power_state': health_status.get('power_state') or info.get('power_state'),
                                'storage_health': 'OK' if health_status.get('storage_healthy') else ('Warning' if health_status.get('storage_healthy') == False else None),
                                'fan_health': health_status.get('fan_health'),
                                'psu_health': 'OK' if health_status.get('power_healthy') else ('Warning' if health_status.get('power_healthy') == False else None),
                                'temperature_celsius': health_status.get('temperature_celsius'),
                                'sensors': {}
                            }
                            
                            try:
                                health_url = f"{DSM_URL}/rest/v1/server_health"
                                health_response = requests.post(
                                    health_url,
                                    headers=headers,
                                    json=health_record,
                                    verify=VERIFY_SSL
                                )
                                if health_response.status_code in [200, 201]:
                                    self.log(f"  ✓ Health record saved to server_health table", "DEBUG")
                                else:
                                    self.log(f"  Warning: Could not save health record: {health_response.status_code}", "WARN")
                            except Exception as health_err:
                                self.log(f"  Warning: Failed to save health record: {health_err}", "WARN")
                        
                        # Sync drives to server_drives table
                        if info.get('drives'):
                            self._sync_server_drives(server['id'], info['drives'])
                        
                        # Sync NICs to server_nics table
                        if info.get('nics'):
                            self._sync_server_nics(server['id'], info['nics'])
                        
                        # Try auto-linking to vCenter if service_tag was updated
                        if info.get('service_tag'):
                            self.auto_link_vcenter(server['id'], info.get('service_tag'))
                        
                        # Mark task as completed
                        if task:
                            self.update_task_status(
                                task['id'],
                                'completed',
                                log=f"✓ Refreshed {ip}: {info.get('model')} - {info.get('hostname')}",
                                progress=100,
                                completed_at=datetime.now().isoformat()
                            )
                        
                        # Create audit trail entry for server discovery
                        self._create_server_audit_entry(
                            server_id=server['id'],
                            job_id=job['id'],
                            action='server_discovery',
                            summary=f"Server discovered: {info.get('model', 'Unknown')} ({info.get('service_tag', 'N/A')})",
                            details={
                                'bios_version': info.get('bios_version'),
                                'idrac_firmware': info.get('idrac_firmware'),
                                'health_status': info.get('health_status'),
                                'event_logs_fetched': info.get('event_log_count', 0)
                            }
                        )
                        
                        # Queue SCP backup as background job (deferred for speed)
                        # This removes the slowest operation from the discovery critical path
                        self._create_automatic_scp_backup(server['id'], job['id'])
                        servers_with_scp_queued.append(server['id'])
                    else:
                        error_detail = {
                            'ip': ip,
                            'status': update_response.status_code,
                            'body': update_response.text[:500]
                        }
                        update_errors.append(error_detail)
                        self.log(f"  ✗ Failed to update DB for {ip}: {update_response.status_code} {update_response.text}", "ERROR")
                        
                        # Mark task as failed
                        if task:
                            self.update_task_status(
                                task['id'],
                                'failed',
                                log=f"✗ Failed to update DB for {ip}",
                                progress=100,
                                completed_at=datetime.now().isoformat()
                            )
                        
                        failed_count += 1
                else:
                    # Update as offline - failed to query iDRAC
                    update_data = {
                        'connection_status': 'offline',
                        'connection_error': f'Failed to query iDRAC using {cred_source} credentials - check network or credentials',
                        'last_connection_test': datetime.utcnow().isoformat() + 'Z',
                        'credential_test_status': 'invalid',
                    }
                    
                    update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server['id']}"
                    requests.patch(update_url, headers=headers, json=update_data, verify=VERIFY_SSL)
                    
                    self.log(f"  ✗ Failed to connect to {ip} (tried {cred_source})", "WARN")
                    
                    # Mark task as failed
                    if task:
                        self.update_task_status(
                            task['id'],
                            'failed',
                            log=f"✗ Failed to connect to {ip}",
                            progress=100,
                            completed_at=datetime.now().isoformat()
                        )
                    
                    failed_count += 1
            
            # Complete the job
            summary = f"Synced {refreshed_count} server(s)"
            if failed_count > 0:
                summary += f", {failed_count} failed"
            
            job_details = {
                'summary': summary,
                'synced': refreshed_count,
                'failed': failed_count,
                'scp_backups_queued': len(servers_with_scp_queued),  # SCP backups are now background jobs
                'scp_deferred': True,  # Indicate SCP is handled via separate jobs for speed
            }
            if update_errors:
                job_details['update_errors'] = update_errors
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details=job_details
            )
            
            self.log(f"Server refresh complete: {summary}")
            
        except Exception as e:
            self.log(f"Error refreshing servers: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )

    def _quick_port_check(self, ip: str, port: int = 443, timeout: float = 1.0) -> bool:
        """
        Stage 1: Quick TCP port check to identify live IPs.
        Returns True if port is open, False otherwise.
        """
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            result = sock.connect_ex((ip, port))
            sock.close()
            return result == 0
        except:
            return False
    
    def _detect_idrac(self, ip: str, timeout: float = 2.0) -> bool:
        """
        Stage 2: Quick iDRAC detection via unauthenticated request to /redfish/v1.
        Dell iDRACs respond with 401/403 and specific headers.
        Returns True if iDRAC detected, False otherwise.
        """
        try:
            url = f"https://{ip}/redfish/v1"
            response = requests.get(
                url,
                verify=False,
                timeout=timeout,
                allow_redirects=False
            )
            
            # Dell iDRACs typically return 401/403 for unauthenticated requests
            # or 200 with Redfish service root
            if response.status_code in [200, 401, 403]:
                # Check for Dell/iDRAC indicators in headers or response
                server_header = response.headers.get('Server', '').lower()
                content_type = response.headers.get('Content-Type', '').lower()
                
                # Dell iDRAC indicators
                if 'idrac' in server_header or 'dell' in server_header:
                    return True
                
                # Redfish service root check (200 response)
                if response.status_code == 200 and 'application/json' in content_type:
                    try:
                        data = response.json()
                        # Check for Redfish identifiers
                        if 'RedfishVersion' in data or '@odata.context' in data:
                            return True
                    except:
                        pass
                
                # 401/403 with WWW-Authenticate suggests Redfish API
                if response.status_code in [401, 403]:
                    www_auth = response.headers.get('WWW-Authenticate', '').lower()
                    if 'basic' in www_auth or 'digest' in www_auth:
                        return True
            
            return False
        except:
            return False
    
    def discover_single_ip(self, ip: str, credential_sets: List[Dict], job_id: str) -> Dict:
        """
        3-Stage optimized IP discovery:
        Stage 1: Quick TCP port check (443)
        Stage 2: Unauthenticated iDRAC detection (/redfish/v1)
        Stage 3: Full authentication only on confirmed iDRACs
        
        Priority:
          1. Credential sets matching IP ranges (highest priority)
          2. Global credential sets selected in the discovery job
        """
        
        # Stage 1: Quick port check - skip IPs with closed port 443
        port_open = self._quick_port_check(ip, port=443, timeout=1.0)
        if not port_open:
            return {
                'success': False,
                'ip': ip,
                'idrac_detected': False,
                'auth_failed': False,
                'port_open': False
            }
        
        # Stage 2: Quick iDRAC detection - skip non-iDRAC devices
        if not self._detect_idrac(ip, timeout=2.0):
            return {
                'success': False,
                'ip': ip,
                'idrac_detected': False,
                'auth_failed': False,
                'port_open': True
            }
        
        # Stage 3: Full authentication on confirmed iDRACs
        self.log(f"iDRAC detected at {ip}, attempting authentication...", "INFO")
        
        # Step 1: Get credential sets that match this IP's range
        range_based_credentials = self.get_credential_sets_for_ip(ip)
        
        # Step 2: Combine with global credentials (range-based first)
        all_credentials = range_based_credentials + credential_sets
        
        # Remove duplicates (prioritize range-based)
        seen_ids = set()
        unique_credentials = []
        for cred in all_credentials:
            if cred['id'] not in seen_ids:
                unique_credentials.append(cred)
                seen_ids.add(cred['id'])
        
        # Track if any response indicated an iDRAC exists (401/403 response)
        idrac_detected = False
        
        # Step 3: Try each credential set in order
        for cred_set in sorted(unique_credentials, key=lambda x: x.get('priority', 999)):
            try:
                matched_by = cred_set.get('matched_range', 'manual_selection')
                self.log(f"Trying {cred_set['name']} for {ip} (matched: {matched_by})", "INFO")
                
                # For range-based creds, password is already decrypted
                # For global creds from DB, it may be in 'password_encrypted' field
                password = cred_set.get('password')
                if not password:
                    # Decrypt if password_encrypted exists
                    encrypted = cred_set.get('password_encrypted')
                    if encrypted:
                        password = self.decrypt_password(encrypted)
                
                if not password:
                    self.log(f"No valid password for {cred_set['name']}", "WARN")
                    continue
                
                result = self.test_idrac_connection(
                    ip,
                    cred_set['username'],
                    password,
                    server_id=None,
                    job_id=job_id
                )
                
                if result:
                    # Track if iDRAC was detected by ANY credential attempt
                    if result.get('idrac_detected'):
                        idrac_detected = True
                    
                    # If successful, return immediately
                    if result.get('success'):
                        return {
                            'success': True,
                            'ip': ip,
                            'idrac_detected': True,
                            'credential_set_id': cred_set.get('id'),
                            'credential_set_name': cred_set['name'],
                            'matched_by': matched_by,
                            'auth_failed': False,
                            **result
                        }
            except Exception as e:
                continue  # Try next credential set
        
        # All credential sets failed
        return {
            'success': False,
            'ip': ip,
            'idrac_detected': idrac_detected,  # Only True if we got 401/403
            'auth_failed': idrac_detected  # Only mark auth_failed if iDRAC exists
        }

    def insert_discovered_server(self, server: Dict, job_id: str):
        """Insert discovered server into database with credential info"""
        try:
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            
            # Check if server already exists by IP
            check_url = f"{DSM_URL}/rest/v1/servers"
            check_params = {"ip_address": f"eq.{server['ip']}", "select": "id"}
            existing = requests.get(check_url, headers=headers, params=check_params, verify=VERIFY_SSL)
            
            server_data = {
                'hostname': server.get('hostname'),
                'model': server.get('model'),
                'service_tag': server.get('service_tag'),
                'manager_mac_address': server.get('manager_mac_address'),
                'product_name': server.get('product_name'),
                'manufacturer': server.get('manufacturer', 'Dell'),
                'redfish_version': server.get('redfish_version'),
                'idrac_firmware': server.get('idrac_firmware'),
                'bios_version': server.get('bios_version'),
                'cpu_count': server.get('cpu_count'),
                'memory_gb': server.get('memory_gb'),
                'supported_endpoints': server.get('supported_endpoints'),
                'connection_status': 'online',
                'last_seen': datetime.now().isoformat(),
                # Link to credential set directly - don't store plaintext passwords
                'credential_set_id': server.get('credential_set_id'),
                'credential_test_status': 'valid',
                'credential_last_tested': datetime.now().isoformat(),
                'discovered_by_credential_set_id': server.get('credential_set_id'),
                'discovery_job_id': job_id,
                'cpu_model': server.get('cpu_model'),
                'cpu_cores_per_socket': server.get('cpu_cores_per_socket'),
                'cpu_speed': server.get('cpu_speed'),
                'boot_mode': server.get('boot_mode'),
                'boot_order': server.get('boot_order'),
                'secure_boot': server.get('secure_boot'),
                'virtualization_enabled': server.get('virtualization_enabled'),
                'total_drives': server.get('total_drives'),
                'total_storage_tb': server.get('total_storage_tb'),
            }
            
            if existing.status_code == 200 and _safe_json_parse(existing):
                # Update existing server
                server_id = _safe_json_parse(existing)[0]['id']
                update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}"
                requests.patch(update_url, headers=headers, json=server_data, verify=VERIFY_SSL)
                self.log(f"Updated existing server: {server['ip']}")
                
                # Sync drives to server_drives table
                if server.get('drives'):
                    self._sync_server_drives(server_id, server['drives'])
                
                # Try auto-linking to vCenter
                if server.get('service_tag'):
                    self.auto_link_vcenter(server_id, server.get('service_tag'))
            else:
                # Insert new server
                server_data['ip_address'] = server['ip']
                insert_url = f"{DSM_URL}/rest/v1/servers"
                response = requests.post(insert_url, headers=headers, json=server_data, verify=VERIFY_SSL)
                self.log(f"Inserted new server: {server['ip']}")
                
                # Try auto-linking to vCenter for new server
                if response.status_code in [200, 201]:
                    new_server = _safe_json_parse(response)
                    if new_server:
                        server_id = new_server[0]['id'] if isinstance(new_server, list) else new_server['id']
                        
                        # Sync drives for new server
                        if server.get('drives'):
                            self._sync_server_drives(server_id, server['drives'])
                        
                        if server.get('service_tag'):
                            self.auto_link_vcenter(server_id, server.get('service_tag'))
        except Exception as e:
            self.log(f"Error inserting server {server['ip']}: {e}", "ERROR")

    def insert_auth_failed_server(self, ip: str, job_id: str):
        """Insert server that was discovered but authentication failed"""
        try:
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            
            # Check if server already exists
            check_url = f"{DSM_URL}/rest/v1/servers"
            params = {"ip_address": f"eq.{ip}"}
            existing = requests.get(check_url, headers=headers, params=params, verify=VERIFY_SSL)
            
            server_data = {
                'ip_address': ip,
                'connection_status': 'offline',
                'connection_error': 'Authentication failed - credentials required',
                'credential_test_status': 'invalid',
                'credential_last_tested': datetime.now().isoformat(),
                'last_connection_test': datetime.now().isoformat(),
                'discovery_job_id': job_id,
                'notes': f'Discovered by IP scan on {datetime.now().strftime("%Y-%m-%d %H:%M:%S")} - iDRAC detected but no valid credentials'
            }
            
            if existing.status_code == 200 and _safe_json_parse(existing):
                # Update existing server with auth failure status
                server_id = _safe_json_parse(existing)[0]['id']
                update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}"
                requests.patch(update_url, headers=headers, json=server_data, verify=VERIFY_SSL)
                self.log(f"Updated server {ip} - auth failed status")
            else:
                # Insert new server with auth failed status
                insert_url = f"{DSM_URL}/rest/v1/servers"
                requests.post(insert_url, headers=headers, json=server_data, verify=VERIFY_SSL)
                self.log(f"Inserted auth-failed server: {ip}")
                
        except Exception as e:
            self.log(f"Error inserting auth-failed server {ip}: {e}", "ERROR")

    def _create_server_audit_entry(self, server_id: str, job_id: str, action: str, summary: str, details: Dict = None):
        """Create audit trail entry for server operations"""
        try:
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            
            # Get job creator
            job_url = f"{DSM_URL}/rest/v1/jobs?id=eq.{job_id}&select=created_by"
            job_response = requests.get(job_url, headers=headers, verify=VERIFY_SSL)
            created_by = None
            if job_response.status_code == 200:
                jobs = _safe_json_parse(job_response)
                if jobs:
                    created_by = jobs[0].get('created_by')
            
            audit_entry = {
                'action': action,
                'details': {
                    'server_id': server_id,
                    'summary': summary,
                    **(details or {})
                },
                'user_id': created_by
            }
            
            insert_url = f"{DSM_URL}/rest/v1/audit_logs"
            requests.post(insert_url, headers=headers, json=audit_entry, verify=VERIFY_SSL)
            
        except Exception as e:
            self.log(f"  Could not create audit entry: {e}", "DEBUG")
    
    def _create_automatic_scp_backup(self, server_id: str, parent_job_id: str):
        """Create automatic SCP backup job for newly discovered servers"""
        try:
            headers = {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}
            
            # Get user who created the parent job
            job_url = f"{DSM_URL}/rest/v1/jobs?id=eq.{parent_job_id}&select=created_by"
            job_response = requests.get(job_url, headers=headers, verify=VERIFY_SSL)
            created_by = None
            if job_response.status_code == 200:
                jobs = _safe_json_parse(job_response)
                if jobs and len(jobs) > 0:
                    created_by = jobs[0].get('created_by')
            
            if not created_by:
                self.log(f"  Cannot create SCP backup: no user found for parent job", "WARN")
                return
            
            backup_job = {
                'job_type': 'scp_export',
                'created_by': created_by,
                'target_scope': {'server_ids': [server_id]},
                'details': {
                    'backup_name': f'Initial-{datetime.now().strftime("%Y%m%d-%H%M%S")}',
                    'description': 'Automatic backup on server discovery',
                    'include_bios': True,
                    'include_idrac': True,
                    'include_raid': True,
                    'include_nic': True
                }
            }
            
            insert_url = f"{DSM_URL}/rest/v1/jobs"
            response = requests.post(insert_url, headers=headers, json=backup_job, verify=VERIFY_SSL)
            
            if response.status_code in [200, 201]:
                self.log(f"  ✓ Created automatic SCP backup job for server {server_id}", "INFO")
            else:
                self.log(f"  Failed to create SCP backup: HTTP {response.status_code}", "WARN")
                
        except Exception as e:
            self.log(f"  Failed to create SCP backup: {e}", "WARN")
