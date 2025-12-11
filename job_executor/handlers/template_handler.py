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
        Prepare a VM as a ZFS appliance template with enhanced features.
        
        Steps:
        1. Connect to vCenter (optional: create rollback snapshot)
        2. SSH to VM
        3. Pre-flight checks (disk space, repo access, kernel headers)
        4. Detect OS family (Debian/RHEL)
        5. Install packages (ZFS, NFS, open-vm-tools) with proper repo setup
        6. Apply ZFS tuning configuration
        7. Create service user with SSH key
        8. Install health check script
        9. Clean system IDs and network state
        10. Stamp template version
        11. Power off and optionally convert to template
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        target_scope = job.get('target_scope', {}) or {}
        
        job_details = {
            'step_results': [],
            'console_log': [],
            'progress_percent': 0,
            'preflight_checks': [],
            'os_family': None,
            'template_version': details.get('template_version', '1.0.0'),
        }
        
        self._log_console(job_id, 'INFO', 'Starting enhanced ZFS template preparation', job_details)
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
            
            # Optional: Create rollback snapshot before making changes
            if details.get('create_rollback_snapshot', False):
                self._add_step_result(job_id, job_details, 'rollback_snapshot', 'running', 'Creating rollback snapshot...')
                try:
                    vc_settings = self._get_vcenter_settings(vcenter_id)
                    if vc_settings:
                        self.vcenter_conn = self._connect_vcenter(
                            vc_settings['host'],
                            vc_settings['username'],
                            vc_settings['password'],
                            vc_settings.get('port', 443),
                            vc_settings.get('verify_ssl', False)
                        )
                        if self.vcenter_conn:
                            vm_moref = vm_info.get('vcenter_id') or details.get('vm_moref')
                            vm_obj = self._find_vm_by_moref(self.vcenter_conn, vm_moref)
                            if vm_obj:
                                snapshot_name = f"pre-template-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
                                task = vm_obj.CreateSnapshot(
                                    name=snapshot_name,
                                    description="Rollback snapshot before template preparation",
                                    memory=False,
                                    quiesce=False
                                )
                                self._wait_for_task(task)
                                job_details['rollback_snapshot'] = snapshot_name
                                self._add_step_result(job_id, job_details, 'rollback_snapshot', 'success', f'Created snapshot: {snapshot_name}')
                            Disconnect(self.vcenter_conn)
                            self.vcenter_conn = None
                except Exception as snap_err:
                    self._log_console(job_id, 'WARN', f'Rollback snapshot failed: {snap_err}', job_details)
                    self._add_step_result(job_id, job_details, 'rollback_snapshot', 'warning', str(snap_err))
            
            # Step 1: Connect to VM via SSH
            self._add_step_result(job_id, job_details, 'ssh_connect', 'running', 'Connecting via SSH...')
            self._update_progress(job_id, job_details, 5)
            
            ssh_client = self._connect_ssh_password(vm_ip, 'root', root_password)
            if not ssh_client:
                self._add_step_result(job_id, job_details, 'ssh_connect', 'failed', 'SSH connection failed')
                raise Exception('Failed to connect via SSH')
            
            self._add_step_result(job_id, job_details, 'ssh_connect', 'success', f'Connected to {vm_ip}')
            self.ssh_client = ssh_client
            
            # Step 2: Pre-flight checks
            self._add_step_result(job_id, job_details, 'preflight', 'running', 'Running pre-flight checks...')
            self._update_progress(job_id, job_details, 8)
            
            preflight_results = self._preflight_checks(ssh_client, job_id, job_details)
            job_details['preflight_checks'] = preflight_results
            
            # Check for critical failures
            critical_failures = [c for c in preflight_results if not c['ok'] and c.get('critical', False)]
            if critical_failures:
                failure_msg = ', '.join([f"{c['check']}: {c['value']}" for c in critical_failures])
                self._add_step_result(job_id, job_details, 'preflight', 'failed', failure_msg)
                raise Exception(f'Pre-flight checks failed: {failure_msg}')
            
            warnings = [c for c in preflight_results if not c['ok'] and not c.get('critical', False)]
            if warnings:
                warning_msg = ', '.join([f"{c['check']}: {c['value']}" for c in warnings])
                self._add_step_result(job_id, job_details, 'preflight', 'warning', f'Warnings: {warning_msg}')
            else:
                self._add_step_result(job_id, job_details, 'preflight', 'success', 'All pre-flight checks passed')
            
            # Step 3: Detect OS family
            self._add_step_result(job_id, job_details, 'os_detect', 'running', 'Detecting OS family...')
            self._update_progress(job_id, job_details, 10)
            
            os_family = self._detect_os_family(ssh_client)
            job_details['os_family'] = os_family
            self._log_console(job_id, 'INFO', f'Detected OS family: {os_family}', job_details)
            self._add_step_result(job_id, job_details, 'os_detect', 'success', f'OS: {os_family}')
            
            # Step 4: Install packages
            if details.get('install_packages', True):
                packages = details.get('packages', ['zfsutils-linux', 'nfs-kernel-server', 'open-vm-tools'])
                self._add_step_result(job_id, job_details, 'install_packages', 'running', f'Installing {len(packages)} packages...')
                self._update_progress(job_id, job_details, 15)
                
                if os_family == 'debian':
                    self._install_packages_debian(ssh_client, packages, job_id, job_details)
                elif os_family == 'rhel':
                    self._install_packages_rhel(ssh_client, packages, job_id, job_details)
                else:
                    # Fallback to apt
                    self._install_packages_debian(ssh_client, packages, job_id, job_details)
                
                self._add_step_result(job_id, job_details, 'install_packages', 'success', f'Installed {len(packages)} packages')
                self._update_progress(job_id, job_details, 35)
            
            # Step 5: Apply ZFS tuning
            tuning = details.get('zfs_tuning', {})
            if tuning.get('enabled', True):
                self._add_step_result(job_id, job_details, 'zfs_tuning', 'running', 'Applying ZFS tuning...')
                self._update_progress(job_id, job_details, 38)
                
                self._configure_zfs_tuning(ssh_client, job_id, job_details, tuning)
                self._add_step_result(job_id, job_details, 'zfs_tuning', 'success', 'ZFS tuning applied')
            
            # Step 6: Create service user
            if details.get('create_user', True):
                username = details.get('username', 'zfsadmin')
                self._add_step_result(job_id, job_details, 'create_user', 'running', f'Creating user {username}...')
                self._update_progress(job_id, job_details, 42)
                
                # Create user with home directory
                self._exec_ssh(ssh_client, f'useradd -m -s /bin/bash {username} || true')
                
                # Add to sudo group
                self._exec_ssh(ssh_client, f'usermod -aG sudo {username}')
                
                # Allow passwordless sudo for ZFS commands
                sudo_line = f'{username} ALL=(ALL) NOPASSWD: /sbin/zpool, /sbin/zfs, /bin/systemctl, /usr/sbin/exportfs, /usr/local/bin/zfs-health-check'
                self._exec_ssh(ssh_client, f'echo "{sudo_line}" > /etc/sudoers.d/{username}')
                self._exec_ssh(ssh_client, f'chmod 440 /etc/sudoers.d/{username}')
                
                self._add_step_result(job_id, job_details, 'create_user', 'success', f'Created user {username} with sudo access')
            
            # Step 7: Deploy SSH key
            ssh_key_id = details.get('ssh_key_id')
            if ssh_key_id:
                self._add_step_result(job_id, job_details, 'deploy_key', 'running', 'Deploying SSH key...')
                self._update_progress(job_id, job_details, 48)
                
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
            
            # Step 8: Install health check script
            if details.get('install_health_script', True):
                self._add_step_result(job_id, job_details, 'health_script', 'running', 'Installing health check script...')
                self._update_progress(job_id, job_details, 52)
                
                self._install_health_check_script(ssh_client, job_id, job_details)
                self._add_step_result(job_id, job_details, 'health_script', 'success', 'Health check script installed')
            
            # Step 9: Clean system for templating
            cleanup = details.get('cleanup', {})
            self._update_progress(job_id, job_details, 58)
            
            if cleanup.get('clear_machine_id', True):
                self._add_step_result(job_id, job_details, 'clean_machine_id', 'running', 'Clearing machine-id...')
                self._exec_ssh(ssh_client, 'truncate -s 0 /etc/machine-id')
                self._exec_ssh(ssh_client, 'rm -f /var/lib/dbus/machine-id')
                self._add_step_result(job_id, job_details, 'clean_machine_id', 'success', 'machine-id cleared')
            
            if cleanup.get('clear_ssh_host_keys', True):
                self._add_step_result(job_id, job_details, 'clean_ssh_keys', 'running', 'Clearing SSH host keys...')
                self._exec_ssh(ssh_client, 'rm -f /etc/ssh/ssh_host_*')
                # Configure to regenerate on boot
                if os_family == 'debian':
                    self._exec_ssh(ssh_client, 'dpkg-reconfigure openssh-server || true')
                self._add_step_result(job_id, job_details, 'clean_ssh_keys', 'success', 'SSH host keys cleared')
            
            if cleanup.get('clean_cloud_init', True):
                self._add_step_result(job_id, job_details, 'clean_cloud_init', 'running', 'Cleaning cloud-init...')
                self._exec_ssh(ssh_client, 'cloud-init clean --logs || true')
                self._exec_ssh(ssh_client, 'rm -rf /var/lib/cloud/* || true')
                self._add_step_result(job_id, job_details, 'clean_cloud_init', 'success', 'cloud-init cleaned')
            
            # Step 10: Clean network state
            if cleanup.get('clean_network', True):
                self._add_step_result(job_id, job_details, 'clean_network', 'running', 'Cleaning network state...')
                self._cleanup_network(ssh_client, job_id, job_details)
                self._add_step_result(job_id, job_details, 'clean_network', 'success', 'Network state cleaned')
            
            self._update_progress(job_id, job_details, 68)
            
            # Step 11: Stamp template version
            template_version = details.get('template_version', '1.0.0')
            packages_installed = details.get('packages', ['zfsutils-linux', 'nfs-kernel-server', 'open-vm-tools'])
            
            self._add_step_result(job_id, job_details, 'stamp_version', 'running', f'Stamping version {template_version}...')
            self._stamp_template_version(ssh_client, template_version, packages_installed, os_family, job_id, job_details)
            self._add_step_result(job_id, job_details, 'stamp_version', 'success', f'Template version: {template_version}')
            
            self._update_progress(job_id, job_details, 75)
            
            # Close SSH before power operations
            ssh_client.close()
            self.ssh_client = None
            
            # Step 12: Power off and convert to template
            if details.get('power_off_first', True) or details.get('convert_to_template', True):
                # Connect to vCenter
                vc_settings = self._get_vcenter_settings(vcenter_id)
                if not vc_settings:
                    raise Exception('vCenter settings not found')
                
                self._add_step_result(job_id, job_details, 'vcenter_connect', 'running', f'Connecting to vCenter {vc_settings["host"]}...')
                self._log_and_update(job_id, 'INFO', f'Connecting to vCenter for power-off/convert...', job_details)
                
                self.vcenter_conn = self._connect_vcenter(
                    vc_settings['host'],
                    vc_settings['username'],
                    vc_settings['password'],
                    vc_settings.get('port', 443),
                    vc_settings.get('verify_ssl', False),
                    job_id=job_id,
                    job_details=job_details
                )
                
                if not self.vcenter_conn:
                    self._add_step_result(job_id, job_details, 'vcenter_connect', 'failed', f'Connection failed to {vc_settings["host"]} - check console for details')
                    raise Exception(f'Failed to connect to vCenter at {vc_settings["host"]} - check network connectivity and credentials')
                
                self._add_step_result(job_id, job_details, 'vcenter_connect', 'success', f'Connected to {vc_settings["host"]}')
                
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
            self._log_console(job_id, 'INFO', 'Enhanced template preparation complete', job_details)
            
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
    
    def execute_validate_zfs_template(self, job: Dict):
        """
        Validate ZFS template preparation prerequisites without making changes.
        
        Runs read-only checks:
        1. SSH connectivity test
        2. Disk space check (≥2GB free)
        3. Repository access (Debian or RHEL repos)
        4. Kernel headers availability
        5. ZFS installation status
        6. SSH service status
        7. OS family detection
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        target_scope = job.get('target_scope', {}) or {}
        
        job_details = {
            'step_results': [],
            'console_log': [],
            'progress_percent': 0,
            'validation_mode': True,
        }
        
        self._log_console(job_id, 'INFO', 'Starting ZFS template validation (read-only)', job_details)
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details=job_details)
        
        try:
            # Get VM info
            vm_id = target_scope.get('vm_id')
            if not vm_id:
                raise Exception('No VM ID provided for validation')
            
            # Fetch VM details
            vm_info = self._fetch_vm_by_id(vm_id)
            if not vm_info:
                raise Exception(f'VM not found: {vm_id}')
            
            vm_ip = vm_info.get('ip_address')
            vm_name = vm_info.get('name', 'Unknown')
            
            if not vm_ip:
                raise Exception(f'VM {vm_name} has no IP address - ensure VM is powered on and has VMware Tools')
            
            root_password = details.get('root_password')
            if not root_password:
                raise Exception('Root password is required for validation')
            
            self._log_console(job_id, 'INFO', f'Connecting to VM {vm_name} at {vm_ip}...', job_details)
            self._update_progress(job_id, job_details, 10)
            
            # SSH connect
            ssh_client = self._connect_ssh_password(vm_ip, 'root', root_password)
            if not ssh_client:
                raise Exception(f'Failed to SSH connect to {vm_ip} - check credentials')
            
            self._log_console(job_id, 'INFO', 'SSH connected successfully', job_details)
            self._add_step_result(job_id, job_details, 'ssh_connect', 'success', f'Connected to {vm_ip}')
            self._update_progress(job_id, job_details, 25)
            
            try:
                # Run preflight checks (read-only)
                self._log_console(job_id, 'INFO', 'Running pre-flight checks...', job_details)
                preflight_results = self._preflight_checks(ssh_client, job_id, job_details)
                self._update_progress(job_id, job_details, 50)
                
                # Detect OS family (read-only)
                os_family = self._detect_os_family(ssh_client)
                self._log_console(job_id, 'INFO', f'Detected OS family: {os_family}', job_details)
                self._update_progress(job_id, job_details, 65)
                
                # Get additional system info (read-only)
                kernel_result = self._exec_ssh(ssh_client, 'uname -r')
                kernel_version = kernel_result.get('stdout', '').strip() if kernel_result.get('exit_code') == 0 else 'unknown'
                
                memory_result = self._exec_ssh(ssh_client, "grep MemTotal /proc/meminfo | awk '{print $2}'")
                try:
                    memory_kb = int(memory_result.get('stdout', '0').strip() or 0)
                    memory_gb = round(memory_kb / 1024 / 1024, 1)
                except ValueError:
                    memory_gb = 0
                
                # Get hostname
                hostname_result = self._exec_ssh(ssh_client, 'hostname')
                hostname = hostname_result.get('stdout', '').strip() if hostname_result.get('exit_code') == 0 else 'unknown'
                
                # Check if ZFS is already installed
                zfs_already_installed = any(
                    check.get('check') == 'zfs_installed' and check.get('ok', False)
                    for check in preflight_results
                )
                
                self._update_progress(job_id, job_details, 85)
                
                # Determine if VM is ready for preparation
                critical_checks = ['disk_space', 'ssh_service']
                all_critical_passed = all(
                    check.get('ok', False) 
                    for check in preflight_results 
                    if check.get('check') in critical_checks
                )
                
                os_supported = os_family in ['debian', 'rhel']
                ready_for_preparation = all_critical_passed and os_supported
                
                # Compile validation results
                validation_results = {
                    'vm_name': vm_name,
                    'vm_ip': vm_ip,
                    'hostname': hostname,
                    'os_family': os_family,
                    'os_supported': os_supported,
                    'kernel_version': kernel_version,
                    'memory_gb': memory_gb,
                    'zfs_already_installed': zfs_already_installed,
                    'preflight_checks': preflight_results,
                    'all_checks_passed': all(c.get('ok', False) for c in preflight_results),
                    'ready_for_preparation': ready_for_preparation,
                }
                
                job_details['validation_results'] = validation_results
                job_details['preflight_checks'] = preflight_results
                job_details['os_family'] = os_family
                
                self._update_progress(job_id, job_details, 100)
                
                # Set final status based on results
                if ready_for_preparation:
                    self._log_console(job_id, 'INFO', 'Validation passed - VM is ready for template preparation', job_details)
                    self._add_step_result(job_id, job_details, 'validation', 'success', 'All checks passed')
                else:
                    issues = []
                    if not os_supported:
                        issues.append(f'Unsupported OS: {os_family}')
                    failed_checks = [c['check'] for c in preflight_results if not c.get('ok')]
                    if failed_checks:
                        issues.append(f'Failed checks: {", ".join(failed_checks)}')
                    self._log_console(job_id, 'WARN', f'Validation completed with warnings: {"; ".join(issues)}', job_details)
                    self._add_step_result(job_id, job_details, 'validation', 'warning', '; '.join(issues))
                
                # Mark job completed (even with warnings - it's informational)
                self.update_job_status(
                    job_id, 
                    'completed', 
                    completed_at=utc_now_iso(), 
                    details=job_details
                )
                
            finally:
                if ssh_client:
                    ssh_client.close()
                    
        except Exception as e:
            self._log_console(job_id, 'ERROR', f'Validation failed: {str(e)}', job_details)
            self._add_step_result(job_id, job_details, 'validation', 'failed', str(e))
            self.update_job_status(
                job_id, 
                'failed', 
                completed_at=utc_now_iso(), 
                details={**job_details, 'error': str(e)}
            )
    
    # ========== Enhanced Template Preparation Methods ==========
    
    def _preflight_checks(self, ssh_client: Any, job_id: str, job_details: Dict) -> list:
        """Validate prerequisites before making changes."""
        checks = []
        
        # Check disk space (need ~2GB for ZFS packages)
        result = self._exec_ssh(ssh_client, "df -BG / | tail -1 | awk '{print $4}' | tr -d 'G'")
        try:
            free_gb = int(result['stdout'].strip()) if result['exit_code'] == 0 else 0
            checks.append({
                'check': 'disk_space',
                'ok': free_gb >= 2,
                'value': f'{free_gb}GB free',
                'critical': free_gb < 1  # Critical if less than 1GB
            })
        except ValueError:
            checks.append({'check': 'disk_space', 'ok': False, 'value': 'Could not determine', 'critical': False})
        
        # Check internet/repo access
        result = self._exec_ssh(ssh_client, "curl -s --connect-timeout 5 http://deb.debian.org > /dev/null 2>&1 && echo ok || echo fail")
        repo_ok = 'ok' in result['stdout']
        checks.append({
            'check': 'repo_access',
            'ok': repo_ok,
            'value': 'Debian repos accessible' if repo_ok else 'Cannot reach Debian repos',
            'critical': False  # Not critical, might be RHEL
        })
        
        # Check kernel headers available
        result = self._exec_ssh(ssh_client, "uname -r")
        kernel_version = result['stdout'].strip() if result['exit_code'] == 0 else 'unknown'
        
        result = self._exec_ssh(ssh_client, f"apt-cache search linux-headers-{kernel_version} 2>/dev/null || yum list kernel-devel 2>/dev/null")
        headers_available = len(result['stdout'].strip()) > 0
        checks.append({
            'check': 'kernel_headers',
            'ok': headers_available,
            'value': f'Headers for {kernel_version}' if headers_available else 'Headers may need installation',
            'critical': False
        })
        
        # Check if ZFS is already installed
        result = self._exec_ssh(ssh_client, "which zpool 2>/dev/null")
        zfs_installed = result['exit_code'] == 0
        checks.append({
            'check': 'zfs_installed',
            'ok': True,  # Not a failure either way
            'value': 'ZFS already installed' if zfs_installed else 'ZFS not installed (will install)',
            'critical': False
        })
        
        # Check SSH server running
        result = self._exec_ssh(ssh_client, "systemctl is-active sshd 2>/dev/null || systemctl is-active ssh 2>/dev/null")
        ssh_active = 'active' in result['stdout']
        checks.append({
            'check': 'ssh_service',
            'ok': ssh_active,
            'value': 'SSH service active' if ssh_active else 'SSH service status unknown',
            'critical': False
        })
        
        self._log_console(job_id, 'INFO', f'Pre-flight checks: {len([c for c in checks if c["ok"]])}/{len(checks)} passed', job_details)
        return checks
    
    def _detect_os_family(self, ssh_client: Any) -> str:
        """Detect OS family for package manager selection."""
        result = self._exec_ssh(ssh_client, 'cat /etc/os-release 2>/dev/null')
        os_info = result['stdout'].lower()
        
        if 'debian' in os_info or 'ubuntu' in os_info:
            return 'debian'
        elif 'rhel' in os_info or 'centos' in os_info or 'rocky' in os_info or 'alma' in os_info or 'fedora' in os_info:
            return 'rhel'
        
        # Fallback checks
        result = self._exec_ssh(ssh_client, 'which apt-get 2>/dev/null')
        if result['exit_code'] == 0:
            return 'debian'
        
        result = self._exec_ssh(ssh_client, 'which yum 2>/dev/null || which dnf 2>/dev/null')
        if result['exit_code'] == 0:
            return 'rhel'
        
        return 'unknown'
    
    def _log_and_update(self, job_id: str, level: str, message: str, job_details: Dict):
        """Log to console AND push update to database for real-time UI updates."""
        self._log_console(job_id, level, message, job_details)
        self.update_job_status(job_id, 'running', details=job_details)
    
    def _install_packages_debian(self, ssh_client: Any, packages: list, job_id: str, job_details: Dict):
        """Install packages on Debian/Ubuntu with proper ZFS repo setup."""
        self._log_and_update(job_id, 'INFO', 'Configuring Debian repositories...', job_details)
        
        # Detect repository format (deb822 vs traditional)
        check_deb822 = self._exec_ssh(ssh_client, 'ls /etc/apt/sources.list.d/*.sources 2>/dev/null')
        
        if check_deb822['exit_code'] == 0 and check_deb822['stdout'].strip():
            # deb822 format - add contrib component to existing files
            self._log_and_update(job_id, 'INFO', 'Using deb822 repository format', job_details)
            self._exec_ssh(ssh_client, r"sed -i 's/Components: main$/Components: main contrib/' /etc/apt/sources.list.d/*.sources")
        else:
            # Traditional format - check if contrib is already present
            check_contrib = self._exec_ssh(ssh_client, 'grep -r "contrib" /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null')
            if check_contrib['exit_code'] != 0:
                self._log_and_update(job_id, 'INFO', 'Adding contrib repository', job_details)
                # Detect codename
                codename_result = self._exec_ssh(ssh_client, 'lsb_release -cs 2>/dev/null || grep VERSION_CODENAME /etc/os-release | cut -d= -f2')
                codename = codename_result['stdout'].strip() or 'bookworm'
                self._exec_ssh(ssh_client, f'echo "deb http://deb.debian.org/debian {codename} main contrib" > /etc/apt/sources.list.d/contrib.list')
        
        # Update package lists
        self._log_and_update(job_id, 'INFO', 'Updating package lists...', job_details)
        self._exec_ssh(ssh_client, 'apt-get update -qq')
        
        # Install kernel headers first (required for DKMS to build ZFS module)
        result = self._exec_ssh(ssh_client, 'uname -r')
        kernel_version = result['stdout'].strip() if result['exit_code'] == 0 else None
        
        if kernel_version:
            self._log_and_update(job_id, 'INFO', f'Installing kernel headers for {kernel_version}...', job_details)
            result = self._exec_ssh(ssh_client, f'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq dpkg-dev linux-headers-{kernel_version}')
            if result['exit_code'] != 0:
                self._log_and_update(job_id, 'WARN', f'Header install warning: {result["stderr"]}', job_details)
        
        # Separate ZFS packages from others
        zfs_packages = [p for p in packages if 'zfs' in p.lower()]
        other_packages = [p for p in packages if 'zfs' not in p.lower()]
        
        # Install non-ZFS packages first
        if other_packages:
            pkg_str = ' '.join(other_packages)
            self._log_and_update(job_id, 'INFO', f'Installing packages: {pkg_str}', job_details)
            result = self._exec_ssh(ssh_client, f'DEBIAN_FRONTEND=noninteractive apt-get install -y {pkg_str}')
            if result['exit_code'] != 0:
                self._log_and_update(job_id, 'WARN', f'Package install warning: {result["stderr"]}', job_details)
        
        # Install ZFS packages (zfs-dkms + zfsutils-linux)
        if zfs_packages or 'zfsutils-linux' in packages:
            self._log_and_update(job_id, 'INFO', 'Installing ZFS packages (this may take a few minutes for DKMS build)...', job_details)
            result = self._exec_ssh(ssh_client, 'DEBIAN_FRONTEND=noninteractive apt-get install -y zfs-dkms zfsutils-linux')
            if result['exit_code'] != 0:
                self._log_and_update(job_id, 'WARN', f'ZFS install warning: {result["stderr"]}', job_details)
            
            # Load ZFS kernel module
            self._log_and_update(job_id, 'INFO', 'Loading ZFS kernel module...', job_details)
            result = self._exec_ssh(ssh_client, 'modprobe zfs')
            if result['exit_code'] != 0:
                self._log_and_update(job_id, 'WARN', 'modprobe zfs failed, trying dkms autoinstall...', job_details)
                self._exec_ssh(ssh_client, 'dkms autoinstall')
                result = self._exec_ssh(ssh_client, 'modprobe zfs')
                if result['exit_code'] != 0:
                    self._log_and_update(job_id, 'WARN', f'modprobe zfs still failed: {result["stderr"]}', job_details)
            
            # Verify ZFS is loaded
            result = self._exec_ssh(ssh_client, 'lsmod | grep zfs')
            if result['exit_code'] == 0:
                self._log_and_update(job_id, 'INFO', 'ZFS kernel module loaded successfully', job_details)
            else:
                self._log_and_update(job_id, 'WARN', 'ZFS kernel module not loaded - may work after reboot', job_details)
    
    def _install_packages_rhel(self, ssh_client: Any, packages: list, job_id: str, job_details: Dict):
        """Install packages on RHEL/CentOS/Rocky."""
        self._log_console(job_id, 'INFO', 'Configuring RHEL-family repositories...', job_details)
        
        # Enable EPEL repository
        self._exec_ssh(ssh_client, 'yum install -y epel-release 2>/dev/null || dnf install -y epel-release 2>/dev/null || true')
        
        # Install kernel-devel for DKMS
        result = self._exec_ssh(ssh_client, 'uname -r')
        kernel_version = result['stdout'].strip()
        self._exec_ssh(ssh_client, f'yum install -y kernel-devel-{kernel_version} || dnf install -y kernel-devel-{kernel_version} || true')
        
        # Map Debian package names to RHEL equivalents
        rhel_packages = []
        for pkg in packages:
            if pkg == 'zfsutils-linux':
                rhel_packages.append('zfs')
            elif pkg == 'nfs-kernel-server':
                rhel_packages.append('nfs-utils')
            elif pkg == 'open-vm-tools':
                rhel_packages.append('open-vm-tools')
            else:
                rhel_packages.append(pkg)
        
        # Install ZFS repo for RHEL
        if 'zfs' in rhel_packages:
            self._log_console(job_id, 'INFO', 'Adding ZFS repository...', job_details)
            # This is a simplified approach - in production might need more specific handling
            self._exec_ssh(ssh_client, 'yum install -y https://zfsonlinux.org/epel/zfs-release-2-3$(rpm --eval "%{dist}").noarch.rpm || true')
            self._exec_ssh(ssh_client, 'yum-config-manager --enable zfs || true')
        
        # Install packages
        pkg_str = ' '.join(rhel_packages)
        self._log_console(job_id, 'INFO', f'Installing packages: {pkg_str}', job_details)
        result = self._exec_ssh(ssh_client, f'yum install -y {pkg_str} || dnf install -y {pkg_str}')
        if result['exit_code'] != 0:
            self._log_console(job_id, 'WARN', f'Package install warning: {result["stderr"]}', job_details)
        
        # Enable NFS service
        self._exec_ssh(ssh_client, 'systemctl enable nfs-server 2>/dev/null || true')
    
    def _configure_zfs_tuning(self, ssh_client: Any, job_id: str, job_details: Dict, tuning: Dict):
        """Apply ZFS performance tuning for NFS workloads."""
        self._log_console(job_id, 'INFO', 'Applying ZFS tuning parameters...', job_details)
        
        tuning_lines = []
        
        # ARC size limit (default: 50% of RAM)
        arc_percent = tuning.get('arc_percent', 50)
        if arc_percent and arc_percent > 0:
            tuning_lines.append(f'# Limit ARC to {arc_percent}% of RAM')
            tuning_lines.append(f'options zfs zfs_arc_max=$(( $(grep MemTotal /proc/meminfo | awk \'{{print $2}}\') * 1024 * {arc_percent} / 100 ))')
        
        # Enable prefetch (good for sequential workloads)
        if tuning.get('enable_prefetch', True):
            tuning_lines.append('# Enable prefetch for sequential reads')
            tuning_lines.append('options zfs zfs_prefetch_disable=0')
        
        # Sync write optimization
        if tuning.get('sync_optimization', False):
            tuning_lines.append('# Optimize sync writes')
            tuning_lines.append('options zfs zfs_txg_timeout=5')
        
        # Write tuning config
        if tuning_lines:
            tuning_content = '\n'.join(tuning_lines)
            self._exec_ssh(ssh_client, f'cat > /etc/modprobe.d/zfs-tuning.conf << \'EOF\'\n{tuning_content}\nEOF')
            self._log_console(job_id, 'INFO', f'Applied {len(tuning_lines)} ZFS tuning parameters', job_details)
        
        # NFS tuning
        if tuning.get('nfs_tuning', True):
            self._log_console(job_id, 'INFO', 'Applying NFS tuning...', job_details)
            nfs_tuning = '''# NFS tuning for ZFS appliance
# Increase number of NFS threads
RPCNFSDCOUNT=16
'''
            self._exec_ssh(ssh_client, f'cat >> /etc/default/nfs-kernel-server << \'EOF\'\n{nfs_tuning}\nEOF')
    
    def _install_health_check_script(self, ssh_client: Any, job_id: str, job_details: Dict):
        """Install ZFS health check script."""
        script = '''#!/bin/bash
# ZFS Appliance Health Check
# Installed by Dell Server Manager Template Preparation

echo "=== ZFS Appliance Health Check ==="
echo "Date: $(date)"
echo "Hostname: $(hostname)"
echo ""

echo "=== ZFS Pools ==="
if command -v zpool &> /dev/null; then
    zpool list 2>/dev/null || echo "No pools configured"
    echo ""
    echo "Pool Status:"
    zpool status 2>/dev/null || echo "No pools to check"
else
    echo "ZFS not installed or not in PATH"
fi
echo ""

echo "=== ZFS Module ==="
lsmod | grep zfs || echo "ZFS module not loaded"
echo ""

echo "=== NFS Exports ==="
exportfs -v 2>/dev/null || echo "No NFS exports or exportfs not available"
echo ""

echo "=== Services ==="
echo -n "NFS Server: "
systemctl is-active nfs-server.service 2>/dev/null || systemctl is-active nfs-kernel-server.service 2>/dev/null || echo "not found"
echo -n "ZFS Import: "
systemctl is-active zfs-import-cache.service 2>/dev/null || echo "not found"
echo -n "ZFS Mount: "
systemctl is-active zfs-mount.service 2>/dev/null || echo "not found"
echo ""

echo "=== Disk Space ==="
df -h / /var 2>/dev/null
echo ""

echo "=== Memory ==="
free -h
echo ""

echo "=== Template Info ==="
cat /etc/zfs-template-info 2>/dev/null || echo "Template info not found"
'''
        # Write the script
        self._exec_ssh(ssh_client, f"cat > /usr/local/bin/zfs-health-check << 'HEALTHEOF'\n{script}\nHEALTHEOF")
        self._exec_ssh(ssh_client, 'chmod +x /usr/local/bin/zfs-health-check')
        
        self._log_console(job_id, 'INFO', 'Installed /usr/local/bin/zfs-health-check', job_details)
    
    def _cleanup_network(self, ssh_client: Any, job_id: str, job_details: Dict):
        """Clean network state for cloning."""
        commands = [
            ('DHCP leases', 'rm -f /var/lib/dhcp/*.leases /var/lib/dhclient/* 2>/dev/null || true'),
            ('Persistent net rules', 'rm -f /etc/udev/rules.d/70-persistent-net.rules 2>/dev/null || true'),
            ('NetworkManager connections', 'rm -f /etc/NetworkManager/system-connections/* 2>/dev/null || true'),
            ('Hostname (optional)', 'truncate -s 0 /etc/hostname 2>/dev/null || true'),
        ]
        
        for desc, cmd in commands:
            result = self._exec_ssh(ssh_client, cmd)
            if result['exit_code'] == 0:
                self._log_console(job_id, 'INFO', f'Cleaned: {desc}', job_details)
    
    def _stamp_template_version(self, ssh_client: Any, version: str, packages: list, os_family: str, job_id: str, job_details: Dict):
        """Create /etc/zfs-template-info with version metadata."""
        timestamp = datetime.now(timezone.utc).isoformat()
        packages_str = ','.join(packages)
        
        # Get OS details
        os_result = self._exec_ssh(ssh_client, 'cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'')
        os_name = os_result['stdout'].strip() or 'Unknown'
        
        kernel_result = self._exec_ssh(ssh_client, 'uname -r')
        kernel = kernel_result['stdout'].strip() or 'Unknown'
        
        zfs_result = self._exec_ssh(ssh_client, 'zfs --version 2>/dev/null | head -1 || echo "Not installed"')
        zfs_version = zfs_result['stdout'].strip()
        
        info_content = f'''# ZFS Appliance Template
# Created by Dell Server Manager

VERSION={version}
CREATED={timestamp}
OS_FAMILY={os_family}
OS_NAME={os_name}
KERNEL={kernel}
ZFS_VERSION={zfs_version}
PACKAGES={packages_str}
'''
        
        self._exec_ssh(ssh_client, f"cat > /etc/zfs-template-info << 'TPLEOF'\n{info_content}\nTPLEOF")
        self._log_console(job_id, 'INFO', f'Template version {version} stamped', job_details)
    
    # ========== Original Helper Methods ==========
    
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
                         port: int = 443, verify_ssl: bool = False,
                         job_id: str = None, job_details: Dict = None) -> Optional[Any]:
        """Connect to vCenter with optional console logging"""
        try:
            ssl_context = None
            if not verify_ssl:
                ssl_context = ssl.create_default_context()
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE
            
            if job_details is not None and job_id:
                self._log_console(job_id, 'INFO', f'Connecting to vCenter {host}:{port}...', job_details)
                self.update_job_status(job_id, 'running', details=job_details)
            
            conn = SmartConnect(
                host=host,
                user=username,
                pwd=password,
                port=port,
                sslContext=ssl_context
            )
            
            if job_details is not None and job_id:
                self._log_console(job_id, 'INFO', f'Successfully connected to vCenter {host}', job_details)
            
            return conn
        except Exception as e:
            error_msg = f'vCenter connection failed: {e}'
            self.log(error_msg, 'ERROR')
            if job_details is not None and job_id:
                self._log_console(job_id, 'ERROR', error_msg, job_details)
                self.update_job_status(job_id, 'running', details=job_details)
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
