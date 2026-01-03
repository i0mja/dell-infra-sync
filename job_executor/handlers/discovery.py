"""Discovery and testing handlers"""

from typing import Dict, List
from datetime import datetime, timezone
import concurrent.futures
import ipaddress
import time
import requests
from .base import BaseHandler
from job_executor.utils import utc_now_iso


class DiscoveryHandler(BaseHandler):
    """Handles server discovery, credential testing, health checks, and event log fetching"""
    
    def execute_discovery_scan(self, job: Dict):
        """Execute IP discovery scan with multi-credential support OR refresh existing servers"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, IDRAC_DEFAULT_USER, IDRAC_DEFAULT_PASSWORD, VERIFY_SSL
        from job_executor.utils import _safe_json_parse
        
        self.log(f"Starting discovery scan job {job['id']}")
        
        self.update_job_status(
            job['id'],
            'running',
            started_at=utc_now_iso()
        )
        
        try:
            target_scope = job['target_scope']
            
            # Check if this is a per-server refresh (when adding individual servers)
            if 'server_ids' in target_scope and target_scope['server_ids']:
                self.executor.refresh_existing_servers(job, target_scope['server_ids'])
                return
            
            # Otherwise, proceed with IP range discovery
            ip_range = target_scope.get('ip_range', '')
            ip_list = target_scope.get('ip_list', [])  # Handle IP list from UI
            credential_set_ids = job.get('credential_set_ids', [])
            
            # Fetch credential sets from database
            credential_sets = self.executor.get_credential_sets(credential_set_ids)
            
            # Fallback to environment defaults if no sets configured
            if not credential_sets:
                credential_sets = [{
                    'id': None,
                    'name': 'Environment Default',
                    'username': IDRAC_DEFAULT_USER,
                    'password_encrypted': IDRAC_DEFAULT_PASSWORD,
                    'priority': 999
                }]
            
            self.log(f"Using {len(credential_sets)} credential set(s) for discovery")
            
            # Parse IPs to scan
            ips_to_scan = []
            
            # Handle IP list first (multiple individual IPs from UI)
            if ip_list and len(ip_list) > 0:
                ips_to_scan = ip_list
                self.log(f"Scanning {len(ips_to_scan)} IPs from provided list...")
            
            # Handle IP range
            elif ip_range:
                if '/' in ip_range:  # CIDR notation
                    network = ipaddress.ip_network(ip_range, strict=False)
                    ips_to_scan = [str(ip) for ip in network.hosts()]
                    self.log(f"Scanning CIDR range {ip_range}: {len(ips_to_scan)} IPs")
                elif '-' in ip_range:  # Range notation
                    start, end = ip_range.split('-')
                    start_ip = ipaddress.ip_address(start.strip())
                    end_ip = ipaddress.ip_address(end.strip())
                    current = start_ip
                    while current <= end_ip:
                        ips_to_scan.append(str(current))
                        current += 1
                    self.log(f"Scanning IP range {ip_range}: {len(ips_to_scan)} IPs")
                else:
                    # Treat as single IP address
                    try:
                        ipaddress.ip_address(ip_range.strip())  # Validate it's a valid IP
                        ips_to_scan = [ip_range.strip()]
                        self.log(f"Scanning single IP: {ip_range}")
                    except ValueError:
                        raise ValueError(f"Invalid IP format: {ip_range}")
            
            if not ips_to_scan:
                raise ValueError("No IPs to scan - provide ip_range or ip_list")
            
            self.log(f"Scanning {len(ips_to_scan)} IPs with 3-stage optimization...")
            self.log(f"  Stage 1: TCP port check (443)")
            self.log(f"  Stage 2: iDRAC detection (/redfish/v1)")
            self.log(f"  Stage 3: Full authentication")
            
            # Get activity settings for discovery thread limit
            settings = self.executor.fetch_activity_settings()
            max_threads = settings.get('discovery_max_threads', 5)
            self.log(f"Using {max_threads} concurrent threads for discovery")
            
            discovered = []
            auth_failures = []
            stage1_filtered = 0  # Port closed
            stage2_filtered = 0  # Not an iDRAC
            stage1_passed = 0    # Port open
            stage2_passed = 0    # iDRAC detected
            server_results = []  # Per-server results for UI
            ips_processed = 0
            total_ips = len(ips_to_scan)
            
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_threads) as executor:
                futures = {}
                
                # Submit jobs with pacing to avoid thundering herd
                for i, ip in enumerate(ips_to_scan):
                    # Add small random delay between starting each scan (50-200ms)
                    if i > 0 and len(ips_to_scan) > 10:
                        time.sleep(0.05 + (0.15 * (i % 10) / 10.0))
                    
                    future = executor.submit(
                        self.executor.discover_single_ip,
                        ip,
                        credential_sets,
                        job['id']
                    )
                    futures[future] = ip
                
                timeout_count = 0
                total_requests = len(ips_to_scan)
                
                for future in concurrent.futures.as_completed(futures):
                    ip = futures[future]
                    ips_processed += 1
                    
                    try:
                        result = future.result(timeout=30)  # 30s timeout per IP
                        
                        # Track per-server result for UI
                        server_result = {'ip': ip, 'status': 'filtered'}
                        
                        if result['success']:
                            self.log(f"✓ Found iDRAC at {ip}: {result['model']} (using {result['credential_set_name']})")
                            discovered.append(result)
                            stage1_passed += 1
                            stage2_passed += 1
                            server_result = {
                                'ip': ip,
                                'status': 'synced',
                                'model': result.get('model'),
                                'service_tag': result.get('service_tag'),
                                'credential_set': result.get('credential_set_name'),
                            }
                        elif result.get('idrac_detected') and result.get('auth_failed'):
                            # Only add to auth_failures if we CONFIRMED an iDRAC exists (got 401/403)
                            auth_failures.append({
                                'ip': ip,
                                'reason': 'iDRAC detected but authentication failed'
                            })
                            stage1_passed += 1
                            stage2_passed += 1
                            server_result = {'ip': ip, 'status': 'auth_failed'}
                        elif not result.get('idrac_detected'):
                            # Track filtering stages
                            if not result.get('port_open', True):
                                stage1_filtered += 1
                                server_result = {'ip': ip, 'status': 'filtered', 'filter_reason': 'port_closed'}
                            else:
                                stage1_passed += 1
                                stage2_filtered += 1
                                server_result = {'ip': ip, 'status': 'filtered', 'filter_reason': 'not_idrac'}
                        
                        server_results.append(server_result)
                        
                        # Update progress every 5 IPs or on significant events
                        if ips_processed % 5 == 0 or result['success'] or result.get('auth_failed'):
                            self.update_job_status(
                                job['id'],
                                'running',
                                details={
                                    "current_ip": ip,
                                    "current_stage": "authenticating",
                                    "ips_processed": ips_processed,
                                    "ips_total": total_ips,
                                    "stage1_passed": stage1_passed,
                                    "stage1_filtered": stage1_filtered,
                                    "stage2_passed": stage2_passed,
                                    "stage2_filtered": stage2_filtered,
                                    "discovered_count": len(discovered),
                                    "auth_failures": len(auth_failures),
                                    "server_results": server_results[-20:],  # Last 20 for UI
                                }
                            )
                        
                    except concurrent.futures.TimeoutError:
                        timeout_count += 1
                        server_results.append({'ip': ip, 'status': 'filtered', 'filter_reason': 'timeout'})
                        # If >30% of requests timeout, warn about overload
                        if timeout_count / total_requests > 0.3:
                            self.log("⚠️  Multiple timeouts detected - iDRACs may be overloaded. Consider reducing discovery_max_threads in settings.", "WARN")
                    except Exception as e:
                        server_results.append({'ip': ip, 'status': 'filtered', 'filter_reason': str(e)})
            
            self.log(f"Discovery complete:")
            self.log(f"  ✓ {len(discovered)} servers authenticated")
            self.log(f"  ⚠ {len(auth_failures)} iDRACs require credentials")
            self.log(f"  ⊗ {stage1_filtered} IPs filtered (port closed)")
            self.log(f"  ⊗ {stage2_filtered} IPs filtered (not iDRAC)")
            total_filtered = stage1_filtered + stage2_filtered
            if total_filtered > 0:
                self.log(f"  Optimization: Skipped full auth on {total_filtered} IPs ({total_filtered/len(ips_to_scan)*100:.1f}%)")
            
            # Insert discovered servers into database with credential info
            for server in discovered:
                self.executor.insert_discovered_server(server, job['id'])
            
            # Auto-trigger full refresh for newly discovered servers
            if discovered:
                self.log(f"Auto-triggering full refresh for {len(discovered)} discovered servers...")
                try:
                    # Get server IDs of newly discovered servers
                    discovered_ips = [s['ip'] for s in discovered]
                    servers_url = f"{DSM_URL}/rest/v1/servers"
                    params = {
                        "ip_address": f"in.({','.join(discovered_ips)})",
                        "select": "id"
                    }
                    response = requests.get(servers_url, headers=self.executor.headers, params=params, verify=VERIFY_SSL)
                    
                    if response.status_code == 200:
                        server_records = response.json()
                        server_ids = [s['id'] for s in server_records]
                        
                        if server_ids:
                            # Call refresh_existing_servers to get full server info
                            self.executor.refresh_existing_servers(job, server_ids)
                            self.log(f"✓ Auto-refresh completed for {len(server_ids)} servers")
                    else:
                        self.log(f"Failed to fetch discovered server IDs: {response.status_code}", "WARN")
                except Exception as e:
                    self.log(f"Auto-refresh failed: {e}", "WARN")
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=utc_now_iso(),
                details={
                    "discovered_count": len(discovered),
                    "auth_failures": len(auth_failures),
                    "scanned_ips": len(ips_to_scan),
                    "auth_failure_ips": [f['ip'] for f in auth_failures],
                    "auto_refresh_triggered": len(discovered) > 0,
                    "stage1_passed": stage1_passed,
                    "stage1_filtered": stage1_filtered,
                    "stage2_passed": stage2_passed,
                    "stage2_filtered": stage2_filtered,
                    "stage3_passed": len(discovered),
                    "stage3_failed": len(auth_failures),
                    "optimization_enabled": True,
                    "server_results": server_results,
                }
            )
            
        except Exception as e:
            self.log(f"Discovery scan failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=utc_now_iso(),
                details={"error": str(e)}
            )
    
    def execute_test_credentials(self, job: Dict):
        """Test credentials against a single iDRAC - lightweight connection test"""
        from job_executor.utils import _safe_json_parse
        
        self.log(f"Testing credentials for job {job['id']}")
        
        try:
            ip_address = job['target_scope'].get('ip_address')
            credential_set_ids = job.get('credential_set_ids', [])
            
            # Get credentials - decrypt if needed
            if credential_set_ids and credential_set_ids[0]:
                creds = self.executor.get_credential_sets([credential_set_ids[0]])[0]
                username = creds['username']
                encrypted_password = creds.get('password_encrypted')
                if encrypted_password:
                    password = self.executor.decrypt_password(encrypted_password)
                else:
                    password = creds.get('password')  # Fallback for env defaults
            else:
                # Manual credentials passed in job details (already decrypted)
                username = job['details'].get('username')
                password = job['details'].get('password')
            
            if not username or not password:
                raise Exception("No credentials provided")
            
            # Test connection with simple GET to /redfish/v1/
            url = f"https://{ip_address}/redfish/v1/"
            self.log(f"  Testing connection to {url}")
            
            start_time = time.time()
            try:
                response = requests.get(
                    url,
                    auth=(username, password),
                    verify=False,
                    timeout=10
                )
                response_time_ms = int((time.time() - start_time) * 1000)
                
                # Log the test request
                self.executor.log_idrac_command(
                    server_id=None,
                    job_id=job['id'],
                    task_id=None,
                    command_type='GET',
                    endpoint='/redfish/v1/',
                    full_url=url,
                    request_headers={'Authorization': f'Basic {username}:***'},
                    request_body=None,
                    status_code=response.status_code,
                    response_time_ms=response_time_ms,
                    response_body=_safe_json_parse(response) if response.content else None,
                    success=response.status_code == 200,
                    error_message=None if response.status_code == 200 else f"HTTP {response.status_code}",
                    operation_type='idrac_api'
                )
                
                if response.status_code == 200:
                    data = _safe_json_parse(response)
                    result = {
                        "success": True,
                        "message": "Connection successful",
                        "idrac_version": data.get("RedfishVersion"),
                        "product": data.get("Product"),
                        "vendor": data.get("Vendor")
                    }
                    self.log(f"  ✓ Connection successful - {data.get('Product', 'Unknown')}")
                elif response.status_code == 401:
                    result = {
                        "success": False,
                        "message": "Authentication failed - invalid credentials"
                    }
                    self.log(f"  ✗ Authentication failed", "ERROR")
                else:
                    result = {
                        "success": False,
                        "message": f"Connection failed: HTTP {response.status_code}"
                    }
                    self.log(f"  ✗ Connection failed: HTTP {response.status_code}", "ERROR")
            except Exception as e:
                response_time_ms = int((time.time() - start_time) * 1000)
                self.executor.log_idrac_command(
                    server_id=None,
                    job_id=job['id'],
                    task_id=None,
                    command_type='GET',
                    endpoint='/redfish/v1/',
                    full_url=url,
                    request_headers={'Authorization': f'Basic {username}:***'},
                    request_body=None,
                    status_code=None,
                    response_time_ms=response_time_ms,
                    response_body=None,
                    success=False,
                    error_message=str(e),
                    operation_type='idrac_api'
                )
                raise
            
            # Update job with result
            self.update_job_status(
                job['id'],
                'completed' if result['success'] else 'failed',
                completed_at=utc_now_iso(),
                details=result
            )
            
        except requests.exceptions.Timeout:
            self.log(f"  ✗ Connection timeout", "ERROR")
            self.update_job_status(
                job['id'], 'failed',
                completed_at=utc_now_iso(),
                details={"success": False, "message": "Connection timeout - iDRAC not reachable"}
            )
        except Exception as e:
            self.log(f"  ✗ Test failed: {e}", "ERROR")
            self.update_job_status(
                job['id'], 'failed',
                completed_at=utc_now_iso(),
                details={"success": False, "message": f"Error: {str(e)}"}
            )
    
    def execute_health_check(self, job: Dict):
        """Execute health check on servers"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        
        try:
            self.update_job_status(job['id'], 'running', started_at=utc_now_iso())
            
            target_scope = job.get('target_scope', {})
            
            self.log("Executing health check")
            
            # Get target servers
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            if target_scope.get('type') == 'specific':
                server_ids = target_scope.get('server_ids', [])
                servers_url = f"{DSM_URL}/rest/v1/servers?id=in.({','.join(server_ids)})"
            else:
                servers_url = f"{DSM_URL}/rest/v1/servers"
            
            servers_response = requests.get(servers_url, headers=headers, verify=VERIFY_SSL)
            servers = self.executor.safe_json_parse(servers_response) or []
            
            success_count = 0
            failed_count = 0
            failed_servers = []
            total_servers = len(servers)
            
            for index, server in enumerate(servers):
                # Update progress
                self.update_job_status(
                    job['id'],
                    'running',
                    details={
                        "current_server_index": index,
                        "total_servers": total_servers,
                        "success_count": success_count,
                        "failed_count": failed_count,
                        "total": total_servers,
                        "current_step": f"Checking {server['ip_address']} ({index+1}/{total_servers})"
                    }
                )
                ip = server['ip_address']
                self.log(f"Checking health for {ip}...")
                
                # Create task for this server
                task_id = self.create_task(job['id'], server_id=server['id'])
                if task_id:
                    self.update_task_status(task_id, 'running', log="Starting health check...")
                
                # Get credentials
                username, password = self.executor.get_server_credentials(server['id'])
                if not username or not password:
                    error_msg = f"No credentials configured for {ip}"
                    self.log(f"  ✗ {error_msg}", "WARN")
                    failed_count += 1
                    failed_servers.append({
                        'ip_address': ip,
                        'hostname': server.get('hostname'),
                        'server_id': server['id'],
                        'error': error_msg
                    })
                    if task_id:
                        self.update_task_status(
                            task_id, 'failed',
                            log=error_msg,
                            completed_at=utc_now_iso()
                        )
                    continue
                
                try:
                    # Delegate to executor's health check implementation
                    health_data = self.executor._perform_health_check(server, username, password, job['id'], task_id)
                    
                    if health_data:
                        success_count += 1
                        if task_id:
                            self.update_task_status(
                                task_id, 'completed',
                                log=f"✓ Health check completed for {ip}",
                                progress=100,
                                completed_at=utc_now_iso()
                            )
                    else:
                        failed_count += 1
                        if task_id:
                            self.update_task_status(
                                task_id, 'failed',
                                log=f"✗ Health check failed for {ip}",
                                completed_at=utc_now_iso()
                            )
                        
                except Exception as e:
                    self.log(f"  ✗ Error: {e}", "ERROR")
                    failed_count += 1
                    failed_servers.append({
                        'ip_address': ip,
                        'hostname': server.get('hostname'),
                        'server_id': server['id'],
                        'error': str(e)
                    })
                    if task_id:
                        self.update_task_status(
                            task_id, 'failed',
                            log=f"✗ Error: {str(e)}",
                            completed_at=utc_now_iso()
                        )
            
            # Complete job
            result = {
                "success_count": success_count,
                "failed_count": failed_count,
                "total": total_servers,
                "failed_servers": failed_servers
            }
            
            self.update_job_status(
                job['id'],
                'completed' if failed_count == 0 else 'failed',
                completed_at=utc_now_iso(),
                details=result
            )
            
            self.log(f"Health check complete: {success_count} succeeded, {failed_count} failed")
            
        except Exception as e:
            self.log(f"Health check job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'], 'failed',
                completed_at=utc_now_iso(),
                details={"error": str(e)}
            )
    
    def execute_fetch_event_logs(self, job: Dict):
        """Execute event log fetching from servers"""
        # Delegate to executor's existing implementation
        self.log(f"Starting fetch_event_logs job: {job['id']}")
        try:
            # Call executor's implementation
            self.executor._execute_fetch_event_logs_impl(job)
        except Exception as e:
            self.log(f"Fetch event logs failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=utc_now_iso(),
                details={'error': str(e)}
            )
