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
        """
        Get comprehensive server information from iDRAC Redfish API using SessionManager.
        
        OPTIMIZED: Uses session-based auth, capability detection, and aggressive $expand to minimize API calls.
        - First sync: Detects iDRAC capabilities (~2-4 test calls), caches in supported_endpoints
        - Subsequent syncs: Uses cached capabilities to skip unsupported $expand attempts
        
        Before: 50-80+ API calls per server (with wasted fallback attempts)
        After: 8-15 API calls per server (capability-aware, no wasted calls)
        """
        system_data = None
        session = None
        capabilities = None
        
        try:
            # Load cached capabilities FIRST to know if legacy_ssl is needed
            legacy_ssl = False
            if server_id:
                capabilities = self._get_cached_idrac_capabilities(server_id)
                legacy_ssl = (capabilities or {}).get('requires_legacy_ssl', False)
            
            # OPTIMIZATION: Create Redfish session once for all requests
            if full_onboarding:
                session = self.create_idrac_session(
                    ip, username, password, 
                    server_id=server_id, job_id=job_id,
                    legacy_ssl=legacy_ssl  # Pass legacy_ssl for iDRAC 8
                )
                if session and session.get('token'):
                    self.log(f"  ✓ Session created for {ip} (legacy_ssl={legacy_ssl})", "DEBUG")
            
            # Get system information - use session if available
            # Use longer connect timeout for iDRAC 8
            system_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1"
            
            system_response, response_time_ms = self._make_session_request(
                ip, system_url, session, username, password, 
                timeout=(10 if legacy_ssl else 2, 15),
                legacy_ssl=legacy_ssl
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
                request_headers={'X-Auth-Token': '[SESSION]'} if session else {'Authorization': f'Basic {username}:***'},
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
            else:
                self.log(f"  Failed to get system info from {ip}", "ERROR")
                return None
                    
        except Exception as e:
            self.log_idrac_command(
                server_id=server_id, job_id=job_id, task_id=None,
                command_type='GET', endpoint='/redfish/v1/Systems/System.Embedded.1',
                full_url=f"https://{ip}/redfish/v1/Systems/System.Embedded.1",
                request_headers={'Authorization': f'Basic {username}:***'},
                request_body=None, status_code=None, response_time_ms=0,
                response_body=None, success=False, error_message=str(e),
                operation_type='idrac_api'
            )
            self.log(f"  Error getting system info from {ip}: {e}", "ERROR")
            return None
        
        if system_data is None:
            return None
        
        # Get manager (iDRAC) information
        manager_url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1"
        manager_data = {}
        
        try:
            manager_response, response_time_ms = self._make_session_request(
                ip, manager_url, session, username, password, 
                timeout=(10 if legacy_ssl else 2, 15),
                legacy_ssl=legacy_ssl
            )
            
            response_json = None
            json_error = None
            if manager_response and manager_response.content:
                try:
                    response_json = manager_response.json()
                except json.JSONDecodeError as json_err:
                    json_error = str(json_err)
            
            self.log_idrac_command(
                server_id=server_id, job_id=job_id, task_id=None,
                command_type='GET', endpoint='/redfish/v1/Managers/iDRAC.Embedded.1',
                full_url=manager_url,
                request_headers={'X-Auth-Token': '[SESSION]'} if session else {'Authorization': f'Basic {username}:***'},
                request_body=None, status_code=manager_response.status_code if manager_response else None,
                response_time_ms=response_time_ms, response_body=response_json,
                success=(manager_response and manager_response.status_code == 200 and response_json is not None),
                error_message=json_error if json_error else (None if (manager_response and manager_response.status_code == 200) else f"HTTP {manager_response.status_code}" if manager_response else "Request failed"),
                operation_type='idrac_api'
            )
            
            if manager_response and manager_response.status_code == 200 and response_json is not None:
                manager_data = response_json
            else:
                self.log(f"  Warning: Could not get manager info from {ip}", "WARN")
                    
        except Exception as e:
            self.log(f"  Warning: Error getting manager info from {ip}: {e}", "WARN")
        
        # Extract comprehensive info
        try:
            # Guard against NoneType - old iDRAC firmwares may return None
            if not isinstance(system_data, dict):
                self.log(f"  Invalid system_data type for {ip}: {type(system_data).__name__}", "ERROR")
                return None
            
            processor_summary = system_data.get("ProcessorSummary", {})
            memory_summary = system_data.get("MemorySummary", {})
            
            # Extract Redfish version from @odata.type
            redfish_version = None
            if "@odata.type" in system_data:
                odata_type = system_data.get("@odata.type", "")
                if "." in odata_type:
                    parts = odata_type.split(".")
                    if len(parts) >= 2:
                        redfish_version = parts[1].replace("v", "").replace("_", ".")
            
            # Sanitize types for database columns
            cpu_count_val = processor_summary.get("Count")
            cpu_count = None
            if cpu_count_val is not None:
                try:
                    cpu_count = int(cpu_count_val) if isinstance(cpu_count_val, (int, float)) else (int(cpu_count_val) if str(cpu_count_val).replace('.','',1).isdigit() else None)
                except (ValueError, TypeError):
                    pass
            
            mem_gib_val = memory_summary.get("TotalSystemMemoryGiB")
            memory_gb = None
            if mem_gib_val is not None:
                try:
                    memory_gb = int(mem_gib_val) if isinstance(mem_gib_val, (int, float)) else (int(float(mem_gib_val)) if isinstance(mem_gib_val, str) and mem_gib_val.replace('.','',1).isdigit() else None)
                except (ValueError, TypeError):
                    pass
            
            base_info = {
                "manufacturer": system_data.get("Manufacturer", "Unknown"),
                "model": system_data.get("Model", "Unknown"),
                "service_tag": system_data.get("SKU") or system_data.get("SerialNumber", None),
                "hostname": system_data.get("HostName", None) or None,
                "bios_version": system_data.get("BiosVersion", None),
                "cpu_count": cpu_count,
                "memory_gb": memory_gb,
                "idrac_firmware": manager_data.get("FirmwareVersion", None) if manager_data else None,
                "manager_mac_address": None,
                "product_name": system_data.get("Model", None),
                "redfish_version": redfish_version,
                "supported_endpoints": None,
                "power_state": system_data.get("PowerState", None),
                "username": username,
                "password": password,
            }
            
            # If full onboarding is requested, fetch additional data IN PARALLEL with session
            if full_onboarding:
                # Extract legacy_ssl BEFORE capability detection so it's available for all requests
                legacy_ssl = (capabilities or {}).get('requires_legacy_ssl', False)
                
                # Detect iDRAC 8 by firmware version (starts with "2.") and force legacy TLS
                current_firmware = base_info.get('idrac_firmware')
                if current_firmware and current_firmware.startswith('2.') and not legacy_ssl:
                    legacy_ssl = True
                    self.log(f"  → Detected iDRAC 8 firmware ({current_firmware}), using Legacy TLS", "INFO")
                    # Persist the flag to database for future syncs
                    if server_id:
                        self._update_server_legacy_ssl(server_id, True)
                
                # Detect capabilities if not cached, firmware changed, missing flags, or legacy_ssl mismatch
                cached_legacy_ssl = (capabilities or {}).get('requires_legacy_ssl', False)
                needs_redetect = (
                    not capabilities or 
                    capabilities.get('idrac_version') != current_firmware or
                    'expand_network_adapters' not in capabilities or
                    'expand_storage' not in capabilities or
                    'supports_ethernet_interfaces' not in capabilities or
                    # Re-detect if server requires legacy SSL but cached capabilities don't reflect it
                    (legacy_ssl and not cached_legacy_ssl) or
                    # Re-detect if iDRAC 8 (legacy_ssl) but NIC capability is missing/false
                    (legacy_ssl and not capabilities.get('supports_ethernet_interfaces', False) 
                     and not capabilities.get('expand_network_adapters', False))
                )
                if needs_redetect:
                    if not capabilities:
                        reason = "missing"
                    elif legacy_ssl and not cached_legacy_ssl:
                        reason = "legacy SSL mismatch"
                    elif legacy_ssl and not capabilities.get('supports_ethernet_interfaces', False):
                        reason = "iDRAC 8 NIC capability missing"
                    elif 'expand_storage' not in capabilities:
                        reason = "stale cache (missing new flags)"
                    else:
                        reason = "firmware changed"
                    self.log(f"  Detecting iDRAC capabilities for {ip} ({reason})...", "INFO")
                    # Pass legacy_ssl to capability detection for TLS 1.0/1.1 iDRAC 8 devices
                    capabilities = self._detect_idrac_capabilities(ip, username, password, session, server_id, job_id, current_firmware, legacy_ssl=legacy_ssl)
                    if server_id and capabilities:
                        # Ensure requires_legacy_ssl is synchronized in stored capabilities
                        capabilities['requires_legacy_ssl'] = legacy_ssl
                        self._store_idrac_capabilities(server_id, capabilities)
                        self.log(f"  ✓ Cached iDRAC capabilities (legacy_ssl={legacy_ssl})", "DEBUG")
                    # Update legacy_ssl from detected capabilities (may have been set during detection)
                    legacy_ssl = (capabilities or {}).get('requires_legacy_ssl', legacy_ssl)
                
                self.log(f"  Starting full onboarding for {ip} (capability-aware parallel fetch)...", "INFO")
                
                # Use ThreadPoolExecutor to fetch independent endpoints in parallel
                # Pass session, capabilities, AND legacy_ssl to all workers for efficient fetching
                with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
                    # Submit all independent tasks with session, capabilities, and legacy_ssl
                    future_health = executor.submit(
                        self._fetch_health_status, ip, username, password, server_id, job_id, session, legacy_ssl
                    )
                    future_bios = executor.submit(
                        self._fetch_bios_attributes, ip, username, password, server_id, job_id, session, legacy_ssl
                    )
                    future_drives = executor.submit(
                        self._fetch_storage_drives_optimized, ip, username, password, server_id, job_id, session, capabilities, legacy_ssl
                    )
                    # legacy_ssl already extracted above before capability detection
                    future_nics = executor.submit(
                        self._fetch_network_adapters_optimized, ip, username, password, server_id, job_id, session, capabilities, legacy_ssl
                    )
                    future_memory = executor.submit(
                        self._fetch_memory_dimms_optimized, ip, username, password, server_id, job_id, session, capabilities, legacy_ssl
                    )
                    
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
                    
                    try:
                        memory_dimms = future_memory.result(timeout=45)
                        if memory_dimms:
                            base_info['memory_dimms'] = memory_dimms
                            base_info['total_dimms'] = len(memory_dimms)
                            self.log(f"  ✓ Discovered {len(memory_dimms)} DIMMs", "INFO")
                    except Exception as e:
                        self.log(f"  ⚠ Memory fetch failed: {e}", "DEBUG")
            
            return base_info
            
        except Exception as e:
            self.log(f"Error extracting server info from {ip}: {e}", "ERROR")
            self.log(f"  system_data keys: {list(system_data.keys()) if system_data else 'None'}", "DEBUG")
            self.log(f"  manager_data keys: {list(manager_data.keys()) if manager_data else 'None'}", "DEBUG")
            return None
            
        finally:
            # CRITICAL: Always clean up session to prevent iDRAC session exhaustion
            if session and session.get('token'):
                try:
                    self.delete_idrac_session(session, ip=ip, server_id=server_id, job_id=job_id)
                except Exception as e:
                    self.log(f"  Session cleanup failed: {e}", "DEBUG")
    
    def create_idrac_session(
        self, 
        ip: str, 
        username: str, 
        password: str, 
        log_to_db: bool = True,
        server_id: str = None,
        job_id: str = None,
        legacy_ssl: bool = False,
        timeout: tuple = None
    ) -> Optional[Dict]:
        """
        Create a Redfish session with iDRAC using Dell's official session endpoint.
        
        Uses: POST /redfish/v1/SessionService/Sessions
        
        Args:
            legacy_ssl: Use Legacy TLS adapter for iDRAC 8 (TLS 1.0/1.1)
            timeout: Custom (connect, read) timeout tuple. Defaults to (10,20) for legacy, (5,15) otherwise
        
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
        
        # Use longer timeout for iDRAC 8 (legacy TLS handshake is slower)
        if timeout is None:
            timeout = (10, 20) if legacy_ssl else (5, 15)
        
        try:
            start_time = time.time()
            response = self.session_manager.make_request(
                method='POST',
                url=url,
                ip=ip,
                json=payload,
                timeout=timeout,
                headers={'Content-Type': 'application/json'},
                legacy_ssl=legacy_ssl
            )
            response_time_ms = int((time.time() - start_time) * 1000)
            
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
                self.log(f"  Session creation failed: HTTP {response.status_code if response else 'no response'}", "ERROR")
                return None
                
        except Exception as e:
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
            start_time = time.time()
            response = self.session_manager.make_request(
                method='DELETE',
                url=delete_url,
                ip=session_ip,
                headers={'X-Auth-Token': token},
                timeout=(5, 10)
            )
            response_time_ms = int((time.time() - start_time) * 1000)
            
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

    def _detect_idrac_capabilities(
        self,
        ip: str,
        username: str,
        password: str,
        session: Dict = None,
        server_id: str = None,
        job_id: str = None,
        current_firmware: str = None,
        legacy_ssl: bool = False
    ) -> Dict:
        """
        Detect which $expand levels this iDRAC supports.
        
        Runs quick test requests to determine optimal query strategy.
        Results are cached in servers.supported_endpoints JSONB.
        
        IMPORTANT: Some iDRAC versions have connection-level failures (SSL/TLS errors)
        for $expand on specific endpoints (especially NetworkAdapters). We test each
        endpoint type separately to handle this.
        
        AUTO-RETRY: If initial request fails with connection error and legacy_ssl=False,
        this method recursively calls itself with legacy_ssl=True to support iDRAC 8
        devices that were not flagged correctly in the database.
        
        Args:
            legacy_ssl: Use Legacy TLS adapter for iDRAC 8 (TLS 1.0/1.1)
        
        Returns capability flags dict with:
        - expand_levels_1: Supports $expand=*($levels=1) on Memory/Storage
        - expand_levels_2: Supports $expand=*($levels=2) on Memory/Storage
        - expand_members: General $expand=Members support
        - expand_network_adapters: NetworkAdapters specifically supports $expand
        - expand_storage: Storage specifically supports $expand
        - supports_ethernet_interfaces: iDRAC 8 EthernetInterfaces fallback
        - detected_at: ISO timestamp
        - idrac_version: Current firmware for cache invalidation
        """
        caps = {
            'expand_levels_1': False,
            'expand_levels_2': False,
            'expand_members': False,
            'expand_network_adapters': False,  # Test separately - known to fail on some firmwares
            'expand_storage': False,  # Test separately for Storage endpoint
            'supports_ethernet_interfaces': False,  # iDRAC 8 fallback endpoint
            'detected_at': datetime.now().isoformat(),
            'idrac_version': current_firmware,
            'requires_legacy_ssl': legacy_ssl  # Preserve for subsequent calls
        }
        
        try:
            # Test 1: $expand=*($levels=1) on Memory (generally reliable)
            memory_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Memory?$expand=*($levels=1)"
            resp, resp_time = self._make_session_request(ip, memory_url, session, username, password, timeout=(2, 15), legacy_ssl=legacy_ssl)
            
            # AUTO-DETECT LEGACY TLS NEED
            # If first request fails with connection error (resp=None) AND we haven't tried legacy TLS yet,
            # retry entire detection with legacy_ssl=True (iDRAC 8 auto-detection)
            if resp is None and not legacy_ssl:
                self.log(f"  → Connection failed, retrying with Legacy TLS (iDRAC 8 auto-detection)...", "INFO")
                caps = self._detect_idrac_capabilities(
                    ip, username, password, session, server_id, job_id, 
                    current_firmware, legacy_ssl=True  # Recursive call with legacy TLS
                )
                # Update server record with correct legacy_ssl flag
                if server_id:
                    self._update_server_legacy_ssl(server_id, True)
                return caps
            
            # Only mark as supported if we get HTTP 200 (not connection errors)
            if resp and resp.status_code == 200:
                caps['expand_levels_1'] = True
                caps['expand_members'] = True  # If levels work, members likely work too
                self.log(f"  ✓ Memory supports $expand=*($levels=1)", "DEBUG")
            else:
                status_info = f"HTTP {resp.status_code}" if resp else "connection error"
                self.log(f"  ✗ Memory $expand=*($levels=1) failed: {status_info}", "DEBUG")
            
            self.log_idrac_command(
                server_id=server_id, job_id=job_id, task_id=None,
                command_type='GET', endpoint='/Memory?$expand=*($levels=1) [capability test]',
                full_url=memory_url, request_headers=None, request_body=None,
                status_code=resp.status_code if resp else None,
                response_time_ms=resp_time, response_body=None,
                success=resp is not None and resp.status_code == 200,
                operation_type='idrac_api'
            )
            
            # Test 2: NetworkAdapters $expand - SKIP for iDRAC 8 (known to timeout after 15-40 seconds)
            # iDRAC 8 cannot process $expand queries - the device hangs trying to build the response
            if legacy_ssl:
                # iDRAC 8 detected: Skip $expand tests entirely to avoid wasting 30+ seconds on guaranteed timeouts
                self.log(f"  → Skipping NetworkAdapters $expand test (iDRAC 8 cannot handle $expand)", "DEBUG")
                caps['expand_network_adapters'] = False
                caps['supports_ethernet_interfaces'] = True  # iDRAC 8 uses EthernetInterfaces
                caps['supports_ethernet_expand'] = False  # iDRAC 8 cannot handle $expand
                resp = None
                resp_time = 0
                adapters_url = "skipped"
            else:
                # iDRAC 9+: Test NetworkAdapters $expand
                adapters_url = f"https://{ip}/redfish/v1/Chassis/System.Embedded.1/NetworkAdapters?$expand=Members"
                resp, resp_time = self._make_session_request(ip, adapters_url, session, username, password, timeout=(2, 15), legacy_ssl=legacy_ssl)
                
                if resp and resp.status_code == 200:
                    caps['expand_network_adapters'] = True
                    caps['supports_ethernet_interfaces'] = False  # Uses NetworkAdapters (iDRAC 9+)
                    self.log(f"  ✓ NetworkAdapters supports $expand=Members", "DEBUG")
                elif resp is None or (resp and resp.status_code == 404):
                    # iDRAC 8 - NetworkAdapters doesn't exist (404) or TLS/connection failure
                    caps['expand_network_adapters'] = False
                    self.log(f"  → NetworkAdapters unavailable (404/timeout), testing EthernetInterfaces...", "DEBUG")
                    
                    # Dell official pattern: simple GET first to confirm endpoint exists
                    eth_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/EthernetInterfaces"
                    eth_resp, eth_time = self._make_session_request(ip, eth_url, session, username, password, timeout=(2, 20), legacy_ssl=legacy_ssl)
                    
                    # If EthernetInterfaces also fails AND we're not using legacy TLS, try with legacy TLS
                    if (eth_resp is None or (eth_resp and eth_resp.status_code != 200)) and not legacy_ssl:
                        self.log(f"  → EthernetInterfaces failed, retrying with Legacy TLS (iDRAC 8 auto-detection)...", "DEBUG")
                        eth_resp, eth_time = self._make_session_request(ip, eth_url, session, username, password, timeout=(2, 25), legacy_ssl=True)
                        if eth_resp and eth_resp.status_code == 200:
                            caps['requires_legacy_ssl'] = True
                            legacy_ssl = True  # Update for subsequent tests
                            self.log(f"  ✓ Legacy TLS required - auto-detected", "INFO")
                            if server_id:
                                self._update_server_legacy_ssl(server_id, True)
                    
                    if eth_resp and eth_resp.status_code == 200:
                        caps['supports_ethernet_interfaces'] = True
                        self.log(f"  ✓ EthernetInterfaces available (iDRAC 8 fallback)", "DEBUG")
                        
                        # Dell official pattern: test $expand support for bulk fetch optimization
                        expand_url = f"{eth_url}?$expand=*($levels=1)"
                        expand_resp, _ = self._make_session_request(
                            ip, expand_url, session, username, password, 
                            timeout=(2, 30), legacy_ssl=legacy_ssl
                        )
                        caps['supports_ethernet_expand'] = (expand_resp is not None and expand_resp.status_code == 200)
                        if caps['supports_ethernet_expand']:
                            self.log(f"  ✓ EthernetInterfaces supports $expand=*($levels=1)", "DEBUG")
                        else:
                            self.log(f"  → EthernetInterfaces $expand failed, will use individual fetches", "DEBUG")
                    else:
                        caps['supports_ethernet_interfaces'] = False
                        caps['supports_ethernet_expand'] = False
                        eth_status = f"HTTP {eth_resp.status_code}" if eth_resp else "connection error"
                        self.log(f"  ✗ EthernetInterfaces not available: {eth_status}", "DEBUG")
                else:
                    status_info = f"HTTP {resp.status_code}" if resp else "connection error"
                    self.log(f"  ✗ NetworkAdapters $expand=Members failed: {status_info}", "DEBUG")
            
            if adapters_url != "skipped":
                self.log_idrac_command(
                    server_id=server_id, job_id=job_id, task_id=None,
                    command_type='GET', endpoint='/NetworkAdapters?$expand=Members [capability test]',
                    full_url=adapters_url, request_headers=None, request_body=None,
                    status_code=resp.status_code if resp else None,
                    response_time_ms=resp_time, response_body=None,
                    success=resp is not None and resp.status_code == 200,
                    operation_type='idrac_api'
                )
            
            # Test 3: Storage $expand - SKIP for iDRAC 8 (known to timeout after 10+ seconds)
            if legacy_ssl:
                self.log(f"  → Skipping Storage $expand test (iDRAC 8 cannot handle $expand)", "DEBUG")
                caps['expand_storage'] = False
                resp = None
                resp_time = 0
                storage_url = "skipped"
            else:
                storage_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Storage?$expand=Members"
                resp, resp_time = self._make_session_request(ip, storage_url, session, username, password, timeout=(2, 15), legacy_ssl=legacy_ssl)
            
            if storage_url != "skipped":
                if resp and resp.status_code == 200:
                    caps['expand_storage'] = True
                    self.log(f"  ✓ Storage supports $expand=Members", "DEBUG")
                else:
                    status_info = f"HTTP {resp.status_code}" if resp else "connection error"
                    self.log(f"  ✗ Storage $expand=Members failed: {status_info}", "DEBUG")
                
                self.log_idrac_command(
                    server_id=server_id, job_id=job_id, task_id=None,
                    command_type='GET', endpoint='/Storage?$expand=Members [capability test]',
                    full_url=storage_url, request_headers=None, request_body=None,
                    status_code=resp.status_code if resp else None,
                    response_time_ms=resp_time, response_body=None,
                    success=resp is not None and resp.status_code == 200,
                    operation_type='idrac_api'
                )
            
            # Test 4: If NetworkAdapters $expand works, test deeper levels
            if caps['expand_network_adapters']:
                nics_url = f"https://{ip}/redfish/v1/Chassis/System.Embedded.1/NetworkAdapters?$expand=*($levels=2)"
                resp, resp_time = self._make_session_request(ip, nics_url, session, username, password, timeout=(2, 20), legacy_ssl=legacy_ssl)
                
                if resp and resp.status_code == 200:
                    caps['expand_levels_2'] = True
                    self.log(f"  ✓ NetworkAdapters supports $expand=*($levels=2)", "DEBUG")
                else:
                    status_info = f"HTTP {resp.status_code}" if resp else "connection error"
                    self.log(f"  ✗ NetworkAdapters $expand=*($levels=2) failed: {status_info}", "DEBUG")
                
                self.log_idrac_command(
                    server_id=server_id, job_id=job_id, task_id=None,
                    command_type='GET', endpoint='/NetworkAdapters?$expand=*($levels=2) [capability test]',
                    full_url=nics_url, request_headers=None, request_body=None,
                    status_code=resp.status_code if resp else None,
                    response_time_ms=resp_time, response_body=None,
                    success=resp is not None and resp.status_code == 200,
                    operation_type='idrac_api'
                )
            
            self.log(f"  Capabilities detected: levels1={caps['expand_levels_1']}, levels2={caps['expand_levels_2']}, nics={caps['expand_network_adapters']}, storage={caps['expand_storage']}", "DEBUG")
            
            return caps
            
        except Exception as e:
            self.log(f"  Error detecting iDRAC capabilities: {e}", "WARN")
            return caps
    
    def _get_cached_idrac_capabilities(self, server_id: str) -> Optional[Dict]:
        """Load cached iDRAC capabilities from servers.supported_endpoints and requires_legacy_ssl"""
        try:
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            }
            
            response = requests.get(
                f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}&select=supported_endpoints,idrac_firmware,requires_legacy_ssl",
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if data and len(data) > 0:
                    endpoints = data[0].get('supported_endpoints') or {}
                    # Return capabilities if they exist and include our detection keys
                    if 'expand_levels_1' in endpoints or 'expand_members' in endpoints:
                        # Also include firmware version for cache invalidation
                        endpoints['idrac_version'] = data[0].get('idrac_firmware')
                        # Include legacy SSL flag for iDRAC 8 support
                        endpoints['requires_legacy_ssl'] = data[0].get('requires_legacy_ssl', False)
                        return endpoints
                    # Even if no capabilities cached, return legacy_ssl if set
                    if data[0].get('requires_legacy_ssl'):
                        return {'requires_legacy_ssl': True}
            
            return None
            
        except Exception as e:
            self.log(f"  Could not load cached capabilities: {e}", "DEBUG")
            return None
    
    def _store_idrac_capabilities(self, server_id: str, capabilities: Dict):
        """Store iDRAC capabilities in servers.supported_endpoints"""
        try:
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            }
            
            response = requests.patch(
                f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}",
                headers=headers,
                json={'supported_endpoints': capabilities},
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.status_code not in [200, 204]:
                self.log(f"  Could not store capabilities: HTTP {response.status_code}", "DEBUG")
                
        except Exception as e:
            self.log(f"  Could not store capabilities: {e}", "DEBUG")
    
    def _update_server_legacy_ssl(self, server_id: str, requires_legacy_ssl: bool):
        """
        Update the requires_legacy_ssl flag on server record.
        
        Called when TLS auto-detection discovers an iDRAC 8 that was not
        correctly flagged in the database.
        """
        try:
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            }
            
            response = requests.patch(
                f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}",
                headers=headers,
                json={'requires_legacy_ssl': requires_legacy_ssl},
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.status_code in [200, 204]:
                self.log(f"  ✓ Auto-detected iDRAC 8: Updated requires_legacy_ssl={requires_legacy_ssl}", "INFO")
            else:
                self.log(f"  Could not update legacy SSL flag: HTTP {response.status_code}", "DEBUG")
                
        except Exception as e:
            self.log(f"  Could not update legacy SSL flag: {e}", "DEBUG")

    def _update_ethernet_interface_capability(self, server_id: str, supports_ethernet: bool):
        """
        Update the supports_ethernet_interfaces capability in server's supported_endpoints.
        
        Called when EthernetInterfaces succeeds on an iDRAC 8 that had stale cached capabilities.
        This self-heals the cache so future syncs use the correct path immediately.
        """
        try:
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            }
            
            # First get current supported_endpoints
            get_response = requests.get(
                f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}&select=supported_endpoints",
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if get_response.status_code == 200:
                data = get_response.json()
                if data:
                    endpoints = data[0].get('supported_endpoints') or {}
                    endpoints['supports_ethernet_interfaces'] = supports_ethernet
                    
                    response = requests.patch(
                        f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}",
                        headers=headers,
                        json={'supported_endpoints': endpoints},
                        verify=VERIFY_SSL,
                        timeout=10
                    )
                    
                    if response.status_code in [200, 204]:
                        self.log(f"  ✓ Self-healed: Updated supports_ethernet_interfaces={supports_ethernet}", "INFO")
        except Exception as e:
            self.log(f"  Could not update ethernet interface capability: {e}", "DEBUG")


    def _make_session_request(
        self,
        ip: str,
        url: str,
        session: Optional[Dict],
        username: str,
        password: str,
        timeout: tuple = (2, 15),
        method: str = 'GET',
        json_body: Dict = None,
        legacy_ssl: bool = False
    ) -> tuple:
        """
        Make an authenticated request using session token or fallback to basic auth.
        
        OPTIMIZATION: Reduces auth overhead by reusing session tokens.
        
        TIMEOUT ADJUSTMENT: Legacy TLS (iDRAC 8) requires longer connect timeouts
        due to slower TLS 1.0/1.1 handshakes.
        
        Args:
            ip: iDRAC IP address
            url: Full URL to request
            session: Optional session dict with 'token' key
            username: Basic auth username (fallback)
            password: Basic auth password (fallback)
            timeout: Request timeout tuple (connect, read)
            method: HTTP method
            json_body: Optional JSON body for POST/PATCH
            legacy_ssl: Use Legacy TLS adapter for iDRAC 8
            
        Returns:
            tuple: (response, response_time_ms)
        """
        headers = {}
        auth = None
        
        if session and session.get('token'):
            headers['X-Auth-Token'] = session['token']
        else:
            auth = (username, password)
        
        if json_body:
            headers['Content-Type'] = 'application/json'
        
        # Increase connect timeout for iDRAC 8 Legacy TLS (slow TLS 1.0/1.1 handshakes)
        # Standard iDRAC 9+: 2s connect is fine
        # iDRAC 8 Legacy TLS: needs 10s connect to avoid timeouts during handshake
        actual_timeout = timeout
        if legacy_ssl and timeout[0] < 10:
            actual_timeout = (10, timeout[1])
        
        start_time = time.time()
        try:
            response = self.session_manager.make_request(
                method=method,
                url=url,
                ip=ip,
                auth=auth,
                headers=headers,
                json=json_body,
                timeout=actual_timeout,
                legacy_ssl=legacy_ssl
            )
            response_time_ms = int((time.time() - start_time) * 1000)
            return response, response_time_ms
        except requests.exceptions.Timeout as e:
            self.log(f"  Timeout connecting to {ip}: {e}", "DEBUG")
            return None, int((time.time() - start_time) * 1000)
        except requests.exceptions.SSLError as e:
            self.log(f"  SSL error connecting to {ip}: {e}", "DEBUG")
            return None, int((time.time() - start_time) * 1000)
        except Exception as e:
            self.log(f"  Connection error to {ip}: {e}", "DEBUG")
            return None, int((time.time() - start_time) * 1000)

    def _fetch_health_status(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None, session: Dict = None, legacy_ssl: bool = False) -> Optional[Dict]:
        """Fetch comprehensive health status from multiple Redfish endpoints (session-aware, legacy TLS aware)"""
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
            system_response, system_time = self._make_session_request(
                ip, system_url, session, username, password, timeout=(2, 15), legacy_ssl=legacy_ssl
            )
            
            if system_response and system_response.status_code == 200:
                system_json = system_response.json()
                health['power_state'] = system_json.get('PowerState')
        except Exception as e:
            self.log(f"  Could not fetch power state: {e}", "WARN")
        
        endpoints = [
            ('/redfish/v1/Chassis/System.Embedded.1/Thermal', 'thermal'),
            ('/redfish/v1/Chassis/System.Embedded.1/Power', 'power')
        ]
        
        for endpoint, health_type in endpoints:
            try:
                url = f"https://{ip}{endpoint}"
                response, response_time = self._make_session_request(
                    ip, url, session, username, password, timeout=(2, 15), legacy_ssl=legacy_ssl
                )
                
                response_json = None
                if response and response.status_code == 200 and response.content:
                    try:
                        response_json = response.json()
                    except json.JSONDecodeError:
                        pass
                
                self.log_idrac_command(
                    server_id=server_id, job_id=job_id, task_id=None,
                    command_type='GET', endpoint=endpoint, full_url=url,
                    request_headers={'X-Auth-Token': '[SESSION]'} if session else {'Authorization': f'Basic {username}:***'},
                    request_body=None, status_code=response.status_code if response else None,
                    response_time_ms=response_time, response_body=response_json,
                    success=(response and response.status_code == 200),
                    error_message=None if (response and response.status_code == 200) else f"HTTP {response.status_code}" if response else "Request failed",
                    operation_type='idrac_api'
                )
                
                if response and response.status_code == 200 and response_json:
                    health[f'{health_type}_healthy'] = self._parse_health_from_response(response_json)
                    
                    if health_type == 'thermal':
                        temps = response_json.get('Temperatures', [])
                        if temps:
                            valid_temps = [t.get('ReadingCelsius', 0) for t in temps if t.get('ReadingCelsius')]
                            if valid_temps:
                                health['temperature_celsius'] = round(sum(valid_temps) / len(valid_temps), 1)
                        
                        fans = response_json.get('Fans', [])
                        if fans:
                            all_fans_ok = all(
                                f.get('Status', {}).get('Health') == 'OK' 
                                for f in fans 
                                if f.get('Status', {}).get('Health')
                            )
                            health['fan_health'] = 'OK' if all_fans_ok else 'Warning'
                    
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
            start_time = time.time()
            response = self.session_manager.make_request(
                method='GET',
                url=url,
                ip=ip,
                auth=(username, password),
                timeout=(2, 15)
            )
            response_time = int((time.time() - start_time) * 1000)
            
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
                
        except Exception as e:
            self.log(f"  Could not fetch SEL logs: {e}", "WARN")
        
        # Fetch Lifecycle logs
        try:
            url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Lclog/Entries"
            start_time = time.time()
            response = self.session_manager.make_request(
                method='GET',
                url=url,
                ip=ip,
                auth=(username, password),
                timeout=(2, 15)
            )
            response_time = int((time.time() - start_time) * 1000)
            
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

    def _fetch_bios_attributes(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None, session: Dict = None, legacy_ssl: bool = False) -> Optional[Dict]:
        """Fetch BIOS attributes for initial snapshot (session-aware, legacy TLS aware)"""
        try:
            url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Bios"
            response, response_time = self._make_session_request(
                ip, url, session, username, password, timeout=(2, 15), legacy_ssl=legacy_ssl
            )
            
            response_json = None
            if response and response.content:
                try:
                    response_json = response.json()
                except json.JSONDecodeError:
                    pass
            
            self.log_idrac_command(
                server_id=server_id, job_id=job_id, task_id=None,
                command_type='GET', endpoint='/redfish/v1/Systems/System.Embedded.1/Bios',
                full_url=url,
                request_headers={'X-Auth-Token': '[SESSION]'} if session else {'Authorization': f'Basic {username}:***'},
                request_body=None, status_code=response.status_code if response else None,
                response_time_ms=response_time, response_body=response_json,
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
    
    def _fetch_storage_drives_optimized(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None, session: Dict = None, capabilities: Dict = None, legacy_ssl: bool = False) -> List[Dict]:
        """
        OPTIMIZED: Fetch drive inventory using capability-aware $expand.
        
        Uses cached capabilities to skip unsupported $expand attempts.
        Before: 20-40 API calls (with wasted fallback attempts)
        After: 2-4 API calls (no wasted calls)
        """
        drives = []
        volumes_info = {}
        caps = capabilities or {}
        
        try:
            # Check if Storage $expand is supported (tested separately)
            # Default to FALSE if not detected - safer to skip $expand than waste API calls
            if not caps.get('expand_storage', False):
                # No $expand support for Storage - go straight to legacy with session
                self.log(f"  → Storage: skipping $expand (not supported by this iDRAC)", "DEBUG")
                return self._fetch_storage_drives(ip, username, password, server_id, job_id, session=session, capabilities=caps, legacy_ssl=legacy_ssl)
            
            # Choose best expansion level
            if caps.get('expand_levels_1', False):
                storage_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Storage?$expand=*($levels=1)"
                endpoint_label = '/Storage?$expand=*($levels=1)'
            else:
                storage_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Storage?$expand=Members"
                endpoint_label = '/Storage?$expand=Members'
            
            storage_response, storage_time = self._make_session_request(
                ip, storage_url, session, username, password, timeout=(2, 45), legacy_ssl=legacy_ssl
            )
            
            self.log_idrac_command(
                server_id=server_id, job_id=job_id, task_id=None,
                command_type='GET', endpoint=endpoint_label,
                full_url=storage_url, request_headers=None, request_body=None,
                status_code=storage_response.status_code if storage_response else None,
                response_time_ms=storage_time, response_body=None,
                success=storage_response is not None and storage_response.status_code == 200,
                operation_type='idrac_api' if (storage_response and storage_response.status_code == 200) else 'idrac_api_fallback'
            )
            
            # If expansion failed unexpectedly, fall back once (first sync or capability changed)
            if not storage_response or storage_response.status_code != 200:
                if '$expand=*' in storage_url:
                    # Try simpler expansion
                    storage_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Storage?$expand=Members"
                    storage_response, storage_time = self._make_session_request(
                        ip, storage_url, session, username, password, timeout=(2, 30), legacy_ssl=legacy_ssl
                    )
                    
                    self.log_idrac_command(
                        server_id=server_id, job_id=job_id, task_id=None,
                        command_type='GET', endpoint='/Storage?$expand=Members',
                        full_url=storage_url, request_headers=None, request_body=None,
                        status_code=storage_response.status_code if storage_response else None,
                        response_time_ms=storage_time, response_body=None,
                        success=storage_response is not None and storage_response.status_code == 200,
                        operation_type='idrac_api'
                    )
            
            if not storage_response or storage_response.status_code != 200:
                # Ultimate fallback to legacy method with session and capabilities
                return self._fetch_storage_drives(ip, username, password, server_id, job_id, session=session, capabilities=caps, legacy_ssl=legacy_ssl)
            
            storage_data = storage_response.json()
            controllers = storage_data.get('Members', [])
            
            for controller_item in controllers:
                try:
                    # Check if controller data is expanded or just a reference
                    if 'Id' in controller_item and ('Drives' in controller_item or 'Volumes' in controller_item):
                        # Full expansion worked - data is inline
                        ctrl_data = controller_item
                    elif '@odata.id' in controller_item:
                        # Need to fetch controller with expansion
                        controller_url = f"https://{ip}{controller_item['@odata.id']}?$expand=Drives,Volumes"
                        ctrl_resp, ctrl_time = self._make_session_request(
                            ip, controller_url, session, username, password, timeout=(2, 20), legacy_ssl=legacy_ssl
                        )
                        
                        if not ctrl_resp or ctrl_resp.status_code != 200:
                            continue
                        ctrl_data = ctrl_resp.json()
                    else:
                        continue
                    
                    controller_name = ctrl_data.get('Id', 'Unknown')
                    
                    # Process Volumes for drive mapping
                    volumes = ctrl_data.get('Volumes', {})
                    if isinstance(volumes, dict) and 'Members' in volumes:
                        for vol in volumes.get('Members', []):
                            if 'Id' in vol:
                                self._map_volume_to_drives(vol, volumes_info, controller_name)
                    
                    # Process Drives - check if expanded
                    drives_data = ctrl_data.get('Drives', [])
                    for drive_item in drives_data:
                        try:
                            if 'Id' in drive_item and 'SerialNumber' in drive_item:
                                # Fully expanded
                                drive_info = self._extract_drive_info(drive_item, controller_name, volumes_info)
                            elif '@odata.id' in drive_item:
                                # Need individual fetch (fallback)
                                drive_url = f"https://{ip}{drive_item['@odata.id']}"
                                drive_resp, _ = self._make_session_request(
                                    ip, drive_url, session, username, password, timeout=(2, 10), legacy_ssl=legacy_ssl
                                )
                                if drive_resp and drive_resp.status_code == 200:
                                    drive_info = self._extract_drive_info(drive_resp.json(), controller_name, volumes_info)
                                else:
                                    continue
                            else:
                                continue
                            
                            if drive_info:
                                drives.append(drive_info)
                        except Exception as e:
                            self.log(f"  Error processing drive: {e}", "DEBUG")
                            
                except Exception as e:
                    self.log(f"  Error processing controller: {e}", "DEBUG")
            
            return drives
            
        except Exception as e:
            self.log(f"  Could not fetch storage drives (optimized): {e}", "DEBUG")
            # Fall back to legacy method with capabilities
            caps = capabilities or {}
            return self._fetch_storage_drives(ip, username, password, server_id, job_id, session=session, capabilities=caps)
    
    def _fetch_network_adapters_optimized(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None, session: Dict = None, capabilities: Dict = None, legacy_ssl: bool = False) -> List[Dict]:
        """
        OPTIMIZED: Fetch NIC inventory using capability-aware $expand.
        
        Uses cached capabilities to skip unsupported $expand attempts.
        IMPORTANT: Uses 'expand_network_adapters' flag specifically tested for NICs
        to avoid connection-level failures on some iDRAC versions.
        
        For iDRAC 8: Falls back to EthernetInterfaces if NetworkAdapters returns 404.
        
        Before: 10-20 API calls (with wasted fallback attempts)
        After: 2-3 API calls (no wasted calls)
        """
        nics = []
        caps = capabilities or {}
        
        try:
            # Check for iDRAC 8 EthernetInterfaces support first
            # This takes priority because it's explicitly detected during capability scan
            if caps.get('supports_ethernet_interfaces', False):
                self.log(f"  → NICs: using EthernetInterfaces (cached iDRAC 8 mode)", "DEBUG")
                return self._fetch_ethernet_interfaces(ip, username, password, server_id, job_id, session, legacy_ssl)
            
            # If legacy_ssl is True (iDRAC 8), force EthernetInterfaces even if cache says otherwise
            # This handles stale cache from failed capability detection
            if legacy_ssl and not caps.get('expand_network_adapters', False):
                self.log(f"  → NICs: forcing EthernetInterfaces (iDRAC 8 legacy TLS detected)", "DEBUG")
                result = self._fetch_ethernet_interfaces(ip, username, password, server_id, job_id, session, legacy_ssl=True)
                # Update capability cache if successful (self-healing)
                if result and server_id:
                    try:
                        self._update_ethernet_interface_capability(server_id, True)
                    except Exception:
                        pass
                return result
            
            # Check if NetworkAdapters $expand is supported (tested separately from Memory/Storage)
            # Default to FALSE if not detected - safer to skip $expand than waste API calls
            if not caps.get('expand_network_adapters', False):
                # No $expand support for NICs - go straight to legacy with session
                self.log(f"  → NICs: skipping $expand (not supported by this iDRAC)", "DEBUG")
                return self._fetch_network_adapters(ip, username, password, server_id, job_id, session=session, legacy_ssl=legacy_ssl)
            
            # Choose best expansion level for NICs
            if caps.get('expand_levels_2', False):
                adapters_url = f"https://{ip}/redfish/v1/Chassis/System.Embedded.1/NetworkAdapters?$expand=*($levels=2)"
                endpoint_label = '/NetworkAdapters?$expand=*($levels=2)'
            else:
                adapters_url = f"https://{ip}/redfish/v1/Chassis/System.Embedded.1/NetworkAdapters?$expand=Members"
                endpoint_label = '/NetworkAdapters?$expand=Members'
            
            adapters_response, adapters_time = self._make_session_request(
                ip, adapters_url, session, username, password, timeout=(2, 45), legacy_ssl=legacy_ssl
            )
            
            self.log_idrac_command(
                server_id=server_id, job_id=job_id, task_id=None,
                command_type='GET', endpoint=endpoint_label,
                full_url=adapters_url, request_headers=None, request_body=None,
                status_code=adapters_response.status_code if adapters_response else None,
                response_time_ms=adapters_time, response_body=None,
                success=adapters_response is not None and adapters_response.status_code == 200,
                operation_type='idrac_api' if (adapters_response and adapters_response.status_code == 200) else 'idrac_api_fallback'
            )
            
            # iDRAC 8 fallback: NetworkAdapters endpoint doesn't exist (404) OR TLS/connection failure (None)
            if adapters_response is None or adapters_response.status_code == 404:
                self.log(f"  → NetworkAdapters unavailable, trying EthernetInterfaces (iDRAC 8 fallback)", "DEBUG")
                result = self._fetch_ethernet_interfaces(ip, username, password, server_id, job_id, session, legacy_ssl)
                # If EthernetInterfaces also failed and we're not using legacy TLS, retry with legacy TLS
                if not result and not legacy_ssl:
                    self.log(f"  → EthernetInterfaces failed, retrying with Legacy TLS...", "DEBUG")
                    result = self._fetch_ethernet_interfaces(ip, username, password, server_id, job_id, session, legacy_ssl=True)
                return result
            
            # If expansion failed unexpectedly, fall back once
            if not adapters_response or adapters_response.status_code != 200:
                if '$expand=*' in adapters_url:
                    adapters_url = f"https://{ip}/redfish/v1/Chassis/System.Embedded.1/NetworkAdapters?$expand=Members"
                    adapters_response, adapters_time = self._make_session_request(
                        ip, adapters_url, session, username, password, timeout=(2, 30), legacy_ssl=legacy_ssl
                    )
                    
                    self.log_idrac_command(
                        server_id=server_id, job_id=job_id, task_id=None,
                        command_type='GET', endpoint='/NetworkAdapters?$expand=Members',
                        full_url=adapters_url, request_headers=None, request_body=None,
                        status_code=adapters_response.status_code if adapters_response else None,
                        response_time_ms=adapters_time, response_body=None,
                        success=adapters_response is not None and adapters_response.status_code == 200,
                        operation_type='idrac_api'
                    )
            
            if not adapters_response or adapters_response.status_code != 200:
                # Ultimate fallback with session
                return self._fetch_network_adapters(ip, username, password, server_id, job_id, session=session, legacy_ssl=legacy_ssl)
            
            adapters_data = adapters_response.json()
            
            for adapter_item in adapters_data.get('Members', []):
                try:
                    # Check if adapter is expanded
                    if 'Id' in adapter_item:
                        adapter_data = adapter_item
                    elif '@odata.id' in adapter_item:
                        adapter_url = f"https://{ip}{adapter_item['@odata.id']}"
                        adapter_resp, _ = self._make_session_request(
                            ip, adapter_url, session, username, password, timeout=(2, 15), legacy_ssl=legacy_ssl
                        )
                        if not adapter_resp or adapter_resp.status_code != 200:
                            continue
                        adapter_data = adapter_resp.json()
                    else:
                        continue
                    
                    manufacturer = adapter_data.get('Manufacturer')
                    model = adapter_data.get('Model')
                    serial = adapter_data.get('SerialNumber')
                    part_number = adapter_data.get('PartNumber')
                    
                    # Fetch NetworkPorts for speed data (iDRAC 9 stores speed here)
                    port_map = self._fetch_network_ports(ip, adapter_data, session, username, password, legacy_ssl)
                    
                    # Get NetworkDeviceFunctions
                    functions = adapter_data.get('NetworkDeviceFunctions', {})
                    if isinstance(functions, dict) and 'Members' in functions:
                        # Functions are expanded inline
                        for func_item in functions.get('Members', []):
                            if 'Id' in func_item:
                                nic_info = self._extract_nic_info(func_item, manufacturer, model, serial, part_number, port_map)
                                if nic_info:
                                    nics.append(nic_info)
                    elif isinstance(functions, dict) and '@odata.id' in functions:
                        # Need to fetch functions
                        funcs_url = f"https://{ip}{functions['@odata.id']}?$expand=Members"
                        funcs_resp, _ = self._make_session_request(
                            ip, funcs_url, session, username, password, timeout=(2, 20), legacy_ssl=legacy_ssl
                        )
                        if funcs_resp and funcs_resp.status_code == 200:
                            for func_item in funcs_resp.json().get('Members', []):
                                # Relaxed condition: some iDRACs don't have 'Ethernet' at collection level
                                if 'Id' in func_item:
                                    nic_info = self._extract_nic_info(func_item, manufacturer, model, serial, part_number, port_map)
                                    if nic_info:
                                        nics.append(nic_info)
                                        
                except Exception as e:
                    self.log(f"  Error processing adapter: {e}", "DEBUG")
            
            # Enhance NICs with EthernetInterfaces speed data (Dell official pattern)
            # EthernetInterfaces provides SpeedMbps as an integer, guaranteed to work
            if nics:
                try:
                    eth_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/EthernetInterfaces?$expand=*($levels=1)"
                    eth_resp, eth_time = self._make_session_request(ip, eth_url, session, username, password, timeout=(2, 30), legacy_ssl=legacy_ssl)
                    
                    self.log_idrac_command(
                        server_id=server_id, job_id=job_id, task_id=None,
                        command_type='GET', endpoint='/EthernetInterfaces?$expand (speed enhancement)',
                        full_url=eth_url, request_headers=None, request_body=None,
                        status_code=eth_resp.status_code if eth_resp else None,
                        response_time_ms=eth_time, response_body=None,
                        success=eth_resp is not None and eth_resp.status_code == 200,
                        operation_type='idrac_api'
                    )
                    
                    if eth_resp and eth_resp.status_code == 200:
                        eth_data = eth_resp.json()
                        # Build speed map: FQDD -> SpeedMbps
                        speed_map = {}
                        for member in eth_data.get('Members', []):
                            fqdd = member.get('Id')
                            speed = member.get('SpeedMbps')
                            if fqdd and speed and speed > 0:
                                speed_map[fqdd] = speed
                                self.log(f"    → EthernetInterface {fqdd}: {speed} Mbps", "DEBUG")
                        
                        # Merge speeds into NICs that are missing speed data
                        # Handle partition suffix: NIC FQDD "NIC.Integrated.1-1-1" vs EthInterface ID "NIC.Integrated.1-1"
                        enhanced_count = 0
                        for nic in nics:
                            if not nic.get('current_speed_mbps'):
                                fqdd = nic.get('fqdd')
                                if not fqdd:
                                    continue
                                
                                speed = None
                                # Pattern 1: Exact match
                                if fqdd in speed_map:
                                    speed = speed_map[fqdd]
                                # Pattern 2: Strip partition suffix (NIC.Integrated.1-1-1 → NIC.Integrated.1-1)
                                if not speed and '-' in fqdd:
                                    eth_id = '-'.join(fqdd.rsplit('-', 1)[:-1])
                                    if eth_id in speed_map:
                                        speed = speed_map[eth_id]
                                
                                if speed:
                                    nic['current_speed_mbps'] = speed
                                    enhanced_count += 1
                        
                        if enhanced_count > 0:
                            self.log(f"  → Enhanced {enhanced_count} NICs with EthernetInterfaces speed data", "DEBUG")
                except Exception as e:
                    self.log(f"  → EthernetInterfaces speed enhancement failed (non-fatal): {e}", "DEBUG")
            
            return nics
            
        except Exception as e:
            self.log(f"  Could not fetch NICs (optimized): {e}", "DEBUG")
            return self._fetch_network_adapters(ip, username, password, server_id, job_id, session=session, legacy_ssl=legacy_ssl)
    
    def _fetch_memory_dimms_optimized(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None, session: Dict = None, capabilities: Dict = None, legacy_ssl: bool = False) -> List[Dict]:
        """
        OPTIMIZED: Fetch memory/DIMM inventory using capability-aware $expand.
        
        Uses cached capabilities to skip unsupported $expand attempts.
        Memory $expand is generally reliable (expand_levels_1 tested on Memory endpoint).
        
        Before: 16+ API calls (with wasted fallback attempts)
        After: 1 API call (no wasted calls)
        """
        import re
        dimms = []
        caps = capabilities or {}
        
        try:
            # Check if Memory $expand is supported (expand_levels_1 is tested on Memory specifically)
            # Default to FALSE if not detected - safer to skip $expand than waste API calls
            if not caps.get('expand_levels_1', False):
                # No $expand support - go straight to legacy with session
                self.log(f"  → Memory: skipping $expand (not supported by this iDRAC)", "DEBUG")
                return self._fetch_memory_dimms(ip, username, password, server_id, job_id, session=session, legacy_ssl=legacy_ssl)
            
            memory_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Memory?$expand=*($levels=1)"
            endpoint_label = '/Memory?$expand=*($levels=1)'
            
            memory_response, memory_time = self._make_session_request(
                ip, memory_url, session, username, password, timeout=(2, 45), legacy_ssl=legacy_ssl
            )
            
            self.log_idrac_command(
                server_id=server_id, job_id=job_id, task_id=None,
                command_type='GET', endpoint=endpoint_label,
                full_url=memory_url, request_headers=None, request_body=None,
                status_code=memory_response.status_code if memory_response else None,
                response_time_ms=memory_time, response_body=None,
                success=memory_response is not None and memory_response.status_code == 200,
                operation_type='idrac_api' if (memory_response and memory_response.status_code == 200) else 'idrac_api_fallback'
            )
            
            # If expansion failed unexpectedly, fall back once
            if not memory_response or memory_response.status_code != 200:
                if '$expand=*' in memory_url:
                    memory_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Memory?$expand=Members"
                    memory_response, memory_time = self._make_session_request(
                        ip, memory_url, session, username, password, timeout=(2, 30), legacy_ssl=legacy_ssl
                    )
                    
                    self.log_idrac_command(
                        server_id=server_id, job_id=job_id, task_id=None,
                        command_type='GET', endpoint='/Memory?$expand=Members',
                        full_url=memory_url, request_headers=None, request_body=None,
                        status_code=memory_response.status_code if memory_response else None,
                        response_time_ms=memory_time, response_body=None,
                        success=memory_response is not None and memory_response.status_code == 200,
                        operation_type='idrac_api'
                    )
            
            if not memory_response or memory_response.status_code != 200:
                # Ultimate fallback with session
                return self._fetch_memory_dimms(ip, username, password, server_id, job_id, session=session, legacy_ssl=legacy_ssl)
            
            memory_data = memory_response.json()
            
            for dimm_item in memory_data.get('Members', []):
                try:
                    # Check if DIMM is expanded
                    if 'Id' in dimm_item and 'CapacityMiB' in dimm_item:
                        dimm_data = dimm_item
                    elif '@odata.id' in dimm_item:
                        # Need individual fetch (rare with proper expansion)
                        dimm_url = f"https://{ip}{dimm_item['@odata.id']}"
                        dimm_resp, _ = self._make_session_request(
                            ip, dimm_url, session, username, password, timeout=(2, 10), legacy_ssl=legacy_ssl
                        )
                        if not dimm_resp or dimm_resp.status_code != 200:
                            continue
                        dimm_data = dimm_resp.json()
                    else:
                        continue
                    
                    # Skip absent DIMMs (empty slots) - match non-optimized behavior
                    status = dimm_data.get('Status', {})
                    if status.get('State') == 'Absent':
                        continue
                    
                    dimm_id = dimm_data.get('Id', '')
                    
                    # Extract slot name from Id (e.g., "DIMM.Socket.B2" -> "B2") - match non-optimized
                    slot_match = re.search(r'DIMM\.Socket\.(\w+)', dimm_id)
                    slot_name = slot_match.group(1) if slot_match else dimm_id
                    
                    # Use correct field names matching _sync_server_memory expectations
                    dimm_info = {
                        'dimm_identifier': dimm_id,
                        'slot_name': slot_name,
                        'manufacturer': dimm_data.get('Manufacturer'),
                        'part_number': dimm_data.get('PartNumber'),
                        'serial_number': dimm_data.get('SerialNumber') or None,
                        'capacity_mb': dimm_data.get('CapacityMiB'),
                        'speed_mhz': dimm_data.get('OperatingSpeedMhz'),
                        'memory_type': dimm_data.get('MemoryDeviceType'),
                        'rank_count': dimm_data.get('RankCount'),
                        'health': status.get('Health'),
                        'status': status.get('State'),
                        'operating_speed_mhz': dimm_data.get('OperatingSpeedMhz'),
                        'error_correction': dimm_data.get('ErrorCorrection'),
                        'volatile_size_mb': dimm_data.get('VolatileSizeMiB'),
                        'non_volatile_size_mb': dimm_data.get('NonVolatileSizeMiB'),
                    }
                    dimms.append(dimm_info)
                    
                except Exception as e:
                    self.log(f"  Error processing DIMM: {e}", "DEBUG")
            
            return dimms
            
        except Exception as e:
            self.log(f"  Could not fetch memory (optimized): {e}", "DEBUG")
            return self._fetch_memory_dimms(ip, username, password, server_id, job_id, session=session, legacy_ssl=legacy_ssl)
    
    def _fetch_storage_drives(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None, session: Dict = None, capabilities: Dict = None, legacy_ssl: bool = False) -> List[Dict]:
        """
        Fetch drive inventory using Dell Redfish Storage API.
        
        CAPABILITY-AWARE: Only uses $expand when explicitly supported.
        All API calls use session-based auth for efficiency when session is provided.
        
        Args:
            capabilities: Dict with 'expand_storage' flag - if False, skips ALL $expand attempts
            legacy_ssl: Use Legacy TLS adapter for iDRAC 8
        
        Returns drives with RAID/Volume info and WWN/NAA for ESXi correlation.
        """
        drives = []
        volumes_info = {}  # Map drive IDs to volume info
        caps = capabilities or {}
        use_expand = caps.get('expand_storage', False)  # Default FALSE - never expand if unknown
        
        try:
            # Only use $expand if capability is confirmed
            if use_expand:
                storage_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Storage?$expand=Members"
                endpoint_label = '/Storage?$expand=Members'
            else:
                storage_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Storage"
                endpoint_label = '/Storage'
            
            # Always use session-based request when session is available
            storage_response, storage_time = self._make_session_request(
                ip, storage_url, session, username, password, timeout=(2, 30), legacy_ssl=legacy_ssl
            )
            
            # Log the storage controllers API call
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint=endpoint_label,
                full_url=storage_url,
                request_headers=None,
                request_body=None,
                status_code=storage_response.status_code if storage_response else None,
                response_time_ms=storage_time,
                response_body=None,
                success=storage_response is not None and storage_response.status_code == 200,
                error_message=storage_response.text[:200] if storage_response and storage_response.status_code != 200 else None,
                operation_type='idrac_api'
            )
            
            if not storage_response or storage_response.status_code != 200:
                return drives
            
            storage_data = storage_response.json()
            controllers = storage_data.get('Members', [])
            
            for controller_item in controllers:
                try:
                    # If $expand worked, controller_item has full data; else it's a reference
                    if '@odata.id' in controller_item and 'Id' not in controller_item:
                        controller_id = controller_item['@odata.id'].split('/')[-1]
                        
                        # Only use $expand on controller if capability is confirmed
                        if use_expand:
                            controller_url = f"https://{ip}{controller_item['@odata.id']}?$expand=Drives,Volumes"
                            endpoint_label = f'/Storage/{controller_id}?$expand'
                        else:
                            controller_url = f"https://{ip}{controller_item['@odata.id']}"
                            endpoint_label = f'/Storage/{controller_id}'
                        
                        ctrl_resp, ctrl_time = self._make_session_request(
                            ip, controller_url, session, username, password, timeout=(2, 30), legacy_ssl=legacy_ssl
                        )
                        
                        self.log_idrac_command(
                            server_id=server_id,
                            job_id=job_id,
                            task_id=None,
                            command_type='GET',
                            endpoint=endpoint_label,
                            full_url=controller_url,
                            request_headers=None,
                            request_body=None,
                            status_code=ctrl_resp.status_code if ctrl_resp else None,
                            response_time_ms=ctrl_time,
                            response_body=None,
                            success=ctrl_resp is not None and ctrl_resp.status_code == 200,
                            operation_type='idrac_api'
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
                        # Need to fetch volumes separately - only use $expand if supported
                        if use_expand:
                            volumes_url = f"https://{ip}{volumes['@odata.id']}?$expand=Members"
                            vol_endpoint = f'/Storage/{controller_name}/Volumes?$expand'
                        else:
                            volumes_url = f"https://{ip}{volumes['@odata.id']}"
                            vol_endpoint = f'/Storage/{controller_name}/Volumes'
                        
                        vol_resp, vol_time = self._make_session_request(
                            ip, volumes_url, session, username, password, timeout=(2, 20), legacy_ssl=legacy_ssl
                        )
                        
                        self.log_idrac_command(
                            server_id=server_id,
                            job_id=job_id,
                            task_id=None,
                            command_type='GET',
                            endpoint=vol_endpoint,
                            full_url=volumes_url,
                            request_headers=None,
                            request_body=None,
                            status_code=vol_resp.status_code if vol_resp else None,
                            response_time_ms=vol_time,
                            response_body=None,
                            success=vol_resp is not None and vol_resp.status_code == 200,
                            operation_type='idrac_api'
                        )
                        
                        if vol_resp and vol_resp.status_code == 200:
                            vol_collection = vol_resp.json()
                            # If expansion worked, Members contains full data
                            vol_members = vol_collection.get('Members', [])
                            for vol in vol_members:
                                if 'Id' in vol:
                                    self._map_volume_to_drives(vol, volumes_info, controller_name)
                                elif '@odata.id' in vol and not use_expand:
                                    # Need to fetch individual volume
                                    vol_url = f"https://{ip}{vol['@odata.id']}"
                                    vol_detail_resp, _ = self._make_session_request(
                                        ip, vol_url, session, username, password, timeout=(2, 15), legacy_ssl=legacy_ssl
                                    )
                                    if vol_detail_resp and vol_detail_resp.status_code == 200:
                                        self._map_volume_to_drives(vol_detail_resp.json(), volumes_info, controller_name)
                    
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
                                drive_resp, drive_time = self._make_session_request(
                                    ip, drive_url, session, username, password, timeout=(2, 15), legacy_ssl=legacy_ssl
                                )
                                
                                # Log individual drive fetch
                                drive_id = drive_item['@odata.id'].split('/')[-1]
                                self.log_idrac_command(
                                    server_id=server_id,
                                    job_id=job_id,
                                    task_id=None,
                                    command_type='GET',
                                    endpoint=f'/Drives/{drive_id}',
                                    full_url=drive_url,
                                    request_headers=None,
                                    request_body=None,
                                    status_code=drive_resp.status_code if drive_resp else None,
                                    response_time_ms=drive_time,
                                    response_body=None,
                                    success=drive_resp is not None and drive_resp.status_code == 200,
                                    operation_type='idrac_api'
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
            # Log the exception
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='ERROR',
                endpoint='_fetch_storage_drives',
                full_url=f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Storage",
                request_headers=None,
                request_body=None,
                status_code=None,
                response_time_ms=0,
                response_body=None,
                success=False,
                error_message=str(e)[:200],
                operation_type='idrac_api'
            )
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
    
    def _sync_server_drives(self, server_id: str, drives: List[Dict], log_fn=None, job_id: str = None):
        """Sync drive inventory to server_drives table using bulk upsert
        
        Args:
            server_id: The server UUID
            drives: List of drive dictionaries from iDRAC
            log_fn: Optional callback for console logging (displays in UI)
            job_id: Optional job ID for logging visibility
        """
        import time as timing_module
        try:
            # Correct PostgREST upsert headers - Prefer header for resolution
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal"
            }
            
            # Fetch existing drives for this server to preserve historical data
            existing_drives = {}
            try:
                existing_url = f"{DSM_URL}/rest/v1/server_drives?server_id=eq.{server_id}&select=drive_identifier,serial_number,last_known_serial_number,health,status,failed_at"
                existing_response = requests.get(existing_url, headers=headers, verify=VERIFY_SSL, timeout=15)
                if existing_response.status_code == 200:
                    for ex in existing_response.json():
                        existing_drives[ex.get('drive_identifier')] = ex
            except Exception as e:
                self.log(f"  ⚠ Could not fetch existing drives for historical preservation: {e}", "WARN")
            
            # Build list of drive records for bulk upsert
            drive_records = []
            for drive in drives:
                # Generate unique identifier with fallbacks
                new_serial = drive.get('serial_number')
                if new_serial:
                    drive_identifier = f"sn:{new_serial}"
                else:
                    # Fallback to composite: controller + slot + name
                    controller = drive.get('controller', 'unknown')
                    slot = drive.get('slot', 'unknown')
                    name = drive.get('name', 'drive')
                    drive_identifier = f"loc:{controller}:{slot}:{name}"
                
                # Check if we have existing data for this drive
                existing = existing_drives.get(drive_identifier, {})
                existing_serial = existing.get('serial_number')
                existing_last_known = existing.get('last_known_serial_number')
                existing_failed_at = existing.get('failed_at')
                existing_health = existing.get('health')
                existing_status = existing.get('status')
                
                # Preserve serial number: if new scan returns empty but we had one, keep it
                final_serial = new_serial
                last_known_serial = existing_last_known
                if not new_serial and existing_serial:
                    final_serial = existing_serial
                    last_known_serial = existing_serial  # Also save as last_known for reference
                
                # Determine if drive is now faulty
                new_health = drive.get('health')
                new_status = drive.get('status')
                is_now_faulty = new_health == 'Critical' or new_status in ['Disabled', 'UnavailableOffline']
                was_faulty = existing_health == 'Critical' or existing_status in ['Disabled', 'UnavailableOffline']
                
                # Set failed_at timestamp when drive becomes faulty for the first time
                failed_at = existing_failed_at
                if is_now_faulty and not failed_at:
                    failed_at = datetime.utcnow().isoformat() + 'Z'
                elif not is_now_faulty:
                    # Clear failed_at if drive is now healthy (recovered/replaced)
                    failed_at = None
                
                drive_records.append({
                    'server_id': server_id,
                    'drive_identifier': drive_identifier,
                    'name': drive.get('name'),
                    'manufacturer': drive.get('manufacturer'),
                    'model': drive.get('model'),
                    'serial_number': final_serial,
                    'last_known_serial_number': last_known_serial,
                    'failed_at': failed_at,
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
                })
            
            if not drive_records:
                self.log(f"  ⚠ No drives to sync for server {server_id}", "WARN")
                return 0
            
            # Calculate total storage
            total_gb = sum(d.get('capacity_gb') or 0 for d in drive_records)
            total_tb = round(total_gb / 1024, 2) if total_gb else 0
            
            # Log for visibility (both executor and UI console)
            self.log(f"  → Saving {len(drive_records)} drives ({total_tb} TB)", "DEBUG")
            if log_fn:
                log_fn(f"Saving {len(drive_records)} drives ({total_tb} TB)", "INFO")
            
            # Use column names for on_conflict (PostgREST requirement)
            upsert_url = f"{DSM_URL}/rest/v1/server_drives?on_conflict=server_id,drive_identifier"
            try:
                start_time = timing_module.time()
                response = requests.post(
                    upsert_url, 
                    headers=headers, 
                    json=drive_records, 
                    verify=VERIFY_SSL,
                    timeout=30
                )
                response_time_ms = int((timing_module.time() - start_time) * 1000)
                
                # Log database sync operation for visibility
                self.log_idrac_command(
                    server_id=server_id,
                    job_id=job_id,
                    task_id=None,
                    command_type='DB_SYNC',
                    endpoint='/server_drives (upsert)',
                    full_url=upsert_url,
                    request_headers=None,
                    request_body={'drive_count': len(drive_records), 'total_tb': total_tb},
                    status_code=response.status_code,
                    response_time_ms=response_time_ms,
                    response_body=None,
                    success=response.status_code in [200, 201, 204],
                    error_message=response.text[:200] if response.status_code not in [200, 201, 204] else None,
                    operation_type='idrac_api'
                )
                
                if response.status_code in [200, 201, 204]:
                    self.log(f"  ✓ Synced {len(drive_records)} drives", "DEBUG")
                    if log_fn:
                        log_fn(f"✓ Saved {len(drive_records)} drives", "SUCCESS")
                    return len(drive_records)
                else:
                    # Log full error for debugging
                    error_text = response.text[:300] if response.text else 'Unknown error'
                    self.log(f"  ⚠ Drive sync failed: HTTP {response.status_code} - {error_text}", "WARN")
                    if log_fn:
                        log_fn(f"⚠ Drive sync error: HTTP {response.status_code}", "WARN")
                    return 0
            except requests.exceptions.Timeout:
                self.log(f"  ⚠ Drive sync timeout for server {server_id}", "WARN")
                if log_fn:
                    log_fn("⚠ Drive sync timeout", "WARN")
                return 0
            except requests.exceptions.RequestException as e:
                self.log(f"  ⚠ Drive sync request failed: {e}", "WARN")
                if log_fn:
                    log_fn(f"⚠ Drive sync failed: {e}", "WARN")
                return 0
                
        except Exception as e:
            self.log(f"  Error syncing drives for server {server_id}: {e}", "WARN")
            return 0

    def _fetch_ethernet_interfaces(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None, session: Dict = None, legacy_ssl: bool = False) -> List[Dict]:
        """
        Fetch NIC info using iDRAC 8 EthernetInterfaces API (Dell official pattern).
        
        Based on: dell/iDRAC-Redfish-Scripting/GetEthernetInterfacesREDFISH.py
        
        iDRAC 8 does NOT support /Chassis/System.Embedded.1/NetworkAdapters.
        Instead, use /Systems/System.Embedded.1/EthernetInterfaces with $expand.
        
        Response schema differs from iDRAC 9:
        - Id: "NIC.Integrated.1-1-1"
        - MACAddress: "14:FE:B5:FF:B1:9C"
        - SpeedMbps: 1000
        - Status: {"Health": "OK", "State": "Enabled"}
        - LinkStatus: "LinkUp"
        """
        nics = []
        
        try:
            # Dell official pattern from GetEthernetInterfacesREDFISH.py:
            # 1. Try $expand=*($levels=1) for bulk fetch (most efficient) - iDRAC 9+ only
            # 2. If that fails, GET collection then fetch each member individually
            # 
            # CRITICAL: iDRAC 8 CANNOT handle $expand queries - the device hangs for 40+ seconds
            # trying to build the response. Skip $expand entirely for legacy_ssl devices.
            
            if legacy_ssl:
                # iDRAC 8: Skip $expand entirely - go directly to collection + individual fetch
                self.log(f"  → NICs: iDRAC 8 detected (legacy TLS), skipping $expand", "DEBUG")
                interfaces_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/EthernetInterfaces"
                expand_worked = False  # Force individual fetch pattern
                
                interfaces_response, interfaces_time = self._make_session_request(
                    ip, interfaces_url, session, username, password, timeout=(10, 30), legacy_ssl=True
                )
                
                self.log_idrac_command(
                    server_id=server_id, job_id=job_id, task_id=None,
                    command_type='GET', endpoint='/EthernetInterfaces',
                    full_url=interfaces_url, request_headers=None, request_body=None,
                    status_code=interfaces_response.status_code if interfaces_response else None,
                    response_time_ms=interfaces_time, response_body=None,
                    success=interfaces_response is not None and interfaces_response.status_code == 200,
                    operation_type='idrac_api'
                )
            else:
                # iDRAC 9+: Try $expand first for efficiency
                interfaces_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/EthernetInterfaces?$expand=*($levels=1)"
                
                interfaces_response, interfaces_time = self._make_session_request(
                    ip, interfaces_url, session, username, password, timeout=(2, 30), legacy_ssl=False
                )
                
                expand_worked = interfaces_response is not None and interfaces_response.status_code == 200
                
                # Log the API call
                self.log_idrac_command(
                    server_id=server_id, job_id=job_id, task_id=None,
                    command_type='GET', endpoint='/EthernetInterfaces?$expand=*($levels=1)',
                    full_url=interfaces_url, request_headers=None, request_body=None,
                    status_code=interfaces_response.status_code if interfaces_response else None,
                    response_time_ms=interfaces_time, response_body=None,
                    success=expand_worked,
                    operation_type='idrac_api' if expand_worked else 'idrac_api_fallback'
                )
                
                # If $expand failed, try with legacy TLS auto-retry (iDRAC 8 auto-detection)
                if not expand_worked:
                    self.log(f"  → EthernetInterfaces $expand failed, retrying with Legacy TLS...", "DEBUG")
                    # Try legacy TLS with simple collection GET (not $expand)
                    interfaces_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/EthernetInterfaces"
                    interfaces_response, interfaces_time = self._make_session_request(
                        ip, interfaces_url, session, username, password, timeout=(10, 30), legacy_ssl=True
                    )
                    if interfaces_response and interfaces_response.status_code == 200:
                        legacy_ssl = True  # Use for subsequent requests
                        self.log(f"  ✓ EthernetInterfaces succeeded with Legacy TLS", "DEBUG")
                    
                    self.log_idrac_command(
                        server_id=server_id, job_id=job_id, task_id=None,
                        command_type='GET', endpoint='/EthernetInterfaces',
                        full_url=interfaces_url, request_headers=None, request_body=None,
                        status_code=interfaces_response.status_code if interfaces_response else None,
                        response_time_ms=interfaces_time, response_body=None,
                        success=interfaces_response is not None and interfaces_response.status_code == 200,
                        operation_type='idrac_api'
                    )
            
            if not interfaces_response or interfaces_response.status_code != 200:
                return nics
            
            interfaces_data = interfaces_response.json()
            
            # Process Members - check if expanded inline
            for member in interfaces_data.get('Members', []):
                try:
                    # If $expand worked, member has full data
                    if 'Id' in member and ('MACAddress' in member or 'Status' in member):
                        iface_data = member
                    elif '@odata.id' in member:
                        # Need to fetch individually (fallback for non-expanded)
                        interface_url = f"https://{ip}{member['@odata.id']}"
                        iface_resp, iface_time = self._make_session_request(
                            ip, interface_url, session, username, password, timeout=(2, 15), legacy_ssl=legacy_ssl
                        )
                        
                        iface_id = member['@odata.id'].split('/')[-1]
                        self.log_idrac_command(
                            server_id=server_id, job_id=job_id, task_id=None,
                            command_type='GET', endpoint=f'/EthernetInterfaces/{iface_id}',
                            full_url=interface_url, request_headers=None, request_body=None,
                            status_code=iface_resp.status_code if iface_resp else None,
                            response_time_ms=iface_time, response_body=None,
                            success=iface_resp is not None and iface_resp.status_code == 200,
                            operation_type='idrac_api'
                        )
                        
                        if not iface_resp or iface_resp.status_code != 200:
                            continue
                        iface_data = iface_resp.json()
                    else:
                        continue
                    
                    # Map iDRAC 8 EthernetInterface schema to our NIC format
                    status = iface_data.get('Status', {})
                    
                    # Derive link_status - iDRAC 8 may not have LinkStatus at top level
                    # Fall back to Status.State mapping: Enabled → LinkUp, Disabled → LinkDown
                    raw_link_status = iface_data.get('LinkStatus')
                    if not raw_link_status:
                        state = status.get('State', '').lower()
                        if state == 'enabled':
                            raw_link_status = 'LinkUp'
                        elif state in ('disabled', 'standbyoffline', 'absent'):
                            raw_link_status = 'LinkDown'
                    
                    nic_info = {
                        'nic_id': iface_data.get('Id'),
                        'fqdd': iface_data.get('Id'),  # e.g., "NIC.Integrated.1-1-1"
                        'mac_address': iface_data.get('MACAddress'),
                        'permanent_mac_address': iface_data.get('PermanentMACAddress'),
                        'model': iface_data.get('Description') or 'Unknown',
                        'current_speed_mbps': iface_data.get('SpeedMbps'),
                        'link_status': raw_link_status,
                        'auto_neg': iface_data.get('AutoNeg'),
                        'health': status.get('Health', 'Unknown'),
                        'status': status.get('State'),
                        # Fill in adapter-level fields with defaults for iDRAC 8
                        'manufacturer': 'Dell',
                        'serial_number': None,
                        'part_number': None,
                    }
                    nics.append(nic_info)
                    
                except Exception as e:
                    self.log(f"  Error processing EthernetInterface: {e}", "DEBUG")
            
            return nics
            
        except Exception as e:
            self.log(f"  Could not fetch EthernetInterfaces: {e}", "DEBUG")
            return []

    def _fetch_network_adapters(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None, session: Dict = None, legacy_ssl: bool = False) -> List[Dict]:
        """
        Fetch NIC inventory using Dell Redfish Network Adapters API.
        All API calls are logged to idrac_commands for visibility.
        Session-aware: Uses session token if provided for auth efficiency.
        
        LEGACY method: Called when $expand is not supported.
        Uses N+1 pattern but maintains session for efficiency.
        
        Dell Redfish Pattern (iDRAC 9+):
        1. GET /redfish/v1/Chassis/System.Embedded.1/NetworkAdapters → list adapters
        2. For each adapter, GET individual adapter + NetworkDeviceFunctions
        
        iDRAC 8 Fallback:
        - If NetworkAdapters returns 404, falls back to EthernetInterfaces API
        """
        nics = []
        
        try:
            # NO $expand - this is the fallback for iDRACs that don't support it
            adapters_url = f"https://{ip}/redfish/v1/Chassis/System.Embedded.1/NetworkAdapters"
            
            # Use session-based request if available for efficiency
            adapters_response, adapters_time = self._make_session_request(
                ip, adapters_url, session, username, password, timeout=(2, 30), legacy_ssl=legacy_ssl
            )
            
            # Log the network adapters API call
            adapters_succeeded = adapters_response is not None and adapters_response.status_code == 200
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/NetworkAdapters',
                full_url=adapters_url,
                request_headers=None,
                request_body=None,
                status_code=adapters_response.status_code if adapters_response else None,
                response_time_ms=adapters_time,
                response_body=None,
                success=adapters_succeeded,
                error_message=adapters_response.text[:200] if adapters_response and adapters_response.status_code != 200 else None,
                operation_type='idrac_api'
            )
            
            # iDRAC 8 fallback: NetworkAdapters endpoint doesn't exist (404) OR connection timeout (None)
            # iDRAC 8 may timeout on NetworkAdapters instead of returning 404
            if adapters_response is None or (adapters_response and adapters_response.status_code == 404):
                self.log(f"  → NetworkAdapters unavailable (iDRAC 8), using EthernetInterfaces fallback", "DEBUG")
                result = self._fetch_ethernet_interfaces(ip, username, password, server_id, job_id, session, legacy_ssl)
                # If EthernetInterfaces also failed and not using legacy TLS, retry with legacy TLS
                if not result and not legacy_ssl:
                    self.log(f"  → EthernetInterfaces failed, retrying with Legacy TLS...", "DEBUG")
                    result = self._fetch_ethernet_interfaces(ip, username, password, server_id, job_id, session, legacy_ssl=True)
                return result
            
            if adapters_response.status_code != 200:
                return nics
            
            adapters_data = adapters_response.json()
            adapter_items = adapters_data.get('Members', [])
            
            for adapter_item in adapter_items:
                try:
                    # Legacy method: adapter_item is always a reference, fetch individually
                    if '@odata.id' not in adapter_item:
                        continue
                    
                    # Fetch adapter with session
                    adapter_url = f"https://{ip}{adapter_item['@odata.id']}"
                    adapter_resp, adapter_time = self._make_session_request(
                        ip, adapter_url, session, username, password, timeout=(2, 15), legacy_ssl=legacy_ssl
                    )
                    
                    # Log adapter fetch
                    adapter_id = adapter_item['@odata.id'].split('/')[-1]
                    self.log_idrac_command(
                        server_id=server_id,
                        job_id=job_id,
                        task_id=None,
                        command_type='GET',
                        endpoint=f'/NetworkAdapters/{adapter_id}',
                        full_url=adapter_url,
                        request_headers=None,
                        request_body=None,
                        status_code=adapter_resp.status_code if adapter_resp else None,
                        response_time_ms=adapter_time,
                        response_body=None,
                        success=adapter_resp is not None and adapter_resp.status_code == 200,
                        operation_type='idrac_api'
                    )
                    
                    if not adapter_resp or adapter_resp.status_code != 200:
                        continue
                    
                    adapter_data = adapter_resp.json()
                    
                    adapter_id = adapter_data.get('Id')
                    manufacturer = adapter_data.get('Manufacturer')
                    model = adapter_data.get('Model')
                    serial = adapter_data.get('SerialNumber')
                    part_number = adapter_data.get('PartNumber')
                    
                    # Fetch NetworkPorts for speed data (iDRAC 9 stores speed here)
                    port_map = self._fetch_network_ports(ip, adapter_data, session, username, password, legacy_ssl)
                    
                    # Get NetworkDeviceFunctions - NO $expand in legacy method
                    functions_link = adapter_data.get('NetworkDeviceFunctions', {}).get('@odata.id')
                    if functions_link:
                        functions_url = f"https://{ip}{functions_link}"
                        functions_resp, functions_time = self._make_session_request(
                            ip, functions_url, session, username, password, timeout=(2, 20), legacy_ssl=legacy_ssl
                        )
                        
                        self.log_idrac_command(
                            server_id=server_id,
                            job_id=job_id,
                            task_id=None,
                            command_type='GET',
                            endpoint=f'/NetworkAdapters/{adapter_id}/NetworkDeviceFunctions',
                            full_url=functions_url,
                            request_headers=None,
                            request_body=None,
                            status_code=functions_resp.status_code if functions_resp else None,
                            response_time_ms=functions_time,
                            response_body=None,
                            success=functions_resp is not None and functions_resp.status_code == 200,
                            operation_type='idrac_api'
                        )
                        
                        if not functions_resp or functions_resp.status_code != 200:
                            continue
                        
                        functions_data = functions_resp.json()
                        
                        for func_item in functions_data.get('Members', []):
                            try:
                                if '@odata.id' not in func_item:
                                    continue
                                
                                # Fetch individual function with session
                                func_url = f"https://{ip}{func_item['@odata.id']}"
                                func_resp, func_time = self._make_session_request(
                                    ip, func_url, session, username, password, timeout=(2, 15), legacy_ssl=legacy_ssl
                                )
                                
                                # Log function fetch
                                func_id = func_item['@odata.id'].split('/')[-1]
                                self.log_idrac_command(
                                    server_id=server_id,
                                    job_id=job_id,
                                    task_id=None,
                                    command_type='GET',
                                    endpoint=f'/NetworkDeviceFunctions/{func_id}',
                                    full_url=func_url,
                                    request_headers=None,
                                    request_body=None,
                                    status_code=func_resp.status_code if func_resp else None,
                                    response_time_ms=func_time,
                                    response_body=None,
                                    success=func_resp is not None and func_resp.status_code == 200,
                                    operation_type='idrac_api'
                                )
                                
                                if not func_resp or func_resp.status_code != 200:
                                    continue
                                
                                func_data = func_resp.json()
                                
                                nic_info = self._extract_nic_info(func_data, manufacturer, model, serial, part_number, port_map)
                                if nic_info:
                                    nics.append(nic_info)
                                    
                            except Exception as e:
                                self.log(f"  Error processing NIC function: {e}", "DEBUG")
                                continue
                except Exception as e:
                    self.log(f"  Error fetching adapter: {e}", "DEBUG")
                    continue
            
            # Enhance NICs with EthernetInterfaces speed data (Dell official pattern)
            # EthernetInterfaces provides SpeedMbps as an integer, guaranteed to work
            if nics:
                try:
                    eth_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/EthernetInterfaces?$expand=*($levels=1)"
                    eth_resp, eth_time = self._make_session_request(ip, eth_url, session, username, password, timeout=(2, 30), legacy_ssl=legacy_ssl)
                    
                    self.log_idrac_command(
                        server_id=server_id, job_id=job_id, task_id=None,
                        command_type='GET', endpoint='/EthernetInterfaces?$expand (speed enhancement)',
                        full_url=eth_url, request_headers=None, request_body=None,
                        status_code=eth_resp.status_code if eth_resp else None,
                        response_time_ms=eth_time, response_body=None,
                        success=eth_resp is not None and eth_resp.status_code == 200,
                        operation_type='idrac_api'
                    )
                    
                    if eth_resp and eth_resp.status_code == 200:
                        eth_data = eth_resp.json()
                        # Build speed map: FQDD -> SpeedMbps
                        speed_map = {}
                        for member in eth_data.get('Members', []):
                            fqdd = member.get('Id')
                            speed = member.get('SpeedMbps')
                            if fqdd and speed and speed > 0:
                                speed_map[fqdd] = speed
                        
                        # Merge speeds into NICs that are missing speed data
                        # Handle partition suffix: NIC FQDD "NIC.Integrated.1-1-1" vs EthInterface ID "NIC.Integrated.1-1"
                        enhanced_count = 0
                        for nic in nics:
                            if not nic.get('current_speed_mbps'):
                                fqdd = nic.get('fqdd')
                                if not fqdd:
                                    continue
                                
                                speed = None
                                # Pattern 1: Exact match
                                if fqdd in speed_map:
                                    speed = speed_map[fqdd]
                                # Pattern 2: Strip partition suffix (NIC.Integrated.1-1-1 → NIC.Integrated.1-1)
                                if not speed and '-' in fqdd:
                                    eth_id = '-'.join(fqdd.rsplit('-', 1)[:-1])
                                    if eth_id in speed_map:
                                        speed = speed_map[eth_id]
                                
                                if speed:
                                    nic['current_speed_mbps'] = speed
                                    enhanced_count += 1
                        
                        if enhanced_count > 0:
                            self.log(f"  → Enhanced {enhanced_count} NICs with EthernetInterfaces speed data", "DEBUG")
                except Exception as e:
                    self.log(f"  → EthernetInterfaces speed enhancement failed (non-fatal): {e}", "DEBUG")
            
            return nics
            
        except Exception as e:
            self.log(f"  Could not fetch network adapters: {e}", "DEBUG")
            # Log the exception
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='ERROR',
                endpoint='_fetch_network_adapters',
                full_url=f"https://{ip}/redfish/v1/Chassis/System.Embedded.1/NetworkAdapters",
                request_headers=None,
                request_body=None,
                status_code=None,
                response_time_ms=0,
                response_body=None,
                success=False,
                error_message=str(e)[:200],
                operation_type='idrac_api'
            )
            return []
    
    def _fetch_network_ports(self, ip: str, adapter_data: Dict, session: Dict, username: str, password: str, legacy_ssl: bool = False) -> Dict[str, Dict]:
        """
        Fetch NetworkPorts or Ports for an adapter and return a mapping of port_id -> port_data.
        
        Handles both deprecated NetworkPorts and newer Ports property (iDRAC 9 v1.5+).
        Port data includes speed and link status.
        """
        port_map = {}
        
        # Helper to extract speed from port data (handles multiple property names)
        def _extract_speed(port_data: Dict) -> Optional[int]:
            # Try CurrentLinkSpeedMbps first (Dell OEM/newer NetworkPort)
            speed = port_data.get('CurrentLinkSpeedMbps')
            if speed and speed > 0:
                return int(speed)
            
            # Try CurrentSpeedGbps (DMTF Port schema) - convert to Mbps
            speed_gbps = port_data.get('CurrentSpeedGbps')
            if speed_gbps and speed_gbps > 0:
                return int(speed_gbps * 1000)
            
            # Try SupportedLinkCapabilities (older NetworkPort schema)
            capabilities = port_data.get('SupportedLinkCapabilities', [])
            if capabilities and len(capabilities) > 0:
                speed = capabilities[0].get('LinkSpeedMbps')
                if speed and speed > 0:
                    return int(speed)
            
            return None
        
        # Helper to parse port data into port_map
        def _parse_port_item(port_item):
            try:
                if 'Id' in port_item:
                    # Port is expanded, parse directly
                    port_id = port_item.get('Id')
                    if port_id:
                        port_map[port_id] = {
                            'current_speed_mbps': _extract_speed(port_item),
                            'link_status': port_item.get('LinkStatus'),
                        }
                elif '@odata.id' in port_item:
                    # Port is a link, need to fetch individually
                    port_url = f"https://{ip}{port_item['@odata.id']}"
                    port_resp, _ = self._make_session_request(
                        ip, port_url, session, username, password, timeout=(2, 10), legacy_ssl=legacy_ssl
                    )
                    if port_resp and port_resp.status_code == 200:
                        port_data = port_resp.json()
                        port_id = port_data.get('Id')
                        if port_id:
                            port_map[port_id] = {
                                'current_speed_mbps': _extract_speed(port_data),
                                'link_status': port_data.get('LinkStatus'),
                            }
            except Exception:
                pass
        
        # Try Ports first (newer iDRAC 9 with v1.5+ NetworkAdapter schema)
        ports_data = adapter_data.get('Ports', {})
        network_ports_data = adapter_data.get('NetworkPorts', {})
        
        # Determine which collection to use
        ports_link = None
        
        # Check Ports first (newer schema) at top level
        if isinstance(ports_data, dict):
            if 'Members' in ports_data:
                # Ports is already expanded inline
                self.log(f"  → Ports expanded inline with {len(ports_data.get('Members', []))} members", "DEBUG")
                for port_item in ports_data.get('Members', []):
                    _parse_port_item(port_item)
                if port_map:
                    self.log(f"  → Port map: {list(port_map.keys())}", "DEBUG")
                return port_map
            elif '@odata.id' in ports_data:
                ports_link = ports_data['@odata.id']
                self.log(f"  → Found Ports link: {ports_link}", "DEBUG")
        
        # Fallback to NetworkPorts at top level (deprecated but still common)
        if not ports_link and isinstance(network_ports_data, dict):
            if 'Members' in network_ports_data:
                # NetworkPorts is already expanded inline
                self.log(f"  → NetworkPorts expanded inline with {len(network_ports_data.get('Members', []))} members", "DEBUG")
                for port_item in network_ports_data.get('Members', []):
                    _parse_port_item(port_item)
                if port_map:
                    self.log(f"  → Port map: {list(port_map.keys())}", "DEBUG")
                return port_map
            elif '@odata.id' in network_ports_data:
                ports_link = network_ports_data['@odata.id']
                self.log(f"  → Found NetworkPorts link: {ports_link}", "DEBUG")
        
        # Check Controllers[0].Links (Dell iDRAC pattern)
        if not ports_link:
            controllers = adapter_data.get('Controllers', [])
            if controllers and len(controllers) > 0:
                links = controllers[0].get('Links', {})
                ports_ref = links.get('Ports') or links.get('NetworkPorts')
                if isinstance(ports_ref, dict) and '@odata.id' in ports_ref:
                    ports_link = ports_ref['@odata.id']
                    self.log(f"  → Found Ports link in Controllers[0].Links: {ports_link}", "DEBUG")
                elif isinstance(ports_ref, list) and len(ports_ref) > 0:
                    # Some schemas return array of links - get parent collection
                    if '@odata.id' in ports_ref[0]:
                        ports_link = ports_ref[0]['@odata.id'].rsplit('/', 1)[0]
                        self.log(f"  → Found Ports link from array in Controllers[0].Links: {ports_link}", "DEBUG")
        
        # Final fallback: Construct URL from adapter ID
        if not ports_link:
            adapter_id = adapter_data.get('Id')
            if adapter_id:
                ports_link = f"/redfish/v1/Chassis/System.Embedded.1/NetworkAdapters/{adapter_id}/NetworkPorts"
                self.log(f"  → Constructed NetworkPorts URL for {adapter_id}: {ports_link}", "DEBUG")
            else:
                self.log(f"  → No Ports or NetworkPorts link found in adapter", "DEBUG")
                return port_map
        
        try:
            # Try with $expand first
            ports_url = f"https://{ip}{ports_link}?$expand=Members"
            ports_resp, _ = self._make_session_request(
                ip, ports_url, session, username, password, timeout=(2, 15), legacy_ssl=legacy_ssl
            )
            
            if not ports_resp or ports_resp.status_code != 200:
                # Fallback without $expand
                ports_url = f"https://{ip}{ports_link}"
                ports_resp, _ = self._make_session_request(
                    ip, ports_url, session, username, password, timeout=(2, 15), legacy_ssl=legacy_ssl
                )
            
            if not ports_resp or ports_resp.status_code != 200:
                self.log(f"  → Failed to fetch ports: status={ports_resp.status_code if ports_resp else 'None'}", "DEBUG")
                return port_map
            
            ports_collection = ports_resp.json()
            self.log(f"  → Fetched {len(ports_collection.get('Members', []))} port members", "DEBUG")
            
            for port_item in ports_collection.get('Members', []):
                _parse_port_item(port_item)
            
            if port_map:
                self.log(f"  → Port map: {list(port_map.keys())}", "DEBUG")
                    
        except Exception as e:
            self.log(f"  Error fetching ports: {e}", "DEBUG")
        
        return port_map
    
    def _extract_nic_info(self, func_data: Dict, manufacturer: str, model: str, serial: str, part_number: str, port_map: Dict = None) -> Optional[Dict]:
        """Extract NIC information from Redfish NetworkDeviceFunction response"""
        try:
            # Extract ethernet info (contains MAC addresses)
            ethernet = func_data.get('Ethernet', {})
            status = func_data.get('Status', {})
            
            # Get Dell OEM data for link status and speed
            dell_oem = func_data.get('Oem', {}).get('Dell', {}).get('DellNIC', {})
            
            # Get link status with fallbacks:
            # 1. Dell OEM DellNIC.LinkStatus
            # 2. Top-level LinkStatus (standard DMTF)
            # 3. Derive from Status.State
            link_status = dell_oem.get('LinkStatus')
            if not link_status:
                link_status = func_data.get('LinkStatus')
            if not link_status:
                state = status.get('State', '').lower()
                if state == 'enabled':
                    link_status = 'LinkUp'
                elif state in ('disabled', 'standbyoffline', 'absent'):
                    link_status = 'LinkDown'
            
            # Get speed with fallbacks (treat 0 as "no data"):
            # 1. Dell OEM DellNIC.LinkSpeed (can be int or string like "1000 Mbps", "10 Gbps")
            # 2. Top-level SpeedMbps (standard DMTF)
            # 3. Ethernet.SpeedMbps
            # 4. NetworkPorts data (port_map lookup)
            current_speed = None
            link_speed = dell_oem.get('LinkSpeed')
            if link_speed is not None:
                try:
                    if isinstance(link_speed, int):
                        if link_speed > 0:
                            current_speed = link_speed
                    elif isinstance(link_speed, str):
                        # Parse strings like "1000 Mbps", "10 Gbps", "25000", etc.
                        link_speed_clean = link_speed.strip().upper()
                        if 'GBPS' in link_speed_clean or 'GB' in link_speed_clean:
                            # Extract number and convert Gbps to Mbps
                            num = ''.join(c for c in link_speed_clean.split('G')[0] if c.isdigit() or c == '.')
                            if num:
                                current_speed = int(float(num) * 1000)
                        elif 'MBPS' in link_speed_clean or 'MB' in link_speed_clean:
                            # Extract Mbps value
                            num = ''.join(c for c in link_speed_clean.split('M')[0] if c.isdigit())
                            if num:
                                current_speed = int(num)
                        else:
                            # Try direct integer parse (legacy format or plain number)
                            num = ''.join(c for c in link_speed_clean if c.isdigit())
                            if num:
                                parsed = int(num)
                                if parsed > 0:
                                    current_speed = parsed
                except (ValueError, TypeError, AttributeError):
                    pass
            
            # Check each fallback, treating 0 as "no data"
            if not current_speed:  # None or 0
                speed_val = func_data.get('SpeedMbps')
                if speed_val and speed_val > 0:
                    current_speed = speed_val
            
            if not current_speed:  # None or 0
                speed_val = ethernet.get('SpeedMbps')
                if speed_val and speed_val > 0:
                    current_speed = speed_val
            
            # Fallback to NetworkPorts data if available
            if not current_speed and port_map:  # None or 0
                fqdd = func_data.get('Id', '')
                port_data = {}
                
                # Try multiple port ID patterns:
                # Pattern 1: Full FQDD prefix (NIC.Integrated.1-2-1 → NIC.Integrated.1-2)
                if '-' in fqdd:
                    port_id_full = '-'.join(fqdd.rsplit('-', 1)[:-1])
                    port_data = port_map.get(port_id_full, {})
                
                # Pattern 2: Extract port number and try ordinal matches
                if not port_data and '-' in fqdd:
                    # Parse: NIC.Integrated.1-2-1 → adapter=NIC.Integrated.1, port=2, partition=1
                    parts = fqdd.rsplit('-', 2)
                    if len(parts) >= 2:
                        port_num = parts[-2] if len(parts) == 3 else parts[-1]
                        # Try: "2", "Port2", "<adapter>-<port_num>"
                        for pattern in [port_num, f"Port{port_num}", f"{parts[0]}-{port_num}"]:
                            port_data = port_map.get(pattern, {})
                            if port_data:
                                break
                
                # Pattern 3: If port_map only has one entry, use it as fallback
                if not port_data and len(port_map) == 1:
                    port_data = list(port_map.values())[0]
                
                speed_val = port_data.get('current_speed_mbps')
                if speed_val and speed_val > 0:
                    current_speed = speed_val
                
                # Also use port link status if we don't have one
                if not link_status:
                    link_status = port_data.get('link_status')
            
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
                'link_status': link_status,
                'current_speed_mbps': current_speed,
                'health': status.get('Health'),
                'status': status.get('State'),
                'switch_connection_id': switch_connection_id,
                'switch_port_description': switch_port_desc,
            }
        except Exception as e:
            self.logger.warning(f"Failed to extract NIC info: {e}")
            return None
    
    def _sync_server_nics(self, server_id: str, nics: List[Dict], log_fn=None, job_id: str = None):
        """Sync NIC inventory to server_nics table using bulk upsert
        
        Args:
            server_id: The server UUID
            nics: List of NIC dictionaries from iDRAC
            log_fn: Optional callback for console logging (displays in UI)
            job_id: Optional job ID for logging visibility
        """
        import time as timing_module
        try:
            # Correct PostgREST upsert headers - Prefer header for resolution
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal"
            }
            
            # Build list of NIC records for bulk upsert
            nic_records = []
            for nic in nics:
                if not nic.get('fqdd'):
                    continue  # Skip NICs without FQDD
                
                nic_records.append({
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
                })
            
            if not nic_records:
                return 0
            
            # Log for visibility (both executor and UI console)
            self.log(f"  → Saving {len(nic_records)} NICs", "DEBUG")
            if log_fn:
                log_fn(f"Saving {len(nic_records)} NICs", "INFO")
            
            # Use column names for on_conflict (PostgREST requirement)
            upsert_url = f"{DSM_URL}/rest/v1/server_nics?on_conflict=server_id,fqdd"
            start_time = timing_module.time()
            response = requests.post(
                upsert_url, 
                headers=headers, 
                json=nic_records, 
                verify=VERIFY_SSL,
                timeout=30
            )
            response_time_ms = int((timing_module.time() - start_time) * 1000)
            
            # Log database sync operation for visibility
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='DB_SYNC',
                endpoint='/server_nics (upsert)',
                full_url=upsert_url,
                request_headers=None,
                request_body={'nic_count': len(nic_records)},
                status_code=response.status_code,
                response_time_ms=response_time_ms,
                response_body=None,
                success=response.status_code in [200, 201, 204],
                error_message=response.text[:200] if response.status_code not in [200, 201, 204] else None,
                operation_type='idrac_api'
            )
            
            if response.status_code in [200, 201, 204]:
                self.log(f"  ✓ Synced {len(nic_records)} NICs", "DEBUG")
                if log_fn:
                    log_fn(f"✓ Saved {len(nic_records)} NICs", "SUCCESS")
                return len(nic_records)
            else:
                error_text = response.text[:200] if response.text else 'Unknown error'
                self.log(f"  ⚠ NIC sync failed: HTTP {response.status_code} - {error_text}", "WARN")
                if log_fn:
                    log_fn(f"⚠ NIC sync error: HTTP {response.status_code}", "WARN")
                return 0
                
        except Exception as e:
            self.log(f"  Error syncing NICs for server {server_id}: {e}", "WARN")
            return 0

    def _fetch_memory_dimms(self, ip: str, username: str, password: str, server_id: str = None, job_id: str = None, session: Dict = None, legacy_ssl: bool = False) -> List[Dict]:
        """
        Fetch memory/DIMM inventory using Dell Redfish Memory API.
        Session-aware: Uses session token if provided for auth efficiency.
        Legacy TLS aware: Uses TLS 1.0/1.1 for iDRAC 8 compatibility.
        
        Dell Redfish Pattern (per GetSystemHWInventoryREDFISH.py):
        1. GET /redfish/v1/Systems/System.Embedded.1/Memory → list of DIMMs
        2. For each DIMM, extract health, capacity, manufacturer, etc.
        
        Returns list of DIMM dicts ready for server_memory table.
        """
        import re
        dimms = []
        
        try:
            # Get memory collection with $expand for efficiency
            memory_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Memory?$expand=Members"
            
            # Always use session-based request for proper legacy_ssl handling
            memory_response, memory_time = self._make_session_request(
                ip, memory_url, session, username, password, timeout=(2, 30), legacy_ssl=legacy_ssl
            )
            
            # Log the API call
            expand_succeeded = memory_response is not None and memory_response.status_code == 200
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='GET',
                endpoint='/redfish/v1/Systems/System.Embedded.1/Memory?$expand=Members',
                full_url=memory_url,
                request_headers=None,
                request_body=None,
                status_code=memory_response.status_code if memory_response else None,
                response_time_ms=memory_time,
                response_body=None,
                success=expand_succeeded,
                error_message=memory_response.text[:200] if memory_response and memory_response.status_code != 200 else None,
                operation_type='idrac_api' if expand_succeeded else 'idrac_api_fallback'
            )
            
            # Fallback to non-expanded if needed
            if not memory_response or memory_response.status_code != 200:
                memory_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Memory"
                memory_response, memory_time = self._make_session_request(
                    ip, memory_url, session, username, password, timeout=(2, 15), legacy_ssl=legacy_ssl
                )
                
                # Log fallback
                self.log_idrac_command(
                    server_id=server_id,
                    job_id=job_id,
                    task_id=None,
                    command_type='GET',
                    endpoint='/redfish/v1/Systems/System.Embedded.1/Memory',
                    full_url=memory_url,
                    request_headers=None,
                    request_body=None,
                    status_code=memory_response.status_code if memory_response else None,
                    response_time_ms=memory_time,
                    response_body=None,
                    success=memory_response is not None and memory_response.status_code == 200,
                    operation_type='idrac_api'
                )
            
            if not memory_response or memory_response.status_code != 200:
                return dimms
            
            memory_data = memory_response.json()
            members = memory_data.get('Members', [])
            
            for member in members:
                try:
                    # If $expand worked, member has full data; else fetch individually
                    if '@odata.id' in member and 'Id' not in member:
                        dimm_url = f"https://{ip}{member['@odata.id']}"
                        dimm_resp, _ = self._make_session_request(
                            ip, dimm_url, session, username, password, timeout=(2, 10), legacy_ssl=legacy_ssl
                        )
                        if not dimm_resp or dimm_resp.status_code != 200:
                            continue
                        dimm_data = dimm_resp.json()
                    else:
                        dimm_data = member
                    
                    # Skip absent DIMMs (empty slots)
                    status = dimm_data.get('Status', {})
                    if status.get('State') == 'Absent':
                        continue
                    
                    # Extract slot name from Id (e.g., "DIMM.Socket.B2" -> "B2")
                    dimm_id = dimm_data.get('Id', '')
                    slot_match = re.search(r'DIMM\.Socket\.(\w+)', dimm_id)
                    slot_name = slot_match.group(1) if slot_match else dimm_id
                    
                    dimm_record = {
                        'server_id': server_id,
                        'dimm_identifier': dimm_id,
                        'slot_name': slot_name,
                        'manufacturer': dimm_data.get('Manufacturer'),
                        'part_number': dimm_data.get('PartNumber'),
                        'serial_number': dimm_data.get('SerialNumber') or None,
                        'capacity_mb': dimm_data.get('CapacityMiB'),
                        'speed_mhz': dimm_data.get('OperatingSpeedMhz'),
                        'memory_type': dimm_data.get('MemoryDeviceType'),
                        'rank_count': dimm_data.get('RankCount'),
                        'health': status.get('Health'),  # "OK", "Warning", "Critical"
                        'status': status.get('State'),   # "Enabled", "Disabled"
                        'operating_speed_mhz': dimm_data.get('OperatingSpeedMhz'),
                        'error_correction': dimm_data.get('ErrorCorrection'),
                        'volatile_size_mb': dimm_data.get('VolatileSizeMiB'),
                        'non_volatile_size_mb': dimm_data.get('NonVolatileSizeMiB'),
                    }
                    
                    dimms.append(dimm_record)
                    
                except Exception as e:
                    self.log(f"  ⚠ Error parsing DIMM {member.get('@odata.id', 'unknown')}: {e}", "DEBUG")
                    continue
            
            return dimms
            
        except Exception as e:
            self.log(f"Error fetching memory DIMMs from {ip}: {e}", "ERROR")
            return dimms

    def _sync_server_memory(self, server_id: str, dimms: List[Dict], log_fn=None, job_id: str = None) -> int:
        """
        Sync memory/DIMM data to server_memory table using PostgREST bulk upsert.
        Uses on_conflict=server_id,dimm_identifier with merge-duplicates.
        """
        if not dimms:
            return 0
        
        try:
            # Prepare memory records with timestamps
            memory_records = []
            for dimm in dimms:
                record = {
                    'server_id': server_id,
                    'dimm_identifier': dimm.get('dimm_identifier'),
                    'slot_name': dimm.get('slot_name'),
                    'manufacturer': dimm.get('manufacturer'),
                    'part_number': dimm.get('part_number'),
                    'serial_number': dimm.get('serial_number'),
                    'capacity_mb': dimm.get('capacity_mb'),
                    'speed_mhz': dimm.get('speed_mhz'),
                    'memory_type': dimm.get('memory_type'),
                    'rank_count': dimm.get('rank_count'),
                    'health': dimm.get('health'),
                    'status': dimm.get('status'),
                    'operating_speed_mhz': dimm.get('operating_speed_mhz'),
                    'error_correction': dimm.get('error_correction'),
                    'volatile_size_mb': dimm.get('volatile_size_mb'),
                    'non_volatile_size_mb': dimm.get('non_volatile_size_mb'),
                    'last_updated_at': datetime.utcnow().isoformat() + 'Z',
                }
                memory_records.append(record)
            
            # PostgREST bulk upsert with on_conflict using column names
            upsert_url = f"{DSM_URL}/rest/v1/server_memory?on_conflict=server_id,dimm_identifier"
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates"
            }
            
            start_time = time.time()
            response = requests.post(
                upsert_url,
                headers=headers,
                json=memory_records,
                verify=VERIFY_SSL,
                timeout=30
            )
            response_time_ms = int((time.time() - start_time) * 1000)
            
            # Log database sync operation for visibility
            self.log_idrac_command(
                server_id=server_id,
                job_id=job_id,
                task_id=None,
                command_type='DB_SYNC',
                endpoint='/server_memory (upsert)',
                full_url=upsert_url,
                request_headers=None,
                request_body={'dimm_count': len(memory_records)},
                status_code=response.status_code,
                response_time_ms=response_time_ms,
                response_body=None,
                success=response.status_code in [200, 201, 204],
                error_message=response.text[:200] if response.status_code not in [200, 201, 204] else None,
                operation_type='idrac_api'
            )
            
            if response.status_code in [200, 201, 204]:
                self.log(f"  ✓ Synced {len(memory_records)} DIMMs", "DEBUG")
                if log_fn:
                    log_fn(f"✓ Saved {len(memory_records)} DIMMs", "SUCCESS")
                return len(memory_records)
            else:
                error_text = response.text[:200] if response.text else 'Unknown error'
                self.log(f"  ⚠ Memory sync failed: HTTP {response.status_code} - {error_text}", "WARN")
                if log_fn:
                    log_fn(f"⚠ Memory sync error: HTTP {response.status_code}", "WARN")
                return 0
                
        except Exception as e:
            self.log(f"  Error syncing memory for server {server_id}: {e}", "WARN")
            return 0

    def _should_backup_server(self, server_id: str, max_age_days: int) -> bool:
        """Check if server needs a backup based on age threshold"""
        try:
            from datetime import timedelta, timezone
            
            headers = {
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            }
            
            # Get most recent backup for this server
            url = f"{DSM_URL}/rest/v1/scp_backups"
            params = {
                "server_id": f"eq.{server_id}",
                "select": "created_at",
                "order": "created_at.desc",
                "limit": "1"
            }
            response = requests.get(url, headers=headers, params=params, verify=VERIFY_SSL)
            
            if response.status_code != 200:
                return True  # If we can't check, run the backup
            
            backups = response.json()
            if not backups:
                return True  # No existing backup, run it
            
            # Parse the most recent backup date
            last_backup_str = backups[0]['created_at']
            # Handle ISO format with or without timezone
            if last_backup_str.endswith('Z'):
                last_backup_str = last_backup_str.replace('Z', '+00:00')
            last_backup = datetime.fromisoformat(last_backup_str)
            
            # Ensure timezone-aware comparison
            if last_backup.tzinfo is None:
                last_backup = last_backup.replace(tzinfo=timezone.utc)
            
            cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
            
            is_stale = last_backup < cutoff
            if not is_stale:
                self.log(f"  → Last backup from {last_backup.strftime('%Y-%m-%d')} is within {max_age_days} days", "DEBUG")
            
            return is_stale  # True if backup is stale and needs refresh
            
        except Exception as e:
            self.log(f"  Warning: Could not check backup age: {e}", "DEBUG")
            return True  # If check fails, run the backup

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
        """Test iDRAC connection and get basic info (lightweight version using SessionManager)"""
        url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1"
        
        try:
            # Use session manager for request handling
            start_time = time.time()
            response = self.session_manager.make_request(
                method='GET',
                url=url,
                ip=ip,
                auth=(username, password),
                timeout=(2, 10)  # 2s connect, 10s read
            )
            response_time_ms = int((time.time() - start_time) * 1000)
            
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

    def sync_one_server(self, server: Dict, fetch_options: Dict, job_id: str) -> Dict:
        """
        Sync a single server's data from iDRAC. Pure worker function - no job progress updates.
        
        This method is designed to be called from a thread pool. It performs:
        - Credential resolution
        - Redfish API query for comprehensive info
        - Database update for server record
        - Health record insertion
        - Drive/NIC sync
        - vCenter auto-linking
        
        Returns a result dict (no side effects on job state):
            {
                'server_id': str,
                'ip': str,
                'success': bool,
                'model': str | None,
                'hostname': str | None,
                'service_tag': str | None,
                'error': str | None,
                'error_type': 'credentials' | 'unreachable' | 'auth_failed' | 'lockout_risk' | 'db_error' | None,
                'logs': List[str],  # Local log messages for this server
                'needs_backup': bool,  # True if SCP backup should be queued
                'cred_source': str | None,
            }
        """
        ip = server['ip_address']
        server_id = server['id']
        logs = []  # Thread-local log accumulator
        
        def log_local(message: str, level: str = 'INFO'):
            """Add message to local logs (thread-safe, no shared state)"""
            timestamp = datetime.utcnow().strftime('%H:%M:%S')
            logs.append(f'[{timestamp}] [{level}] {message}')
            self.log(message, level)
        
        headers = {
            "apikey": SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }
        
        # Default result structure
        result = {
            'server_id': server_id,
            'ip': ip,
            'success': False,
            'model': None,
            'hostname': None,
            'service_tag': None,
            'error': None,
            'error_type': None,
            'logs': logs,
            'needs_backup': False,
            'cred_source': None,
        }
        
        try:
            log_local(f'Syncing: {ip}', 'INFO')
            
            # Resolve credentials using priority order
            username, password, cred_source, used_cred_set_id = self.resolve_credentials_for_server(server)
            result['cred_source'] = cred_source
            
            # Handle credential resolution failures
            if cred_source == 'decrypt_failed':
                error_msg = 'Encryption key not configured; cannot decrypt credentials'
                update_data = {
                    'connection_status': 'offline',
                    'connection_error': error_msg,
                    'credential_test_status': 'invalid',
                    'credential_last_tested': datetime.utcnow().isoformat() + 'Z'
                }
                update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}"
                requests.patch(update_url, headers=headers, json=update_data, verify=VERIFY_SSL)
                
                log_local(f'✗ Cannot decrypt credentials for {ip}', 'ERROR')
                result['error'] = error_msg
                result['error_type'] = 'credentials'
                return result
            
            if not username or not password:
                log_local(f'✗ No credentials available for {ip}', 'WARN')
                result['error'] = 'No credentials available'
                result['error_type'] = 'credentials'
                return result
            
            # Query iDRAC for comprehensive info
            info = self.get_comprehensive_server_info(ip, username, password, server_id=server_id, job_id=job_id)
            
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
                    all_healthy = all([
                        health_status.get('storage_healthy', True) != False,
                        health_status.get('thermal_healthy', True) != False,
                        health_status.get('power_healthy', True) != False
                    ])
                    update_data['overall_health'] = 'OK' if all_healthy else 'Warning'
                    update_data['last_health_check'] = datetime.utcnow().isoformat() + 'Z'
                
                # Check memory health from DIMMs and update overall health
                if info.get('memory_dimms'):
                    memory_healths = [d.get('health') for d in info['memory_dimms'] if d.get('health')]
                    memory_healthy = all(h == 'OK' for h in memory_healths)
                    if not memory_healthy:
                        # Downgrade overall health if any DIMM is unhealthy
                        update_data['overall_health'] = 'Warning'
                
                # Promote credential_set_id if we used discovered_by or ip_range and server doesn't have one
                if not server.get('credential_set_id') and used_cred_set_id and cred_source in ['discovered_by_credential_set_id', 'ip_range']:
                    update_data['credential_set_id'] = used_cred_set_id
                    self.log(f"  → Promoting credential_set_id {used_cred_set_id} from {cred_source}", "INFO")
                
                # Mirror model to product_name if missing
                if 'product_name' not in update_data and info.get('model'):
                    update_data['product_name'] = info['model']
                
                self.log(f"  Updating {ip} with fields: {list(update_data.keys())}", "DEBUG")
                
                update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}"
                update_response = requests.patch(update_url, headers=headers, json=update_data, verify=VERIFY_SSL)
                
                if update_response.status_code in [200, 204]:
                    log_local(f'✓ Synced: {ip} ({info.get("model", "Unknown")})', 'SUCCESS')
                    
                    result['success'] = True
                    result['model'] = info.get('model')
                    result['hostname'] = info.get('hostname')
                    result['service_tag'] = info.get('service_tag')
                    result['needs_backup'] = True  # Backup should be queued (orchestrator will decide)
                    
                    # Insert health record to server_health table if health data exists
                    if info.get('health_status'):
                        health_status = info['health_status']
                        health_record = {
                            'server_id': server_id,
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
                    
                    # Sync drives to server_drives table with console logging
                    drives_synced = 0
                    if info.get('drives'):
                        log_local(f'→ Reading storage: found {len(info["drives"])} drive(s)', 'INFO')
                        drives_synced = self._sync_server_drives(server_id, info['drives'], log_fn=log_local, job_id=job_id) or 0
                    
                    # Sync NICs to server_nics table with console logging
                    nics_synced = 0
                    if info.get('nics'):
                        log_local(f'→ Reading NICs: found {len(info["nics"])} adapter(s)', 'INFO')
                        nics_synced = self._sync_server_nics(server_id, info['nics'], log_fn=log_local, job_id=job_id) or 0
                    
                    # Sync memory/DIMMs to server_memory table with console logging
                    memory_synced = 0
                    if info.get('memory_dimms'):
                        log_local(f'→ Reading memory: found {len(info["memory_dimms"])} DIMM(s)', 'INFO')
                        memory_synced = self._sync_server_memory(server_id, info['memory_dimms'], log_fn=log_local, job_id=job_id) or 0
                    
                    # Try auto-linking to vCenter if service_tag was updated
                    if info.get('service_tag'):
                        self.auto_link_vcenter(server_id, info.get('service_tag'))
                    
                    # Create audit trail entry for server discovery
                    self._create_server_audit_entry(
                        server_id=server_id,
                        job_id=job_id,
                        action='server_discovery',
                        summary=f"Server discovered: {info.get('model', 'Unknown')} ({info.get('service_tag', 'N/A')})",
                        details={
                            'bios_version': info.get('bios_version'),
                            'idrac_firmware': info.get('idrac_firmware'),
                            'health_status': info.get('health_status'),
                            'event_logs_fetched': info.get('event_log_count', 0)
                        }
                    )
                else:
                    error_msg = f'DB update failed: HTTP {update_response.status_code}'
                    log_local(f'✗ DB update failed: {ip}', 'ERROR')
                    result['error'] = error_msg
                    result['error_type'] = 'db_error'
            else:
                # Failed to query iDRAC - determine specific error cause
                conn_result = self.test_idrac_connectivity(ip)
                
                if not conn_result['reachable']:
                    error_msg = f'Host unreachable: {conn_result["message"]}'
                    cred_status = 'unknown'
                else:
                    error_msg = f'Authentication failed using {cred_source} credentials - verify username/password'
                    cred_status = 'invalid'
                
                update_data = {
                    'connection_status': 'offline',
                    'connection_error': error_msg,
                    'last_connection_test': datetime.utcnow().isoformat() + 'Z',
                    'credential_test_status': cred_status,
                }
                
                update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}"
                requests.patch(update_url, headers=headers, json=update_data, verify=VERIFY_SSL)
                
                log_local(f'✗ {error_msg}: {ip}', 'ERROR')
                result['error'] = error_msg
                result['error_type'] = 'auth_failed' if cred_status == 'invalid' else 'unreachable'
                
        except Exception as e:
            error_msg = f'Exception during sync: {str(e)}'
            log_local(f'✗ {error_msg}: {ip}', 'ERROR')
            result['error'] = error_msg
            result['error_type'] = 'exception'
        
        return result

    def refresh_existing_servers(self, job: Dict, server_ids: List[str]):
        """Refresh information for existing servers by querying iDRAC using parallel sync"""
        from concurrent.futures import ThreadPoolExecutor, as_completed
        
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
            scp_completed = 0  # Track inline SCP backup results
            
            # Fetch current job details to preserve discovery progress
            try:
                job_details_url = f"{DSM_URL}/rest/v1/jobs?id=eq.{job['id']}&select=details"
                job_details_response = requests.get(job_details_url, headers=headers, verify=VERIFY_SSL)
                if job_details_response.status_code == 200:
                    job_records = job_details_response.json()
                    base_details = job_records[0].get('details', {}) if job_records else {}
                else:
                    base_details = {}
            except Exception:
                base_details = {}
            
            # Extract fetch_options to control which data to collect
            fetch_options = base_details.get('fetch_options', {})
            should_backup_scp = fetch_options.get('scp_backup', True)  # Default True for backwards compat
            scp_max_age_days = fetch_options.get('scp_backup_max_age_days', 30)
            scp_only_if_stale = fetch_options.get('scp_backup_only_if_stale', True)
            
            # Initialize console log for UI display
            console_log = base_details.get('console_log', [])
            
            def log_console(message: str, level: str = 'INFO'):
                """Add message to console log for UI display"""
                nonlocal console_log
                timestamp = datetime.utcnow().strftime('%H:%M:%S')
                console_log.append(f'[{timestamp}] [{level}] {message}')
                self.log(message, level)
            
            log_console(f'Starting data sync for {total_servers} server(s) (concurrency: 4)', 'INFO')
            
            if not should_backup_scp:
                log_console('SCP backup disabled - will not queue backup jobs', 'INFO')
            
            # Mark all tasks as running initially
            for server in servers:
                task = task_by_server.get(server['id'])
                if task:
                    self.update_task_status(
                        task['id'],
                        'running',
                        log=f"Querying iDRAC at {server['ip_address']}...",
                        progress=0,
                        started_at=datetime.now().isoformat()
                    )
            
            # Update job to show sync starting
            self.update_job_status(
                job['id'],
                'running',
                details={
                    **base_details,
                    'current_stage': 'sync',
                    'current_step': f'Starting parallel sync of {total_servers} server(s)',
                    'servers_refreshed': 0,
                    'servers_total': total_servers,
                    'in_syncing': min(4, total_servers),
                    'console_log': console_log,
                }
            )
            
            # Dispatch to thread pool - workers return results, don't update progress
            # Concurrency default 4 matches throttler limit
            max_workers = min(4, total_servers) if total_servers > 0 else 1
            results = []
            backup_queue = []  # Servers that need SCP backup queued
            
            # Thread-safe tracking of active servers (for progress display)
            import threading
            active_servers_lock = threading.Lock()
            active_servers = {}  # server_id -> {'ip': str, 'started': str}
            
            def tracked_sync(srv):
                """Wrapper to track active servers during sync"""
                server_id = srv['id']
                ip = srv['ip_address']
                with active_servers_lock:
                    active_servers[server_id] = {'ip': ip, 'started': datetime.utcnow().isoformat()}
                try:
                    return self.sync_one_server(srv, fetch_options, job['id'])
                finally:
                    with active_servers_lock:
                        active_servers.pop(server_id, None)
            
            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                # Submit all servers to pool with tracking wrapper
                future_to_server = {
                    pool.submit(tracked_sync, srv): srv
                    for srv in servers
                }
                
                # Process results as they complete (main thread only - progress updates here)
                for future in as_completed(future_to_server):
                    try:
                        result = future.result()
                    except Exception as e:
                        # Should not happen - sync_one_server catches exceptions
                        server = future_to_server[future]
                        result = {
                            'server_id': server['id'],
                            'ip': server['ip_address'],
                            'success': False,
                            'error': str(e),
                            'error_type': 'exception',
                            'logs': [f'[{datetime.utcnow().strftime("%H:%M:%S")}] [ERROR] Exception: {e}'],
                            'needs_backup': False,
                            'cred_source': None,
                        }
                    
                    results.append(result)
                    
                    # Aggregate logs to shared console_log (main thread)
                    console_log.extend(result.get('logs', []))
                    
                    # Update counters
                    if result['success']:
                        refreshed_count += 1
                        # Check if backup should be queued
                        if should_backup_scp and result.get('needs_backup'):
                            # Check staleness before queuing
                            should_run_backup = True
                            if scp_only_if_stale:
                                should_run_backup = self._should_backup_server(result['server_id'], scp_max_age_days)
                            
                            if should_run_backup:
                                backup_queue.append(result)
                    else:
                        failed_count += 1
                    
                    # Update task status (main thread)
                    task = task_by_server.get(result['server_id'])
                    if task:
                        last_log = result.get('logs', [''])[-1] if result.get('logs') else ''
                        self.update_task_status(
                            task['id'],
                            'completed' if result['success'] else 'failed',
                            log=last_log,
                            progress=100,
                            completed_at=datetime.now().isoformat()
                        )
                    
                    # Update job progress (main thread) - show completed count and active servers
                    completed_count = refreshed_count + failed_count
                    remaining = total_servers - completed_count
                    
                    # Get snapshot of currently active servers for progress display
                    with active_servers_lock:
                        current_active = list(active_servers.values())
                    active_ips = [s['ip'] for s in current_active]
                    in_syncing = len(active_ips)
                    
                    # Build human-readable current step
                    if in_syncing > 0:
                        if in_syncing <= 3:
                            current_step = f'Syncing: {", ".join(active_ips)}'
                        else:
                            current_step = f'Syncing: {", ".join(active_ips[:2])} +{in_syncing - 2} more'
                    else:
                        current_step = f'Synced {completed_count}/{total_servers} server(s)'
                    
                    self.update_job_status(
                        job['id'],
                        'running',
                        details={
                            **base_details,
                            'current_stage': 'sync',
                            'current_step': current_step,
                            'current_server_ip': active_ips[0] if active_ips else None,
                            'active_server_ips': active_ips,
                            'in_syncing': in_syncing,
                            'servers_refreshed': refreshed_count,
                            'servers_failed': failed_count,
                            'servers_total': total_servers,
                            'console_log': console_log,
                        }
                    )
            
            # After all syncs complete, queue backup jobs for servers that need it
            backups_queued = 0
            if backup_queue:
                log_console(f'Queuing {len(backup_queue)} config backup job(s)', 'INFO')
                for result in backup_queue:
                    try:
                        self._create_automatic_scp_backup_job(result['server_id'], job['id'])
                        backups_queued += 1
                    except Exception as backup_err:
                        self.log(f"  Failed to queue backup for {result['ip']}: {backup_err}", "WARN")
                
                if backups_queued > 0:
                    log_console(f'✓ Queued {backups_queued} backup job(s) - will run separately', 'SUCCESS')
            
            # Complete the job
            summary = f"Synced {refreshed_count} server(s)"
            if failed_count > 0:
                summary += f", {failed_count} failed"
            if backups_queued > 0:
                summary += f", {backups_queued} backup(s) queued"
            
            log_console(f'Discovery complete: {summary}', 'SUCCESS')
            
            job_details = {
                **base_details,  # Preserve discovery phase details
                'summary': summary,
                'synced': refreshed_count,
                'failed': failed_count,
                'backups_queued': backups_queued,  # SCP backups queued as separate jobs
                'servers_refreshed': refreshed_count,
                'servers_total': total_servers,
                'current_stage': 'complete',
                'console_log': console_log,
            }
            
            # Note: Do not set completed status here when called from discovery
            # Discovery handler will handle final completion
            # Only update details to preserve progress
            self.update_job_status(
                job['id'],
                'running',  # Keep running, discovery handler completes
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
    
    def discover_single_ip(self, ip: str, credential_sets: List[Dict], job_id: str, stage_callback=None) -> Dict:
        """
        3-Stage optimized IP discovery:
        Stage 1: Quick TCP port check (443)
        Stage 2: Unauthenticated iDRAC detection (/redfish/v1)
        Stage 3: Full authentication only on confirmed iDRACs
        
        Args:
            ip: IP address to discover
            credential_sets: List of credential sets to try
            job_id: Job ID for logging
            stage_callback: Optional callback(ip, stage) for real-time progress
        
        Priority:
          1. Credential sets matching IP ranges (highest priority)
          2. Global credential sets selected in the discovery job
        """
        
        # Stage 1: Quick port check - skip IPs with closed port 443
        if stage_callback:
            stage_callback(ip, 'port_check')
        
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
        if stage_callback:
            stage_callback(ip, 'detecting')
        
        if not self._detect_idrac(ip, timeout=2.0):
            return {
                'success': False,
                'ip': ip,
                'idrac_detected': False,
                'auth_failed': False,
                'port_open': True
            }
        
        # Stage 3: Full authentication on confirmed iDRACs
        if stage_callback:
            stage_callback(ip, 'authenticating')
        
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
