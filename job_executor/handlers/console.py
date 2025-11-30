"""Console launch handler"""

from typing import Dict
from datetime import datetime
from .base import BaseHandler


class ConsoleHandler(BaseHandler):
    """Handles iDRAC console launch operations"""
    
    def execute_console_launch(self, job: Dict):
        """Get authenticated KVM console URL using Dell's official Redfish endpoint"""
        try:
            self.log(f"Starting console_launch job: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            details = job.get('details', {})
            target_scope = job.get('target_scope', {})
            
            # Get server_id from multiple possible sources
            server_id = details.get('server_id')
            if not server_id:
                # Try target_scope.server_ids (matches how other job types work)
                server_ids = target_scope.get('server_ids', [])
                if server_ids:
                    server_id = server_ids[0]
            
            if not server_id:
                raise Exception("No server_id provided in job details or target_scope")
            
            # Get server and credentials
            server = self.get_server_by_id(server_id)
            if not server:
                raise Exception(f"Server {server_id} not found")
            
            username, password = self.executor.get_server_credentials(server_id)
            if not username or not password:
                raise Exception("No credentials available for server")
            
            ip_address = server['ip_address']
            
            # Get KVM launch info using Dell Redfish operations
            self.log(f"Getting KVM launch info for {ip_address}")
            dell_ops = self.executor._get_dell_operations()
            kvm_info = dell_ops.get_kvm_launch_info(
                ip=ip_address,
                username=username,
                password=password,
                server_id=server_id,
                job_id=job['id']
            )
            
            console_url = kvm_info.get('console_url')
            
            if not console_url:
                raise Exception("No console URL returned from KVM launch endpoint")
            
            # Log appropriate message based on iDRAC version
            if kvm_info.get('requires_login'):
                self.log(f"[OK] Console URL generated for {ip_address} (iDRAC8 - manual login required)")
            else:
                self.log(f"[OK] Console URL generated for {ip_address} (iDRAC9+ - SSO enabled)")
            
            # Complete job with console URL and all metadata
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details={
                    'console_url': console_url,
                    'server_id': server_id,
                    'ip_address': ip_address,
                    'session_type': kvm_info.get('session_type', 'HTML5'),
                    'requires_login': kvm_info.get('requires_login', False),
                    'message': kvm_info.get('message')
                }
            )
            
        except Exception as e:
            self.log(f"Console launch failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
