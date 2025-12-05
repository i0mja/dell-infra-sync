"""iDRAC Network configuration handlers"""

from typing import Dict
from datetime import datetime, timezone
import requests
from .base import BaseHandler


class NetworkHandler(BaseHandler):
    """Handles iDRAC network configuration read/write operations"""
    
    def execute_idrac_network_read(self, job: Dict):
        """Read iDRAC network configuration"""
        try:
            from job_executor.config import SUPABASE_URL, SERVICE_ROLE_KEY
            
            self.log(f"Starting iDRAC network read job: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            details = job.get('details', {})
            server_id = details.get('server_id')
            notes = details.get('notes', '')
            
            if not server_id:
                raise Exception("Missing server_id in job details")
            
            # Get server info
            server = self.get_server_by_id(server_id)
            if not server:
                raise Exception(f"Server {server_id} not found")
            
            ip = server['ip_address']
            username, password = self.executor.get_credentials_for_server(server)
            
            self.log(f"  Reading iDRAC network configuration from {ip}...")
            
            # Get Dell operations instance
            dell_ops = self.executor._get_dell_operations()
            
            # Get network settings using Dell adapter
            network_data = dell_ops.get_idrac_network_settings(
                ip=ip,
                username=username,
                password=password,
                job_id=job['id'],
                server_id=server_id,
                user_id=job.get('created_by')
            )
            
            self.log(f"  [OK] Retrieved iDRAC network configuration")
            self.log(f"  IPv4: {network_data['ipv4'].get('address')} (DHCP: {network_data['ipv4'].get('dhcp_enabled')})")
            self.log(f"  DNS1: {network_data['ipv4'].get('dns1') or 'Not configured'}")
            self.log(f"  DNS2: {network_data['ipv4'].get('dns2') or 'Not configured'}")
            self.log(f"  NIC Selection: {network_data['nic'].get('selection')}")
            self.log(f"  NTP Enabled: {network_data['ntp'].get('enabled')}")
            
            # Save to database
            config_data = {
                'server_id': server_id,
                'job_id': job['id'],
                'ipv4_enabled': network_data['ipv4'].get('enabled'),
                'dhcp_enabled': network_data['ipv4'].get('dhcp_enabled'),
                'ip_address': network_data['ipv4'].get('address'),
                'gateway': network_data['ipv4'].get('gateway'),
                'netmask': network_data['ipv4'].get('netmask'),
                'dns1': network_data['ipv4'].get('dns1'),
                'dns2': network_data['ipv4'].get('dns2'),
                'dns_from_dhcp': network_data['ipv4'].get('dns_from_dhcp'),
                'nic_selection': network_data['nic'].get('selection'),
                'nic_speed': network_data['nic'].get('speed'),
                'nic_duplex': network_data['nic'].get('duplex'),
                'nic_mtu': network_data['nic'].get('mtu'),
                'vlan_enabled': network_data['nic'].get('vlan_enabled'),
                'vlan_id': network_data['nic'].get('vlan_id'),
                'vlan_priority': network_data['nic'].get('vlan_priority'),
                'ntp_enabled': network_data['ntp'].get('enabled'),
                'ntp_server1': network_data['ntp'].get('server1'),
                'ntp_server2': network_data['ntp'].get('server2'),
                'ntp_server3': network_data['ntp'].get('server3'),
                'timezone': network_data['ntp'].get('timezone'),
                'raw_attributes': network_data.get('attributes', {}),
                'created_by': job.get('created_by'),
                'notes': notes,
                'captured_at': datetime.now().isoformat()
            }
            
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            db_response = requests.post(
                f"{SUPABASE_URL}/rest/v1/idrac_network_configurations",
                headers=headers,
                json=config_data,
                timeout=30
            )
            
            if db_response.status_code not in [200, 201]:
                self.log(f"  Warning: Failed to save to database: {db_response.text}", "WARN")
            else:
                self.log(f"  [OK] Network configuration saved to database")
            
            # Update job status
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details={
                    'ipv4': network_data['ipv4'],
                    'nic': network_data['nic'],
                    'ntp': network_data['ntp'],
                    'dns_configured': bool(network_data['ipv4'].get('dns1'))
                }
            )
            self.log(f"iDRAC network read job completed successfully")
            
        except Exception as e:
            self.log(f"iDRAC network read job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
    
    def execute_idrac_network_write(self, job: Dict):
        """Apply iDRAC network configuration changes"""
        try:
            self.log(f"Starting iDRAC network write job: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            details = job.get('details', {})
            server_id = details.get('server_id')
            changes = details.get('changes', {})
            
            if not server_id:
                raise Exception("Missing server_id in job details")
            
            if not changes:
                raise Exception("No changes specified")
            
            # Get server info
            server = self.get_server_by_id(server_id)
            if not server:
                raise Exception(f"Server {server_id} not found")
            
            ip = server['ip_address']
            username, password = self.executor.get_credentials_for_server(server)
            
            self.log(f"  Applying iDRAC network changes to {ip}...")
            
            # Check if IP address is being changed (this will disconnect!)
            if 'IPv4.1.Address' in changes:
                new_ip = changes['IPv4.1.Address']
                self.log(f"  ⚠️  WARNING: Changing IP from {ip} to {new_ip}")
                self.log(f"  ⚠️  Current session will be disconnected after this change!")
            
            # Get Dell operations instance
            dell_ops = self.executor._get_dell_operations()
            
            # Apply network settings
            result = dell_ops.set_idrac_network_settings(
                ip=ip,
                username=username,
                password=password,
                attributes=changes,
                job_id=job['id'],
                server_id=server_id,
                user_id=job.get('created_by')
            )
            
            self.log(f"  [OK] Network settings applied successfully")
            
            # If IP address changed, update the server record
            if 'IPv4.1.Address' in changes:
                new_ip = changes['IPv4.1.Address']
                self.log(f"  Updating server IP address in database to {new_ip}...")
                
                from job_executor.config import SUPABASE_URL, SERVICE_ROLE_KEY
                headers = {
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json'
                }
                
                update_response = requests.patch(
                    f"{SUPABASE_URL}/rest/v1/servers?id=eq.{server_id}",
                    headers=headers,
                    json={'ip_address': new_ip},
                    timeout=30
                )
                
                if update_response.status_code in [200, 204]:
                    self.log(f"  [OK] Server IP updated in database")
                else:
                    self.log(f"  Warning: Failed to update server IP: {update_response.text}", "WARN")
            
            # Update job status
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details={
                    'applied_changes': changes,
                    'ip_changed': 'IPv4.1.Address' in changes
                }
            )
            self.log(f"iDRAC network write job completed successfully")
            
        except Exception as e:
            self.log(f"iDRAC network write job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
    
    def check_dns_configured(self, server_id: str) -> Dict:
        """
        Check if DNS is configured on an iDRAC.
        Used for pre-flight checks before online catalog operations.
        """
        try:
            server = self.get_server_by_id(server_id)
            if not server:
                return {'configured': False, 'error': 'Server not found'}
            
            ip = server['ip_address']
            username, password = self.executor.get_credentials_for_server(server)
            
            dell_ops = self.executor._get_dell_operations()
            network_data = dell_ops.get_idrac_network_settings(
                ip=ip,
                username=username,
                password=password,
                server_id=server_id
            )
            
            dns1 = network_data['ipv4'].get('dns1')
            dns_from_dhcp = network_data['ipv4'].get('dns_from_dhcp')
            
            if dns1 or dns_from_dhcp:
                return {
                    'configured': True,
                    'dns1': dns1,
                    'dns_from_dhcp': dns_from_dhcp
                }
            else:
                return {
                    'configured': False,
                    'warning': 'No DNS servers configured - online catalog updates will fail',
                    'recommendation': 'Configure DNS servers or use Local Repository firmware source'
                }
        except Exception as e:
            return {'configured': False, 'error': str(e)}
