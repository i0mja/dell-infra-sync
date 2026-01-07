"""
ZFS Target Deployment Handler

Handles the deploy_zfs_target job type with the following phases:
1. Clone Template - Clone VM from vCenter template
2. Power On - Start VM
3. Wait Tools - Wait for VMware Tools to be running  
4. Wait IP - Wait for IP address (DHCP or static)
5. SSH Connection - Connect to VM via SSH
6. ZFS Create - Create ZFS pool
7. NFS Setup - Configure NFS share
8. Register Target - Add to replication_targets table
9. Register Datastore - Mount NFS as vCenter datastore
"""

import io
import ssl
import time
from typing import Dict, Optional, Any, Tuple
from datetime import datetime, timezone

import requests

try:
    import paramiko
    PARAMIKO_AVAILABLE = True
except ImportError:
    PARAMIKO_AVAILABLE = False
    paramiko = None

from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim

from job_executor.handlers.base import BaseHandler
from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL, ZFS_NFS_SHARE_OPTIONS
from job_executor.utils import utc_now_iso


class ZfsTargetHandler(BaseHandler):
    """
    Handler for deploy_zfs_target job type.
    
    Deploys a ZFS target VM from template with full automation:
    - VM cloning with additional disk
    - IP detection (DHCP or static)
    - SSH-based ZFS/NFS configuration
    - vCenter datastore registration
    """
    
    PHASES = [
        ('clone', 'Cloning Template', 0, 20),
        ('power_on', 'Powering On VM', 20, 25),
        ('wait_tools', 'Waiting for VM Tools', 25, 35),
        ('wait_ip', 'Waiting for IP Address', 35, 40),
        ('ssh_connect', 'Establishing SSH Connection', 40, 50),
        ('zfs_create', 'Creating ZFS Pool', 50, 60),
        ('nfs_setup', 'Configuring NFS Share', 60, 75),
        ('register_target', 'Registering Replication Target', 75, 85),
        ('register_datastore', 'Registering vCenter Datastore', 85, 100),
    ]
    
    # Retry configuration
    RETRY_CONFIG = {
        'ssh_connect': {'max_retries': 5, 'delay': 15},
        'wait_tools': {'timeout': 300, 'poll_interval': 10},
        'wait_ip': {'timeout': 300, 'poll_interval': 10},
    }
    
    def __init__(self, executor):
        super().__init__(executor)
        self.vcenter_conn = None
        self.ssh_client = None
    
    def execute_validate_zfs_template(self, job: Dict):
        """
        Validate ZFS template prerequisites without deploying.
        
        Performs validation checks:
        1. vCenter Connection
        2. Template Exists
        3. Template Power State
        4. SSH Key Valid
        5. SSH Connection Test (if template is on)
        6. SSH Key Deployment (if auth fails and root password provided)
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        target_scope = job.get('target_scope', {}) or {}
        
        results = []
        overall_success = True
        
        job_details = {
            'validation_mode': True,
            'results': [],
            'console_log': []
        }
        
        self._log_console(job_id, 'INFO', 'Starting ZFS template prerequisite validation', job_details)
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details=job_details)
        
        try:
            # Step 1: Fetch template
            template_id = target_scope.get('template_id') or details.get('template_id')
            if not template_id:
                results.append({
                    'step': 'template_fetch',
                    'status': 'failed',
                    'label': 'Template Configuration',
                    'error': 'No template_id provided'
                })
                overall_success = False
                return self._complete_validation(job_id, results, overall_success, job_details)
            
            template = self._fetch_template(template_id)
            if not template:
                results.append({
                    'step': 'template_fetch',
                    'status': 'failed',
                    'label': 'Template Configuration',
                    'error': f'Template not found: {template_id}'
                })
                overall_success = False
                return self._complete_validation(job_id, results, overall_success, job_details)
            
            results.append({
                'step': 'template_fetch',
                'status': 'success',
                'label': f'Template: {template.get("name", "Unknown")}'
            })
            self._log_console(job_id, 'INFO', f'Template loaded: {template.get("name")}', job_details)
            
            # Step 2: Test vCenter Connection
            vcenter_id = template.get('vcenter_id')
            if not vcenter_id:
                results.append({
                    'step': 'vcenter',
                    'status': 'failed',
                    'label': 'vCenter Connection',
                    'error': 'No vCenter configured for template'
                })
                overall_success = False
                return self._complete_validation(job_id, results, overall_success, job_details)
            
            try:
                vc_settings = self._get_vcenter_settings(vcenter_id)
                if not vc_settings:
                    raise Exception('vCenter settings not found')
                
                self.vcenter_conn = self._connect_vcenter(
                    vc_settings['host'],
                    vc_settings['username'],
                    vc_settings['password'],
                    vc_settings.get('port', 443),
                    vc_settings.get('verify_ssl', False)
                )
                
                if not self.vcenter_conn:
                    raise Exception('Connection returned None')
                
                results.append({
                    'step': 'vcenter',
                    'status': 'success',
                    'label': f'vCenter: {vc_settings["host"]}'
                })
                self._log_console(job_id, 'INFO', f'vCenter connected: {vc_settings["host"]}', job_details)
                
            except Exception as e:
                results.append({
                    'step': 'vcenter',
                    'status': 'failed',
                    'label': 'vCenter Connection',
                    'error': str(e)
                })
                overall_success = False
                return self._complete_validation(job_id, results, overall_success, job_details)
            
            # Step 3: Verify template VM exists
            template_moref = template.get('template_moref')
            template_vm = None
            
            if not template_moref:
                results.append({
                    'step': 'template_vm',
                    'status': 'failed',
                    'label': 'Template VM',
                    'error': 'No template_moref configured'
                })
                overall_success = False
            else:
                try:
                    template_vm = self._find_vm_by_moref(self.vcenter_conn, template_moref)
                    if template_vm:
                        results.append({
                            'step': 'template_vm',
                            'status': 'success',
                            'label': f'Template VM: {template_vm.name}'
                        })
                        self._log_console(job_id, 'INFO', f'Template VM found: {template_vm.name}', job_details)
                    else:
                        results.append({
                            'step': 'template_vm',
                            'status': 'failed',
                            'label': 'Template VM',
                            'error': f'VM not found: {template_moref}'
                        })
                        overall_success = False
                except Exception as e:
                    results.append({
                        'step': 'template_vm',
                        'status': 'failed',
                        'label': 'Template VM',
                        'error': str(e)
                    })
                    overall_success = False
            
            # Step 4: Check if it's a template or VM
            is_vmware_template = False
            if template_vm:
                # Check if this is a VMware template (not a regular VM)
                try:
                    is_vmware_template = hasattr(template_vm.config, 'template') and template_vm.config.template
                except:
                    is_vmware_template = False
                
                if is_vmware_template:
                    results.append({
                        'step': 'template_type',
                        'status': 'success',
                        'label': 'VMware Template (ready for cloning)'
                    })
                    self._log_console(job_id, 'INFO', 'Object is a VMware template - ready for cloning', job_details)
                else:
                    # It's a VM, not a template - check power state
                    power_state = str(template_vm.runtime.powerState)
                    if power_state == 'poweredOff':
                        results.append({
                            'step': 'template_type',
                            'status': 'warning',
                            'label': 'Object is a VM (not template)',
                            'warning': 'Consider converting to template for better protection. VM is powered off (OK for cloning).'
                        })
                        self._log_console(job_id, 'WARN', 'Object is a VM, not template - but powered off', job_details)
                    else:
                        results.append({
                            'step': 'template_type',
                            'status': 'warning',
                            'label': 'VM is Powered On',
                            'warning': 'Object is a VM (not template) and is powered on. Power off before cloning.'
                        })
                        self._log_console(job_id, 'WARN', 'VM is powered on - should be off for cloning', job_details)
            
            # Step 5: Validate SSH Key
            ssh_key_id = template.get('ssh_key_id')
            ssh_key_valid = False
            private_key = None
            
            if not ssh_key_id:
                results.append({
                    'step': 'ssh_key',
                    'status': 'failed',
                    'label': 'SSH Key',
                    'error': 'No SSH key configured for template'
                })
                overall_success = False
            else:
                try:
                    key_data = self._get_ssh_key(ssh_key_id)
                    if not key_data:
                        raise Exception('SSH key not found in database')
                    
                    private_key = self._decrypt_ssh_key(key_data.get('private_key_encrypted'))
                    if not private_key:
                        raise Exception('Failed to decrypt SSH key')
                    
                    # Validate key format by attempting to parse it
                    key_file = io.StringIO(private_key)
                    pkey = None
                    for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                        try:
                            key_file.seek(0)
                            pkey = key_class.from_private_key(key_file)
                            break
                        except:
                            continue
                    
                    if not pkey:
                        raise Exception('Unsupported key format')
                    
                    key_name = key_data.get('name', 'Unknown')
                    results.append({
                        'step': 'ssh_key',
                        'status': 'success',
                        'label': f'SSH Key: {key_name}'
                    })
                    ssh_key_valid = True
                    self._log_console(job_id, 'INFO', f'SSH key validated: {key_name}', job_details)
                    
                except Exception as e:
                    results.append({
                        'step': 'ssh_key',
                        'status': 'failed',
                        'label': 'SSH Key',
                        'error': str(e)
                    })
                    overall_success = False
            
            # Step 6: SSH Connection Test
            # IMPORTANT: VMware templates CANNOT be powered on or SSH'd into!
            # SSH testing is only possible if this is a regular VM that's running
            test_ssh = details.get('test_ssh', False)
            template_ip = None
            ssh_auth_failed = False
            
            if template_vm and test_ssh:
                if is_vmware_template:
                    # Templates cannot run - SSH test is impossible
                    results.append({
                        'step': 'ssh_test',
                        'status': 'skipped',
                        'label': 'SSH Connection Test',
                        'info': 'VMware templates cannot be powered on. SSH will be validated on first deployment. Ensure the public key is pre-installed in the template.'
                    })
                    self._log_console(job_id, 'INFO', 'SSH test skipped - VMware templates cannot be powered on', job_details)
                else:
                    # It's a VM - check if it's running
                    power_state = str(template_vm.runtime.powerState)
                    
                    if power_state != 'poweredOn':
                        results.append({
                            'step': 'ssh_test',
                            'status': 'skipped',
                            'label': 'SSH Connection Test',
                            'info': 'VM is powered off. Power on the VM to test SSH connection.'
                        })
                        self._log_console(job_id, 'INFO', 'SSH test skipped (VM powered off)', job_details)
                    else:
                        # Get VM IP
                        template_ip = template_vm.guest.ipAddress
                    
                    if not template_ip or template_ip.startswith('169.254') or template_ip.startswith('127.'):
                        results.append({
                            'step': 'ssh_test',
                            'status': 'skipped',
                            'label': 'SSH Connection Test',
                            'info': f'No valid IP address detected: {template_ip or "none"}'
                        })
                    elif not ssh_key_valid or not private_key:
                        results.append({
                            'step': 'ssh_test',
                            'status': 'skipped',
                            'label': 'SSH Connection Test',
                            'info': 'SSH key not valid - cannot test connection'
                        })
                    else:
                        # Attempt SSH connection
                        ssh_username = template.get('default_ssh_username', 'root')
                        try:
                            self._log_console(job_id, 'INFO', f'Testing SSH to {template_ip} as {ssh_username}...', job_details)
                            
                            test_client = paramiko.SSHClient()
                            test_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                            
                            # Parse private key
                            key_file = io.StringIO(private_key)
                            pkey = None
                            for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                                try:
                                    key_file.seek(0)
                                    pkey = key_class.from_private_key(key_file)
                                    break
                                except:
                                    continue
                            
                            test_client.connect(
                                hostname=template_ip,
                                username=ssh_username,
                                pkey=pkey,
                                timeout=15,
                                allow_agent=False,
                                look_for_keys=False
                            )
                            
                            # Test command
                            stdin, stdout, stderr = test_client.exec_command('hostname')
                            hostname = stdout.read().decode().strip()
                            test_client.close()
                            
                            results.append({
                                'step': 'ssh_test',
                                'status': 'success',
                                'label': f'SSH Connected: {hostname}'
                            })
                            self._log_console(job_id, 'INFO', f'SSH test successful: {hostname}', job_details)
                            
                        except paramiko.AuthenticationException as e:
                            ssh_auth_failed = True
                            results.append({
                                'step': 'ssh_test',
                                'status': 'failed',
                                'label': 'SSH Authentication Failed',
                                'error': f'Key not authorized for {ssh_username}@{template_ip}. Add public key to ~/.ssh/authorized_keys'
                            })
                            overall_success = False
                            self._log_console(job_id, 'ERROR', f'SSH auth failed - key not in authorized_keys', job_details)
                            
                        except paramiko.SSHException as e:
                            results.append({
                                'step': 'ssh_test',
                                'status': 'failed',
                                'label': 'SSH Protocol Error',
                                'error': str(e)
                            })
                            overall_success = False
                            
                        except Exception as e:
                            error_type = type(e).__name__
                            results.append({
                                'step': 'ssh_test',
                                'status': 'failed',
                                'label': 'SSH Connection Failed',
                                'error': f'{error_type}: {str(e)}'
                            })
                            overall_success = False
            
            # Step 7: SSH Key Deployment (if auth failed and root password provided)
            deploy_ssh_key = details.get('deploy_ssh_key', False)
            root_password = details.get('root_password')
            
            if ssh_auth_failed and deploy_ssh_key and root_password and template_ip:
                try:
                    ssh_username = template.get('default_ssh_username', 'root')
                    public_key = self._get_ssh_public_key(ssh_key_id)
                    
                    if not public_key:
                        raise Exception('Could not retrieve public key')
                    
                    self._log_console(job_id, 'INFO', f'Deploying SSH key to {template_ip} using root...', job_details)
                    
                    # Connect as root with password
                    deploy_client = paramiko.SSHClient()
                    deploy_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                    deploy_client.connect(
                        hostname=template_ip,
                        username='root',
                        password=root_password,
                        timeout=15,
                        allow_agent=False,
                        look_for_keys=False
                    )
                    
                    # Deploy key
                    home_dir = f'/home/{ssh_username}' if ssh_username != 'root' else '/root'
                    commands = [
                        f'mkdir -p {home_dir}/.ssh',
                        f'echo "{public_key}" >> {home_dir}/.ssh/authorized_keys',
                        f'chmod 700 {home_dir}/.ssh',
                        f'chmod 600 {home_dir}/.ssh/authorized_keys',
                        f'chown -R {ssh_username}:{ssh_username} {home_dir}/.ssh' if ssh_username != 'root' else 'true'
                    ]
                    
                    for cmd in commands:
                        stdin, stdout, stderr = deploy_client.exec_command(cmd)
                        exit_code = stdout.channel.recv_exit_status()
                        if exit_code != 0:
                            err = stderr.read().decode().strip()
                            raise Exception(f'Command failed: {cmd} - {err}')
                    
                    deploy_client.close()
                    
                    results.append({
                        'step': 'ssh_deploy',
                        'status': 'success',
                        'label': f'SSH Key Deployed to {ssh_username}'
                    })
                    # SSH test that failed earlier is now fixed
                    for r in results:
                        if r['step'] == 'ssh_test' and r['status'] == 'failed':
                            r['status'] = 'fixed'
                            r['label'] = 'SSH Key Deployed Successfully'
                            del r['error']
                    overall_success = True
                    self._log_console(job_id, 'INFO', 'SSH key deployed successfully', job_details)
                    
                except paramiko.AuthenticationException:
                    results.append({
                        'step': 'ssh_deploy',
                        'status': 'failed',
                        'label': 'SSH Key Deployment Failed',
                        'error': 'Root password incorrect'
                    })
                    
                except Exception as e:
                    results.append({
                        'step': 'ssh_deploy',
                        'status': 'failed',
                        'label': 'SSH Key Deployment Failed',
                        'error': str(e)
                    })
            
            return self._complete_validation(job_id, results, overall_success, job_details)
            
        except Exception as e:
            self.log(f'Template validation failed: {e}', 'ERROR')
            results.append({
                'step': 'error',
                'status': 'failed',
                'label': 'Validation Error',
                'error': str(e)
            })
            return self._complete_validation(job_id, results, False, job_details)
        finally:
            self._cleanup()
    
    def _complete_validation(self, job_id: str, results: list, success: bool, job_details: dict):
        """Complete the validation job with results."""
        job_details['results'] = results
        job_details['success'] = success
        job_details['current_phase'] = 'complete'
        
        status = 'completed' if success else 'failed'
        self._log_console(job_id, 'INFO', f'Validation complete: {status}', job_details)
        self.update_job_status(job_id, status, completed_at=utc_now_iso(), details=job_details)
        
        return results
    
    def _get_ssh_public_key(self, ssh_key_id: str) -> Optional[str]:
        """Get public key for an SSH key."""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
            }
            
            response = requests.get(
                f'{DSM_URL}/rest/v1/ssh_keys?id=eq.{ssh_key_id}&select=public_key',
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.ok:
                data = response.json()
                if data:
                    return data[0].get('public_key')
            return None
        except Exception as e:
            self.log(f'Failed to get SSH public key: {e}', 'WARN')
            return None

    def execute_prepare_zfs_template(self, job: Dict):
        """
        Template Readiness Wizard handler - Prepares a ZFS template for deployment.
        
        This job handles:
        1. VM state detection (template vs VM, power state)
        2. Convert template to VM if needed
        3. Power on VM
        4. Wait for VMware Tools and IP
        5. SSH key deployment (if auth fails)
        6. APT sources configuration (add contrib for Debian 13)
        7. ZFS/NFS package installation
        8. zfsadmin user creation
        9. Stale config cleanup (machine-id, SSH host keys, NFS exports)
        10. Optionally convert back to template
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        target_scope = job.get('target_scope', {}) or {}
        
        # Options from job details
        root_password = details.get('root_password')
        install_packages = details.get('install_packages', True)
        create_user = details.get('create_user', True)
        reset_machine_id = details.get('reset_machine_id', True)
        reset_ssh_host_keys = details.get('reset_ssh_host_keys', True)
        reset_nfs_config = details.get('reset_nfs_config', True)
        convert_back_to_template = details.get('convert_back_to_template', True)
        
        # Track what we did for cleanup
        we_converted_from_template = False
        we_powered_on = False
        
        step_results = []
        job_details = {
            'progress_percent': 0,
            'console_log': [],
            'step_results': step_results,
            'vm_state': None
        }
        
        self._log_console(job_id, 'INFO', 'Starting Template Readiness Wizard', job_details)
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details=job_details)
        
        try:
            # Step 1: Fetch template
            template_id = target_scope.get('template_id') or details.get('template_id')
            if not template_id:
                raise Exception('No template_id provided')
            
            template = self._fetch_template(template_id)
            if not template:
                raise Exception(f'Template not found: {template_id}')
            
            step_results.append({'step': 'vcenter', 'status': 'running', 'message': 'Connecting...'})
            self.update_job_status(job_id, 'running', details=job_details)
            
            # Step 2: Connect to vCenter
            vcenter_id = template.get('vcenter_id')
            if not vcenter_id:
                step_results[-1] = {'step': 'vcenter', 'status': 'failed', 'message': 'No vCenter configured'}
                raise Exception('No vCenter configured for template')
            
            vc_settings = self._get_vcenter_settings(vcenter_id)
            if not vc_settings:
                step_results[-1] = {'step': 'vcenter', 'status': 'failed', 'message': 'vCenter settings not found'}
                raise Exception('vCenter settings not found')
            
            self.vcenter_conn = self._connect_vcenter(
                vc_settings['host'],
                vc_settings['username'],
                vc_settings['password'],
                vc_settings.get('port', 443),
                vc_settings.get('verify_ssl', False)
            )
            
            if not self.vcenter_conn:
                step_results[-1] = {'step': 'vcenter', 'status': 'failed', 'message': 'Connection failed'}
                raise Exception('Failed to connect to vCenter')
            
            step_results[-1] = {'step': 'vcenter', 'status': 'success', 'message': f'Connected to {vc_settings["host"]}'}
            job_details['progress_percent'] = 5
            self._log_console(job_id, 'INFO', f'Connected to vCenter: {vc_settings["host"]}', job_details)
            self.update_job_status(job_id, 'running', details=job_details)
            
            # Step 3: Find VM and detect state
            step_results.append({'step': 'vm_state', 'status': 'running', 'message': 'Detecting VM state...'})
            self.update_job_status(job_id, 'running', details=job_details)
            
            template_moref = template.get('template_moref')
            if not template_moref:
                step_results[-1] = {'step': 'vm_state', 'status': 'failed', 'message': 'No template_moref'}
                raise Exception('No template_moref configured')
            
            vm = self._find_vm_by_moref(self.vcenter_conn, template_moref)
            if not vm:
                step_results[-1] = {'step': 'vm_state', 'status': 'failed', 'message': 'VM not found'}
                raise Exception(f'VM not found: {template_moref}')
            
            # Detect if template or VM
            is_template = hasattr(vm.config, 'template') and vm.config.template
            power_state = str(vm.runtime.powerState)
            
            if is_template:
                job_details['vm_state'] = 'VMware Template'
                step_results[-1] = {'step': 'vm_state', 'status': 'success', 'message': 'VMware Template detected'}
            elif power_state == 'poweredOn':
                job_details['vm_state'] = 'VM (Powered On)'
                step_results[-1] = {'step': 'vm_state', 'status': 'success', 'message': 'VM is already powered on'}
            else:
                job_details['vm_state'] = 'VM (Powered Off)'
                step_results[-1] = {'step': 'vm_state', 'status': 'success', 'message': 'VM is powered off'}
            
            job_details['progress_percent'] = 10
            self._log_console(job_id, 'INFO', f'VM state: {job_details["vm_state"]}', job_details)
            self.update_job_status(job_id, 'running', details=job_details)
            
            # Step 4: Convert template to VM if needed
            if is_template:
                step_results.append({'step': 'convert_to_vm', 'status': 'running', 'message': 'Converting to VM...'})
                self.update_job_status(job_id, 'running', details=job_details)
                
                try:
                    # Find resource pool for the VM
                    cluster_name = template.get('default_cluster')
                    resource_pool = self._find_resource_pool(self.vcenter_conn, cluster_name)
                    if not resource_pool:
                        raise Exception('No resource pool found')
                    
                    vm.MarkAsVirtualMachine(pool=resource_pool)
                    we_converted_from_template = True
                    step_results[-1] = {'step': 'convert_to_vm', 'status': 'success', 'message': 'Converted to VM'}
                    self._log_console(job_id, 'INFO', 'Converted template to VM', job_details)
                except Exception as e:
                    step_results[-1] = {'step': 'convert_to_vm', 'status': 'failed', 'message': str(e)}
                    raise
            else:
                step_results.append({'step': 'convert_to_vm', 'status': 'skipped', 'message': 'Already a VM'})
            
            job_details['progress_percent'] = 15
            self.update_job_status(job_id, 'running', details=job_details)
            
            # Step 5: Power on VM if needed
            power_state = str(vm.runtime.powerState)
            if power_state != 'poweredOn':
                step_results.append({'step': 'power_on', 'status': 'running', 'message': 'Powering on...'})
                self.update_job_status(job_id, 'running', details=job_details)
                
                try:
                    task = vm.PowerOn()
                    self._wait_for_task(task, timeout=120)
                    we_powered_on = True
                    step_results[-1] = {'step': 'power_on', 'status': 'success', 'message': 'VM powered on'}
                    self._log_console(job_id, 'INFO', 'VM powered on', job_details)
                except Exception as e:
                    step_results[-1] = {'step': 'power_on', 'status': 'failed', 'message': str(e)}
                    raise
            else:
                step_results.append({'step': 'power_on', 'status': 'skipped', 'message': 'Already powered on'})
            
            job_details['progress_percent'] = 20
            self.update_job_status(job_id, 'running', details=job_details)
            
            # Step 6: Wait for VMware Tools
            step_results.append({'step': 'vmware_tools', 'status': 'running', 'message': 'Waiting for VMware Tools...'})
            self.update_job_status(job_id, 'running', details=job_details)
            
            tools_timeout = 180
            tools_start = time.time()
            while time.time() - tools_start < tools_timeout:
                vm_view = self._find_vm_by_moref(self.vcenter_conn, template_moref)
                tools_status = vm_view.guest.toolsRunningStatus if vm_view.guest else None
                if tools_status == 'guestToolsRunning':
                    break
                time.sleep(5)
            else:
                step_results[-1] = {'step': 'vmware_tools', 'status': 'warning', 'message': 'VMware Tools not running - may need manual install'}
                self._log_console(job_id, 'WARN', 'VMware Tools timeout', job_details)
            
            if tools_status == 'guestToolsRunning':
                step_results[-1] = {'step': 'vmware_tools', 'status': 'success', 'message': 'VMware Tools running'}
            
            job_details['progress_percent'] = 25
            self.update_job_status(job_id, 'running', details=job_details)
            
            # Step 7: Wait for IP address
            step_results.append({'step': 'ip_address', 'status': 'running', 'message': 'Waiting for IP...'})
            self.update_job_status(job_id, 'running', details=job_details)
            
            ip_timeout = 120
            ip_start = time.time()
            vm_ip = None
            while time.time() - ip_start < ip_timeout:
                vm_view = self._find_vm_by_moref(self.vcenter_conn, template_moref)
                vm_ip = vm_view.guest.ipAddress if vm_view.guest else None
                if vm_ip and not vm_ip.startswith('169.254') and not vm_ip.startswith('127.'):
                    break
                time.sleep(5)
            else:
                step_results[-1] = {'step': 'ip_address', 'status': 'failed', 'message': 'No IP address detected'}
                raise Exception('Failed to get IP address')
            
            step_results[-1] = {'step': 'ip_address', 'status': 'success', 'message': vm_ip}
            job_details['vm_ip'] = vm_ip
            job_details['progress_percent'] = 30
            self._log_console(job_id, 'INFO', f'IP address: {vm_ip}', job_details)
            self.update_job_status(job_id, 'running', details=job_details)
            
            # Step 8: Test SSH port
            step_results.append({'step': 'ssh_port', 'status': 'running', 'message': 'Testing SSH port...'})
            self.update_job_status(job_id, 'running', details=job_details)
            
            import socket
            ssh_open = False
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(10)
                result = sock.connect_ex((vm_ip, 22))
                ssh_open = (result == 0)
                sock.close()
            except:
                pass
            
            if ssh_open:
                step_results[-1] = {'step': 'ssh_port', 'status': 'success', 'message': 'Port 22 open'}
            else:
                step_results[-1] = {'step': 'ssh_port', 'status': 'failed', 'message': 'Port 22 not reachable'}
                raise Exception('SSH port 22 not reachable')
            
            job_details['progress_percent'] = 35
            self.update_job_status(job_id, 'running', details=job_details)
            
            # Step 9: SSH Authentication
            step_results.append({'step': 'ssh_auth', 'status': 'running', 'message': 'Testing SSH key...'})
            self.update_job_status(job_id, 'running', details=job_details)
            
            ssh_key_id = template.get('ssh_key_id')
            ssh_username = template.get('default_ssh_username', 'root')
            ssh_connected = False
            
            if ssh_key_id:
                try:
                    key_data = self._get_ssh_key(ssh_key_id)
                    if key_data:
                        private_key = self._decrypt_ssh_key(key_data.get('private_key_encrypted'))
                        if private_key:
                            # Try to connect with key
                            key_file = io.StringIO(private_key)
                            pkey = None
                            for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                                try:
                                    key_file.seek(0)
                                    pkey = key_class.from_private_key(key_file)
                                    break
                                except:
                                    continue
                            
                            if pkey:
                                self.ssh_client = paramiko.SSHClient()
                                self.ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                                self.ssh_client.connect(
                                    hostname=vm_ip,
                                    username=ssh_username,
                                    pkey=pkey,
                                    timeout=15,
                                    allow_agent=False,
                                    look_for_keys=False
                                )
                                ssh_connected = True
                                step_results[-1] = {'step': 'ssh_auth', 'status': 'success', 'message': f'Connected as {ssh_username}'}
                                self._log_console(job_id, 'INFO', f'SSH connected as {ssh_username}', job_details)
                except paramiko.AuthenticationException:
                    self._log_console(job_id, 'WARN', 'SSH key not authorized', job_details)
                except Exception as e:
                    self._log_console(job_id, 'WARN', f'SSH key error: {e}', job_details)
            
            # If SSH key failed and we have root password, deploy the key
            if not ssh_connected and root_password:
                step_results[-1] = {'step': 'ssh_auth', 'status': 'fixing', 'message': 'Deploying SSH key...'}
                self.update_job_status(job_id, 'running', details=job_details)
                
                try:
                    # Connect as root with password
                    self.ssh_client = paramiko.SSHClient()
                    self.ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                    self.ssh_client.connect(
                        hostname=vm_ip,
                        username='root',
                        password=root_password,
                        timeout=15,
                        allow_agent=False,
                        look_for_keys=False
                    )
                    
                    # Deploy the SSH key
                    if ssh_key_id:
                        public_key = self._get_ssh_public_key(ssh_key_id)
                        if public_key:
                            home_dir = f'/home/{ssh_username}' if ssh_username != 'root' else '/root'
                            commands = [
                                f'mkdir -p {home_dir}/.ssh',
                                f'grep -qxF "{public_key}" {home_dir}/.ssh/authorized_keys 2>/dev/null || echo "{public_key}" >> {home_dir}/.ssh/authorized_keys',
                                f'chmod 700 {home_dir}/.ssh',
                                f'chmod 600 {home_dir}/.ssh/authorized_keys',
                            ]
                            if ssh_username != 'root':
                                commands.append(f'chown -R {ssh_username}:{ssh_username} {home_dir}/.ssh')
                            
                            for cmd in commands:
                                stdin, stdout, stderr = self.ssh_client.exec_command(cmd)
                                stdout.channel.recv_exit_status()
                            
                            self._log_console(job_id, 'INFO', 'SSH key deployed', job_details)
                    
                    ssh_connected = True
                    step_results[-1] = {'step': 'ssh_auth', 'status': 'fixed', 'message': 'SSH key deployed'}
                    
                except paramiko.AuthenticationException:
                    step_results[-1] = {'step': 'ssh_auth', 'status': 'failed', 'message': 'Root password incorrect'}
                    raise Exception('Root password incorrect')
                except Exception as e:
                    step_results[-1] = {'step': 'ssh_auth', 'status': 'failed', 'message': str(e)}
                    raise
            
            elif not ssh_connected:
                # Need password but don't have it
                step_results[-1] = {'step': 'ssh_auth', 'status': 'failed', 'message': 'SSH key not authorized - provide root password'}
                job_details['needs_root_password'] = True
                self.update_job_status(job_id, 'running', details=job_details)
                raise Exception('SSH key not authorized and no root password provided')
            
            job_details['progress_percent'] = 40
            self.update_job_status(job_id, 'running', details=job_details)
            
            # From here on, we have SSH access
            # Step 10-16: Package installation and configuration (require root password for apt)
            if install_packages and root_password:
                # Step 10: Check/add contrib to APT sources (Debian 13 - supports deb822 format)
                step_results.append({'step': 'apt_sources', 'status': 'running', 'message': 'Checking APT sources...'})
                self.update_job_status(job_id, 'running', details=job_details)
                
                # Check for deb822 format (.sources files) vs traditional format
                check_deb822 = self._ssh_exec('ls /etc/apt/sources.list.d/*.sources 2>/dev/null')
                
                if check_deb822['exit_code'] == 0 and check_deb822['stdout'].strip():
                    # deb822 format - check if contrib is in Components line
                    result = self._ssh_exec('grep -r "Components:.*contrib" /etc/apt/sources.list.d/*.sources 2>/dev/null')
                    if result['exit_code'] != 0 or not result['stdout'].strip():
                        self._log_console(job_id, 'INFO', 'Adding contrib to deb822 sources', job_details)
                        self._ssh_exec(r"sed -i 's/^Components: main$/Components: main contrib/' /etc/apt/sources.list.d/*.sources")
                        step_results[-1] = {'step': 'apt_sources', 'status': 'fixed', 'message': 'Added contrib to deb822 sources'}
                    else:
                        step_results[-1] = {'step': 'apt_sources', 'status': 'success', 'message': 'contrib already enabled (deb822)'}
                else:
                    # Traditional format - check sources.list
                    result = self._ssh_exec('grep -E "^deb.*contrib" /etc/apt/sources.list /etc/apt/sources.list.d/*.list 2>/dev/null | head -1')
                    if result['exit_code'] != 0 or not result['stdout'].strip():
                        self._log_console(job_id, 'INFO', 'Adding contrib to APT sources', job_details)
                        self._ssh_exec(r"sed -i 's/^\(deb.*main\)$/\1 contrib/' /etc/apt/sources.list")
                        step_results[-1] = {'step': 'apt_sources', 'status': 'fixed', 'message': 'Added contrib repository'}
                    else:
                        step_results[-1] = {'step': 'apt_sources', 'status': 'success', 'message': 'contrib already enabled'}
                
                job_details['progress_percent'] = 45
                self.update_job_status(job_id, 'running', details=job_details)
                
                # Step 11: Install kernel headers (required for ZFS DKMS)
                step_results.append({'step': 'kernel_headers', 'status': 'running', 'message': 'Installing kernel headers...'})
                self.update_job_status(job_id, 'running', details=job_details)
                
                result = self._ssh_exec('uname -r')
                kernel_version = result['stdout'].strip() if result['exit_code'] == 0 else None
                if kernel_version:
                    self._log_console(job_id, 'INFO', f'Installing kernel headers for {kernel_version}', job_details)
                    result = self._ssh_exec(f'DEBIAN_FRONTEND=noninteractive apt-get update && apt-get install -y dpkg-dev linux-headers-{kernel_version}')
                    if result['exit_code'] != 0:
                        step_results[-1] = {'step': 'kernel_headers', 'status': 'warning', 'message': 'Headers install warning: ' + result['stderr'][:80]}
                    else:
                        step_results[-1] = {'step': 'kernel_headers', 'status': 'success', 'message': f'Headers installed for {kernel_version}'}
                else:
                    step_results[-1] = {'step': 'kernel_headers', 'status': 'skipped', 'message': 'Could not detect kernel version'}
                
                job_details['progress_percent'] = 50
                self.update_job_status(job_id, 'running', details=job_details)
                
                # Step 12: Install ZFS packages (zfs-dkms + zfsutils-linux)
                step_results.append({'step': 'zfs_packages', 'status': 'running', 'message': 'Installing ZFS packages (DKMS build may take a few minutes)...'})
                self.update_job_status(job_id, 'running', details=job_details)
                
                # Check if already installed
                result = self._ssh_exec('dpkg -l zfsutils-linux 2>/dev/null | grep -q "^ii"')
                if result['exit_code'] != 0:
                    self._log_console(job_id, 'INFO', 'Installing zfs-dkms and zfsutils-linux (this may take several minutes)...', job_details)
                    result = self._ssh_exec('DEBIAN_FRONTEND=noninteractive apt-get install -y zfs-dkms zfsutils-linux')
                    if result['exit_code'] != 0:
                        step_results[-1] = {'step': 'zfs_packages', 'status': 'failed', 'message': 'Install failed: ' + result['stderr'][:100]}
                        self._log_console(job_id, 'ERROR', f'ZFS install failed: {result["stderr"]}', job_details)
                    else:
                        step_results[-1] = {'step': 'zfs_packages', 'status': 'fixed', 'message': 'ZFS packages installed'}
                        self._log_console(job_id, 'INFO', 'ZFS packages installed', job_details)
                else:
                    step_results[-1] = {'step': 'zfs_packages', 'status': 'success', 'message': 'Already installed'}
                
                job_details['progress_percent'] = 55
                self.update_job_status(job_id, 'running', details=job_details)
                
                # Step 12: Install NFS packages
                step_results.append({'step': 'nfs_packages', 'status': 'running', 'message': 'Installing NFS packages...'})
                self.update_job_status(job_id, 'running', details=job_details)
                
                result = self._ssh_exec('dpkg -l nfs-kernel-server 2>/dev/null | grep -q "^ii"')
                if result['exit_code'] != 0:
                    self._log_console(job_id, 'INFO', 'Installing nfs-kernel-server...', job_details)
                    result = self._ssh_exec('DEBIAN_FRONTEND=noninteractive apt-get install -y nfs-kernel-server')
                    if result['exit_code'] != 0:
                        step_results[-1] = {'step': 'nfs_packages', 'status': 'failed', 'message': 'Install failed'}
                    else:
                        step_results[-1] = {'step': 'nfs_packages', 'status': 'fixed', 'message': 'NFS packages installed'}
                else:
                    step_results[-1] = {'step': 'nfs_packages', 'status': 'success', 'message': 'Already installed'}
                
                job_details['progress_percent'] = 60
                self.update_job_status(job_id, 'running', details=job_details)
                
                # Step 13: Load ZFS module
                step_results.append({'step': 'zfs_module', 'status': 'running', 'message': 'Loading ZFS module...'})
                self.update_job_status(job_id, 'running', details=job_details)
                
                result = self._ssh_exec('lsmod | grep -q zfs')
                if result['exit_code'] != 0:
                    self._ssh_exec('modprobe zfs')
                    result = self._ssh_exec('lsmod | grep -q zfs')
                    if result['exit_code'] == 0:
                        step_results[-1] = {'step': 'zfs_module', 'status': 'fixed', 'message': 'ZFS module loaded'}
                    else:
                        step_results[-1] = {'step': 'zfs_module', 'status': 'warning', 'message': 'ZFS module not loaded - may need reboot'}
                else:
                    step_results[-1] = {'step': 'zfs_module', 'status': 'success', 'message': 'ZFS module loaded'}
                
                job_details['progress_percent'] = 65
                self.update_job_status(job_id, 'running', details=job_details)
            else:
                # Skip package installation steps
                for step_id in ['apt_sources', 'zfs_packages', 'nfs_packages', 'zfs_module']:
                    step_results.append({'step': step_id, 'status': 'skipped', 'message': 'Skipped (no root password or disabled)'})
                job_details['progress_percent'] = 65
                self.update_job_status(job_id, 'running', details=job_details)
            
            # Step 14: Create zfsadmin user
            if create_user and root_password:
                step_results.append({'step': 'user_account', 'status': 'running', 'message': 'Creating zfsadmin user...'})
                self.update_job_status(job_id, 'running', details=job_details)
                
                result = self._ssh_exec('id zfsadmin 2>/dev/null')
                if result['exit_code'] != 0:
                    self._log_console(job_id, 'INFO', 'Creating zfsadmin user with sudo...', job_details)
                    self._ssh_exec('useradd -m -s /bin/bash zfsadmin')
                    self._ssh_exec('echo "zfsadmin ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/zfsadmin')
                    self._ssh_exec('chmod 440 /etc/sudoers.d/zfsadmin')
                    
                    # Copy SSH key to zfsadmin if it exists
                    if ssh_key_id:
                        public_key = self._get_ssh_public_key(ssh_key_id)
                        if public_key:
                            self._ssh_exec('mkdir -p /home/zfsadmin/.ssh')
                            self._ssh_exec(f'echo "{public_key}" >> /home/zfsadmin/.ssh/authorized_keys')
                            self._ssh_exec('chmod 700 /home/zfsadmin/.ssh')
                            self._ssh_exec('chmod 600 /home/zfsadmin/.ssh/authorized_keys')
                            self._ssh_exec('chown -R zfsadmin:zfsadmin /home/zfsadmin/.ssh')
                    
                    step_results[-1] = {'step': 'user_account', 'status': 'fixed', 'message': 'User created with sudo'}
                else:
                    step_results[-1] = {'step': 'user_account', 'status': 'success', 'message': 'User already exists'}
            else:
                step_results.append({'step': 'user_account', 'status': 'skipped', 'message': 'Skipped'})
            
            job_details['progress_percent'] = 70
            self.update_job_status(job_id, 'running', details=job_details)
            
            # Step 15: Detect secondary disk
            step_results.append({'step': 'disk_detection', 'status': 'running', 'message': 'Detecting disks...'})
            self.update_job_status(job_id, 'running', details=job_details)
            
            zfs_disk = self._detect_zfs_disk()
            if zfs_disk:
                step_results[-1] = {'step': 'disk_detection', 'status': 'success', 'message': f'Found: {zfs_disk}'}
                self._log_console(job_id, 'INFO', f'Secondary disk detected: {zfs_disk}', job_details)
            else:
                step_results[-1] = {'step': 'disk_detection', 'status': 'warning', 'message': 'No secondary disk found - add before deployment'}
            
            job_details['progress_percent'] = 75
            self.update_job_status(job_id, 'running', details=job_details)
            
            # Step 16: Cleanup stale configuration
            if root_password:
                step_results.append({'step': 'stale_config', 'status': 'running', 'message': 'Cleaning stale config...'})
                self.update_job_status(job_id, 'running', details=job_details)
                
                cleanup_actions = []
                
                if reset_machine_id:
                    self._ssh_exec('rm -f /etc/machine-id && systemd-machine-id-setup')
                    cleanup_actions.append('machine-id')
                    self._log_console(job_id, 'INFO', 'Regenerated machine-id', job_details)
                
                if reset_ssh_host_keys:
                    self._ssh_exec('rm -f /etc/ssh/ssh_host_* && dpkg-reconfigure openssh-server')
                    cleanup_actions.append('SSH host keys')
                    self._log_console(job_id, 'INFO', 'Regenerated SSH host keys', job_details)
                
                if reset_nfs_config:
                    self._ssh_exec('truncate -s 0 /etc/exports && exportfs -ra 2>/dev/null || true')
                    cleanup_actions.append('NFS exports')
                    self._log_console(job_id, 'INFO', 'Reset NFS exports', job_details)
                
                # Check for existing ZFS pools (warning only)
                result = self._ssh_exec('zpool list -H 2>/dev/null')
                if result['exit_code'] == 0 and result['stdout'].strip():
                    pools = result['stdout'].strip().split('\n')
                    self._log_console(job_id, 'WARN', f'Existing ZFS pools detected: {pools}', job_details)
                    cleanup_actions.append(f'ZFS pools warning: {len(pools)} pool(s)')
                
                if cleanup_actions:
                    step_results[-1] = {'step': 'stale_config', 'status': 'fixed', 'message': ', '.join(cleanup_actions)}
                else:
                    step_results[-1] = {'step': 'stale_config', 'status': 'skipped', 'message': 'No cleanup needed'}
            else:
                step_results.append({'step': 'stale_config', 'status': 'skipped', 'message': 'Skipped (no root password)'})
            
            job_details['progress_percent'] = 85
            self.update_job_status(job_id, 'running', details=job_details)
            
            # Step 17: Finalize - power off and optionally convert to template
            step_results.append({'step': 'finalize', 'status': 'running', 'message': 'Finalizing...'})
            self.update_job_status(job_id, 'running', details=job_details)
            
            # Close SSH before power off
            if self.ssh_client:
                self.ssh_client.close()
                self.ssh_client = None
            
            # Power off
            vm = self._find_vm_by_moref(self.vcenter_conn, template_moref)
            if vm and str(vm.runtime.powerState) == 'poweredOn':
                self._log_console(job_id, 'INFO', 'Powering off VM...', job_details)
                task = vm.PowerOff()
                self._wait_for_task(task, timeout=120)
            
            # Convert back to template if requested and we converted it
            if convert_back_to_template and we_converted_from_template:
                self._log_console(job_id, 'INFO', 'Converting back to template...', job_details)
                vm = self._find_vm_by_moref(self.vcenter_conn, template_moref)
                if vm:
                    vm.MarkAsTemplate()
                    step_results[-1] = {'step': 'finalize', 'status': 'success', 'message': 'Converted back to template'}
                    job_details['vm_state'] = 'VMware Template'
            elif we_powered_on:
                step_results[-1] = {'step': 'finalize', 'status': 'success', 'message': 'VM powered off'}
                job_details['vm_state'] = 'VM (Powered Off)'
            else:
                step_results[-1] = {'step': 'finalize', 'status': 'success', 'message': 'Complete'}
            
            job_details['progress_percent'] = 100
            job_details['success'] = True
            self._log_console(job_id, 'INFO', 'Template preparation complete', job_details)
            self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(), details=job_details)
            
        except Exception as e:
            self.log(f'Template preparation failed: {e}', 'ERROR')
            job_details['error'] = str(e)
            self._log_console(job_id, 'ERROR', f'Failed: {str(e)}', job_details)
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details=job_details)
        finally:
            self._cleanup()
    
    def _find_resource_pool(self, si, cluster_name: str = None):
        """Find a resource pool, preferring the specified cluster."""
        content = si.RetrieveContent()
        container = content.viewManager.CreateContainerView(
            content.rootFolder, [vim.ResourcePool], True
        )
        
        pools = list(container.view)
        container.Destroy()
        
        if not pools:
            return None
        
        # If cluster specified, try to find pool in that cluster
        if cluster_name:
            for pool in pools:
                try:
                    if hasattr(pool, 'owner') and hasattr(pool.owner, 'name'):
                        if pool.owner.name == cluster_name:
                            return pool
                except:
                    pass
        
        # Return first available pool
        return pools[0] if pools else None

    def execute_deploy_zfs_target(self, job: Dict):
        """
        Main entry point for deploy_zfs_target job.
        
        Expected job structure:
        - target_scope.template_id: UUID of zfs_target_templates entry
        - details.vm_name: Name for new VM
        - details.hostname: Hostname to configure
        - details.network_name: vCenter network/port group name
        - details.use_dhcp: Whether to use DHCP (true) or static IP
        - details.zfs_pool_name: Name for ZFS pool
        - details.zfs_disk_gb: Size of ZFS disk in GB
        - details.nfs_network: Network CIDR for NFS exports
        
        The handler fetches template data (vcenter_id, template_moref, ssh_key_id, etc.)
        from the zfs_target_templates table using target_scope.template_id
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        target_scope = job.get('target_scope', {}) or {}
        
        # Initialize job tracking
        job_details = {
            'current_phase': 'initializing',
            'progress_percent': 0,
            'console_log': [],
            **details
        }
        
        self._log_console(job_id, 'INFO', 'Starting ZFS Target deployment', job_details)
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details=job_details)
        
        try:
            # Fetch template from database using target_scope.template_id
            template_id = target_scope.get('template_id')
            if not template_id:
                raise Exception("No template_id provided in job target_scope. Please select a template.")
            
            self._log_console(job_id, 'INFO', f'Fetching template configuration: {template_id}', job_details)
            
            template = self._fetch_template(template_id)
            if not template:
                raise Exception(f"Template not found in database: {template_id}. Please verify the template exists.")
            
            # Validate template has required fields
            if not template.get('vcenter_id'):
                raise Exception(f"Template '{template.get('name', template_id)}' is not linked to a vCenter. Please edit the template in Settings → Infrastructure.")
            
            if not template.get('template_moref'):
                raise Exception(f"Template '{template.get('name', template_id)}' has no VM template configured (template_moref missing). Please edit the template configuration.")
            
            # Merge template data into job details
            job_details['template_id'] = template_id
            job_details['template_name'] = template.get('name', 'Unknown Template')
            job_details['vcenter_id'] = template['vcenter_id']
            job_details['template_moref'] = template['template_moref']
            job_details['ssh_key_id'] = template.get('ssh_key_id')
            job_details['ssh_username'] = details.get('ssh_username') or template.get('default_ssh_username', 'root')
            
            # Apply template defaults where job details are missing
            if not job_details.get('zfs_pool_name'):
                job_details['zfs_pool_name'] = template.get('default_zfs_pool', 'datapool')
            if not job_details.get('zfs_disk_gb'):
                job_details['zfs_disk_gb'] = template.get('default_zfs_disk_gb', 500)
            if not job_details.get('nfs_network'):
                job_details['nfs_network'] = template.get('default_nfs_network', '10.0.0.0/8')
            if not job_details.get('cpu_count'):
                job_details['cpu_count'] = template.get('default_cpu', 2)
            if not job_details.get('memory_gb'):
                job_details['memory_gb'] = template.get('default_memory_gb', 4)
            if not job_details.get('cluster_name'):
                job_details['cluster_name'] = template.get('default_cluster')
            
            # Pass use_template_disk setting from template
            if 'use_template_disk' not in job_details:
                job_details['use_template_disk'] = template.get('use_template_disk', False)
            
            self._log_console(job_id, 'INFO', f'Using template: {job_details["template_name"]}', job_details)
            self._log_console(job_id, 'INFO', f'vCenter ID: {job_details["vcenter_id"]}', job_details)
            self._log_console(job_id, 'INFO', f'VM Template MoRef: {job_details["template_moref"]}', job_details)
            
            # Update job with merged details
            self.update_job_status(job_id, 'running', details=job_details)
        
            # Validate paramiko is available
            if not PARAMIKO_AVAILABLE:
                raise Exception("paramiko library not installed - required for SSH operations")
            
            # Phase 1: Clone Template
            self._update_phase(job_id, 'clone', 0, job_details)
            vm_moref = self._clone_template(job_id, job_details)
            job_details['cloned_vm_moref'] = vm_moref
            
            # Phase 2: Power On
            self._update_phase(job_id, 'power_on', 20, job_details)
            self._power_on_vm(job_id, vm_moref, job_details)
            
            # Phase 3: Wait for VM Tools
            self._update_phase(job_id, 'wait_tools', 25, job_details)
            self._wait_for_tools(job_id, vm_moref, job_details)
            
            # Phase 4: Wait for IP
            self._update_phase(job_id, 'wait_ip', 35, job_details)
            detected_ip = self._wait_for_ip(job_id, vm_moref, job_details)
            job_details['detected_ip'] = detected_ip
            
            # Phase 5: SSH Connection
            self._update_phase(job_id, 'ssh_connect', 40, job_details)
            self._establish_ssh(job_id, detected_ip, job_details)
            
            # Phase 6: ZFS Pool Creation
            self._update_phase(job_id, 'zfs_create', 50, job_details)
            self._create_zfs_pool(job_id, job_details)
            
            # Phase 7: NFS Setup
            self._update_phase(job_id, 'nfs_setup', 60, job_details)
            self._configure_nfs(job_id, job_details)
            
            # Phase 8: Register Target
            self._update_phase(job_id, 'register_target', 75, job_details)
            target_id = self._register_replication_target(job_id, job_details)
            job_details['replication_target_id'] = target_id
            
            # Phase 9: Register Datastore (optional)
            if job_details.get('register_datastore', True):
                self._update_phase(job_id, 'register_datastore', 85, job_details)
                datastore_name = self._register_datastore(job_id, job_details)
                job_details['datastore_name'] = datastore_name
            
            # Complete
            job_details['current_phase'] = 'complete'
            job_details['progress_percent'] = 100
            job_details['success'] = True
            
            self._log_console(job_id, 'INFO', '✓ ZFS Target deployment completed successfully', job_details)
            self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(), details=job_details)
            
        except Exception as e:
            self.log(f'ZFS Target deployment failed: {e}', 'ERROR')
            job_details['error'] = str(e)
            job_details['failed_phase'] = job_details.get('current_phase', 'unknown')
            self._log_console(job_id, 'ERROR', f'Deployment failed: {str(e)}', job_details)
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details=job_details)
        finally:
            self._cleanup()
    
    # =========================================================================
    # Phase Implementations
    # =========================================================================
    
    def _find_resource_pool(self, content, cluster_name: str = None):
        """Find resource pool, optionally within a specific cluster."""
        for dc in content.rootFolder.childEntity:
            if not isinstance(dc, vim.Datacenter):
                continue
            for entity in dc.hostFolder.childEntity:
                if isinstance(entity, vim.ClusterComputeResource):
                    if cluster_name is None or entity.name == cluster_name:
                        return entity.resourcePool
                elif isinstance(entity, vim.ComputeResource):
                    return entity.resourcePool
        return None

    def _clone_template(self, job_id: str, details: Dict) -> str:
        """Phase 1: Clone VM from template with ZFS disk and network config."""
        vcenter_id = details['vcenter_id']
        template_moref = details['template_moref']
        vm_name = details['vm_name']
        network_name = details.get('network_name')
        cluster_name = details.get('cluster_name') or details.get('default_cluster')
        
        # Dynamic disk sizing: use calculated_disk_gb if provided, else fallback to template default
        calculated_disk_gb = details.get('calculated_disk_gb')
        template_disk_gb = details.get('zfs_disk_gb', 500)
        
        if calculated_disk_gb:
            zfs_disk_gb = calculated_disk_gb
            protection_group_id = details.get('protection_group_id', 'unknown')
            headroom_percent = details.get('headroom_percent', 50)
            vm_count = details.get('vm_count', 0)
            source_bytes = details.get('source_vm_storage_bytes', 0)
            self._log_console(job_id, 'INFO', 
                f'Dynamic disk sizing: {zfs_disk_gb} GB '
                f'(PG: {protection_group_id[:8] if protection_group_id != "unknown" else "unknown"}..., '
                f'{vm_count} VMs, {source_bytes / (1024**3):.1f} GB source, {headroom_percent}% headroom)', 
                details)
        else:
            zfs_disk_gb = template_disk_gb
            self._log_console(job_id, 'INFO', 
                f'Using template default disk size: {zfs_disk_gb} GB (no protection group specified)', 
                details)
        
        # Store final disk size in details for reference
        details['final_disk_gb'] = zfs_disk_gb
        
        self._log_console(job_id, 'INFO', f'Connecting to vCenter...', details)
        
        # Connect to vCenter
        vc_settings = self._get_vcenter_settings(vcenter_id)
        if not vc_settings:
            raise Exception(f"Failed to get vCenter settings for {vcenter_id}")
        
        self.vcenter_conn = self._connect_vcenter(
            vc_settings['host'],
            vc_settings['username'],
            vc_settings['password'],
            vc_settings.get('port', 443),
            vc_settings.get('verify_ssl', False)
        )
        
        if not self.vcenter_conn:
            raise Exception(f"Failed to connect to vCenter: {vc_settings['host']}")
        
        self._log_console(job_id, 'INFO', f'Connected to vCenter: {vc_settings["host"]}', details)
        
        # Find template
        template = self._find_vm_by_moref(self.vcenter_conn, template_moref)
        if not template:
            raise Exception(f"Template not found: {template_moref}")
        
        self._log_console(job_id, 'INFO', f'Found template: {template.name}', details)
        
        # Find resource pool
        content = self.vcenter_conn.RetrieveContent()
        resource_pool = self._find_resource_pool(content, cluster_name)
        if not resource_pool:
            raise Exception(f"No resource pool found for cluster: {cluster_name or 'any'}")
        
        self._log_console(job_id, 'INFO', f'Using resource pool: {resource_pool.name}', details)
        
        # Build clone spec
        clone_spec = vim.vm.CloneSpec()
        clone_spec.location = vim.vm.RelocateSpec()
        clone_spec.location.pool = resource_pool
        clone_spec.powerOn = False
        clone_spec.template = False
        
        # Skip VMware guest customization - hostname will be set via SSH
        # (VMware customization requires Perl on the template which may not be present)
        # Hostname and network config will be applied via SSH in _establish_ssh phase
        
        # Clone the VM
        self._log_console(job_id, 'INFO', f'Cloning template to: {vm_name}', details)
        folder = template.parent
        task = template.Clone(folder=folder, name=vm_name, spec=clone_spec)
        self._wait_for_task(task, job_id, details)
        
        new_vm = task.info.result
        vm_moref = str(new_vm._moId)
        
        self._log_console(job_id, 'INFO', f'VM cloned successfully: {vm_moref}', details)
        
        # Add ZFS disk (unless template already has one)
        use_template_disk = details.get('use_template_disk', False)
        if use_template_disk:
            self._log_console(job_id, 'INFO', 'Using existing template disk for ZFS pool (skipping disk add)', details)
        else:
            self._log_console(job_id, 'INFO', f'Adding {zfs_disk_gb}GB disk for ZFS pool...', details)
            self._add_disk(new_vm, zfs_disk_gb)
            self._log_console(job_id, 'INFO', f'Disk added successfully', details)
        
        # Configure network adapter
        if network_name:
            self._log_console(job_id, 'INFO', f'Configuring network: {network_name}', details)
            self._configure_network(new_vm, network_name)
        
        return vm_moref
    
    def _power_on_vm(self, job_id: str, vm_moref: str, details: Dict):
        """Phase 2: Power on the cloned VM."""
        vm = self._find_vm_by_moref(self.vcenter_conn, vm_moref)
        if not vm:
            raise Exception(f"VM not found: {vm_moref}")
        
        self._log_console(job_id, 'INFO', f'Powering on VM: {vm.name}', details)
        task = vm.PowerOn()
        self._wait_for_task(task, job_id, details)
        self._log_console(job_id, 'INFO', 'VM powered on', details)
    
    def _wait_for_tools(self, job_id: str, vm_moref: str, details: Dict):
        """Phase 3: Wait for VMware Tools to be running."""
        vm = self._find_vm_by_moref(self.vcenter_conn, vm_moref)
        if not vm:
            raise Exception(f"VM not found: {vm_moref}")
        
        timeout = self.RETRY_CONFIG['wait_tools']['timeout']
        poll_interval = self.RETRY_CONFIG['wait_tools']['poll_interval']
        start_time = time.time()
        
        self._log_console(job_id, 'INFO', 'Waiting for VMware Tools...', details)
        
        while time.time() - start_time < timeout:
            tools_status = vm.guest.toolsRunningStatus
            if tools_status == 'guestToolsRunning':
                self._log_console(job_id, 'INFO', 'VMware Tools running', details)
                return
            
            elapsed = int(time.time() - start_time)
            self._log_console(job_id, 'DEBUG', f'Tools status: {tools_status} ({elapsed}s)', details)
            time.sleep(poll_interval)
            
            # Refresh VM object
            vm = self._find_vm_by_moref(self.vcenter_conn, vm_moref)
        
        raise Exception(f"VMware Tools not running after {timeout}s")
    
    def _wait_for_ip(self, job_id: str, vm_moref: str, details: Dict) -> str:
        """Phase 4: Wait for VM to acquire IP address."""
        use_dhcp = details.get('use_dhcp', True)
        configured_ip = details.get('ip_address')
        
        if not use_dhcp and configured_ip:
            self._log_console(job_id, 'INFO', f'Using static IP: {configured_ip}', details)
            return configured_ip
        
        # DHCP - wait for IP from VMware Tools
        vm = self._find_vm_by_moref(self.vcenter_conn, vm_moref)
        if not vm:
            raise Exception(f"VM not found: {vm_moref}")
        
        timeout = self.RETRY_CONFIG['wait_ip']['timeout']
        poll_interval = self.RETRY_CONFIG['wait_ip']['poll_interval']
        start_time = time.time()
        
        self._log_console(job_id, 'INFO', 'Waiting for DHCP IP assignment...', details)
        
        while time.time() - start_time < timeout:
            ip = vm.guest.ipAddress
            
            # Skip APIPA (169.254.x.x) and empty
            if ip and not ip.startswith('169.254') and not ip.startswith('127.'):
                self._log_console(job_id, 'INFO', f'VM acquired IP via DHCP: {ip}', details)
                return ip
            
            elapsed = int(time.time() - start_time)
            self._log_console(job_id, 'DEBUG', f'Waiting for IP... Current: {ip or "none"} ({elapsed}s)', details)
            time.sleep(poll_interval)
            
            # Refresh VM object
            vm = self._find_vm_by_moref(self.vcenter_conn, vm_moref)
        
        raise Exception(f"VM did not acquire IP via DHCP after {timeout}s. Consider using static IP.")
    
    def _establish_ssh(self, job_id: str, ip: str, details: Dict):
        """Phase 5: Establish SSH connection to the VM."""
        ssh_key_id = details.get('ssh_key_id')
        ssh_username = details.get('ssh_username', 'root')
        
        if not ssh_key_id:
            raise Exception("No SSH key configured for deployment")
        
        # Get SSH key from database
        key_data = self._get_ssh_key(ssh_key_id)
        if not key_data:
            raise Exception(f"SSH key not found: {ssh_key_id}")
        
        private_key = self._decrypt_ssh_key(key_data.get('private_key_encrypted'))
        if not private_key:
            raise Exception("Failed to decrypt SSH private key")
        
        max_retries = self.RETRY_CONFIG['ssh_connect']['max_retries']
        retry_delay = self.RETRY_CONFIG['ssh_connect']['delay']
        
        for attempt in range(max_retries):
            try:
                self.ssh_client = paramiko.SSHClient()
                self.ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                
                # Parse private key - try multiple key types
                pkey = None
                key_file = io.StringIO(private_key)
                for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                    try:
                        key_file.seek(0)
                        pkey = key_class.from_private_key(key_file)
                        self._log_console(job_id, 'DEBUG', f'Loaded SSH key as {key_class.__name__}', details)
                        break
                    except Exception:
                        continue
                
                if not pkey:
                    raise Exception("Failed to parse SSH private key - unsupported key format")
                
                self._log_console(job_id, 'INFO', f'SSH attempt {attempt + 1}/{max_retries} to {ip}', details)
                
                self.ssh_client.connect(
                    hostname=ip,
                    username=ssh_username,
                    pkey=pkey,
                    timeout=30,
                    allow_agent=False,
                    look_for_keys=False
                )
                
                # Verify connection
                stdin, stdout, stderr = self.ssh_client.exec_command('hostname')
                current_hostname = stdout.read().decode().strip()
                self._log_console(job_id, 'INFO', f'SSH connected to: {current_hostname}', details)
                
                # Set hostname via SSH (instead of VMware guest customization)
                target_hostname = details.get('hostname', details.get('vm_name', ''))
                if target_hostname and target_hostname != current_hostname:
                    self._log_console(job_id, 'INFO', f'Setting hostname to: {target_hostname}', details)
                    stdin, stdout, stderr = self.ssh_client.exec_command(f'sudo hostnamectl set-hostname {target_hostname}')
                    exit_code = stdout.channel.recv_exit_status()
                    if exit_code != 0:
                        err = stderr.read().decode().strip()
                        self._log_console(job_id, 'WARN', f'Failed to set hostname: {err}', details)
                    else:
                        self._log_console(job_id, 'INFO', f'Hostname set to: {target_hostname}', details)
                
                return
                
            except Exception as e:
                self._log_console(job_id, 'WARN', f'SSH attempt {attempt + 1} failed: {e}', details)
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                else:
                    raise Exception(f"SSH connection failed after {max_retries} attempts: {e}")
    
    def _create_zfs_pool(self, job_id: str, details: Dict):
        """Phase 6: Create ZFS pool on the new disk."""
        pool_name = details.get('zfs_pool_name', 'replication')
        
        self._log_console(job_id, 'INFO', 'Detecting available disks...', details)
        
        # Detect the new disk (usually /dev/sdb or similar)
        disk_device = self._detect_zfs_disk()
        if not disk_device:
            raise Exception("Could not detect ZFS target disk")
        
        self._log_console(job_id, 'INFO', f'Found disk for ZFS: {disk_device}', details)
        
        # Create ZFS pool
        self._log_console(job_id, 'INFO', f'Creating ZFS pool: {pool_name} on {disk_device}', details)
        
        result = self._ssh_exec(f'zpool create -f {pool_name} {disk_device}')
        if result['exit_code'] != 0:
            raise Exception(f"zpool create failed: {result['stderr']}")
        
        self._log_console(job_id, 'INFO', 'ZFS pool created successfully', details)
        
        # Create NFS dataset
        dataset = f'{pool_name}/nfs'
        self._log_console(job_id, 'INFO', f'Creating dataset: {dataset}', details)
        
        result = self._ssh_exec(f'zfs create {dataset}')
        if result['exit_code'] != 0:
            raise Exception(f"zfs create failed: {result['stderr']}")
        
        # Verify pool status
        result = self._ssh_exec(f'zpool status {pool_name}')
        if 'ONLINE' in result['stdout']:
            self._log_console(job_id, 'INFO', 'ZFS pool is healthy (ONLINE)', details)
        else:
            self._log_console(job_id, 'WARN', f'ZFS pool status: {result["stdout"]}', details)
    
    def _configure_nfs(self, job_id: str, details: Dict):
        """Phase 7: Configure NFS share on ZFS dataset."""
        pool_name = details.get('zfs_pool_name', 'replication')
        nfs_network = details.get('nfs_network', '*')
        dataset = f'{pool_name}/nfs'
        
        self._log_console(job_id, 'INFO', f'Configuring NFS share for {dataset}...', details)
        
        # Set NFS share properties
        # CRITICAL: Include 'nohide' to expose child datasets (VM folders) through NFS
        # Without nohide, ZFS child datasets create separate mount points that are hidden from NFS clients
        share_opts = ZFS_NFS_SHARE_OPTIONS
        if nfs_network and nfs_network != '*':
            share_opts = f'{nfs_network}({share_opts})'
        else:
            share_opts = f'*({share_opts})'
        
        result = self._ssh_exec(f'zfs set sharenfs="{share_opts}" {dataset}')
        if result['exit_code'] != 0:
            # Try alternate method - direct exports file
            self._log_console(job_id, 'WARN', f'ZFS sharenfs failed, trying /etc/exports...', details)
            export_path = f'/{dataset}'
            export_line = f'{export_path} {share_opts}'
            
            self._ssh_exec(f'echo "{export_line}" >> /etc/exports')
            self._ssh_exec('exportfs -ra')
        
        # Ensure NFS service is running
        self._log_console(job_id, 'INFO', 'Enabling NFS service...', details)
        
        # Try systemd first
        result = self._ssh_exec('systemctl enable --now nfs-server 2>/dev/null || service nfs start')
        
        # Verify NFS export
        result = self._ssh_exec('showmount -e localhost 2>/dev/null || exportfs -v')
        self._log_console(job_id, 'INFO', f'NFS exports: {result["stdout"][:200]}', details)
        
        self._log_console(job_id, 'INFO', 'NFS configuration complete', details)
    
    def _register_replication_target(self, job_id: str, details: Dict) -> str:
        """Phase 8: Register as replication target in database."""
        detected_ip = details.get('detected_ip')
        vm_name = details.get('vm_name')
        pool_name = details.get('zfs_pool_name', 'replication')
        ssh_key_id = details.get('ssh_key_id')
        ssh_username = details.get('ssh_username', 'root')
        vcenter_id = details.get('vcenter_id')
        template_id = details.get('template_id')
        vm_moref = details.get('cloned_vm_moref')
        use_dhcp = details.get('use_dhcp', True)
        
        # Dynamic sizing metadata
        protection_group_id = details.get('protection_group_id')
        headroom_percent = details.get('headroom_percent')
        vm_count = details.get('vm_count')
        source_vm_storage_bytes = details.get('source_vm_storage_bytes')
        provisioned_disk_gb = details.get('final_disk_gb') or details.get('calculated_disk_gb') or details.get('zfs_disk_gb')
        
        self._log_console(job_id, 'INFO', f'Registering replication target: {vm_name}', details)
        
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
        
        target_data = {
            'name': vm_name,
            'hostname': detected_ip,
            'port': 22,
            'target_type': 'zfs',
            'zfs_pool': pool_name,
            'zfs_dataset_prefix': f'{pool_name}/nfs',
            'ssh_username': ssh_username,
            'ssh_key_id': ssh_key_id,
            'dr_vcenter_id': vcenter_id,
            'health_status': 'healthy',
            'is_active': True,
            'source_template_id': template_id,
            'deployed_job_id': job_id,
            'deployed_vm_moref': vm_moref,
            'deployed_ip_source': 'dhcp' if use_dhcp else 'static',
            # Dynamic sizing metadata
            'protection_group_id': protection_group_id,
            'headroom_percent': headroom_percent,
            'vm_count_at_provisioning': vm_count,
            'source_vm_storage_bytes': source_vm_storage_bytes,
            'provisioned_disk_gb': provisioned_disk_gb,
        }
        
        # Remove None values to avoid Supabase errors
        target_data = {k: v for k, v in target_data.items() if v is not None}
        
        response = requests.post(
            f'{DSM_URL}/rest/v1/replication_targets',
            json=target_data,
            headers=headers,
            verify=VERIFY_SSL,
            timeout=30
        )
        
        if not response.ok:
            raise Exception(f"Failed to register target: {response.text}")
        
        result = response.json()
        target_id = result[0]['id'] if result else None
        
        self._log_console(job_id, 'INFO', f'Replication target registered: {target_id}', details)
        
        # Log dynamic sizing info if used
        if protection_group_id:
            self._log_console(job_id, 'INFO', 
                f'Target provisioned with dynamic sizing: {provisioned_disk_gb} GB disk, '
                f'{vm_count} VMs, {headroom_percent}% headroom', details)
        
        # Update template deployment count
        if template_id:
            self._increment_template_deployment(template_id)
        
        return target_id
    
    def _register_datastore(self, job_id: str, details: Dict) -> str:
        """Phase 9: Register NFS share as vCenter datastore."""
        detected_ip = details.get('detected_ip')
        vm_name = details.get('vm_name')
        pool_name = details.get('zfs_pool_name', 'replication')
        datastore_hosts = details.get('datastore_hosts', [])
        
        datastore_name = f'nfs-{vm_name}'
        remote_path = f'/{pool_name}/nfs'
        
        self._log_console(job_id, 'INFO', f'Registering NFS datastore: {datastore_name}', details)
        
        if not self.vcenter_conn:
            self._log_console(job_id, 'WARN', 'No vCenter connection, skipping datastore registration', details)
            return None
        
        content = self.vcenter_conn.RetrieveContent()
        
        # Find hosts to mount datastore on
        hosts_to_mount = []
        
        if datastore_hosts:
            # Use specified hosts
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.HostSystem], True
            )
            for host in container.view:
                if host.name in datastore_hosts or str(host._moId) in datastore_hosts:
                    hosts_to_mount.append(host)
            container.Destroy()
        else:
            # Use all connected hosts
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.HostSystem], True
            )
            hosts_to_mount = [h for h in container.view if h.runtime.connectionState == 'connected']
            container.Destroy()
        
        if not hosts_to_mount:
            self._log_console(job_id, 'WARN', 'No ESXi hosts available for datastore mount', details)
            return None
        
        self._log_console(job_id, 'INFO', f'Mounting datastore on {len(hosts_to_mount)} hosts...', details)
        
        mounted_count = 0
        for host in hosts_to_mount:
            try:
                spec = vim.host.NasVolume.Specification()
                spec.remoteHost = detected_ip
                spec.remotePath = remote_path
                spec.localPath = datastore_name
                spec.accessMode = 'readWrite'
                spec.type = 'NFS'
                
                host.configManager.datastoreSystem.CreateNasDatastore(spec)
                mounted_count += 1
                self._log_console(job_id, 'INFO', f'Mounted on {host.name}', details)
            except vim.fault.DuplicateName:
                self._log_console(job_id, 'INFO', f'Datastore already exists on {host.name}', details)
                mounted_count += 1
            except Exception as e:
                self._log_console(job_id, 'WARN', f'Failed to mount on {host.name}: {e}', details)
        
        self._log_console(job_id, 'INFO', f'Datastore mounted on {mounted_count}/{len(hosts_to_mount)} hosts', details)
        
        return datastore_name
    
    # =========================================================================
    # Helper Methods
    # =========================================================================
    
    def _update_phase(self, job_id: str, phase: str, progress: int, details: Dict):
        """Update current phase and progress."""
        details['current_phase'] = phase
        details['progress_percent'] = progress
        
        # Find phase description
        for p_name, p_desc, _, _ in self.PHASES:
            if p_name == phase:
                self._log_console(job_id, 'INFO', f'Phase: {p_desc}', details)
                break
        
        self._update_details(job_id, details)
    
    def _update_details(self, job_id: str, details: Dict):
        """Update job details in database."""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            requests.patch(
                f'{DSM_URL}/rest/v1/jobs',
                params={'id': f'eq.{job_id}'},
                json={'details': details},
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
        except Exception as e:
            self.log(f'Warning: Could not update job details: {e}', 'WARN')
    
    def _log_console(self, job_id: str, level: str, message: str, details: Dict):
        """Add log entry to console_log array."""
        timestamp = datetime.now(timezone.utc).strftime('%H:%M:%S')
        log_entry = f'[{timestamp}] [{level}] {message}'
        
        console_log = details.get('console_log', [])
        if not isinstance(console_log, list):
            console_log = []
        console_log.append(log_entry)
        
        # Keep last 100 entries
        if len(console_log) > 100:
            console_log = console_log[-100:]
        
        details['console_log'] = console_log
        
        # Also log to executor
        self.log(message, level)
    
    def _fetch_template(self, template_id: str) -> Optional[Dict]:
        """Fetch ZFS target template from database using REST API."""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
            }
            
            response = requests.get(
                f'{DSM_URL}/rest/v1/zfs_target_templates',
                params={'id': f'eq.{template_id}', 'select': '*'},
                headers=headers,
                verify=VERIFY_SSL,
                timeout=15
            )
            
            if response.ok:
                data = response.json()
                if data and len(data) > 0:
                    return data[0]
            return None
        except Exception as e:
            self.log(f'Error fetching template: {e}', 'ERROR')
            return None
    
    def _get_vcenter_settings(self, vcenter_id: str) -> Optional[Dict]:
        """Fetch vCenter connection settings from database."""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
            }
            
            response = requests.get(
                f'{DSM_URL}/rest/v1/vcenters',
                params={'id': f'eq.{vcenter_id}', 'select': '*'},
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.ok:
                data = response.json()
                if data and len(data) > 0:
                    vc = data[0]
                    password = self.executor.decrypt_password(vc.get('password_encrypted'))
                    return {
                        'host': vc['host'],
                        'username': vc['username'],
                        'password': password,
                        'port': vc.get('port', 443),
                        'verify_ssl': vc.get('verify_ssl', False)
                    }
            return None
        except Exception as e:
            self.log(f'Error fetching vCenter settings: {e}', 'ERROR')
            return None
    
    def _get_ssh_key(self, ssh_key_id: str) -> Optional[Dict]:
        """Fetch SSH key from database."""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
            }
            
            response = requests.get(
                f'{DSM_URL}/rest/v1/ssh_keys',
                params={'id': f'eq.{ssh_key_id}', 'select': '*'},
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.ok:
                data = response.json()
                if data and len(data) > 0:
                    return data[0]
            return None
        except Exception as e:
            self.log(f'Error fetching SSH key: {e}', 'ERROR')
            return None
    
    def _decrypt_ssh_key(self, encrypted: str) -> Optional[str]:
        """Decrypt SSH private key."""
        if not encrypted:
            return None
        return self.executor.decrypt_password(encrypted)
    
    def _connect_vcenter(self, host: str, username: str, password: str,
                         port: int = 443, verify_ssl: bool = False):
        """Establish connection to vCenter."""
        try:
            ssl_context = None
            if not verify_ssl:
                ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE
            
            return SmartConnect(
                host=host,
                user=username,
                pwd=password,
                port=port,
                sslContext=ssl_context
            )
        except Exception as e:
            self.log(f'Failed to connect to vCenter {host}: {e}', 'ERROR')
            return None
    
    def _find_vm_by_moref(self, conn, moref: str):
        """Find VM by MoRef ID."""
        try:
            content = conn.RetrieveContent()
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.VirtualMachine], True
            )
            
            for vm in container.view:
                if str(vm._moId) == moref or f'vm-{vm._moId}' == moref:
                    container.Destroy()
                    return vm
            
            container.Destroy()
            return None
        except Exception as e:
            self.log(f'Error finding VM by moref: {e}', 'ERROR')
            return None
    
    def _build_customization_spec(self, details: Dict) -> vim.vm.customization.Specification:
        """Build guest customization specification."""
        hostname = details.get('hostname', details.get('vm_name', 'zfs-target'))
        use_dhcp = details.get('use_dhcp', True)
        ip_address = details.get('ip_address')
        subnet_mask = details.get('subnet_mask', '255.255.255.0')
        gateway = details.get('gateway')
        
        spec = vim.vm.customization.Specification()
        
        # Identity - Linux
        ident = vim.vm.customization.LinuxPrep()
        ident.hostName = vim.vm.customization.FixedName(name=hostname)
        ident.domain = 'local'
        spec.identity = ident
        
        # Network adapter config
        adapter = vim.vm.customization.AdapterMapping()
        ip_settings = vim.vm.customization.IPSettings()
        
        if use_dhcp:
            ip_settings.ip = vim.vm.customization.DhcpIpGenerator()
        else:
            fixed_ip = vim.vm.customization.FixedIp()
            fixed_ip.ipAddress = ip_address
            ip_settings.ip = fixed_ip
            ip_settings.subnetMask = subnet_mask
            if gateway:
                ip_settings.gateway = [gateway]
        
        adapter.adapter = ip_settings
        spec.nicSettingMap = [adapter]
        
        # Global IP settings
        global_ip = vim.vm.customization.GlobalIPSettings()
        spec.globalIPSettings = global_ip
        
        return spec
    
    def _add_disk(self, vm, size_gb: int):
        """Add a new virtual disk to VM."""
        spec = vim.vm.ConfigSpec()
        
        # Find SCSI controller
        scsi_controller = None
        for device in vm.config.hardware.device:
            if isinstance(device, vim.vm.device.VirtualSCSIController):
                scsi_controller = device
                break
        
        if not scsi_controller:
            raise Exception("No SCSI controller found on VM")
        
        # Find next available unit number
        unit_number = 0
        for device in vm.config.hardware.device:
            if hasattr(device, 'controllerKey') and device.controllerKey == scsi_controller.key:
                if hasattr(device, 'unitNumber') and device.unitNumber >= unit_number:
                    unit_number = device.unitNumber + 1
        
        # Skip unit 7 (reserved for SCSI controller)
        if unit_number == 7:
            unit_number = 8
        
        # Create disk spec
        disk_spec = vim.vm.device.VirtualDeviceSpec()
        disk_spec.fileOperation = 'create'
        disk_spec.operation = vim.vm.device.VirtualDeviceSpec.Operation.add
        
        disk = vim.vm.device.VirtualDisk()
        disk.backing = vim.vm.device.VirtualDisk.FlatVer2BackingInfo()
        disk.backing.diskMode = 'persistent'
        disk.backing.thinProvisioned = True
        disk.controllerKey = scsi_controller.key
        disk.unitNumber = unit_number
        disk.capacityInKB = size_gb * 1024 * 1024
        
        disk_spec.device = disk
        spec.deviceChange = [disk_spec]
        
        task = vm.ReconfigVM_Task(spec=spec)
        self._wait_for_task_simple(task)
    
    def _configure_network(self, vm, network_name: str):
        """Configure VM network adapter."""
        content = self.vcenter_conn.RetrieveContent()
        
        # Find network
        network = None
        container = content.viewManager.CreateContainerView(
            content.rootFolder, [vim.Network], True
        )
        for net in container.view:
            if net.name == network_name:
                network = net
                break
        container.Destroy()
        
        if not network:
            self.log(f'Network {network_name} not found, skipping configuration', 'WARN')
            return
        
        # Find first NIC
        nic = None
        for device in vm.config.hardware.device:
            if isinstance(device, vim.vm.device.VirtualEthernetCard):
                nic = device
                break
        
        if not nic:
            self.log('No NIC found on VM', 'WARN')
            return
        
        # Update NIC backing
        spec = vim.vm.ConfigSpec()
        nic_spec = vim.vm.device.VirtualDeviceSpec()
        nic_spec.operation = vim.vm.device.VirtualDeviceSpec.Operation.edit
        nic_spec.device = nic
        
        if isinstance(network, vim.dvs.DistributedVirtualPortgroup):
            # Distributed port group
            dvs_port = vim.dvs.PortConnection()
            dvs_port.portgroupKey = network.key
            dvs_port.switchUuid = network.config.distributedVirtualSwitch.uuid
            nic.backing = vim.vm.device.VirtualEthernetCard.DistributedVirtualPortBackingInfo()
            nic.backing.port = dvs_port
        else:
            # Standard port group
            nic.backing = vim.vm.device.VirtualEthernetCard.NetworkBackingInfo()
            nic.backing.deviceName = network_name
        
        spec.deviceChange = [nic_spec]
        
        task = vm.ReconfigVM_Task(spec=spec)
        self._wait_for_task_simple(task)
    
    def _wait_for_task(self, task, job_id: str, details: Dict, timeout: int = 600):
        """Wait for vCenter task to complete with progress updates."""
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            state = task.info.state
            
            if state == vim.TaskInfo.State.success:
                return
            elif state == vim.TaskInfo.State.error:
                error_msg = str(task.info.error.msg) if task.info.error else 'Unknown error'
                raise Exception(f"Task failed: {error_msg}")
            
            if task.info.progress:
                self._log_console(job_id, 'DEBUG', f'Task progress: {task.info.progress}%', details)
            
            time.sleep(5)
        
        raise Exception(f"Task timed out after {timeout}s")
    
    def _wait_for_task_simple(self, task, timeout: int = 300):
        """Wait for vCenter task without logging."""
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            state = task.info.state
            
            if state == vim.TaskInfo.State.success:
                return
            elif state == vim.TaskInfo.State.error:
                error_msg = str(task.info.error.msg) if task.info.error else 'Unknown error'
                raise Exception(f"Task failed: {error_msg}")
            
            time.sleep(2)
        
        raise Exception(f"Task timed out after {timeout}s")
    
    def _ssh_exec(self, command: str, job_id: str = None, log_command: bool = True) -> Dict:
        """Execute SSH command, log it to idrac_commands, and return result."""
        if not self.ssh_client:
            raise Exception("SSH client not connected")
        
        start_time = time.time()
        
        stdin, stdout, stderr = self.ssh_client.exec_command(command, timeout=60)
        exit_code = stdout.channel.recv_exit_status()
        
        stdout_text = stdout.read().decode('utf-8', errors='replace')
        stderr_text = stderr.read().decode('utf-8', errors='replace')
        
        response_time_ms = int((time.time() - start_time) * 1000)
        
        # Log SSH command to idrac_commands if logging is enabled
        if log_command and hasattr(self, 'executor') and self.executor:
            try:
                # Get target IP from SSH transport
                target_ip = 'unknown'
                try:
                    transport = self.ssh_client.get_transport()
                    if transport:
                        peer = transport.getpeername()
                        if peer:
                            target_ip = peer[0]
                except:
                    pass
                
                # Truncate command if too long (keep first 200 chars)
                command_display = command[:200] + '...' if len(command) > 200 else command
                
                # Truncate stdout/stderr for logging (keep first 500 chars)
                stdout_log = stdout_text[:500] + '...' if len(stdout_text) > 500 else stdout_text
                stderr_log = stderr_text[:500] + '...' if len(stderr_text) > 500 else stderr_text
                
                self.executor.log_idrac_command(
                    server_id=None,
                    job_id=job_id or getattr(self, 'current_job_id', None),
                    task_id=None,
                    command_type='SSH',
                    endpoint=command_display,
                    full_url=f'ssh://{target_ip}:22',
                    request_headers={'user': 'root'},
                    request_body={'command': command_display},
                    status_code=0 if exit_code == 0 else exit_code,
                    response_time_ms=response_time_ms,
                    response_body={'stdout': stdout_log, 'stderr': stderr_log, 'exit_code': exit_code},
                    success=(exit_code == 0),
                    error_message=stderr_log if exit_code != 0 else None,
                    operation_type='ssh_command',
                    source='job_executor'
                )
            except Exception as log_err:
                # Don't fail the command if logging fails
                pass
        
        return {
            'stdout': stdout_text,
            'stderr': stderr_text,
            'exit_code': exit_code
        }
    
    def _detect_zfs_disk(self) -> Optional[str]:
        """Detect the disk to use for ZFS pool."""
        # Try common disk paths
        disk_candidates = ['/dev/sdb', '/dev/vdb', '/dev/nvme1n1', '/dev/xvdb']
        
        # First, list block devices
        result = self._ssh_exec('lsblk -dpno NAME,SIZE,TYPE | grep disk')
        if result['exit_code'] == 0:
            lines = result['stdout'].strip().split('\n')
            for line in lines:
                parts = line.split()
                if len(parts) >= 2:
                    device = parts[0]
                    # Skip first disk (OS disk)
                    if device not in ['/dev/sda', '/dev/vda', '/dev/nvme0n1', '/dev/xvda']:
                        # Verify it's not in use
                        check = self._ssh_exec(f'zpool status 2>/dev/null | grep -q {device}')
                        if check['exit_code'] != 0:  # Not in a pool
                            return device
        
        # Fallback to candidates
        for device in disk_candidates:
            result = self._ssh_exec(f'test -b {device} && echo exists')
            if 'exists' in result['stdout']:
                return device
        
        return None
    
    def _increment_template_deployment(self, template_id: str):
        """Increment template deployment count."""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            # Call the database function
            requests.post(
                f'{DSM_URL}/rest/v1/rpc/increment_template_deployment',
                json={'template_id': template_id},
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
        except Exception as e:
            self.log(f'Warning: Could not increment deployment count: {e}', 'WARN')
    
    def _cleanup(self):
        """Clean up connections."""
        if self.ssh_client:
            try:
                self.ssh_client.close()
            except:
                pass
            self.ssh_client = None
        
        if self.vcenter_conn:
            try:
                Disconnect(self.vcenter_conn)
            except:
                pass
            self.vcenter_conn = None
    
    # =========================================================================
    # Execute Onboard ZFS Target Handler
    # =========================================================================
    
    def execute_onboard_zfs_target(self, job: Dict):
        """
        Unified onboarding handler for ZFS replication targets.
        
        This handler is used by the OnboardZfsTargetWizard to set up an existing
        VM as a ZFS replication target. Unlike deploy_zfs_target which clones
        from a template, this works with an existing VM.
        
        Steps:
        1. DETECT_VM_STATE - Check if VM exists, powered on, has IP
        2. SSH_AUTH - Connect via SSH (password or key)
        3. INSTALL_PACKAGES - apt-get install zfsutils-linux nfs-kernel-server
        4. CREATE_ZPOOL - zpool create with detected disk
        5. CONFIGURE_NFS - Set up NFS exports
        6. REGISTER_TARGET - Insert into replication_targets table
        7. REGISTER_DATASTORE - Register NFS datastore in vCenter
        8. (Optional) CREATE_PROTECTION_GROUP - If user selected
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        target_scope = job.get('target_scope', {}) or {}
        
        # Initialize step tracking
        step_results = []
        
        def add_step_result(step: str, status: str, message: str, **kwargs):
            result = {'step': step, 'status': status, 'message': message, **kwargs}
            step_results.append(result)
            job_details['step_results'] = step_results
            self.update_job_status(job_id, 'running', details=job_details)
        
        job_details = {
            'step_results': step_results,
            'progress_percent': 0,
            'console_log': [],
            'vm_state': None,
            'vm_ip': None,
            **details
        }
        
        self._log_console(job_id, 'INFO', 'Starting ZFS target onboarding', job_details)
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details=job_details)
        
        try:
            # Get VM info from target_scope
            vcenter_id = target_scope.get('vcenter_id')
            vm_id = target_scope.get('vm_id')
            
            if not vcenter_id or not vm_id:
                raise Exception("Missing vcenter_id or vm_id in target_scope")
            
            # Fetch VM details from database
            vm_info = self._fetch_vm_info(vm_id)
            if not vm_info:
                raise Exception(f"VM not found in database: {vm_id}")
            
            vm_name = vm_info.get('name', 'Unknown')
            vm_moref = vm_info.get('vcenter_id')  # Column is 'vcenter_id', not 'moref'
            vm_ip = vm_info.get('ip_address')
            target_name = details.get('target_name', f'zfs-{vm_name}')
            
            # Validate we have the moref
            if not vm_moref:
                raise Exception(f"VM {vm_name} has no vCenter ID (moref) - please resync vCenter inventory")
            
            job_details['vm_name'] = vm_name
            job_details['vm_moref'] = vm_moref
            job_details['target_name'] = target_name
            
            self._log_console(job_id, 'INFO', f'Target VM: {vm_name} ({vm_moref})', job_details)
            
            # ========== Step 1: Detect VM State ==========
            job_details['progress_percent'] = 5
            add_step_result('vm_state', 'running', 'Checking VM state...')
            
            try:
                vc_settings = self._get_vcenter_settings(vcenter_id)
                if not vc_settings:
                    raise Exception(f"vCenter settings not found: {vcenter_id}")
                
                self.vcenter_conn = self._connect_vcenter(
                    vc_settings['host'],
                    vc_settings['username'],
                    vc_settings['password'],
                    vc_settings.get('port', 443),
                    vc_settings.get('verify_ssl', False)
                )
                
                if not self.vcenter_conn:
                    raise Exception("Failed to connect to vCenter")
                
                add_step_result('vcenter', 'success', f'Connected to {vc_settings["host"]}')
                
                # Find VM
                vm = self._find_vm_by_moref(self.vcenter_conn, vm_moref)
                if not vm:
                    raise Exception(f"VM not found in vCenter: {vm_moref}")
                
                # Check if this is a template deployment
                is_template_deploy = details.get('is_template_deploy', False)
                is_template = hasattr(vm.config, 'template') and vm.config.template
                
                if is_template or is_template_deploy:
                    # Clone the template first
                    clone_config = details.get('clone_template', {})
                    clone_name = clone_config.get('clone_name') or f"{target_name}-vm"
                    target_cluster = clone_config.get('target_cluster')
                    target_datastore = clone_config.get('target_datastore')
                    
                    add_step_result('clone_template', 'running', f'Cloning template to {clone_name}...')
                    self._log_console(job_id, 'INFO', f'Source is a template, cloning to: {clone_name}', job_details)
                    
                    # Find resource pool from cluster
                    content = self.vcenter_conn.RetrieveContent()
                    resource_pool = self._find_resource_pool(content, target_cluster)
                    if not resource_pool:
                        raise Exception(f"No resource pool found for cluster: {target_cluster or 'any'}")
                    
                    self._log_console(job_id, 'INFO', f'Using resource pool: {resource_pool.name}', job_details)
                    
                    # Build clone spec
                    clone_spec = vim.vm.CloneSpec()
                    clone_spec.location = vim.vm.RelocateSpec()
                    clone_spec.location.pool = resource_pool
                    clone_spec.powerOn = False  # We'll power on after clone
                    clone_spec.template = False
                    
                    # Execute clone
                    folder = vm.parent
                    task = vm.Clone(folder=folder, name=clone_name, spec=clone_spec)
                    self._wait_for_task(task, job_id, job_details)
                    
                    cloned_vm = task.info.result
                    
                    # Update references to point to the cloned VM
                    vm = cloned_vm
                    vm_moref = str(vm._moId)
                    vm_name = clone_name
                    job_details['cloned_vm_moref'] = vm_moref
                    job_details['cloned_vm_name'] = clone_name
                    job_details['is_cloned'] = True
                    
                    add_step_result('clone_template', 'success', f'Cloned to {clone_name}')
                    self._log_console(job_id, 'INFO', f'Clone complete: {clone_name} ({vm_moref})', job_details)
                
                # Now check power state (for cloned VM or existing VM)
                power_state = str(vm.runtime.powerState)
                job_details['vm_state'] = power_state
                
                if power_state != 'poweredOn':
                    add_step_result('vm_state', 'running', f'VM is {power_state}, powering on...')
                    task = vm.PowerOn()
                    self._wait_for_task(task, job_id, job_details)
                    job_details['vm_state'] = 'poweredOn'
                    add_step_result('power_on', 'success', 'VM powered on')
                else:
                    add_step_result('vm_state', 'success', 'VM is powered on')
                
                # Wait for IP
                job_details['progress_percent'] = 10
                add_step_result('ip_address', 'running', 'Waiting for IP address...')
                
                vm_ip = None
                for _ in range(30):  # 5 minute timeout
                    vm = self._find_vm_by_moref(self.vcenter_conn, vm_moref)
                    if vm and vm.guest.ipAddress:
                        ip = vm.guest.ipAddress
                        if ip and not ip.startswith('169.254') and not ip.startswith('127.'):
                            vm_ip = ip
                            break
                    time.sleep(10)
                
                if not vm_ip:
                    raise Exception("Could not detect VM IP address")
                
                job_details['vm_ip'] = vm_ip
                add_step_result('ip_address', 'success', f'IP: {vm_ip}')
                
            except Exception as e:
                add_step_result('vm_state', 'failed', str(e))
                raise
            
            # ========== Step 2: SSH Authentication ==========
            job_details['progress_percent'] = 20
            add_step_result('ssh_auth', 'running', 'Attempting SSH connection...')
            
            try:
                if not PARAMIKO_AVAILABLE:
                    raise Exception("paramiko library not installed")
                
                ssh_username = details.get('ssh_username', 'root')
                root_password = details.get('root_password')
                ssh_key_id = details.get('ssh_key_id')
                
                self.ssh_client = paramiko.SSHClient()
                self.ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                
                connected = False
                
                # Try SSH key first
                if ssh_key_id:
                    try:
                        key_data = self._get_ssh_key(ssh_key_id)
                        if key_data:
                            private_key = self._decrypt_ssh_key(key_data.get('private_key_encrypted'))
                            if private_key:
                                key_file = io.StringIO(private_key)
                                pkey = None
                                for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                                    try:
                                        key_file.seek(0)
                                        pkey = key_class.from_private_key(key_file)
                                        break
                                    except:
                                        continue
                                
                                if pkey:
                                    self.ssh_client.connect(
                                        hostname=vm_ip,
                                        username=ssh_username,
                                        pkey=pkey,
                                        timeout=30,
                                        allow_agent=False,
                                        look_for_keys=False
                                    )
                                    connected = True
                                    add_step_result('ssh_auth', 'success', f'Connected via SSH key as {ssh_username}')
                    except paramiko.AuthenticationException:
                        self._log_console(job_id, 'WARN', 'SSH key auth failed, trying password...', job_details)
                
                # Try password if key failed
                if not connected and root_password:
                    try:
                        self.ssh_client.connect(
                            hostname=vm_ip,
                            username=ssh_username,
                            password=root_password,
                            timeout=30,
                            allow_agent=False,
                            look_for_keys=False
                        )
                        connected = True
                        add_step_result('ssh_auth', 'success', f'Connected via password as {ssh_username}')
                        
                        # Deploy SSH key if requested
                        if details.get('generate_new_key'):
                            add_step_result('ssh_key_deploy', 'running', 'Generating and deploying SSH key...')
                            # Generate key pair
                            new_key = paramiko.Ed25519Key.generate()
                            private_key_str = io.StringIO()
                            new_key.write_private_key(private_key_str)
                            public_key_str = f"ssh-ed25519 {new_key.get_base64()} zfs-target-{target_name}"
                            
                            # Deploy to authorized_keys
                            result = self._ssh_exec(f'mkdir -p ~/.ssh && chmod 700 ~/.ssh', job_id=job_id)
                            result = self._ssh_exec(f'echo "{public_key_str}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys', job_id=job_id)
                            
                            if result['exit_code'] == 0:
                                # Save key to database
                                self._save_ssh_key(target_name, private_key_str.getvalue(), public_key_str)
                                add_step_result('ssh_key_deploy', 'success', 'SSH key generated and deployed')
                            else:
                                add_step_result('ssh_key_deploy', 'warning', 'Key deploy failed, continuing with password')
                        
                    except paramiko.AuthenticationException:
                        pass
                
                if not connected:
                    # Need password - pause job
                    add_step_result('ssh_auth', 'failed', 'SSH authentication failed - provide root password', needs_root_password=True)
                    job_details['waiting_for_input'] = True
                    self.update_job_status(job_id, 'running', details=job_details)
                    # The job will be resumed when user provides password
                    return
                
            except Exception as e:
                add_step_result('ssh_auth', 'failed', str(e))
                raise
            
            # ========== Step 3: Install Packages ==========
            if details.get('install_packages', True):
                job_details['progress_percent'] = 35
                
                try:
                    # For template deployments, check if ZFS is already installed
                    is_template_deploy = details.get('is_template_deploy', False)
                    skip_package_install = False
                    
                    if is_template_deploy:
                        self._log_console(job_id, 'INFO', 'Template deployment detected - checking for existing ZFS...', job_details)
                        
                        # Check if ZFS package is installed (not if module is loaded - module may not auto-load on boot)
                        zfs_check = self._ssh_exec('dpkg -l zfsutils-linux 2>/dev/null | grep -q "^ii" && which zfs', job_id=job_id)
                        if zfs_check['exit_code'] == 0:
                            self._log_console(job_id, 'INFO', 'ZFS tools already installed (prepared template)', job_details)
                            add_step_result('apt_sources', 'skipped', 'Template already prepared')
                            add_step_result('kernel_headers', 'skipped', 'Template already prepared')
                            add_step_result('zfs_packages', 'success', 'Already installed from template')
                            
                            # Check if NFS is also installed
                            nfs_check = self._ssh_exec('which exportfs 2>/dev/null', job_id=job_id)
                            if nfs_check['exit_code'] == 0:
                                add_step_result('nfs_packages', 'success', 'Already installed from template')
                            else:
                                # Install NFS if missing
                                self._log_console(job_id, 'INFO', 'Installing NFS packages...', job_details)
                                add_step_result('nfs_packages', 'running', 'Installing NFS packages...')
                                result = self._ssh_exec('DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nfs-kernel-server', job_id=job_id)
                                if result['exit_code'] == 0:
                                    add_step_result('nfs_packages', 'success', 'NFS packages installed')
                                else:
                                    add_step_result('nfs_packages', 'warning', 'NFS install failed, continuing')
                            
                            # Try to load the ZFS module
                            add_step_result('zfs_module', 'running', 'Loading ZFS kernel module...')
                            modprobe = self._ssh_exec('modprobe zfs 2>&1', job_id=job_id)
                            
                            if modprobe['exit_code'] != 0:
                                # Module not loaded - might need DKMS rebuild after clone
                                self._log_console(job_id, 'WARN', 'ZFS module not loaded, attempting DKMS rebuild...', job_details)
                                add_step_result('zfs_module', 'running', 'Rebuilding ZFS DKMS module...')
                                
                                # Run DKMS autoinstall
                                dkms_result = self._ssh_exec('dkms autoinstall 2>&1', job_id=job_id)
                                self._log_console(job_id, 'DEBUG', f'DKMS autoinstall output: {dkms_result["stdout"][:500]}', job_details)
                                
                                # Retry modprobe
                                modprobe = self._ssh_exec('modprobe zfs 2>&1', job_id=job_id)
                                
                                if modprobe['exit_code'] != 0:
                                    # Still failing - check if module is maybe already loaded
                                    lsmod = self._ssh_exec('lsmod | grep -q zfs', job_id=job_id)
                                    if lsmod['exit_code'] != 0:
                                        # Module really won't load - template may need re-preparation
                                        self._log_console(job_id, 'ERROR', 'ZFS module failed to load after DKMS rebuild', job_details)
                                        raise Exception(
                                            "ZFS kernel module failed to load. The template may need to be "
                                            "re-prepared with a reboot before converting to template, or the "
                                            "kernel version may have changed. Try running 'dkms autoinstall && modprobe zfs' manually."
                                        )
                            
                            # Verify module is loaded
                            verify = self._ssh_exec('lsmod | grep zfs', job_id=job_id)
                            if verify['exit_code'] == 0:
                                add_step_result('zfs_module', 'success', 'ZFS module loaded from template')
                                self._log_console(job_id, 'INFO', 'ZFS module loaded successfully', job_details)
                            else:
                                add_step_result('zfs_module', 'success', 'ZFS module appears loaded')
                            
                            skip_package_install = True
                        else:
                            self._log_console(job_id, 'INFO', 'Template does not have ZFS pre-installed, proceeding with full install', job_details)
                    
                    if not skip_package_install:
                        # Step 3a: Enable contrib repository (required for ZFS on Debian 13)
                        add_step_result('apt_sources', 'running', 'Configuring repositories for ZFS...')
                        self._log_console(job_id, 'INFO', 'Checking repository configuration...', job_details)
                        
                        # Check for deb822 format (.sources files) vs traditional format
                        check_deb822 = self._ssh_exec('ls /etc/apt/sources.list.d/*.sources 2>/dev/null', job_id=job_id)
                        
                        if check_deb822['exit_code'] == 0 and check_deb822['stdout'].strip():
                            # deb822 format (Debian 12+) - check if contrib is in Components line
                            result = self._ssh_exec('grep -r "Components:.*contrib" /etc/apt/sources.list.d/*.sources 2>/dev/null', job_id=job_id)
                            if result['exit_code'] != 0 or not result['stdout'].strip():
                                self._log_console(job_id, 'INFO', 'Adding contrib to deb822 sources...', job_details)
                                self._ssh_exec(r"sed -i 's/^Components: main$/Components: main contrib/' /etc/apt/sources.list.d/*.sources", job_id=job_id)
                                add_step_result('apt_sources', 'success', 'Added contrib to deb822 sources')
                            else:
                                add_step_result('apt_sources', 'success', 'contrib already enabled (deb822)')
                        else:
                            # Traditional format - check sources.list
                            result = self._ssh_exec('grep -E "^deb.*contrib" /etc/apt/sources.list /etc/apt/sources.list.d/*.list 2>/dev/null', job_id=job_id)
                            if result['exit_code'] != 0 or not result['stdout'].strip():
                                self._log_console(job_id, 'INFO', 'Adding contrib to sources.list...', job_details)
                                self._ssh_exec(r"sed -i 's/^\(deb.*main\)$/\1 contrib/' /etc/apt/sources.list", job_id=job_id)
                                add_step_result('apt_sources', 'success', 'Added contrib repository')
                            else:
                                add_step_result('apt_sources', 'success', 'contrib already enabled')
                        
                        # Update apt sources after adding contrib
                        self._log_console(job_id, 'INFO', 'Updating package lists...', job_details)
                        result = self._ssh_exec('apt-get update -qq', job_id=job_id)
                        
                        # Step 3b: Install kernel headers (required for DKMS/ZFS module build)
                        add_step_result('kernel_headers', 'running', 'Installing kernel headers...')
                        result = self._ssh_exec('uname -r', job_id=job_id)
                        kernel_version = result['stdout'].strip() if result['exit_code'] == 0 else None
                        
                        if kernel_version:
                            self._log_console(job_id, 'INFO', f'Installing kernel headers for {kernel_version}...', job_details)
                            result = self._ssh_exec(
                                f'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq dpkg-dev linux-headers-{kernel_version}',
                                job_id=job_id
                            )
                            if result['exit_code'] != 0:
                                self._log_console(job_id, 'WARN', f'Header install warning: {result["stderr"]}', job_details)
                                add_step_result('kernel_headers', 'warning', 'Headers may not have installed correctly')
                            else:
                                add_step_result('kernel_headers', 'success', f'Headers installed for {kernel_version}')
                        else:
                            add_step_result('kernel_headers', 'skipped', 'Could not detect kernel version')
                        
                        # Step 3c: Install ZFS packages (zfs-dkms builds kernel module, zfsutils-linux provides tools)
                        add_step_result('zfs_packages', 'running', 'Installing ZFS packages (DKMS build may take several minutes)...')
                        self._log_console(job_id, 'INFO', 'Installing zfs-dkms and zfsutils-linux...', job_details)
                        
                        result = self._ssh_exec('DEBIAN_FRONTEND=noninteractive apt-get install -y zfs-dkms zfsutils-linux', job_id=job_id)
                        if result['exit_code'] != 0:
                            raise Exception(f"Failed to install ZFS: {result['stderr']}")
                        
                        add_step_result('zfs_packages', 'success', 'ZFS packages installed')
                        
                        # Step 3d: Install NFS
                        add_step_result('nfs_packages', 'running', 'Installing NFS packages...')
                        result = self._ssh_exec('DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nfs-kernel-server', job_id=job_id)
                        if result['exit_code'] != 0:
                            raise Exception(f"Failed to install NFS: {result['stderr']}")
                        
                        add_step_result('nfs_packages', 'success', 'NFS packages installed')
                        
                        # Step 3e: Load ZFS module
                        add_step_result('zfs_module', 'running', 'Loading ZFS kernel module...')
                        result = self._ssh_exec('modprobe zfs', job_id=job_id)
                        
                        # If modprobe failed, try rebuilding DKMS modules
                        if result['exit_code'] != 0:
                            self._log_console(job_id, 'WARN', 'modprobe zfs failed, attempting DKMS rebuild...', job_details)
                            add_step_result('zfs_module', 'running', 'Rebuilding ZFS DKMS module...')
                            self._ssh_exec('dkms autoinstall', job_id=job_id)
                            result = self._ssh_exec('modprobe zfs', job_id=job_id)
                        
                        # Final check - fail if module still won't load
                        if result['exit_code'] != 0:
                            check = self._ssh_exec('lsmod | grep -q zfs', job_id=job_id)
                            if check['exit_code'] != 0:
                                raise Exception(
                                    "ZFS kernel module failed to load. This may require a reboot "
                                    "or manual intervention. Try: 'dkms autoinstall && modprobe zfs'"
                                )
                        
                        add_step_result('zfs_module', 'success', 'ZFS module loaded')
                    
                except Exception as e:
                    add_step_result('zfs_packages', 'failed', str(e))
                    raise
            
            # ========== Step 4: Create ZFS Pool ==========
            job_details['progress_percent'] = 50
            add_step_result('disk_detection', 'running', 'Detecting available disks...')
            
            try:
                # Handle destroy_existing_pool option - destroy any existing pool first
                if details.get('destroy_existing_pool'):
                    self._log_console(job_id, 'WARN', 'destroy_existing_pool is set - checking for existing pools', job_details)
                    existing_pool = self._ssh_exec('zpool list -H -o name 2>/dev/null | head -1', job_id=job_id)
                    if existing_pool['exit_code'] == 0 and existing_pool['stdout'].strip():
                        pool_to_destroy = existing_pool['stdout'].strip()
                        self._log_console(job_id, 'WARN', f'Destroying existing pool: {pool_to_destroy}', job_details)
                        add_step_result('disk_detection', 'running', f'Destroying existing pool {pool_to_destroy}...')
                        destroy_result = self._ssh_exec(f'zpool destroy -f {pool_to_destroy}', job_id=job_id)
                        if destroy_result['exit_code'] != 0:
                            raise Exception(f"Failed to destroy pool {pool_to_destroy}: {destroy_result['stderr']}")
                        self._log_console(job_id, 'INFO', f'Successfully destroyed pool: {pool_to_destroy}', job_details)
                
                # Detect available disk
                zfs_disk = self._detect_zfs_disk()
                if not zfs_disk:
                    raise Exception("No suitable disk found for ZFS pool")
                
                add_step_result('disk_detection', 'success', f'Found disk: {zfs_disk}')
                job_details['zfs_disk'] = zfs_disk
                
                # Check if pool already exists
                pool_name = details.get('zfs_pool_name', 'tank')
                result = self._ssh_exec(f'zpool list {pool_name} 2>/dev/null', job_id=job_id)
                
                if result['exit_code'] == 0:
                    add_step_result('zfs_pool', 'success', f'Pool {pool_name} already exists')
                else:
                    add_step_result('zfs_pool', 'running', f'Creating ZFS pool {pool_name}...')
                    
                    # Create pool
                    result = self._ssh_exec(f'zpool create -f {pool_name} {zfs_disk}', job_id=job_id)
                    if result['exit_code'] != 0:
                        raise Exception(f"Failed to create ZFS pool: {result['stderr']}")
                    
                    # Set compression
                    result = self._ssh_exec(f'zfs set compression=lz4 {pool_name}', job_id=job_id)
                    
                    # Create NFS dataset
                    result = self._ssh_exec(f'zfs create {pool_name}/nfs', job_id=job_id)
                    
                    add_step_result('zfs_pool', 'success', f'Pool {pool_name} created with compression=lz4')
                
            except Exception as e:
                add_step_result('zfs_pool', 'failed', str(e))
                raise
            
            # ========== Step 5: Configure NFS ==========
            job_details['progress_percent'] = 65
            add_step_result('nfs_export', 'running', 'Configuring NFS exports...')
            
            try:
                pool_name = details.get('zfs_pool_name', 'tank')
                nfs_network = details.get('nfs_network', '10.0.0.0/8')
                nfs_path = f'/{pool_name}/nfs'
                
                # CRITICAL: Include 'nohide' to expose child datasets (VM folders) through NFS
                result = self._ssh_exec(f'zfs set sharenfs="{ZFS_NFS_SHARE_OPTIONS}" {pool_name}/nfs', job_id=job_id)
                
                # Also add to /etc/exports as backup (with nohide for nested mount visibility)
                export_line = f'{nfs_path} {nfs_network}({ZFS_NFS_SHARE_OPTIONS})'
                result = self._ssh_exec(f'grep -q "{nfs_path}" /etc/exports || echo "{export_line}" >> /etc/exports', job_id=job_id)
                
                # Export and restart NFS
                result = self._ssh_exec('exportfs -ra && systemctl restart nfs-kernel-server', job_id=job_id)
                
                add_step_result('nfs_export', 'success', f'NFS export configured: {nfs_path}')
                job_details['nfs_path'] = nfs_path
                
            except Exception as e:
                add_step_result('nfs_export', 'failed', str(e))
                raise
            
            # ========== Step 6: Register Target ==========
            job_details['progress_percent'] = 80
            add_step_result('register_target', 'running', 'Registering replication target...')
            
            try:
                pool_name = details.get('zfs_pool_name', 'tank')
                nfs_path = f'/{pool_name}/nfs'
                
                target_data = {
                    'name': target_name,
                    'hostname': vm_ip,
                    'target_type': 'zfs',
                    'dr_vcenter_id': vcenter_id,
                    'deployed_vm_moref': vm_moref,
                    'zfs_pool': pool_name,
                    'zfs_dataset_prefix': f'{pool_name}/nfs',
                    'health_status': 'healthy',
                    'is_active': True,
                    'deployed_job_id': job_id,
                    'ssh_username': ssh_username
                }
                
                headers = {
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                }
                
                resp = requests.post(
                    f'{DSM_URL}/rest/v1/replication_targets',
                    json=target_data,
                    headers=headers,
                    verify=VERIFY_SSL,
                    timeout=30
                )
                
                if resp.status_code not in [200, 201]:
                    raise Exception(f"Failed to register target: {resp.text}")
                
                target_result = resp.json()
                target_id = target_result[0]['id'] if isinstance(target_result, list) else target_result.get('id')
                job_details['replication_target_id'] = target_id
                
                add_step_result('register_target', 'success', f'Target registered: {target_name}')
                
            except Exception as e:
                add_step_result('register_target', 'failed', str(e))
                raise
            
            # ========== Step 7: Register Datastore on ALL Hosts ==========
            job_details['progress_percent'] = 90
            add_step_result('register_datastore', 'running', 'Registering vCenter datastore on all ESXi hosts...')
            
            try:
                datastore_name = self._register_datastore(job_id, {
                    'detected_ip': vm_ip,
                    'vm_name': target_name,
                    'zfs_pool_name': details.get('zfs_pool_name', 'tank'),
                    'datastore_name': details.get('datastore_name'),
                    # Empty datastore_hosts = mount on ALL connected hosts
                    'datastore_hosts': details.get('datastore_hosts', []),
                })
                
                if datastore_name:
                    job_details['datastore_name'] = datastore_name
                    add_step_result('register_datastore', 'success', f'Datastore mounted on all hosts: {datastore_name}')
                else:
                    add_step_result('register_datastore', 'warning', 'No hosts available for datastore mount')
                    
            except Exception as e:
                add_step_result('register_datastore', 'warning', str(e))
                # Don't fail the whole job for datastore issues
            
            # ========== Complete ==========
            job_details['progress_percent'] = 100
            add_step_result('finalize', 'success', 'ZFS target ready for replication')
            
            self._log_console(job_id, 'INFO', '✓ ZFS target onboarding completed successfully', job_details)
            self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(), details=job_details)
            
        except Exception as e:
            self.log(f'ZFS target onboarding failed: {e}', 'ERROR')
            job_details['error'] = str(e)
            self._log_console(job_id, 'ERROR', f'Onboarding failed: {str(e)}', job_details)
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details=job_details)
        finally:
            self._cleanup()
    
    def _fetch_vm_info(self, vm_id: str) -> Optional[Dict]:
        """Fetch VM info from vcenter_vms table."""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            }
            
            resp = requests.get(
                f'{DSM_URL}/rest/v1/vcenter_vms?id=eq.{vm_id}&select=*',
                headers=headers,
                verify=VERIFY_SSL,
                timeout=30
            )
            
            if resp.status_code == 200:
                data = resp.json()
                return data[0] if data else None
            return None
        except Exception as e:
            self.log(f'Failed to fetch VM info: {e}', 'ERROR')
            return None
    
    def _save_ssh_key(self, name: str, private_key: str, public_key: str):
        """Save generated SSH key to database."""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            # Encrypt private key (simplified - in production use proper encryption)
            key_data = {
                'name': f'auto-{name}',
                'public_key': public_key,
                'private_key_encrypted': private_key,  # Should be encrypted
                'key_type': 'ed25519',
                'fingerprint': 'auto-generated'
            }
            
            requests.post(
                f'{DSM_URL}/rest/v1/ssh_keys',
                json=key_data,
                headers=headers,
                verify=VERIFY_SSL,
                timeout=30
            )
        except Exception as e:
            self.log(f'Failed to save SSH key: {e}', 'WARN')
    
    def execute_detect_disks(self, job: Dict) -> Dict:
        """
        Detect available disks on target VM via SSH.
        
        Returns list of unmounted disks suitable for ZFS pool creation.
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        job_details = {
            'detected_disks': [],
            'console_log': []
        }
        
        self._log_console(job_id, 'INFO', 'Starting disk detection...', job_details)
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details=job_details)
        
        try:
            # Get connection details
            vm_ip = details.get('vm_ip')
            if not vm_ip:
                raise Exception('No vm_ip provided')
            
            auth_method = details.get('auth_method', 'password')
            ssh_key_id = details.get('ssh_key_id')
            root_password = details.get('root_password')
            
            # Connect via SSH
            self.ssh_client = paramiko.SSHClient()
            self.ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            if auth_method == 'existing_key' and ssh_key_id:
                # Use SSH key
                key_data = self._get_ssh_key(ssh_key_id)
                if not key_data:
                    raise Exception('SSH key not found')
                
                private_key = self._decrypt_ssh_key(key_data.get('private_key_encrypted'))
                if not private_key:
                    raise Exception('Failed to decrypt SSH key')
                
                key_file = io.StringIO(private_key)
                pkey = None
                for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                    try:
                        key_file.seek(0)
                        pkey = key_class.from_private_key(key_file)
                        break
                    except:
                        continue
                
                if not pkey:
                    raise Exception('Unsupported key format')
                
                self.ssh_client.connect(
                    hostname=vm_ip,
                    username='root',
                    pkey=pkey,
                    timeout=15,
                    allow_agent=False,
                    look_for_keys=False
                )
            else:
                # Use password
                if not root_password:
                    raise Exception('No password provided')
                
                self.ssh_client.connect(
                    hostname=vm_ip,
                    username='root',
                    password=root_password,
                    timeout=15,
                    allow_agent=False,
                    look_for_keys=False
                )
            
            self._log_console(job_id, 'INFO', f'SSH connected to {vm_ip}', job_details)
            
            # Run lsblk to get disk info
            result = self._ssh_exec('lsblk -J -o NAME,SIZE,TYPE,MOUNTPOINT 2>/dev/null || lsblk -dno NAME,SIZE,TYPE', job_id)
            
            detected_disks = []
            excluded_disks = []
            os_disk_names = ['sda', 'vda', 'nvme0n1', 'xvda']
            
            if result['exit_code'] == 0:
                output = result['stdout'].strip()
                
                # Try JSON format first
                if output.startswith('{'):
                    import json
                    try:
                        data = json.loads(output)
                        for device in data.get('blockdevices', []):
                            name = device.get('name', '')
                            size = device.get('size', '')
                            dtype = device.get('type', '')
                            mountpoint = device.get('mountpoint')
                            
                            # Skip non-disk devices
                            if dtype != 'disk':
                                continue
                            
                            # Check exclusion reasons
                            exclusion_reason = None
                            
                            if mountpoint:
                                exclusion_reason = f'Mounted at {mountpoint}'
                            elif name in os_disk_names:
                                exclusion_reason = 'Primary OS disk (boot device)'
                            else:
                                # Check if any partitions are mounted
                                children = device.get('children', [])
                                mounted_children = [c for c in children if c.get('mountpoint')]
                                if mounted_children:
                                    mounts = ', '.join(c.get('mountpoint') for c in mounted_children)
                                    exclusion_reason = f'Has mounted partitions: {mounts}'
                                else:
                                    # Check if in use by ZFS
                                    zfs_check = self._ssh_exec(f'zpool status 2>/dev/null | grep -q "{name}"', job_id, log_command=False)
                                    if zfs_check['exit_code'] == 0:
                                        # Get the pool name for this disk
                                        pool_info = self._ssh_exec(f'zpool list -H -o name 2>/dev/null | head -1', job_id, log_command=False)
                                        pool_name = pool_info['stdout'].strip() if pool_info['exit_code'] == 0 and pool_info['stdout'].strip() else 'unknown'
                                        exclusion_reason = f'Already in use by ZFS pool: {pool_name}'
                                        reclaimable_pool = pool_name
                            
                            if exclusion_reason:
                                excluded_entry = {
                                    'device': f'/dev/{name}',
                                    'size': size,
                                    'reason': exclusion_reason
                                }
                                # Mark ZFS pools as reclaimable (can be destroyed and reused)
                                if 'reclaimable_pool' in dir() and reclaimable_pool:
                                    excluded_entry['reclaimable'] = True
                                    excluded_entry['pool_name'] = reclaimable_pool
                                    reclaimable_pool = None  # Reset for next disk
                                excluded_disks.append(excluded_entry)
                                self._log_console(job_id, 'DEBUG', f'Excluded disk {name}: {exclusion_reason}', job_details)
                            else:
                                detected_disks.append({
                                    'device': f'/dev/{name}',
                                    'size': size,
                                    'type': dtype
                                })
                    except json.JSONDecodeError:
                        pass
                
                # Fallback to plain text parsing
                if not detected_disks and not excluded_disks:
                    for line in output.split('\n'):
                        parts = line.split()
                        if len(parts) >= 3:
                            name, size, dtype = parts[0], parts[1], parts[2]
                            if dtype == 'disk':
                                if name in os_disk_names:
                                    excluded_disks.append({
                                        'device': f'/dev/{name}',
                                        'size': size,
                                        'reason': 'Primary OS disk (boot device)'
                                    })
                                else:
                                    detected_disks.append({
                                        'device': f'/dev/{name}',
                                        'size': size,
                                        'type': dtype
                                    })
            
            self._log_console(job_id, 'INFO', f'Found {len(detected_disks)} available disk(s), {len(excluded_disks)} excluded', job_details)
            
            job_details['detected_disks'] = detected_disks
            job_details['excluded_disks'] = excluded_disks
            self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(), details=job_details)
            
            return {'success': True, 'detected_disks': detected_disks}
            
        except Exception as e:
            self._log_console(job_id, 'ERROR', f'Disk detection failed: {e}', job_details)
            job_details['error'] = str(e)
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details=job_details)
            return {'success': False, 'error': str(e)}
        finally:
            self._cleanup()
    
    def execute_test_ssh_connection(self, job: Dict) -> Dict:
        """
        Test SSH connection to a target VM.
        
        Used by the OnboardZfsTargetWizard to verify SSH connectivity
        before starting the full onboarding process.
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        job_details = {
            'console_log': []
        }
        
        self._log_console(job_id, 'INFO', 'Testing SSH connection...', job_details)
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details=job_details)
        
        try:
            # Get connection details
            vm_ip = details.get('vm_ip')
            if not vm_ip:
                raise Exception('No vm_ip provided')
            
            auth_method = details.get('auth_method', 'password')
            ssh_key_id = details.get('ssh_key_id')
            root_password = details.get('root_password')
            
            # Connect via SSH
            self.ssh_client = paramiko.SSHClient()
            self.ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            if auth_method == 'existing_key' and ssh_key_id:
                # Use SSH key
                key_data = self._get_ssh_key(ssh_key_id)
                if not key_data:
                    raise Exception('SSH key not found')
                
                private_key = self._decrypt_ssh_key(key_data.get('private_key_encrypted'))
                if not private_key:
                    raise Exception('Failed to decrypt SSH key')
                
                key_file = io.StringIO(private_key)
                pkey = None
                for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                    try:
                        key_file.seek(0)
                        pkey = key_class.from_private_key(key_file)
                        break
                    except:
                        continue
                
                if not pkey:
                    raise Exception('Unsupported key format')
                
                self.ssh_client.connect(
                    hostname=vm_ip,
                    username='root',
                    pkey=pkey,
                    timeout=15,
                    allow_agent=False,
                    look_for_keys=False
                )
            else:
                # Use password
                if not root_password:
                    raise Exception('No password provided')
                
                self.ssh_client.connect(
                    hostname=vm_ip,
                    username='root',
                    password=root_password,
                    timeout=15,
                    allow_agent=False,
                    look_for_keys=False
                )
            
            self._log_console(job_id, 'INFO', f'SSH connected to {vm_ip}', job_details)
            
            # Run a simple command to verify
            result = self._ssh_exec('hostname', job_id)
            hostname = result['stdout'].strip() if result['exit_code'] == 0 else 'unknown'
            
            self._log_console(job_id, 'INFO', f'Remote hostname: {hostname}', job_details)
            
            job_details['hostname'] = hostname
            job_details['success'] = True
            self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(), details=job_details)
            
            return {'success': True, 'hostname': hostname}
            
        except paramiko.AuthenticationException as e:
            self._log_console(job_id, 'ERROR', f'SSH authentication failed: {e}', job_details)
            job_details['error'] = 'Authentication failed - check credentials'
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details=job_details)
            return {'success': False, 'error': 'Authentication failed'}
        except Exception as e:
            self._log_console(job_id, 'ERROR', f'SSH connection failed: {e}', job_details)
            job_details['error'] = str(e)
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details=job_details)
            return {'success': False, 'error': str(e)}
        finally:
            self._cleanup()
    
    def execute_retry_onboard_step(self, job: Dict) -> Dict:
        """
        Phase 7: Re-run onboarding from a specific failed step.
        
        Loads previous job state and continues from from_step.
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        job_details = {
            'console_log': [],
            'step_results': []
        }
        
        from_step = details.get('from_step', '')
        self._log_console(job_id, 'INFO', f'Retrying from step: {from_step}', job_details)
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details=job_details)
        
        try:
            # Get connection details
            vm_ip = details.get('vm_ip')
            if not vm_ip:
                raise Exception('No vm_ip provided')
            
            auth_method = details.get('auth_method', 'password')
            ssh_key_id = details.get('ssh_key_id')
            root_password = details.get('root_password')
            
            # Connect via SSH
            self.ssh_client = paramiko.SSHClient()
            self.ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            if auth_method == 'existing_key' and ssh_key_id:
                key_data = self._get_ssh_key(ssh_key_id)
                if not key_data:
                    raise Exception('SSH key not found')
                
                private_key = self._decrypt_ssh_key(key_data.get('private_key_encrypted'))
                if not private_key:
                    raise Exception('Failed to decrypt SSH key')
                
                key_file = io.StringIO(private_key)
                pkey = None
                for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                    try:
                        key_file.seek(0)
                        pkey = key_class.from_private_key(key_file)
                        break
                    except:
                        continue
                
                if not pkey:
                    raise Exception('Unsupported key format')
                
                self.ssh_client.connect(
                    hostname=vm_ip,
                    username='root',
                    pkey=pkey,
                    timeout=15,
                    allow_agent=False,
                    look_for_keys=False
                )
            else:
                if not root_password:
                    raise Exception('No password provided')
                
                self.ssh_client.connect(
                    hostname=vm_ip,
                    username='root',
                    password=root_password,
                    timeout=15,
                    allow_agent=False,
                    look_for_keys=False
                )
            
            self._log_console(job_id, 'INFO', f'SSH connected to {vm_ip}', job_details)
            
            # Execute the specific step
            step_success = False
            if from_step == 'zfs_packages':
                # Enable contrib repository first (Debian 13 deb822 format support)
                check_deb822 = self._ssh_exec('ls /etc/apt/sources.list.d/*.sources 2>/dev/null', job_id)
                if check_deb822['exit_code'] == 0 and check_deb822['stdout'].strip():
                    self._ssh_exec(r"sed -i 's/^Components: main$/Components: main contrib/' /etc/apt/sources.list.d/*.sources", job_id)
                else:
                    self._ssh_exec(r"sed -i 's/^\(deb.*main\)$/\1 contrib/' /etc/apt/sources.list", job_id)
                
                self._ssh_exec('apt-get update -qq', job_id)
                
                # Install kernel headers first
                kernel_result = self._ssh_exec('uname -r', job_id)
                if kernel_result['exit_code'] == 0:
                    kernel_version = kernel_result['stdout'].strip()
                    self._ssh_exec(f'DEBIAN_FRONTEND=noninteractive apt-get install -y dpkg-dev linux-headers-{kernel_version}', job_id)
                
                # Install ZFS packages (zfs-dkms + zfsutils-linux)
                result = self._ssh_exec('DEBIAN_FRONTEND=noninteractive apt-get install -y zfs-dkms zfsutils-linux', job_id)
                step_success = result['exit_code'] == 0
                
                if step_success:
                    # Load the module
                    self._ssh_exec('modprobe zfs', job_id)
                
                job_details['step_results'].append({
                    'step': 'zfs_packages',
                    'status': 'success' if step_success else 'failed',
                    'message': 'ZFS packages installed' if step_success else result['stderr'][:100]
                })
            elif from_step == 'nfs_packages':
                result = self._ssh_exec('DEBIAN_FRONTEND=noninteractive apt-get install -y nfs-kernel-server', job_id)
                step_success = result['exit_code'] == 0
                job_details['step_results'].append({
                    'step': 'nfs_packages',
                    'status': 'success' if step_success else 'failed',
                    'message': 'NFS packages installed' if step_success else result['stderr'][:100]
                })
            elif from_step == 'zfs_pool':
                pool_name = details.get('zfs_pool_name', 'tank')
                zfs_disk = details.get('zfs_disk') or self._detect_zfs_disk()
                if not zfs_disk:
                    raise Exception('No disk available for ZFS pool')
                compression = details.get('zfs_compression', 'lz4')
                
                # Create pool
                result = self._ssh_exec(f'zpool create -f {pool_name} {zfs_disk}', job_id)
                if result['exit_code'] != 0:
                    raise Exception(f'Failed to create ZFS pool: {result["stderr"]}')
                
                # Set compression
                self._ssh_exec(f'zfs set compression={compression} {pool_name}', job_id)
                step_success = True
                job_details['step_results'].append({
                    'step': 'zfs_pool',
                    'status': 'success',
                    'message': f'Pool {pool_name} created on {zfs_disk}'
                })
            elif from_step == 'nfs_export':
                pool_name = details.get('zfs_pool_name', 'tank')
                nfs_network = details.get('nfs_network', '10.0.0.0/8')
                
                # Configure NFS export
                export_line = f'/{pool_name} {nfs_network}(rw,sync,no_subtree_check,no_root_squash)'
                result = self._ssh_exec(f'echo "{export_line}" >> /etc/exports && exportfs -ra', job_id)
                step_success = result['exit_code'] == 0
                job_details['step_results'].append({
                    'step': 'nfs_export',
                    'status': 'success' if step_success else 'failed',
                    'message': f'NFS export configured for {nfs_network}' if step_success else result['stderr'][:100]
                })
            else:
                self._log_console(job_id, 'WARN', f'Unknown step to retry: {from_step}', job_details)
                step_success = False
            
            if step_success:
                self._log_console(job_id, 'INFO', f'Step {from_step} completed successfully', job_details)
                self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(), details=job_details)
                return {'success': True}
            else:
                raise Exception(f'Step {from_step} failed')
            
        except Exception as e:
            self._log_console(job_id, 'ERROR', f'Retry failed: {e}', job_details)
            job_details['error'] = str(e)
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details=job_details)
            return {'success': False, 'error': str(e)}
        finally:
            self._cleanup()
    
    def execute_rollback_zfs_onboard(self, job: Dict) -> Dict:
        """
        Phase 7: Clean up partially created ZFS target.
        
        Steps:
        1. Destroy ZFS pool (if exists)
        2. Remove NFS exports (if configured)
        3. Unregister datastore from vCenter (if registered)
        4. Delete replication_target record (if created)
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        job_details = {
            'console_log': [],
            'cleanup_results': []
        }
        
        self._log_console(job_id, 'INFO', 'Starting cleanup of partial ZFS configuration...', job_details)
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details=job_details)
        
        try:
            vm_ip = details.get('vm_ip')
            pool_name = details.get('zfs_pool_name', 'tank')
            target_name = details.get('target_name')
            datastore_name = details.get('datastore_name')
            
            ssh_connected = False
            
            # Try to connect via SSH for cleanup
            if vm_ip:
                try:
                    auth_method = details.get('auth_method', 'password')
                    ssh_key_id = details.get('ssh_key_id')
                    root_password = details.get('root_password')
                    
                    self.ssh_client = paramiko.SSHClient()
                    self.ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                    
                    if auth_method == 'existing_key' and ssh_key_id:
                        key_data = self._get_ssh_key(ssh_key_id)
                        if key_data:
                            private_key = self._decrypt_ssh_key(key_data.get('private_key_encrypted'))
                            if private_key:
                                key_file = io.StringIO(private_key)
                                pkey = None
                                for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                                    try:
                                        key_file.seek(0)
                                        pkey = key_class.from_private_key(key_file)
                                        break
                                    except:
                                        continue
                                
                                if pkey:
                                    self.ssh_client.connect(
                                        hostname=vm_ip,
                                        username='root',
                                        pkey=pkey,
                                        timeout=15,
                                        allow_agent=False,
                                        look_for_keys=False
                                    )
                                    ssh_connected = True
                    elif root_password:
                        self.ssh_client.connect(
                            hostname=vm_ip,
                            username='root',
                            password=root_password,
                            timeout=15,
                            allow_agent=False,
                            look_for_keys=False
                        )
                        ssh_connected = True
                    
                    if ssh_connected:
                        self._log_console(job_id, 'INFO', f'SSH connected to {vm_ip}', job_details)
                except Exception as ssh_err:
                    self._log_console(job_id, 'WARN', f'SSH connection failed: {ssh_err}', job_details)
            
            # Step 1: Remove NFS exports
            if ssh_connected:
                try:
                    # Remove export from /etc/exports
                    result = self._ssh_exec(f'sed -i "/{pool_name}/d" /etc/exports 2>/dev/null; exportfs -ra', job_id)
                    job_details['cleanup_results'].append({
                        'step': 'nfs_export',
                        'status': 'success' if result['exit_code'] == 0 else 'skipped',
                        'message': 'NFS exports cleaned'
                    })
                    self._log_console(job_id, 'INFO', 'NFS exports cleaned', job_details)
                except Exception as e:
                    self._log_console(job_id, 'WARN', f'Failed to clean NFS exports: {e}', job_details)
            
            # Step 2: Destroy ZFS pool
            if ssh_connected:
                try:
                    # Check if pool exists
                    check = self._ssh_exec(f'zpool list {pool_name} 2>/dev/null', job_id, log_command=False)
                    if check['exit_code'] == 0:
                        # Pool exists - destroy it
                        result = self._ssh_exec(f'zpool destroy -f {pool_name}', job_id)
                        job_details['cleanup_results'].append({
                            'step': 'zfs_pool',
                            'status': 'success' if result['exit_code'] == 0 else 'failed',
                            'message': f'Pool {pool_name} destroyed' if result['exit_code'] == 0 else result['stderr'][:50]
                        })
                        self._log_console(job_id, 'INFO', f'ZFS pool {pool_name} destroyed', job_details)
                    else:
                        job_details['cleanup_results'].append({
                            'step': 'zfs_pool',
                            'status': 'skipped',
                            'message': 'Pool does not exist'
                        })
                except Exception as e:
                    self._log_console(job_id, 'WARN', f'Failed to destroy ZFS pool: {e}', job_details)
            
            # Step 3: Delete replication_target record
            if target_name:
                try:
                    headers = {
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                    }
                    
                    response = requests.delete(
                        f'{DSM_URL}/rest/v1/replication_targets',
                        params={'name': f'eq.{target_name}'},
                        headers=headers,
                        verify=VERIFY_SSL,
                        timeout=10
                    )
                    
                    job_details['cleanup_results'].append({
                        'step': 'replication_target',
                        'status': 'success' if response.ok else 'skipped',
                        'message': 'Target record deleted' if response.ok else 'No record found'
                    })
                    self._log_console(job_id, 'INFO', 'Replication target record cleanup attempted', job_details)
                except Exception as e:
                    self._log_console(job_id, 'WARN', f'Failed to delete target record: {e}', job_details)
            
            # Note: Datastore unregistration would require vCenter connection
            # For safety, we skip automatic datastore removal - user should do this manually if needed
            if datastore_name:
                job_details['cleanup_results'].append({
                    'step': 'datastore',
                    'status': 'skipped',
                    'message': 'Manual removal required in vCenter'
                })
                self._log_console(job_id, 'INFO', f'Datastore {datastore_name} should be removed manually from vCenter if needed', job_details)
            
            self._log_console(job_id, 'INFO', 'Cleanup completed', job_details)
            self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(), details=job_details)
            return {'success': True, 'cleanup_results': job_details['cleanup_results']}
            
        except Exception as e:
            self._log_console(job_id, 'ERROR', f'Cleanup failed: {e}', job_details)
            job_details['error'] = str(e)
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details=job_details)
            return {'success': False, 'error': str(e)}
        finally:
            self._cleanup()
    
    def execute_decommission_zfs_target(self, job: Dict) -> Dict:
        """
        Full decommission of a ZFS replication target.
        
        Actions (from job.details.actions):
        - destroy_zfs_pool: SSH to appliance, export/destroy pool
        - remove_nfs_datastore: Remove NFS datastore from all vCenter hosts
        - power_off_vm: Power off the appliance VM
        - delete_vm: Delete the appliance VM from vCenter
        
        Then: Update database (clear partner, delete target record)
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        job_details = {
            'console_log': [],
            'decommission_results': [],
            'progress_percent': 0
        }
        
        def add_result(step: str, status: str, message: str):
            job_details['decommission_results'].append({
                'step': step,
                'status': status,
                'message': message
            })
            self._log_console(job_id, 'INFO' if status == 'success' else 'WARN', f'{step}: {message}', job_details)
        
        self._log_console(job_id, 'INFO', 'Starting ZFS target decommission...', job_details)
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details=job_details)
        
        try:
            # Extract parameters
            target_id = details.get('target_id')
            target_name = details.get('target_name', 'unknown')
            hostname = details.get('hostname')
            zfs_pool = details.get('zfs_pool', 'tank')
            dr_vcenter_id = details.get('dr_vcenter_id')
            deployed_vm_moref = details.get('deployed_vm_moref')
            actions = details.get('actions', [])
            
            self._log_console(job_id, 'INFO', f'Target: {target_name} ({target_id})', job_details)
            self._log_console(job_id, 'INFO', f'Actions to perform: {", ".join(actions)}', job_details)
            
            # ========== Phase 1: Pre-flight VM Check ==========
            job_details['progress_percent'] = 5
            self._log_console(job_id, 'INFO', 'Phase 1: Checking for VMs on datastore...', job_details)
            
            # Check for VMs on the target's datastore
            vms_on_datastore = self._check_vms_on_target_datastore(target_id)
            if vms_on_datastore:
                vm_names = [vm.get('name', 'Unknown') for vm in vms_on_datastore[:5]]
                error_msg = f"Cannot decommission: {len(vms_on_datastore)} VM(s) on datastore: {', '.join(vm_names)}"
                if len(vms_on_datastore) > 5:
                    error_msg += f" and {len(vms_on_datastore) - 5} more..."
                add_result('preflight_check', 'failed', error_msg)
                raise Exception(error_msg)
            
            add_result('preflight_check', 'success', 'No VMs found on target datastore')
            job_details['progress_percent'] = 10
            
            # ========== Phase 2: Destroy ZFS Pool (if selected) ==========
            if 'destroy_zfs_pool' in actions and hostname:
                job_details['progress_percent'] = 15
                self._log_console(job_id, 'INFO', f'Phase 2: Destroying ZFS pool on {hostname}...', job_details)
                
                ssh_connected = False
                try:
                    # Try to connect via SSH using target's stored credentials
                    target_info = self._fetch_replication_target(target_id)
                    if target_info:
                        ssh_key_id = target_info.get('ssh_key_id')
                        ssh_username = target_info.get('ssh_username', 'root')
                        
                        if ssh_key_id:
                            key_data = self._get_ssh_key(ssh_key_id)
                            if key_data:
                                private_key = self._decrypt_ssh_key(key_data.get('private_key_encrypted'))
                                if private_key:
                                    self.ssh_client = paramiko.SSHClient()
                                    self.ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                                    
                                    key_file = io.StringIO(private_key)
                                    pkey = None
                                    for key_class in [paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey]:
                                        try:
                                            key_file.seek(0)
                                            pkey = key_class.from_private_key(key_file)
                                            break
                                        except:
                                            continue
                                    
                                    if pkey:
                                        self.ssh_client.connect(
                                            hostname=hostname,
                                            username=ssh_username,
                                            pkey=pkey,
                                            timeout=15,
                                            allow_agent=False,
                                            look_for_keys=False
                                        )
                                        ssh_connected = True
                                        self._log_console(job_id, 'INFO', f'SSH connected to {hostname}', job_details)
                    
                    if ssh_connected:
                        # Export the pool first (safer than destroy)
                        export_result = self._ssh_exec(f'zpool export {zfs_pool} 2>&1', job_id)
                        if export_result['exit_code'] == 0:
                            add_result('destroy_zfs_pool', 'success', f'Pool {zfs_pool} exported successfully')
                        else:
                            # Pool might be busy or not exist - try force destroy
                            destroy_result = self._ssh_exec(f'zpool destroy -f {zfs_pool} 2>&1', job_id)
                            if destroy_result['exit_code'] == 0:
                                add_result('destroy_zfs_pool', 'success', f'Pool {zfs_pool} destroyed')
                            else:
                                # Pool might not exist
                                check_result = self._ssh_exec(f'zpool list {zfs_pool} 2>&1', job_id, log_command=False)
                                if check_result['exit_code'] != 0:
                                    add_result('destroy_zfs_pool', 'skipped', f'Pool {zfs_pool} does not exist')
                                else:
                                    add_result('destroy_zfs_pool', 'warning', f'Could not destroy pool: {destroy_result["stderr"][:100]}')
                    else:
                        add_result('destroy_zfs_pool', 'skipped', 'Could not establish SSH connection')
                        
                except Exception as ssh_err:
                    add_result('destroy_zfs_pool', 'warning', f'SSH operation failed: {str(ssh_err)[:100]}')
                finally:
                    if self.ssh_client:
                        try:
                            self.ssh_client.close()
                        except:
                            pass
                        self.ssh_client = None
            
            job_details['progress_percent'] = 30
            
            # ========== Phase 3: Remove NFS Datastore (if selected) ==========
            if 'remove_nfs_datastore' in actions and dr_vcenter_id:
                job_details['progress_percent'] = 35
                self._log_console(job_id, 'INFO', 'Phase 3: Removing NFS datastore from vCenter...', job_details)
                
                try:
                    vc_settings = self._get_vcenter_settings(dr_vcenter_id)
                    if vc_settings:
                        self.vcenter_conn = self._connect_vcenter(
                            vc_settings['host'],
                            vc_settings['username'],
                            vc_settings['password'],
                            vc_settings.get('port', 443),
                            vc_settings.get('verify_ssl', False)
                        )
                        
                        if self.vcenter_conn:
                            # Find the datastore by name (typically same as target name or NFS-targetname)
                            datastore_names = [target_name, f'NFS-{target_name}']
                            content = self.vcenter_conn.RetrieveContent()
                            
                            for ds in content.viewManager.CreateContainerView(
                                content.rootFolder, [vim.Datastore], True
                            ).view:
                                if ds.name in datastore_names:
                                    self._log_console(job_id, 'INFO', f'Found datastore: {ds.name}', job_details)
                                    
                                    # Unmount from all hosts
                                    unmount_count = 0
                                    for host in ds.host:
                                        try:
                                            host_system = host.key
                                            ds_system = host_system.configManager.datastoreSystem
                                            ds_system.RemoveDatastore(ds)
                                            unmount_count += 1
                                        except Exception as unmount_err:
                                            self._log_console(job_id, 'WARN', f'Failed to unmount from host: {unmount_err}', job_details)
                                    
                                    add_result('remove_nfs_datastore', 'success', f'Datastore {ds.name} removed from {unmount_count} host(s)')
                                    break
                            else:
                                add_result('remove_nfs_datastore', 'skipped', 'Datastore not found in vCenter')
                        else:
                            add_result('remove_nfs_datastore', 'warning', 'Could not connect to vCenter')
                    else:
                        add_result('remove_nfs_datastore', 'warning', 'vCenter settings not found')
                        
                except Exception as vc_err:
                    add_result('remove_nfs_datastore', 'warning', f'vCenter operation failed: {str(vc_err)[:100]}')
            
            job_details['progress_percent'] = 50
            
            # ========== Phase 4: Power Off VM (if selected) ==========
            if 'power_off_vm' in actions and deployed_vm_moref and dr_vcenter_id:
                job_details['progress_percent'] = 55
                self._log_console(job_id, 'INFO', f'Phase 4: Powering off VM {deployed_vm_moref}...', job_details)
                
                try:
                    if not self.vcenter_conn:
                        vc_settings = self._get_vcenter_settings(dr_vcenter_id)
                        if vc_settings:
                            self.vcenter_conn = self._connect_vcenter(
                                vc_settings['host'],
                                vc_settings['username'],
                                vc_settings['password'],
                                vc_settings.get('port', 443),
                                vc_settings.get('verify_ssl', False)
                            )
                    
                    if self.vcenter_conn:
                        vm = self._find_vm_by_moref(self.vcenter_conn, deployed_vm_moref)
                        if vm:
                            power_state = str(vm.runtime.powerState)
                            if power_state == 'poweredOn':
                                # Try graceful shutdown first
                                try:
                                    vm.ShutdownGuest()
                                    self._log_console(job_id, 'INFO', 'Initiated graceful shutdown, waiting...', job_details)
                                    
                                    # Wait up to 60 seconds for graceful shutdown
                                    for _ in range(12):
                                        time.sleep(5)
                                        if str(vm.runtime.powerState) == 'poweredOff':
                                            break
                                    
                                    if str(vm.runtime.powerState) != 'poweredOff':
                                        # Force power off
                                        task = vm.PowerOffVM_Task()
                                        self._wait_for_task(task)
                                        
                                except:
                                    # Guest tools not available, force power off
                                    task = vm.PowerOffVM_Task()
                                    self._wait_for_task(task)
                                
                                add_result('power_off_vm', 'success', f'VM {vm.name} powered off')
                            else:
                                add_result('power_off_vm', 'skipped', f'VM already {power_state}')
                        else:
                            add_result('power_off_vm', 'warning', f'VM not found: {deployed_vm_moref}')
                    else:
                        add_result('power_off_vm', 'warning', 'Could not connect to vCenter')
                        
                except Exception as vm_err:
                    add_result('power_off_vm', 'warning', f'Power off failed: {str(vm_err)[:100]}')
            
            job_details['progress_percent'] = 70
            
            # ========== Phase 5: Delete VM (if selected) ==========
            if 'delete_vm' in actions and deployed_vm_moref and dr_vcenter_id:
                job_details['progress_percent'] = 75
                self._log_console(job_id, 'INFO', f'Phase 5: Deleting VM {deployed_vm_moref}...', job_details)
                
                try:
                    if not self.vcenter_conn:
                        vc_settings = self._get_vcenter_settings(dr_vcenter_id)
                        if vc_settings:
                            self.vcenter_conn = self._connect_vcenter(
                                vc_settings['host'],
                                vc_settings['username'],
                                vc_settings['password'],
                                vc_settings.get('port', 443),
                                vc_settings.get('verify_ssl', False)
                            )
                    
                    if self.vcenter_conn:
                        vm = self._find_vm_by_moref(self.vcenter_conn, deployed_vm_moref)
                        if vm:
                            # Ensure VM is powered off
                            if str(vm.runtime.powerState) == 'poweredOn':
                                task = vm.PowerOffVM_Task()
                                self._wait_for_task_simple(task)
                            
                            # Delete VM from disk
                            vm_name = vm.name
                            task = vm.Destroy_Task()
                            self._wait_for_task_simple(task)
                            add_result('delete_vm', 'success', f'VM {vm_name} deleted')
                        else:
                            add_result('delete_vm', 'skipped', f'VM not found: {deployed_vm_moref}')
                    else:
                        add_result('delete_vm', 'warning', 'Could not connect to vCenter')
                        
                except Exception as del_err:
                    add_result('delete_vm', 'warning', f'VM deletion failed: {str(del_err)[:100]}')
            
            job_details['progress_percent'] = 85
            
            # ========== Phase 6: Database Cleanup ==========
            self._log_console(job_id, 'INFO', 'Phase 6: Cleaning up database records...', job_details)
            
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            }
            
            # Clear partner_target_id on any paired target
            try:
                resp = requests.patch(
                    f'{DSM_URL}/rest/v1/replication_targets',
                    params={'partner_target_id': f'eq.{target_id}'},
                    json={'partner_target_id': None},
                    headers=headers,
                    verify=VERIFY_SSL,
                    timeout=10
                )
                if resp.ok:
                    add_result('clear_partner', 'success', 'Partner reference cleared')
                else:
                    add_result('clear_partner', 'skipped', 'No partner found or already cleared')
            except Exception as e:
                add_result('clear_partner', 'warning', f'Failed to clear partner: {str(e)[:50]}')
            
            # Clear replication_target_id from vcenter_datastores
            try:
                resp = requests.patch(
                    f'{DSM_URL}/rest/v1/vcenter_datastores',
                    params={'replication_target_id': f'eq.{target_id}'},
                    json={'replication_target_id': None},
                    headers=headers,
                    verify=VERIFY_SSL,
                    timeout=10
                )
                if resp.ok:
                    add_result('clear_datastore_link', 'success', 'Datastore link cleared')
            except Exception as e:
                add_result('clear_datastore_link', 'warning', f'Failed to clear datastore link: {str(e)[:50]}')
            
            # Delete the replication_target record
            try:
                resp = requests.delete(
                    f'{DSM_URL}/rest/v1/replication_targets',
                    params={'id': f'eq.{target_id}'},
                    headers=headers,
                    verify=VERIFY_SSL,
                    timeout=10
                )
                if resp.ok:
                    add_result('delete_target', 'success', f'Target {target_name} deleted from database')
                else:
                    add_result('delete_target', 'warning', f'Delete response: {resp.status_code}')
            except Exception as e:
                add_result('delete_target', 'warning', f'Failed to delete target: {str(e)[:50]}')
            
            # ========== Complete ==========
            job_details['progress_percent'] = 100
            self._log_console(job_id, 'INFO', f'✓ ZFS target {target_name} decommissioned successfully', job_details)
            self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(), details=job_details)
            return {'success': True, 'results': job_details['decommission_results']}
            
        except Exception as e:
            self.log(f'Decommission failed: {e}', 'ERROR')
            job_details['error'] = str(e)
            self._log_console(job_id, 'ERROR', f'Decommission failed: {str(e)}', job_details)
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details=job_details)
            return {'success': False, 'error': str(e)}
        finally:
            self._cleanup()
    
    def _check_vms_on_target_datastore(self, target_id: str) -> list:
        """Check for VMs on the target's linked datastore using vcenter_datastore_vms table."""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            }
            
            # First get the datastore linked to this target
            ds_resp = requests.get(
                f'{DSM_URL}/rest/v1/vcenter_datastores',
                params={
                    'replication_target_id': f'eq.{target_id}',
                    'select': 'id,name'
                },
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if ds_resp.status_code != 200 or not ds_resp.json():
                return []  # No linked datastore
            
            datastore_id = ds_resp.json()[0]['id']
            
            # Now check for VMs on this datastore
            vm_resp = requests.get(
                f'{DSM_URL}/rest/v1/vcenter_datastore_vms',
                params={
                    'datastore_id': f'eq.{datastore_id}',
                    'select': 'id,vm_id,vcenter_vms(id,name,power_state)'
                },
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if vm_resp.status_code == 200:
                vms = vm_resp.json()
                # Flatten to just VM info
                return [
                    {'id': v.get('vm_id'), 'name': v.get('vcenter_vms', {}).get('name', 'Unknown')}
                    for v in vms if v.get('vcenter_vms')
                ]
            
            return []
        except Exception as e:
            self.log(f'Error checking VMs on datastore: {e}', 'WARN')
            return []
    
    def _fetch_replication_target(self, target_id: str) -> Optional[Dict]:
        """Fetch replication target info from database."""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            }
            
            resp = requests.get(
                f'{DSM_URL}/rest/v1/replication_targets',
                params={'id': f'eq.{target_id}', 'select': '*'},
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if resp.status_code == 200:
                data = resp.json()
                return data[0] if data else None
            return None
        except Exception as e:
            self.log(f'Failed to fetch replication target: {e}', 'WARN')
            return None
    
    # =========================================================================
    # Datastore Management Handler
    # =========================================================================
    
    def execute_manage_datastore(self, job: Dict):
        """
        Manage NFS datastore mounts on ESXi hosts.
        
        Supported operations (job.details.operation):
        - 'status': Return mount status per host (read-only)
        - 'mount_all': Mount datastore on all connected hosts
        - 'mount_hosts': Mount on specific hosts (details.host_names)
        - 'unmount_hosts': Unmount from specific hosts
        - 'unmount_all': Unmount from all hosts
        - 'refresh': Unmount and remount on all hosts
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        target_id = details.get('target_id')
        operation = details.get('operation', 'status')
        host_names = details.get('host_names', [])
        is_remediation = details.get('is_remediation', False)
        
        job_details = {
            'operation': operation,
            'target_id': target_id,
            'host_names': host_names,
            'is_remediation': is_remediation,
            'console_log': [],
            'results': {}
        }
        
        if is_remediation:
            self._log_console(job_id, 'INFO', f'🔧 Executing as remediation action: {operation}', job_details)
        else:
            self._log_console(job_id, 'INFO', f'Starting datastore management: {operation}', job_details)
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details=job_details)
        
        try:
            # Fetch target info
            target = self._fetch_replication_target(target_id)
            if not target:
                raise Exception(f'Replication target not found: {target_id}')
            
            job_details['target_name'] = target.get('name')
            job_details['hostname'] = target.get('hostname')
            
            # FIXED: Allow explicit overrides for datastore_name and vcenter_id from job params
            # This is critical for remediation jobs that need to target a specific vCenter
            override_datastore_name = details.get('datastore_name')
            override_vcenter_id = details.get('vcenter_id')
            
            # Get datastore info - use override if provided
            pool_name = target.get('zfs_pool', 'tank')
            datastore_name = override_datastore_name or target.get('datastore_name') or f"nfs-{target.get('name')}"
            nfs_path = target.get('nfs_export_path') or f'/{pool_name}/nfs'
            nfs_host = target.get('hostname')
            
            job_details['datastore_name'] = datastore_name
            job_details['nfs_path'] = nfs_path
            
            if override_datastore_name:
                self._log_console(job_id, 'INFO', f'Using override datastore: {datastore_name}', job_details)
            if override_vcenter_id:
                self._log_console(job_id, 'INFO', f'Using override vCenter ID: {override_vcenter_id}', job_details)
            
            self._log_console(job_id, 'INFO', f'Datastore: {datastore_name} @ {nfs_host}:{nfs_path}', job_details)
            
            # Connect to vCenter - use override if provided
            vcenter_id = override_vcenter_id or target.get('dr_vcenter_id')
            if not vcenter_id:
                raise Exception('No vCenter associated with this target (and no override provided)')
            
            vcenter = self._fetch_vcenter(vcenter_id)
            if not vcenter:
                raise Exception(f'vCenter not found: {vcenter_id}')
            
            self._log_console(job_id, 'INFO', f'Connecting to vCenter: {vcenter["host"]}', job_details)
            
            # Connect to vCenter
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            
            self.vcenter_conn = SmartConnect(
                host=vcenter['host'],
                user=vcenter['username'],
                pwd=vcenter['password'],
                port=vcenter.get('port', 443),
                sslContext=context
            )
            
            content = self.vcenter_conn.RetrieveContent()
            
            # Get all hosts
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.HostSystem], True
            )
            all_hosts = list(container.view)
            container.Destroy()
            
            self._log_console(job_id, 'INFO', f'Found {len(all_hosts)} ESXi hosts', job_details)
            
            # Filter hosts based on operation and host_names
            if operation in ['mount_hosts', 'unmount_hosts'] and host_names:
                target_hosts = [h for h in all_hosts if h.name in host_names]
            else:
                target_hosts = [h for h in all_hosts if h.runtime.connectionState == 'connected']
            
            job_details['target_host_count'] = len(target_hosts)
            
            results = {
                'datastore_name': datastore_name,
                'nfs_path': nfs_path,
                'hosts': [],
                'mounted_count': 0,
                'unmounted_count': 0,
                'failed_count': 0
            }
            
            if operation == 'status':
                # Just check status, don't modify anything
                for host in all_hosts:
                    try:
                        has_datastore = any(
                            ds.name == datastore_name 
                            for ds in host.datastore if ds
                        )
                        results['hosts'].append({
                            'host_name': host.name,
                            'cluster': host.parent.name if hasattr(host.parent, 'name') else None,
                            'connected': host.runtime.connectionState == 'connected',
                            'mounted': has_datastore
                        })
                        if has_datastore:
                            results['mounted_count'] += 1
                    except Exception as e:
                        results['hosts'].append({
                            'host_name': host.name,
                            'error': str(e)
                        })
                
                self._log_console(job_id, 'INFO', f'Status: {results["mounted_count"]}/{len(all_hosts)} hosts have datastore', job_details)
                
            elif operation in ['mount_all', 'mount_hosts']:
                # Mount datastore on target hosts
                for host in target_hosts:
                    try:
                        # Check if already mounted
                        has_datastore = any(
                            ds.name == datastore_name 
                            for ds in host.datastore if ds
                        )
                        
                        if has_datastore:
                            self._log_console(job_id, 'INFO', f'{host.name}: Already mounted', job_details)
                            results['hosts'].append({
                                'host_name': host.name,
                                'status': 'already_mounted'
                            })
                            results['mounted_count'] += 1
                        else:
                            # Mount NFS datastore
                            spec = vim.host.NasVolume.Specification()
                            spec.remoteHost = nfs_host
                            spec.remotePath = nfs_path
                            spec.localPath = datastore_name
                            spec.accessMode = 'readWrite'
                            spec.type = 'NFS'
                            
                            host.configManager.datastoreSystem.CreateNasDatastore(spec)
                            self._log_console(job_id, 'INFO', f'{host.name}: Mounted successfully', job_details)
                            results['hosts'].append({
                                'host_name': host.name,
                                'status': 'mounted'
                            })
                            results['mounted_count'] += 1
                    except vim.fault.DuplicateName:
                        self._log_console(job_id, 'INFO', f'{host.name}: Already exists', job_details)
                        results['hosts'].append({
                            'host_name': host.name,
                            'status': 'already_mounted'
                        })
                        results['mounted_count'] += 1
                    except Exception as e:
                        self._log_console(job_id, 'ERROR', f'{host.name}: Mount failed - {e}', job_details)
                        results['hosts'].append({
                            'host_name': host.name,
                            'status': 'failed',
                            'error': str(e)
                        })
                        results['failed_count'] += 1
                
                self._log_console(job_id, 'INFO', f'Mount complete: {results["mounted_count"]} succeeded, {results["failed_count"]} failed', job_details)
                
            elif operation in ['unmount_all', 'unmount_hosts']:
                # Unmount datastore from target hosts
                for host in target_hosts:
                    try:
                        # Find the datastore
                        ds_to_unmount = None
                        for ds in host.datastore:
                            if ds and ds.name == datastore_name:
                                ds_to_unmount = ds
                                break
                        
                        if not ds_to_unmount:
                            self._log_console(job_id, 'INFO', f'{host.name}: Not mounted', job_details)
                            results['hosts'].append({
                                'host_name': host.name,
                                'status': 'not_mounted'
                            })
                        else:
                            # Check for VMs using the datastore on this host
                            host.configManager.datastoreSystem.RemoveDatastore(ds_to_unmount)
                            self._log_console(job_id, 'INFO', f'{host.name}: Unmounted successfully', job_details)
                            results['hosts'].append({
                                'host_name': host.name,
                                'status': 'unmounted'
                            })
                            results['unmounted_count'] += 1
                    except Exception as e:
                        self._log_console(job_id, 'ERROR', f'{host.name}: Unmount failed - {e}', job_details)
                        results['hosts'].append({
                            'host_name': host.name,
                            'status': 'failed',
                            'error': str(e)
                        })
                        results['failed_count'] += 1
                
                self._log_console(job_id, 'INFO', f'Unmount complete: {results["unmounted_count"]} succeeded, {results["failed_count"]} failed', job_details)
                
            elif operation == 'refresh':
                # Unmount and remount on all hosts
                self._log_console(job_id, 'INFO', 'Refreshing datastore mounts...', job_details)
                
                for host in target_hosts:
                    try:
                        # Find and unmount
                        ds_to_unmount = None
                        for ds in host.datastore:
                            if ds and ds.name == datastore_name:
                                ds_to_unmount = ds
                                break
                        
                        if ds_to_unmount:
                            host.configManager.datastoreSystem.RemoveDatastore(ds_to_unmount)
                            self._log_console(job_id, 'INFO', f'{host.name}: Unmounted for refresh', job_details)
                        
                        # Remount
                        spec = vim.host.NasVolume.Specification()
                        spec.remoteHost = nfs_host
                        spec.remotePath = nfs_path
                        spec.localPath = datastore_name
                        spec.accessMode = 'readWrite'
                        spec.type = 'NFS'
                        
                        host.configManager.datastoreSystem.CreateNasDatastore(spec)
                        self._log_console(job_id, 'INFO', f'{host.name}: Remounted successfully', job_details)
                        results['hosts'].append({
                            'host_name': host.name,
                            'status': 'refreshed'
                        })
                        results['mounted_count'] += 1
                    except Exception as e:
                        self._log_console(job_id, 'ERROR', f'{host.name}: Refresh failed - {e}', job_details)
                        results['hosts'].append({
                            'host_name': host.name,
                            'status': 'failed',
                            'error': str(e)
                        })
                        results['failed_count'] += 1
                
                self._log_console(job_id, 'INFO', f'Refresh complete: {results["mounted_count"]} succeeded, {results["failed_count"]} failed', job_details)
            
            elif operation == 'rescan':
                # Rescan datastore to refresh vCenter's file listing
                self._log_console(job_id, 'INFO', 'Rescanning datastore to refresh vCenter file listing...', job_details)
                
                # Find the datastore object
                target_datastore = None
                for host in all_hosts:
                    if host.runtime.connectionState == 'connected':
                        for ds in host.datastore:
                            if ds and ds.name == datastore_name:
                                target_datastore = ds
                                break
                    if target_datastore:
                        break
                
                if not target_datastore:
                    raise Exception(f'Datastore {datastore_name} not found in vCenter')
                
                try:
                    # RefreshDatastoreStorageInfo refreshes the storage info which includes file listing
                    target_datastore.RefreshDatastoreStorageInfo()
                    self._log_console(job_id, 'INFO', f'Triggered storage info refresh on {datastore_name}', job_details)
                    
                    # Also refresh the datastore browser by calling Refresh on the datastore
                    try:
                        target_datastore.Refresh()
                        self._log_console(job_id, 'INFO', f'Refreshed datastore {datastore_name}', job_details)
                    except Exception as refresh_err:
                        self._log_console(job_id, 'WARN', f'Datastore.Refresh() not available: {refresh_err}', job_details)
                    
                    results['rescan_status'] = 'completed'
                    results['message'] = f'Datastore {datastore_name} rescanned successfully. vCenter file listing should now be up to date.'
                    
                except Exception as rescan_err:
                    self._log_console(job_id, 'ERROR', f'Rescan failed: {rescan_err}', job_details)
                    results['rescan_status'] = 'failed'
                    results['error'] = str(rescan_err)
                    results['failed_count'] = 1
            
            else:
                raise Exception(f'Unknown operation: {operation}')
            
            job_details['results'] = results
            
            # Determine job status
            if results['failed_count'] > 0 and results['mounted_count'] == 0:
                self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details=job_details)
            else:
                self._log_console(job_id, 'INFO', 'Datastore management completed', job_details)
                self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(), details=job_details)
                
        except Exception as e:
            self._log_console(job_id, 'ERROR', f'Failed: {str(e)}', job_details)
            job_details['error'] = str(e)
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details=job_details)
        finally:
            if self.vcenter_conn:
                try:
                    Disconnect(self.vcenter_conn)
                except:
                    pass
                self.vcenter_conn = None
    
    # =========================================================================
    # Scan Datastore Status Handler
    # =========================================================================
    
    def execute_scan_datastore_status(self, job: Dict):
        """
        Scan vCenter for datastore mount status and auto-detect linked datastores.
        
        This job:
        1. Connects to vCenter
        2. Finds NFS datastores where remoteHost matches target's hostname
        3. Returns per-host mount status
        4. Optionally links the datastore to the replication target
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        target_id = details.get('target_id')
        auto_detect = details.get('auto_detect', True)
        
        job_details = {
            'target_id': target_id,
            'auto_detect': auto_detect,
            'console_log': [],
            'results': {}
        }
        
        self._log_console(job_id, 'INFO', 'Starting datastore status scan', job_details)
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details=job_details)
        
        try:
            # Fetch target info
            target = self._fetch_replication_target(target_id)
            if not target:
                raise Exception(f'Replication target not found: {target_id}')
            
            job_details['target_name'] = target.get('name')
            job_details['hostname'] = target.get('hostname')
            
            target_hostname = target.get('hostname')
            target_name = target.get('name')
            existing_ds_name = target.get('datastore_name')
            
            # Connect to vCenter
            vcenter_id = target.get('dr_vcenter_id')
            if not vcenter_id:
                raise Exception('No vCenter associated with this target')
            
            vcenter = self._fetch_vcenter(vcenter_id)
            if not vcenter:
                raise Exception(f'vCenter not found: {vcenter_id}')
            
            self._log_console(job_id, 'INFO', f'Connecting to vCenter: {vcenter["host"]}', job_details)
            
            # Connect to vCenter
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            
            self.vcenter_conn = SmartConnect(
                host=vcenter['host'],
                user=vcenter['username'],
                pwd=vcenter['password'],
                port=vcenter.get('port', 443),
                sslContext=context
            )
            
            content = self.vcenter_conn.RetrieveContent()
            
            # Get all datastores
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.Datastore], True
            )
            all_datastores = list(container.view)
            container.Destroy()
            
            self._log_console(job_id, 'INFO', f'Found {len(all_datastores)} datastores', job_details)
            
            # Find matching NFS datastores
            detected_datastore = None
            detected_ds_name = None
            
            for ds in all_datastores:
                try:
                    # Check if this is an NFS datastore
                    if not hasattr(ds.info, 'nas') or not ds.info.nas:
                        continue
                    
                    nas_info = ds.info.nas
                    remote_host = nas_info.remoteHost
                    remote_path = nas_info.remotePath
                    ds_name = ds.name
                    
                    # Check if remote host matches our target
                    if remote_host == target_hostname:
                        self._log_console(job_id, 'INFO', f'Found matching NFS datastore: {ds_name} @ {remote_host}:{remote_path}', job_details)
                        detected_datastore = ds
                        detected_ds_name = ds_name
                        break
                    
                    # Also check by name pattern if no exact host match
                    if not detected_datastore:
                        name_patterns = [
                            f'nfs-{target_name}',
                            f'NFS-{target_name}',
                            target_name,
                        ]
                        if any(pattern.lower() == ds_name.lower() for pattern in name_patterns):
                            self._log_console(job_id, 'INFO', f'Found datastore by name pattern: {ds_name}', job_details)
                            detected_datastore = ds
                            detected_ds_name = ds_name
                            
                except Exception as e:
                    self.log(f'Error checking datastore {ds.name}: {e}', 'WARN')
                    continue
            
            results = {
                'detected': detected_datastore is not None,
                'datastore_name': detected_ds_name,
                'hosts': [],
                'mounted_count': 0,
                'total_hosts': 0
            }
            
            if detected_datastore:
                # Get mount status per host
                container = content.viewManager.CreateContainerView(
                    content.rootFolder, [vim.HostSystem], True
                )
                all_hosts = list(container.view)
                container.Destroy()
                
                results['total_hosts'] = len(all_hosts)
                
                for host in all_hosts:
                    try:
                        has_datastore = any(
                            ds.name == detected_ds_name 
                            for ds in host.datastore if ds
                        )
                        results['hosts'].append({
                            'host_name': host.name,
                            'cluster': host.parent.name if hasattr(host.parent, 'name') else None,
                            'connected': host.runtime.connectionState == 'connected',
                            'mounted': has_datastore
                        })
                        if has_datastore:
                            results['mounted_count'] += 1
                    except Exception as e:
                        results['hosts'].append({
                            'host_name': host.name,
                            'error': str(e)
                        })
                
                self._log_console(job_id, 'INFO', f'Mount status: {results["mounted_count"]}/{results["total_hosts"]} hosts', job_details)
                
                # Auto-link if requested and not already linked
                if auto_detect and detected_ds_name and not existing_ds_name:
                    try:
                        headers = {
                            'apikey': SERVICE_ROLE_KEY,
                            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                            'Content-Type': 'application/json',
                            'Prefer': 'return=minimal'
                        }
                        
                        # Update replication_targets.datastore_name
                        resp = requests.patch(
                            f'{DSM_URL}/rest/v1/replication_targets',
                            params={'id': f'eq.{target_id}'},
                            json={'datastore_name': detected_ds_name},
                            headers=headers,
                            verify=VERIFY_SSL,
                            timeout=10
                        )
                        
                        if resp.status_code in [200, 204]:
                            self._log_console(job_id, 'INFO', f'Linked datastore: {detected_ds_name} to target', job_details)
                            results['linked'] = True
                        else:
                            self._log_console(job_id, 'WARN', f'Failed to link datastore: {resp.status_code}', job_details)
                            
                        # Also try to link vcenter_datastores.replication_target_id
                        ds_resp = requests.patch(
                            f'{DSM_URL}/rest/v1/vcenter_datastores',
                            params={
                                'source_vcenter_id': f'eq.{vcenter_id}',
                                'name': f'eq.{detected_ds_name}'
                            },
                            json={'replication_target_id': target_id},
                            headers=headers,
                            verify=VERIFY_SSL,
                            timeout=10
                        )
                        
                        if ds_resp.status_code in [200, 204]:
                            self._log_console(job_id, 'INFO', f'Updated vcenter_datastores link', job_details)
                            
                    except Exception as e:
                        self._log_console(job_id, 'WARN', f'Failed to auto-link: {e}', job_details)
            else:
                self._log_console(job_id, 'WARN', f'No matching NFS datastore found for {target_hostname}', job_details)
            
            job_details['results'] = results
            self._log_console(job_id, 'INFO', 'Scan completed', job_details)
            self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(), details=job_details)
            
        except Exception as e:
            self._log_console(job_id, 'ERROR', f'Scan failed: {str(e)}', job_details)
            job_details['error'] = str(e)
            self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details=job_details)
        finally:
            if self.vcenter_conn:
                try:
                    Disconnect(self.vcenter_conn)
                except:
                    pass
                self.vcenter_conn = None
    
    def _fetch_vcenter(self, vcenter_id: str) -> Optional[Dict]:
        """Fetch vCenter info and decrypt password."""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            }
            
            resp = requests.get(
                f'{DSM_URL}/rest/v1/vcenters',
                params={'id': f'eq.{vcenter_id}', 'select': '*'},
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if resp.status_code != 200:
                return None
            
            data = resp.json()
            if not data:
                return None
            
            vcenter = data[0]
            
            # Decrypt password using executor's decrypt method
            if vcenter.get('password_encrypted'):
                password = self.executor.decrypt_password(vcenter['password_encrypted'])
                if password:
                    vcenter['password'] = password
            
            return vcenter
        except Exception as e:
            self.log(f'Failed to fetch vCenter: {e}', 'WARN')
            return None
