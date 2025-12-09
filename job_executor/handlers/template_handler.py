"""
Template Preparation and Cloning Handler

Handles:
- prepare_zfs_template: Configure a VM as a baseline ZFS appliance template
- clone_zfs_template: Clone a template with guest customization
"""

import io
import ssl
import time
from typing import Dict, Optional, Any
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


class TemplateHandler(BaseHandler):
    """
    Handler for template preparation and cloning operations.
    """
    
    def __init__(self, executor):
        super().__init__(executor)
        self.vcenter_conn = None
        self.ssh_client = None
    
    def execute_prepare_zfs_template(self, job: Dict):
        """
        Prepare a VM as a ZFS appliance template.
        
        Steps:
        1. Connect to vCenter
        2. SSH to VM
        3. Install packages (ZFS, NFS, open-vm-tools)
        4. Create service user with SSH key
        5. Clean system IDs (machine-id, SSH host keys)
        6. Power off and optionally convert to template
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        target_scope = job.get('target_scope', {}) or {}
        
        job_details = {
            'step_results': [],
            'console_log': [],
            'progress_percent': 0
        }
        
        self._log_console(job_id, 'INFO', 'Starting ZFS template preparation', job_details)
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details=job_details)
        
        try:
            # Get VM info
            vcenter_id = target_scope.get('vcenter_id')
            vm_id = target_scope.get('vm_id')
            
            if not vcenter_id or not vm_id:
                raise Exception('Missing vcenter_id or vm_id in target_scope')
            
            # Fetch VM details
            vm_info = self._fetch_vm_by_id(vm_id)
            if not vm_info:
                raise Exception(f'VM not found: {vm_id}')
            
            vm_ip = vm_info.get('ip_address')
            if not vm_ip:
                raise Exception('VM has no IP address - cannot SSH')
            
            root_password = details.get('root_password')
            if not root_password:
                raise Exception('Root password is required for template preparation')
            
            # Step 1: Connect to VM via SSH
            self._add_step_result(job_id, job_details, 'ssh_connect', 'running', 'Connecting via SSH...')
            self._update_progress(job_id, job_details, 10)
            
            ssh_client = self._connect_ssh_password(vm_ip, 'root', root_password)
            if not ssh_client:
                self._add_step_result(job_id, job_details, 'ssh_connect', 'failed', 'SSH connection failed')
                raise Exception('Failed to connect via SSH')
            
            self._add_step_result(job_id, job_details, 'ssh_connect', 'success', f'Connected to {vm_ip}')
            self.ssh_client = ssh_client
            
            # Step 2: Install packages
            if details.get('install_packages', True):
                packages = details.get('packages', ['zfsutils-linux', 'nfs-kernel-server', 'open-vm-tools'])
                self._add_step_result(job_id, job_details, 'install_packages', 'running', f'Installing {len(packages)} packages...')
                self._update_progress(job_id, job_details, 20)
                
                # Update apt sources
                self._log_console(job_id, 'INFO', 'Updating apt sources...', job_details)
                self._exec_ssh(ssh_client, 'apt-get update -y')
                
                # Install each package
                for pkg in packages:
                    self._log_console(job_id, 'INFO', f'Installing {pkg}...', job_details)
                    result = self._exec_ssh(ssh_client, f'DEBIAN_FRONTEND=noninteractive apt-get install -y {pkg}')
                    if result['exit_code'] != 0:
                        self._log_console(job_id, 'WARN', f'Package {pkg} may have had issues: {result["stderr"]}', job_details)
                
                self._add_step_result(job_id, job_details, 'install_packages', 'success', f'Installed {len(packages)} packages')
                self._update_progress(job_id, job_details, 40)
            
            # Step 3: Create service user
            if details.get('create_user', True):
                username = details.get('username', 'zfsadmin')
                self._add_step_result(job_id, job_details, 'create_user', 'running', f'Creating user {username}...')
                
                # Create user with home directory
                self._exec_ssh(ssh_client, f'useradd -m -s /bin/bash {username} || true')
                
                # Add to sudo group
                self._exec_ssh(ssh_client, f'usermod -aG sudo {username}')
                
                # Allow passwordless sudo for ZFS commands
                sudo_line = f'{username} ALL=(ALL) NOPASSWD: /sbin/zpool, /sbin/zfs, /bin/systemctl, /usr/sbin/exportfs'
                self._exec_ssh(ssh_client, f'echo "{sudo_line}" > /etc/sudoers.d/{username}')
                self._exec_ssh(ssh_client, f'chmod 440 /etc/sudoers.d/{username}')
                
                self._add_step_result(job_id, job_details, 'create_user', 'success', f'Created user {username} with sudo access')
                self._update_progress(job_id, job_details, 50)
            
            # Step 4: Deploy SSH key
            ssh_key_id = details.get('ssh_key_id')
            if ssh_key_id:
                self._add_step_result(job_id, job_details, 'deploy_key', 'running', 'Deploying SSH key...')
                
                key_data = self._get_ssh_key(ssh_key_id)
                if key_data and key_data.get('public_key'):
                    public_key = key_data['public_key']
                    username = details.get('username', 'zfsadmin')
                    
                    # Create .ssh directory
                    self._exec_ssh(ssh_client, f'mkdir -p /home/{username}/.ssh')
                    self._exec_ssh(ssh_client, f'chmod 700 /home/{username}/.ssh')
                    
                    # Add public key
                    self._exec_ssh(ssh_client, f'echo "{public_key}" >> /home/{username}/.ssh/authorized_keys')
                    self._exec_ssh(ssh_client, f'chmod 600 /home/{username}/.ssh/authorized_keys')
                    self._exec_ssh(ssh_client, f'chown -R {username}:{username} /home/{username}/.ssh')
                    
                    # Also add to root for initial setup
                    self._exec_ssh(ssh_client, 'mkdir -p /root/.ssh')
                    self._exec_ssh(ssh_client, f'echo "{public_key}" >> /root/.ssh/authorized_keys')
                    self._exec_ssh(ssh_client, 'chmod 600 /root/.ssh/authorized_keys')
                    
                    self._add_step_result(job_id, job_details, 'deploy_key', 'success', 'SSH key deployed')
                else:
                    self._add_step_result(job_id, job_details, 'deploy_key', 'warning', 'SSH key not found')
                
                self._update_progress(job_id, job_details, 60)
            
            # Step 5: Clean system for templating
            cleanup = details.get('cleanup', {})
            
            if cleanup.get('clear_machine_id', True):
                self._add_step_result(job_id, job_details, 'clean_machine_id', 'running', 'Clearing machine-id...')
                self._exec_ssh(ssh_client, 'truncate -s 0 /etc/machine-id')
                self._exec_ssh(ssh_client, 'rm -f /var/lib/dbus/machine-id')
                self._add_step_result(job_id, job_details, 'clean_machine_id', 'success', 'machine-id cleared')
            
            if cleanup.get('clear_ssh_host_keys', True):
                self._add_step_result(job_id, job_details, 'clean_ssh_keys', 'running', 'Clearing SSH host keys...')
                self._exec_ssh(ssh_client, 'rm -f /etc/ssh/ssh_host_*')
                # Configure to regenerate on boot
                self._exec_ssh(ssh_client, 'dpkg-reconfigure openssh-server || true')
                self._add_step_result(job_id, job_details, 'clean_ssh_keys', 'success', 'SSH host keys cleared')
            
            if cleanup.get('clean_cloud_init', True):
                self._add_step_result(job_id, job_details, 'clean_cloud_init', 'running', 'Cleaning cloud-init...')
                self._exec_ssh(ssh_client, 'cloud-init clean --logs || true')
                self._exec_ssh(ssh_client, 'rm -rf /var/lib/cloud/* || true')
                self._add_step_result(job_id, job_details, 'clean_cloud_init', 'success', 'cloud-init cleaned')
            
            self._update_progress(job_id, job_details, 75)
            
            # Close SSH before power operations
            ssh_client.close()
            self.ssh_client = None
            
            # Step 6: Power off and convert to template
            if details.get('power_off_first', True) or details.get('convert_to_template', True):
                # Connect to vCenter
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
                    raise Exception('Failed to connect to vCenter')
                
                vm_moref = vm_info.get('vcenter_id') or details.get('vm_moref')
                vm_obj = self._find_vm_by_moref(self.vcenter_conn, vm_moref)
                
                if not vm_obj:
                    raise Exception(f'VM not found in vCenter: {vm_moref}')
                
                # Power off
                if details.get('power_off_first', True):
                    self._add_step_result(job_id, job_details, 'power_off', 'running', 'Powering off VM...')
                    if str(vm_obj.runtime.powerState) == 'poweredOn':
                        task = vm_obj.ShutdownGuest()
                        # Wait for graceful shutdown
                        time.sleep(30)
                        # Force if still on
                        if str(vm_obj.runtime.powerState) == 'poweredOn':
                            task = vm_obj.PowerOff()
                            self._wait_for_task(task)
                    self._add_step_result(job_id, job_details, 'power_off', 'success', 'VM powered off')
                    self._update_progress(job_id, job_details, 85)
                
                # Convert to template
                if details.get('convert_to_template', True):
                    self._add_step_result(job_id, job_details, 'convert_template', 'running', 'Converting to template...')
                    vm_obj.MarkAsTemplate()
                    self._add_step_result(job_id, job_details, 'convert_template', 'success', 'Converted to VMware template')
                    self._update_progress(job_id, job_details, 95)
                
                # Disconnect from vCenter
                Disconnect(self.vcenter_conn)
                self.vcenter_conn = None
            
            # Complete
            self._update_progress(job_id, job_details, 100)
            self._log_console(job_id, 'INFO', 'Template preparation complete', job_details)
            
            self.update_job_status(
                job_id, 
                'completed', 
                completed_at=utc_now_iso(),
                details=job_details
            )
            
        except Exception as e:
            self.log(f'Template preparation failed: {e}', 'ERROR')
            self._log_console(job_id, 'ERROR', str(e), job_details)
            
            # Cleanup
            if self.ssh_client:
                try:
                    self.ssh_client.close()
                except:
                    pass
            if self.vcenter_conn:
                try:
                    Disconnect(self.vcenter_conn)
                except:
                    pass
            
            self.update_job_status(
                job_id,
                'failed',
                completed_at=utc_now_iso(),
                details={**job_details, 'error': str(e)}
            )
    
    def execute_clone_zfs_template(self, job: Dict):
        """
        Clone a ZFS template with guest customization.
        
        Steps:
        1. Connect to vCenter
        2. Clone template to new VM
        3. Apply guest customization (hostname, optional static IP)
        4. Power on cloned VM
        5. Wait for IP address
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        target_scope = job.get('target_scope', {}) or {}
        
        job_details = {
            'step_results': [],
            'console_log': [],
            'progress_percent': 0,
            'cloned_vm_moref': None,
            'cloned_vm_ip': None
        }
        
        self._log_console(job_id, 'INFO', 'Starting template cloning', job_details)
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details=job_details)
        
        try:
            vcenter_id = target_scope.get('vcenter_id')
            clone_config = details.get('clone_config', {})
            
            if not vcenter_id:
                raise Exception('Missing vcenter_id')
            
            source_moref = clone_config.get('source_vm_moref')
            clone_name = clone_config.get('clone_name')
            target_datastore = clone_config.get('target_datastore')
            target_cluster = clone_config.get('target_cluster')
            
            if not source_moref or not clone_name:
                raise Exception('Missing source_vm_moref or clone_name in clone_config')
            
            # Connect to vCenter
            self._add_step_result(job_id, job_details, 'vcenter_connect', 'running', 'Connecting to vCenter...')
            
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
                raise Exception('Failed to connect to vCenter')
            
            self._add_step_result(job_id, job_details, 'vcenter_connect', 'success', f'Connected to {vc_settings["host"]}')
            self._update_progress(job_id, job_details, 10)
            
            # Find template
            self._add_step_result(job_id, job_details, 'find_template', 'running', 'Locating template...')
            template_vm = self._find_vm_by_moref(self.vcenter_conn, source_moref)
            if not template_vm:
                raise Exception(f'Template not found: {source_moref}')
            
            self._add_step_result(job_id, job_details, 'find_template', 'success', f'Found template: {template_vm.name}')
            self._update_progress(job_id, job_details, 20)
            
            # Get target resources
            content = self.vcenter_conn.RetrieveContent()
            
            # Find datastore
            datastore_obj = None
            if target_datastore:
                for dc in content.rootFolder.childEntity:
                    if hasattr(dc, 'datastore'):
                        for ds in dc.datastore:
                            if ds.name == target_datastore:
                                datastore_obj = ds
                                break
            
            # Find resource pool
            resource_pool = None
            if target_cluster:
                for dc in content.rootFolder.childEntity:
                    if hasattr(dc, 'hostFolder'):
                        for cluster in dc.hostFolder.childEntity:
                            if hasattr(cluster, 'name') and cluster.name == target_cluster:
                                if hasattr(cluster, 'resourcePool'):
                                    resource_pool = cluster.resourcePool
                                    break
            
            # Build clone spec
            self._add_step_result(job_id, job_details, 'clone', 'running', f'Cloning to {clone_name}...')
            self._update_progress(job_id, job_details, 30)
            
            relocate_spec = vim.vm.RelocateSpec()
            if datastore_obj:
                relocate_spec.datastore = datastore_obj
            if resource_pool:
                relocate_spec.pool = resource_pool
            
            clone_spec = vim.vm.CloneSpec()
            clone_spec.location = relocate_spec
            clone_spec.powerOn = False
            clone_spec.template = False
            
            # Apply guest customization if configured
            guest_customization = clone_config.get('guest_customization', {})
            if guest_customization:
                hostname = guest_customization.get('hostname', clone_name)
                
                # Build customization spec
                ident = vim.vm.customization.LinuxPrep()
                ident.hostName = vim.vm.customization.FixedName(name=hostname.replace('_', '-')[:63])
                ident.domain = "local"
                
                custom_spec = vim.vm.customization.Specification()
                custom_spec.identity = ident
                custom_spec.globalIPSettings = vim.vm.customization.GlobalIPSettings()
                
                static_ip = guest_customization.get('static_ip')
                if static_ip:
                    ip_settings = vim.vm.customization.IPSettings()
                    ip_settings.ip = vim.vm.customization.FixedIp(ipAddress=static_ip['ip'])
                    ip_settings.subnetMask = static_ip.get('netmask', '255.255.255.0')
                    if static_ip.get('gateway'):
                        ip_settings.gateway = [static_ip['gateway']]
                    
                    adapter = vim.vm.customization.AdapterMapping()
                    adapter.adapter = ip_settings
                    custom_spec.nicSettingMap = [adapter]
                else:
                    # DHCP
                    adapter = vim.vm.customization.AdapterMapping()
                    adapter.adapter = vim.vm.customization.IPSettings()
                    adapter.adapter.ip = vim.vm.customization.DhcpIpGenerator()
                    custom_spec.nicSettingMap = [adapter]
                
                clone_spec.customization = custom_spec
                self._log_console(job_id, 'INFO', f'Guest customization: hostname={hostname}', job_details)
            
            # Execute clone
            folder = template_vm.parent
            task = template_vm.Clone(folder=folder, name=clone_name, spec=clone_spec)
            cloned_vm = self._wait_for_task(task)
            
            if not cloned_vm:
                raise Exception('Clone task completed but no VM returned')
            
            cloned_moref = cloned_vm._moId
            job_details['cloned_vm_moref'] = cloned_moref
            
            self._add_step_result(job_id, job_details, 'clone', 'success', f'Cloned to {clone_name}')
            self._update_progress(job_id, job_details, 60)
            
            # Power on
            self._add_step_result(job_id, job_details, 'power_on', 'running', 'Powering on cloned VM...')
            task = cloned_vm.PowerOn()
            self._wait_for_task(task)
            
            self._add_step_result(job_id, job_details, 'power_on', 'success', 'VM powered on')
            self._update_progress(job_id, job_details, 70)
            
            # Wait for VMware Tools and IP
            self._add_step_result(job_id, job_details, 'wait_ip', 'running', 'Waiting for IP address...')
            
            vm_ip = None
            for attempt in range(60):  # 5 minutes
                time.sleep(5)
                
                # Refresh VM object
                cloned_vm = self._find_vm_by_moref(self.vcenter_conn, cloned_moref)
                if cloned_vm and cloned_vm.guest:
                    ip = cloned_vm.guest.ipAddress
                    if ip and not ip.startswith('169.254') and not ip.startswith('127.'):
                        vm_ip = ip
                        break
                
                if attempt % 6 == 0:
                    self._log_console(job_id, 'INFO', f'Waiting for IP... ({attempt * 5}s)', job_details)
            
            if not vm_ip:
                self._add_step_result(job_id, job_details, 'wait_ip', 'warning', 'No IP detected after 5 minutes')
            else:
                job_details['cloned_vm_ip'] = vm_ip
                self._add_step_result(job_id, job_details, 'wait_ip', 'success', f'IP: {vm_ip}')
            
            self._update_progress(job_id, job_details, 100)
            
            # Cleanup
            Disconnect(self.vcenter_conn)
            self.vcenter_conn = None
            
            self._log_console(job_id, 'INFO', 'Template cloning complete', job_details)
            
            self.update_job_status(
                job_id,
                'completed',
                completed_at=utc_now_iso(),
                details=job_details
            )
            
        except Exception as e:
            self.log(f'Template cloning failed: {e}', 'ERROR')
            self._log_console(job_id, 'ERROR', str(e), job_details)
            
            if self.vcenter_conn:
                try:
                    Disconnect(self.vcenter_conn)
                except:
                    pass
            
            self.update_job_status(
                job_id,
                'failed',
                completed_at=utc_now_iso(),
                details={**job_details, 'error': str(e)}
            )
    
    # Helper methods
    def _log_console(self, job_id: str, level: str, message: str, job_details: Dict):
        """Add message to console log"""
        timestamp = datetime.now(timezone.utc).strftime('%H:%M:%S')
        job_details['console_log'].append(f'[{timestamp}] {level}: {message}')
        self.log(message, level)
    
    def _add_step_result(self, job_id: str, job_details: Dict, step: str, status: str, message: str):
        """Add or update step result"""
        existing = next((r for r in job_details['step_results'] if r['step'] == step), None)
        if existing:
            existing['status'] = status
            existing['message'] = message
        else:
            job_details['step_results'].append({
                'step': step,
                'status': status,
                'message': message
            })
        self.update_job_status(job_id, 'running', details=job_details)
    
    def _update_progress(self, job_id: str, job_details: Dict, percent: int):
        """Update progress percentage"""
        job_details['progress_percent'] = percent
        self.update_job_status(job_id, 'running', details=job_details)
    
    def _connect_ssh_password(self, host: str, username: str, password: str) -> Optional[Any]:
        """Connect to SSH using password"""
        if not PARAMIKO_AVAILABLE:
            raise Exception('Paramiko not available')
        
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(
                hostname=host,
                username=username,
                password=password,
                timeout=30,
                allow_agent=False,
                look_for_keys=False
            )
            return client
        except Exception as e:
            self.log(f'SSH connection failed: {e}', 'ERROR')
            return None
    
    def _exec_ssh(self, client: Any, command: str) -> Dict:
        """Execute SSH command and return result"""
        try:
            stdin, stdout, stderr = client.exec_command(command, timeout=300)
            exit_code = stdout.channel.recv_exit_status()
            return {
                'stdout': stdout.read().decode('utf-8', errors='replace'),
                'stderr': stderr.read().decode('utf-8', errors='replace'),
                'exit_code': exit_code
            }
        except Exception as e:
            return {
                'stdout': '',
                'stderr': str(e),
                'exit_code': -1
            }
    
    def _fetch_vm_by_id(self, vm_id: str) -> Optional[Dict]:
        """Fetch VM details from database"""
        try:
            response = requests.get(
                f'{DSM_URL}/rest/v1/vcenter_vms?id=eq.{vm_id}&select=*',
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL
            )
            if response.status_code == 200:
                data = response.json()
                return data[0] if data else None
            return None
        except Exception as e:
            self.log(f'Failed to fetch VM: {e}', 'ERROR')
            return None
    
    def _get_vcenter_settings(self, vcenter_id: str) -> Optional[Dict]:
        """Get vCenter connection settings"""
        try:
            response = requests.get(
                f'{DSM_URL}/rest/v1/vcenters?id=eq.{vcenter_id}&select=*',
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL
            )
            if response.status_code == 200:
                data = response.json()
                if data:
                    vc = data[0]
                    # Decrypt password
                    if vc.get('password_encrypted'):
                        vc['password'] = self._decrypt_password(vc['password_encrypted'])
                    return vc
            return None
        except Exception as e:
            self.log(f'Failed to get vCenter settings: {e}', 'ERROR')
            return None
    
    def _decrypt_password(self, encrypted: str) -> str:
        """Decrypt password using Fernet"""
        try:
            from job_executor.config import get_encryption_key
            from cryptography.fernet import Fernet
            key = get_encryption_key()
            if key:
                f = Fernet(key.encode() if isinstance(key, str) else key)
                return f.decrypt(encrypted.encode()).decode()
            return encrypted
        except Exception:
            return encrypted
    
    def _get_ssh_key(self, key_id: str) -> Optional[Dict]:
        """Get SSH key from database"""
        try:
            response = requests.get(
                f'{DSM_URL}/rest/v1/ssh_keys?id=eq.{key_id}&select=*',
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL
            )
            if response.status_code == 200:
                data = response.json()
                return data[0] if data else None
            return None
        except Exception:
            return None
    
    def _connect_vcenter(self, host: str, username: str, password: str, 
                         port: int = 443, verify_ssl: bool = False) -> Optional[Any]:
        """Connect to vCenter"""
        try:
            ssl_context = None
            if not verify_ssl:
                ssl_context = ssl.create_default_context()
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
            self.log(f'vCenter connection failed: {e}', 'ERROR')
            return None
    
    def _find_vm_by_moref(self, si: Any, moref: str) -> Optional[Any]:
        """Find VM by MoRef ID"""
        try:
            content = si.RetrieveContent()
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.VirtualMachine], True
            )
            
            for vm in container.view:
                if vm._moId == moref:
                    container.Destroy()
                    return vm
            
            container.Destroy()
            return None
        except Exception as e:
            self.log(f'Failed to find VM by moref: {e}', 'ERROR')
            return None
    
    def _wait_for_task(self, task: Any, timeout: int = 600) -> Any:
        """Wait for vCenter task to complete"""
        start_time = time.time()
        while time.time() - start_time < timeout:
            if task.info.state == vim.TaskInfo.State.success:
                return task.info.result
            elif task.info.state == vim.TaskInfo.State.error:
                raise Exception(f'Task failed: {task.info.error}')
            time.sleep(2)
        raise Exception('Task timeout')
