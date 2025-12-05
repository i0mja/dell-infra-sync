"""Boot and BIOS configuration handlers"""

from typing import Dict
from datetime import datetime, timezone
import requests
from .base import BaseHandler
from job_executor.utils import utc_now_iso


class BootHandler(BaseHandler):
    """Handles boot configuration and BIOS configuration operations"""
    
    def execute_boot_configuration(self, job: Dict):
        """Execute boot configuration changes on servers"""
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            from job_executor.utils import _safe_json_parse
            
            self.update_job_status(job['id'], 'running', started_at=utc_now_iso())
            
            target_scope = job.get('target_scope', {})
            details = job.get('details', {})
            action = details.get('action', 'fetch_config')
            
            self.log(f"Executing boot configuration action: {action}")
            
            # Get target servers
            server_ids = target_scope.get('server_ids', [])
            if not server_ids:
                self.log("Boot configuration requires specific server selection", "ERROR")
                raise ValueError("Boot configuration requires specific server selection")
            
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
            results = []
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
                        "current_step": f"Processing {server['ip_address']} ({index+1}/{total_servers})"
                    }
                )
                ip = server['ip_address']
                self.log(f"Processing boot configuration for {ip}...")
                
                # Get credentials
                username, password = self.executor.get_server_credentials(server['id'])
                if not username or not password:
                    self.log(f"  ✗ No credentials for {ip}", "WARN")
                    failed_count += 1
                    results.append({'server': ip, 'success': False, 'error': 'No credentials'})
                    continue
                
                try:
                    # Fetch current boot configuration
                    current_config = self.executor.fetch_boot_configuration(ip, username, password, server['id'], job['id'])
                    self.log(f"  Current boot mode: {current_config['boot_mode']}")
                    self.log(f"  Boot override: {current_config['boot_source_override_enabled']} -> {current_config['boot_source_override_target']}")
                    
                    # Execute action
                    if action == 'fetch_config':
                        self.executor.update_server_boot_config(server['id'], current_config)
                        self.log(f"  ✓ Boot configuration fetched and updated")
                        success_count += 1
                        results.append({'server': ip, 'success': True, 'config': current_config})
                    
                    elif action == 'set_one_time_boot':
                        target = details.get('boot_target', 'None')
                        mode = details.get('boot_mode', current_config['boot_mode'])
                        uefi_target = details.get('uefi_target', None)
                        
                        self.executor.set_boot_override(ip, username, password, server['id'], job['id'], 
                                              target, mode, 'Once', uefi_target)
                        
                        updated_config = self.executor.fetch_boot_configuration(ip, username, password, server['id'], job['id'])
                        self.executor.update_server_boot_config(server['id'], updated_config)
                        
                        self.log(f"  ✓ One-time boot set to {target}")
                        success_count += 1
                        results.append({'server': ip, 'success': True, 'action': 'one_time_boot', 'target': target})
                    
                    elif action == 'disable_override':
                        self.executor.set_boot_override(ip, username, password, server['id'], job['id'], 
                                              'None', current_config['boot_mode'], 'Disabled', None)
                        
                        updated_config = self.executor.fetch_boot_configuration(ip, username, password, server['id'], job['id'])
                        self.executor.update_server_boot_config(server['id'], updated_config)
                        
                        self.log(f"  ✓ Boot override disabled")
                        success_count += 1
                        results.append({'server': ip, 'success': True, 'action': 'disable_override'})
                    
                    elif action == 'set_boot_order':
                        # Change persistent boot order
                        boot_order = details.get('boot_order', [])
                        
                        if not boot_order:
                            raise ValueError("boot_order is required for set_boot_order action")
                        
                        self.log(f"  Setting boot order: {boot_order}")
                        self.executor.set_persistent_boot_order(ip, username, password, server['id'], job['id'], boot_order)
                        
                        # Fetch updated config to confirm
                        updated_config = self.executor.fetch_boot_configuration(ip, username, password, server['id'], job['id'])
                        self.executor.update_server_boot_config(server['id'], updated_config)
                        
                        self.log(f"  ✓ Boot order updated successfully")
                        success_count += 1
                        results.append({
                            'server': ip, 
                            'success': True, 
                            'action': 'set_boot_order', 
                            'boot_order': boot_order,
                            'verified_order': updated_config.get('boot_order')
                        })
                    
                    else:
                        raise ValueError(f"Unknown boot configuration action: {action}")
                    
                except Exception as e:
                    self.log(f"  ✗ Error: {e}", "ERROR")
                    failed_count += 1
                    results.append({'server': ip, 'success': False, 'error': str(e)})
            
            # Update job status
            self.update_job_status(
                job['id'], 
                'completed' if failed_count == 0 else 'failed',
                completed_at=utc_now_iso(),
                details={
                    'action': action,
                    'success_count': success_count,
                    'failed_count': failed_count,
                    'results': results
                }
            )
            
            self.log(f"Boot configuration job completed: {success_count} succeeded, {failed_count} failed")
            
        except Exception as e:
            self.log(f"Boot configuration job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'], 
                'failed',
                completed_at=utc_now_iso(),
                details={'error': str(e)}
            )
    
    def execute_bios_config_read(self, job: Dict):
        """Execute BIOS configuration read job - capture current and pending BIOS attributes"""
        try:
            from job_executor.config import SUPABASE_URL, SERVICE_ROLE_KEY
            
            self.log(f"Starting BIOS config read job: {job['id']}")
            
            # Update job status
            self.update_job_status(job['id'], 'running', started_at=utc_now_iso())
            
            # Get server and credentials
            details = job.get('details', {})
            server_id = details.get('server_id')
            snapshot_type = details.get('snapshot_type', 'current')
            notes = details.get('notes', '')
            
            if not server_id:
                raise Exception("Missing server_id in job details")
            
            # Get server info
            server = self.get_server_by_id(server_id)
            if not server:
                raise Exception(f"Server {server_id} not found")
            
            ip = server['ip_address']
            username, password = self.executor.get_credentials_for_server(server)
            
            self.log(f"  Reading BIOS configuration from {ip}...")
            
            # Get Dell operations instance
            dell_ops = self.executor._get_dell_operations()
            
            # Get current BIOS attributes using Dell adapter
            current_data = dell_ops.get_bios_attributes(
                ip=ip,
                username=username,
                password=password,
                job_id=job['id'],
                server_id=server_id,
                user_id=job['created_by']
            )
            
            current_attributes = current_data['attributes']
            bios_version = current_data.get('bios_version', 'Unknown')
            
            self.log(f"  [OK] Retrieved {len(current_attributes)} current BIOS attributes")
            
            # Get pending BIOS attributes using Dell adapter
            pending_attributes = None
            try:
                pending_data = dell_ops.get_pending_bios_attributes(
                    ip=ip,
                    username=username,
                    password=password,
                    job_id=job['id'],
                    server_id=server_id,
                    user_id=job['created_by']
                )
                pending_attributes = pending_data['attributes']
                
                if pending_attributes:
                    self.log(f"  [OK] Retrieved {len(pending_attributes)} pending BIOS attributes")
                else:
                    self.log(f"  No pending BIOS changes")
            except Exception as e:
                self.log(f"  Could not retrieve pending attributes: {e}", "WARN")
            
            # Save to database via REST API
            config_data = {
                'server_id': server_id,
                'job_id': job['id'],
                'attributes': current_attributes,
                'pending_attributes': pending_attributes,
                'bios_version': bios_version,
                'snapshot_type': snapshot_type,
                'created_by': job['created_by'],
                'notes': notes,
                'captured_at': utc_now_iso()
            }
            
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            db_response = requests.post(
                f"{SUPABASE_URL}/rest/v1/bios_configurations",
                headers=headers,
                json=config_data,
                timeout=30
            )
            
            if db_response.status_code not in [200, 201]:
                raise Exception(f"Failed to save BIOS configuration: {db_response.text}")
            
            self.log(f"  [OK] BIOS configuration saved to database")
            
            # Update job status
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=utc_now_iso(),
                details={
                    'attribute_count': len(current_attributes),
                    'pending_count': len(pending_attributes) if pending_attributes else 0,
                    'bios_version': bios_version,
                    'snapshot_type': snapshot_type
                }
            )
            self.log(f"BIOS config read job completed successfully")
            
        except Exception as e:
            self.log(f"BIOS config read job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=utc_now_iso(),
                details={'error': str(e)}
            )
    
    def execute_bios_config_write(self, job: Dict):
        """Execute BIOS configuration write job - apply BIOS attribute changes"""
        try:
            self.log(f"Starting BIOS config write job: {job['id']}")
            
            # Update job status
            self.update_job_status(job['id'], 'running', started_at=utc_now_iso())
            
            # Get server and credentials
            details = job.get('details', {})
            server_id = details.get('server_id')
            attributes = details.get('attributes', {})
            reboot_type = details.get('reboot_type', 'none')
            create_snapshot = details.get('create_snapshot', False)
            snapshot_notes = details.get('snapshot_notes', '')
            
            if not server_id:
                raise Exception("Missing server_id in job details")
            
            if not attributes:
                raise Exception("No attributes to apply")
            
            # Get server info
            server = self.get_server_by_id(server_id)
            if not server:
                raise Exception(f"Server {server_id} not found")
            
            ip = server['ip_address']
            username, password = self.executor.get_credentials_for_server(server)
            
            self.log(f"  Applying {len(attributes)} BIOS changes to {ip}...")
            
            # Optional: Create pre-change snapshot
            if create_snapshot:
                self.log(f"  Creating pre-change snapshot...")
                snapshot_job = {
                    'id': f"snapshot-{job['id']}",
                    'job_type': 'bios_config_read',
                    'created_by': job['created_by'],
                    'details': {
                        'server_id': server_id,
                        'snapshot_type': 'current',
                        'notes': snapshot_notes or 'Pre-change snapshot'
                    }
                }
                self.execute_bios_config_read(snapshot_job)
            
            # Get Dell operations instance
            dell_ops = self.executor._get_dell_operations()
            
            # Apply BIOS settings using Dell adapter
            result = dell_ops.set_bios_attributes(
                ip=ip,
                username=username,
                password=password,
                attributes=attributes,
                job_id=job['id'],
                server_id=server_id,
                user_id=job['created_by']
            )
            
            self.log(f"  [OK] BIOS settings applied successfully")
            self.log(f"  Note: Changes will take effect after system reboot")
            
            # Handle reboot if requested
            reboot_action = None
            verification_result = None
            
            if reboot_type != 'none':
                self.log(f"  Initiating {reboot_type} reboot...")
                
                try:
                    # Use Dell operations for power control
                    if reboot_type == 'graceful':
                        dell_ops.graceful_reboot(
                            ip=ip,
                            username=username,
                            password=password,
                            job_id=job['id'],
                            server_id=server_id,
                            user_id=job['created_by']
                        )
                    else:  # forced
                        # Force reboot by calling power_on with ForceRestart
                        dell_ops.adapter.make_request(
                            method='POST',
                            ip=ip,
                            endpoint='/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset',
                            username=username,
                            password=password,
                            payload={'ResetType': 'ForceRestart'},
                            operation_name='Force Reboot',
                            job_id=job['id'],
                            server_id=server_id,
                            user_id=job['created_by']
                        )
                    
                    self.log(f"  [OK] Reboot initiated successfully")
                    reboot_action = 'GracefulRestart' if reboot_type == 'graceful' else 'ForceRestart'
                    
                    # Wait for system to reboot and verify BIOS settings were applied
                    verification_result = self.executor._verify_bios_settings_after_reboot(
                        ip, username, password, attributes, server_id, job['id']
                    )
                except Exception as reboot_error:
                    self.log(f"  [!] Reboot failed but BIOS settings were applied: {reboot_error}", "WARNING")
                    verification_result = None
            
            # Update job status
            job_details = {
                'settings_applied': len(attributes),
                'reboot_required': True,
                'reboot_action': reboot_action,
                'snapshot_created': create_snapshot
            }
            
            if verification_result:
                job_details['verification'] = verification_result
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details=job_details
            )
            self.log(f"BIOS config write job completed successfully")
            
        except Exception as e:
            self.log(f"BIOS config write job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
