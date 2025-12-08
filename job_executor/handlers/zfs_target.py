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
from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
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
                # Step 10: Check/add contrib to APT sources (Debian 13)
                step_results.append({'step': 'apt_sources', 'status': 'running', 'message': 'Checking APT sources...'})
                self.update_job_status(job_id, 'running', details=job_details)
                
                result = self._ssh_exec('grep -E "^deb.*contrib" /etc/apt/sources.list /etc/apt/sources.list.d/*.list 2>/dev/null | head -1')
                if result['exit_code'] != 0 or not result['stdout'].strip():
                    # Add contrib to sources
                    self._log_console(job_id, 'INFO', 'Adding contrib to APT sources', job_details)
                    self._ssh_exec('sed -i "s/main$/main contrib/" /etc/apt/sources.list')
                    step_results[-1] = {'step': 'apt_sources', 'status': 'fixed', 'message': 'Added contrib repository'}
                else:
                    step_results[-1] = {'step': 'apt_sources', 'status': 'success', 'message': 'contrib already enabled'}
                
                job_details['progress_percent'] = 45
                self.update_job_status(job_id, 'running', details=job_details)
                
                # Step 11: Install ZFS packages
                step_results.append({'step': 'zfs_packages', 'status': 'running', 'message': 'Installing ZFS packages...'})
                self.update_job_status(job_id, 'running', details=job_details)
                
                # Check if already installed
                result = self._ssh_exec('dpkg -l zfsutils-linux 2>/dev/null | grep -q "^ii"')
                if result['exit_code'] != 0:
                    self._log_console(job_id, 'INFO', 'Installing zfs-dkms and zfsutils-linux...', job_details)
                    result = self._ssh_exec('DEBIAN_FRONTEND=noninteractive apt-get update && apt-get install -y zfs-dkms zfsutils-linux')
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
        zfs_disk_gb = details.get('zfs_disk_gb', 500)
        network_name = details.get('network_name')
        cluster_name = details.get('cluster_name') or details.get('default_cluster')
        
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
        share_opts = f'rw,no_root_squash,async'
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
            'zfs_dataset_prefix': 'nfs',
            'ssh_username': ssh_username,
            'ssh_key_id': ssh_key_id,
            'dr_vcenter_id': vcenter_id,
            'health_status': 'healthy',
            'is_active': True,
            'source_template_id': template_id,
            'deployed_job_id': job_id,
            'deployed_vm_moref': vm_moref,
            'deployed_ip_source': 'dhcp' if use_dhcp else 'static'
        }
        
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
    
    def _ssh_exec(self, command: str) -> Dict:
        """Execute SSH command and return result."""
        if not self.ssh_client:
            raise Exception("SSH client not connected")
        
        stdin, stdout, stderr = self.ssh_client.exec_command(command, timeout=60)
        exit_code = stdout.channel.recv_exit_status()
        
        return {
            'stdout': stdout.read().decode('utf-8', errors='replace'),
            'stderr': stderr.read().decode('utf-8', errors='replace'),
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
