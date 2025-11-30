"""Power control handler"""

from typing import Dict
from datetime import datetime
import requests
from .base import BaseHandler


class PowerHandler(BaseHandler):
    """Handles server power control operations"""
    
    def execute_power_action(self, job: Dict):
        """Execute power action on servers"""
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            from job_executor.utils import _safe_json_parse
            
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            target_scope = job.get('target_scope', {})
            action = job.get('details', {}).get('action', 'On')
            
            self.log(f"Executing power action: {action}")
            
            # Get target servers
            if target_scope.get('type') == 'specific':
                server_ids = target_scope.get('server_ids', [])
            else:
                self.log("Power action requires specific server selection", "ERROR")
                raise ValueError("Power action requires specific server selection")
            
            # Fetch servers from DB
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            servers_url = f"{DSM_URL}/rest/v1/servers?id=in.({','.join(server_ids)})"
            servers_response = requests.get(servers_url, headers=headers, verify=VERIFY_SSL)
            servers = _safe_json_parse(servers_response) if servers_response.status_code == 200 else []
            
            success_count = 0
            failed_count = 0
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
                        "action": action,
                        "current_step": f"Executing {action} on {server['ip_address']} ({index+1}/{total_servers})"
                    }
                )
                ip = server['ip_address']
                self.log(f"Executing {action} on {ip}...")
                
                # Get credentials
                username, password = self.executor.get_server_credentials(server['id'])
                if not username or not password:
                    self.log(f"  ✗ No credentials for {ip}", "WARN")
                    failed_count += 1
                    continue
                
                try:
                    # Get current power state using throttler
                    system_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1"
                    
                    response, response_time_ms = self.executor.throttler.request_with_safety(
                        'GET',
                        system_url,
                        ip,
                        self.log,
                        auth=(username, password),
                        timeout=(2, 10)
                    )
                    
                    self.executor.log_idrac_command(
                        server_id=server['id'],
                        job_id=job['id'],
                        command_type='GET',
                        endpoint='/redfish/v1/Systems/System.Embedded.1',
                        full_url=system_url,
                        status_code=response.status_code,
                        response_time_ms=response_time_ms,
                        success=response.status_code == 200,
                        operation_type='idrac_api'
                    )
                    
                    if response.status_code in [401, 403]:
                        self.executor.throttler.record_failure(ip, response.status_code, self.log)
                        if self.executor.throttler.is_circuit_open(ip):
                            raise Exception(f"Circuit breaker OPEN for {ip} - Possible credential lockout")
                    elif response.status_code == 200:
                        self.executor.throttler.record_success(ip)
                        data = _safe_json_parse(response)
                        current_state = data.get('PowerState', 'Unknown')
                        self.log(f"  Current power state: {current_state}")
                        
                        # Execute power action using throttler
                        action_url = f"https://{ip}/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset"
                        action_payload = {"ResetType": action}
                        
                        action_response, response_time_ms = self.executor.throttler.request_with_safety(
                            'POST',
                            action_url,
                            ip,
                            self.log,
                            auth=(username, password),
                            json=action_payload,
                            timeout=(2, 30)
                        )
                        
                        self.executor.log_idrac_command(
                            server_id=server['id'],
                            job_id=job['id'],
                            command_type='POST',
                            endpoint='/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset',
                            full_url=action_url,
                            request_body=action_payload,
                            status_code=action_response.status_code,
                            response_time_ms=response_time_ms,
                            success=action_response.status_code in [200, 202, 204],
                            operation_type='idrac_api'
                        )
                        
                        if action_response.status_code in [200, 202, 204]:
                            self.log(f"  ✓ Power action {action} successful")
                            
                            # Update server power state in DB
                            expected_state = 'On' if action in ['On', 'ForceRestart'] else 'Off'
                            update_url = f"{DSM_URL}/rest/v1/servers?id=eq.{server['id']}"
                            requests.patch(update_url, headers=headers, json={'power_state': expected_state}, verify=VERIFY_SSL)
                            
                            success_count += 1
                        else:
                            self.log(f"  ✗ Power action failed: HTTP {action_response.status_code}", "ERROR")
                            failed_count += 1
                    else:
                        self.log(f"  ✗ Failed to get power state: HTTP {response.status_code}", "ERROR")
                        failed_count += 1
                        
                except Exception as e:
                    self.log(f"  ✗ Error: {e}", "ERROR")
                    failed_count += 1
            
            # Complete job
            result = {
                "action": action,
                "success_count": success_count,
                "failed_count": failed_count,
                "total": len(servers)
            }
            
            self.update_job_status(
                job['id'],
                'completed' if failed_count == 0 else 'failed',
                completed_at=datetime.now().isoformat(),
                details=result
            )
            
            self.log(f"Power action complete: {success_count} succeeded, {failed_count} failed")
            
        except Exception as e:
            self.log(f"Power action job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'], 'failed',
                completed_at=datetime.now().isoformat(),
                details={"error": str(e)}
            )
