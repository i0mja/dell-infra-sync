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
        
        # Track what we did for cleanup/rollback
        we_converted_from_template = False
        we_powered_on = False
        
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
            
            root_password = details.get('root_password')
            if not root_password:
                raise Exception('Root password is required for template preparation')
            
            # Check if this is a template or powered-off VM that needs special handling
            source_is_template = details.get('source_is_template', False)
            source_power_state = details.get('source_power_state', 'poweredOn')
            target_cluster = details.get('target_cluster')
            
            vm_ip = vm_info.get('ip_address')
            vm_moref = vm_info.get('vcenter_id') or details.get('vm_moref')
            needs_power_conversion = source_is_template or source_power_state != 'poweredOn' or not vm_ip
            
            self._log_console(job_id, 'INFO', f'Source state: template={source_is_template}, power={source_power_state}, ip={vm_ip}', job_details)
            
            # If template or powered-off, connect to vCenter first to convert/power on
            if needs_power_conversion:
                self._add_step_result(job_id, job_details, 'vcenter_prep', 'running', 'Connecting to vCenter for VM preparation...')
                self._update_progress(job_id, job_details, 2)
                
                vc_settings = self._get_vcenter_settings(vcenter_id)
                if not vc_settings:
                    raise Exception('vCenter settings not found')
                
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
                    raise Exception('Failed to connect to vCenter')
                
                self._add_step_result(job_id, job_details, 'vcenter_prep', 'success', f'Connected to {vc_settings["host"]}')
                
                # Find VM by moref
                vm_obj = self._find_vm_by_moref(self.vcenter_conn, vm_moref)
                if not vm_obj:
                    raise Exception(f'VM not found in vCenter: {vm_moref}')
                
                # Check if it's actually a VMware template
                is_vmware_template = hasattr(vm_obj.config, 'template') and vm_obj.config.template
                
                # Convert template to VM if needed
                if is_vmware_template:
                    self._add_step_result(job_id, job_details, 'convert_to_vm', 'running', 'Converting template to VM...')
                    self._update_progress(job_id, job_details, 4)
                    
                    # Find resource pool from target cluster
                    resource_pool = self._find_resource_pool_for_cluster(self.vcenter_conn, target_cluster)
                    if not resource_pool:
                        raise Exception(f'No resource pool found for cluster: {target_cluster}')
                    
                    vm_obj.MarkAsVirtualMachine(pool=resource_pool)
                    we_converted_from_template = True
                    self._log_console(job_id, 'INFO', f'Converted template to VM in cluster {target_cluster}', job_details)
                    self._add_step_result(job_id, job_details, 'convert_to_vm', 'success', f'Converted to VM in {target_cluster}')
                
                # Power on if needed
                power_state = str(vm_obj.runtime.powerState)
                if power_state != 'poweredOn':
                    self._add_step_result(job_id, job_details, 'power_on', 'running', 'Powering on VM...')
                    self._update_progress(job_id, job_details, 6)
                    
                    task = vm_obj.PowerOn()
                    self._wait_for_task(task, timeout=120)
                    we_powered_on = True
                    self._log_console(job_id, 'INFO', 'VM powered on', job_details)
                    self._add_step_result(job_id, job_details, 'power_on', 'success', 'VM powered on')
                
                # Wait for VMware Tools
                self._add_step_result(job_id, job_details, 'vmware_tools', 'running', 'Waiting for VMware Tools...')
                self._update_progress(job_id, job_details, 8)
                
                tools_timeout = 180
                tools_start = time.time()
                tools_running = False
                while time.time() - tools_start < tools_timeout:
                    vm_obj = self._find_vm_by_moref(self.vcenter_conn, vm_moref)
                    if vm_obj and vm_obj.guest:
                        tools_status = vm_obj.guest.toolsRunningStatus
                        if tools_status == 'guestToolsRunning':
                            tools_running = True
                            break
                    time.sleep(5)
                
                if not tools_running:
                    raise Exception('VMware Tools did not start within timeout')
                
                self._add_step_result(job_id, job_details, 'vmware_tools', 'success', 'VMware Tools running')
                
                # Wait for IP address
                self._add_step_result(job_id, job_details, 'wait_ip', 'running', 'Waiting for IP address...')
                self._update_progress(job_id, job_details, 10)
                
                ip_timeout = 120
                ip_start = time.time()
                while time.time() - ip_start < ip_timeout:
                    vm_obj = self._find_vm_by_moref(self.vcenter_conn, vm_moref)
                    if vm_obj and vm_obj.guest:
                        vm_ip = vm_obj.guest.ipAddress
                        if vm_ip and not vm_ip.startswith('169.254') and not vm_ip.startswith('127.'):
                            break
                    time.sleep(5)
                else:
                    raise Exception('Failed to get IP address within timeout')
                
                job_details['vm_ip'] = vm_ip
                self._log_console(job_id, 'INFO', f'VM IP address: {vm_ip}', job_details)
                self._add_step_result(job_id, job_details, 'wait_ip', 'success', f'IP: {vm_ip}')
                
                # Disconnect vCenter for now (will reconnect later if needed)
                Disconnect(self.vcenter_conn)
                self.vcenter_conn = None
            
            # Handle rollback snapshot (only if VM is already powered on)
            elif details.get('create_rollback_snapshot', False):
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
            
            # Now we should have vm_ip - verify it
            if not vm_ip:
                raise Exception('VM has no IP address - cannot SSH')
            
            # Store tracking info for cleanup
            job_details['we_converted_from_template'] = we_converted_from_template
            job_details['we_powered_on'] = we_powered_on
            
            # Step 1: Connect to VM via SSH
            self._add_step_result(job_id, job_details, 'ssh_connect', 'running', 'Connecting via SSH...')
            self._update_progress(job_id, job_details, 12)
            
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
                
                # Step 4b: Reboot and verify ZFS module persists (critical for templates)
                if details.get('reboot_after_install', True):
                    self._add_step_result(job_id, job_details, 'reboot_verify', 'running', 'Rebooting to verify ZFS module persistence...')
                    self._update_progress(job_id, job_details, 28)
                    
                    # Close current SSH connection before reboot
                    ssh_client.close()
                    self.ssh_client = None
                    
                    # Reconnect and verify
                    ssh_client = self._reboot_and_verify_zfs(vm_ip, root_password, job_id, job_details, vcenter_id=vcenter_id, vm_moref=vm_moref)
                    if not ssh_client:
                        raise Exception('Failed to reconnect after reboot or ZFS module not loaded')
                    
                    self.ssh_client = ssh_client
                    self._add_step_result(job_id, job_details, 'reboot_verify', 'success', 'ZFS module verified after reboot')
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
        """Install packages on Debian/Ubuntu with proper ZFS repo setup and enhanced header detection."""
        import re
        
        self._log_and_update(job_id, 'INFO', 'Configuring Debian repositories...', job_details)
        
        # Detect repository format (deb822 vs traditional)
        check_deb822 = self._exec_ssh(ssh_client, 'ls /etc/apt/sources.list.d/*.sources 2>/dev/null')
        
        # Detect codename early for repo setup
        codename_result = self._exec_ssh(ssh_client, 'lsb_release -cs 2>/dev/null || grep VERSION_CODENAME /etc/os-release | cut -d= -f2')
        codename = codename_result['stdout'].strip() or 'bookworm'
        
        # Get kernel version for later
        kernel_result = self._exec_ssh(ssh_client, 'uname -r')
        kernel_version = kernel_result['stdout'].strip() if kernel_result['exit_code'] == 0 else None
        
        if check_deb822['exit_code'] == 0 and check_deb822['stdout'].strip():
            # deb822 format - add contrib (and non-free for Trixie+) component to existing files
            self._log_and_update(job_id, 'INFO', 'Using deb822 repository format', job_details)
            
            # For Debian 13 (Trixie) and newer, also add non-free for some packages
            if codename in ['trixie', 'forky', 'sid'] or (kernel_version and 'deb13' in kernel_version):
                self._log_and_update(job_id, 'INFO', f'Detected {codename}/Debian 13+ - adding contrib non-free repos', job_details)
                self._exec_ssh(ssh_client, r"sed -i 's/Components: main$/Components: main contrib non-free/' /etc/apt/sources.list.d/*.sources")
            else:
                self._exec_ssh(ssh_client, r"sed -i 's/Components: main$/Components: main contrib/' /etc/apt/sources.list.d/*.sources")
        else:
            # Traditional format - check if contrib is already present
            check_contrib = self._exec_ssh(ssh_client, 'grep -r "contrib" /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null')
            if check_contrib['exit_code'] != 0:
                self._log_and_update(job_id, 'INFO', 'Adding contrib repository', job_details)
                self._exec_ssh(ssh_client, f'echo "deb http://deb.debian.org/debian {codename} main contrib" > /etc/apt/sources.list.d/contrib.list')
        
        # Update package lists
        self._log_and_update(job_id, 'INFO', 'Updating package lists...', job_details)
        self._exec_ssh(ssh_client, 'apt-get update -qq')
        
        # Install kernel headers with fallback detection for newer kernels
        header_installed = False
        if kernel_version:
            self._log_and_update(job_id, 'INFO', f'Installing kernel headers for {kernel_version}...', job_details)
            
            # Attempt 1: Exact match
            check_exact = self._exec_ssh(ssh_client, f'apt-cache show linux-headers-{kernel_version} 2>/dev/null | grep -q "Package:"')
            if check_exact['exit_code'] == 0:
                result = self._exec_ssh(ssh_client, f'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq dpkg-dev linux-headers-{kernel_version}')
                if result['exit_code'] == 0:
                    header_installed = True
                    self._log_and_update(job_id, 'INFO', f'Installed exact headers: linux-headers-{kernel_version}', job_details)
            
            # Attempt 2: Strip Debian suffix (e.g., 6.12.57+deb13-amd64 → 6.12.57-amd64)
            if not header_installed:
                stripped_version = re.sub(r'\+[^-]+', '', kernel_version)  # Remove +deb13 etc
                if stripped_version != kernel_version:
                    self._log_and_update(job_id, 'INFO', f'Trying stripped version: linux-headers-{stripped_version}', job_details)
                    check_stripped = self._exec_ssh(ssh_client, f'apt-cache show linux-headers-{stripped_version} 2>/dev/null | grep -q "Package:"')
                    if check_stripped['exit_code'] == 0:
                        result = self._exec_ssh(ssh_client, f'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq dpkg-dev linux-headers-{stripped_version}')
                        if result['exit_code'] == 0:
                            header_installed = True
                            self._log_and_update(job_id, 'INFO', f'Installed headers: linux-headers-{stripped_version}', job_details)
            
            # Attempt 3: Generic architecture headers (linux-headers-amd64)
            if not header_installed:
                arch = 'amd64' if 'amd64' in kernel_version else 'arm64' if 'arm64' in kernel_version else None
                if arch:
                    self._log_and_update(job_id, 'INFO', f'Trying generic headers: linux-headers-{arch}', job_details)
                    result = self._exec_ssh(ssh_client, f'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq dpkg-dev linux-headers-{arch}')
                    if result['exit_code'] == 0:
                        header_installed = True
                        self._log_and_update(job_id, 'INFO', f'Installed generic headers: linux-headers-{arch}', job_details)
            
            # Attempt 4: Any matching headers via apt search
            if not header_installed:
                self._log_and_update(job_id, 'WARN', 'Could not find exact kernel headers, searching for alternatives...', job_details)
                # Extract base version (e.g., 6.12 from 6.12.57+deb13-amd64)
                base_match = re.match(r'(\d+\.\d+)', kernel_version)
                if base_match:
                    base_version = base_match.group(1)
                    search_result = self._exec_ssh(ssh_client, f'apt-cache search linux-headers | grep "{base_version}" | head -3')
                    self._log_and_update(job_id, 'INFO', f'Available headers for {base_version}: {search_result["stdout"].strip()[:100]}', job_details)
            
            if not header_installed:
                self._log_and_update(job_id, 'WARN', f'Could not install headers for kernel {kernel_version} - DKMS may fail', job_details)
        
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
            result = self._exec_ssh(ssh_client, 'DEBIAN_FRONTEND=noninteractive apt-get install -y zfs-dkms zfsutils-linux 2>&1')
            if result['exit_code'] != 0:
                self._log_and_update(job_id, 'WARN', f'ZFS install warning: {result["stderr"]}', job_details)
            
            # Check DKMS build status for ZFS
            dkms_status = self._exec_ssh(ssh_client, 'dkms status zfs 2>&1')
            self._log_and_update(job_id, 'INFO', f'DKMS status: {dkms_status["stdout"].strip()}', job_details)
            
            # If not built/installed, try manual DKMS build with verbose output
            if 'installed' not in dkms_status['stdout'].lower():
                self._log_and_update(job_id, 'WARN', 'DKMS ZFS not installed, attempting manual build...', job_details)
                
                # Get ZFS DKMS version
                zfs_ver_result = self._exec_ssh(ssh_client, 'ls /usr/src/ | grep zfs | head -1 | sed "s/zfs-//"')
                zfs_dkms_ver = zfs_ver_result['stdout'].strip() or '2.2'
                
                # Attempt DKMS build with output capture
                build_result = self._exec_ssh(ssh_client, f'dkms build -m zfs -v {zfs_dkms_ver} -k {kernel_version} 2>&1 | tail -30')
                self._log_and_update(job_id, 'INFO', f'DKMS build output:\n{build_result["stdout"][-500:]}', job_details)
                
                # Install after build
                self._exec_ssh(ssh_client, f'dkms install -m zfs -v {zfs_dkms_ver} -k {kernel_version} 2>&1')
                
                # Re-check status
                dkms_recheck = self._exec_ssh(ssh_client, 'dkms status zfs 2>&1')
                self._log_and_update(job_id, 'INFO', f'DKMS status after manual build: {dkms_recheck["stdout"].strip()}', job_details)
            
            # Load ZFS kernel module
            self._log_and_update(job_id, 'INFO', 'Loading ZFS kernel module...', job_details)
            result = self._exec_ssh(ssh_client, 'modprobe zfs 2>&1')
            if result['exit_code'] != 0:
                self._log_and_update(job_id, 'WARN', f'modprobe zfs failed: {result["stdout"]} {result["stderr"]}', job_details)
                self._log_and_update(job_id, 'INFO', 'Running dkms autoinstall...', job_details)
                autoinstall_result = self._exec_ssh(ssh_client, 'dkms autoinstall 2>&1 | tail -20')
                self._log_and_update(job_id, 'INFO', f'dkms autoinstall output: {autoinstall_result["stdout"][-300:]}', job_details)
                
                result = self._exec_ssh(ssh_client, 'modprobe zfs 2>&1')
                if result['exit_code'] != 0:
                    # Get detailed diagnostics
                    modinfo_result = self._exec_ssh(ssh_client, 'modinfo zfs 2>&1')
                    self._log_and_update(job_id, 'WARN', f'modinfo zfs: {modinfo_result["stdout"][:200] or modinfo_result["stderr"][:200]}', job_details)
            
            # Verify ZFS is loaded
            result = self._exec_ssh(ssh_client, 'lsmod | grep zfs')
            if result['exit_code'] == 0:
                self._log_and_update(job_id, 'INFO', 'ZFS kernel module loaded successfully', job_details)
            else:
                self._log_and_update(job_id, 'WARN', 'ZFS kernel module not loaded - will verify after reboot', job_details)
            
            # Pre-reboot validation: ensure DKMS shows ZFS installed
            pre_reboot_dkms = self._exec_ssh(ssh_client, 'dkms status | grep zfs')
            if 'installed' not in pre_reboot_dkms['stdout'].lower():
                self._log_and_update(job_id, 'WARN', f'Pre-reboot DKMS check: ZFS may not persist. Status: {pre_reboot_dkms["stdout"].strip()}', job_details)
            else:
                self._log_and_update(job_id, 'INFO', f'Pre-reboot DKMS check passed: {pre_reboot_dkms["stdout"].strip()}', job_details)
    
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
        
        # Clear any existing ZFS modprobe configs from previous runs
        # This ensures idempotent behavior when re-running prepare on the same VM
        self._exec_ssh(ssh_client, "rm -f /etc/modprobe.d/zfs*.conf")
        self._log_console(job_id, 'INFO', 'Cleared old ZFS modprobe configs', job_details)
        
        tuning_lines = []
        
        # ARC size limit (default: 50% of RAM)
        # CRITICAL: modprobe.d files do NOT evaluate shell expressions!
        # We must calculate the value in Python and write the numeric result.
        arc_percent = tuning.get('arc_percent', 50)
        if arc_percent and arc_percent > 0:
            # Query the VM's total memory via SSH
            mem_result = self._exec_ssh(ssh_client, "grep MemTotal /proc/meminfo | awk '{print $2}'")
            if mem_result['exit_code'] == 0 and mem_result['stdout'].strip():
                try:
                    mem_kb = int(mem_result['stdout'].strip())
                    arc_max_bytes = mem_kb * 1024 * arc_percent // 100
                    # Format for human readability (e.g., "8GB")
                    arc_max_gb = arc_max_bytes / (1024 ** 3)
                    self._log_console(job_id, 'INFO', f'Setting ZFS ARC max to {arc_percent}% of RAM = {arc_max_gb:.1f}GB ({arc_max_bytes} bytes)', job_details)
                    tuning_lines.append(f'# Limit ARC to {arc_percent}% of RAM ({arc_max_gb:.1f}GB)')
                    tuning_lines.append(f'options zfs zfs_arc_max={arc_max_bytes}')
                except (ValueError, TypeError) as e:
                    self._log_console(job_id, 'WARN', f'Could not parse memory info: {e}, skipping ARC tuning', job_details)
            else:
                self._log_console(job_id, 'WARN', f'Could not detect memory: {mem_result.get("stderr", "unknown error")}, skipping ARC tuning', job_details)
        
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
    
    def _reboot_and_verify_zfs(self, vm_ip: str, root_password: str, job_id: str, job_details: Dict, 
                                 vcenter_id: str = None, vm_moref: str = None, max_wait: int = 180) -> Optional[Any]:
        """
        Reboot the VM using VMware API and verify ZFS module loads after cold boot.
        
        This is critical for template preparation - DKMS builds the module but 
        it may not persist across reboots if not properly configured.
        
        Args:
            vm_ip: IP address of the VM
            root_password: Root password for SSH
            job_id: Job ID for logging
            job_details: Job details dict for logging
            vcenter_id: vCenter ID for VMware API reboot
            vm_moref: VM managed object reference
            max_wait: Maximum seconds to wait for VM to come back (default 180)
        
        Returns:
            SSH client if successful, None if failed
        """
        self._log_console(job_id, 'INFO', 'Initiating reboot to verify ZFS persistence...', job_details)
        
        vc_conn = None
        reboot_initiated = False
        shutdown_confirmed = False
        shutdown_start = time.time()
        
        # Use VMware API for reliable reboot (preferred)
        if vcenter_id and vm_moref:
            try:
                vc_settings = self._get_vcenter_settings(vcenter_id)
                if not vc_settings:
                    self._log_console(job_id, 'WARN', 'Cannot get vCenter settings, falling back to SSH reboot', job_details)
                else:
                    vc_conn = self._connect_vcenter(
                        vc_settings['host'],
                        vc_settings['username'],
                        vc_settings['password'],
                        vc_settings.get('port', 443),
                        vc_settings.get('verify_ssl', False)
                    )
                    vm_obj = self._find_vm_by_moref(vc_conn, vm_moref)
                    
                    if not vm_obj:
                        self._log_console(job_id, 'WARN', 'Cannot find VM by moref, falling back to SSH reboot', job_details)
                    else:
                        try:
                            # Graceful reboot via VMware Tools
                            self._log_console(job_id, 'INFO', 'Sending reboot via VMware Tools (RebootGuest)...', job_details)
                            vm_obj.RebootGuest()
                            reboot_initiated = True  # Reboot initiated, but NOT confirmed yet
                        except Exception as e:
                            # Fall back to hard reset if graceful fails
                            self._log_console(job_id, 'WARN', f'Graceful reboot failed ({e}), using hard reset (ResetVM)...', job_details)
                            try:
                                task = vm_obj.ResetVM_Task()
                                self._wait_for_task(task, timeout=60)
                                reboot_initiated = True  # Reboot initiated, but NOT confirmed yet
                            except Exception as reset_err:
                                self._log_console(job_id, 'ERROR', f'Hard reset also failed: {reset_err}', job_details)
                        
                        if vc_conn:
                            Disconnect(vc_conn)
                            vc_conn = None
            except Exception as e:
                self._log_console(job_id, 'WARN', f'VMware API reboot failed: {e}, falling back to SSH', job_details)
                if vc_conn:
                    try:
                        Disconnect(vc_conn)
                    except:
                        pass
                    vc_conn = None
        
        # Fallback to SSH reboot if VMware API not available or failed
        if not reboot_initiated:
            self._log_console(job_id, 'INFO', 'Using SSH reboot fallback...', job_details)
            try:
                reboot_client = self._connect_ssh_password(vm_ip, 'root', root_password)
                if not reboot_client:
                    self._log_console(job_id, 'ERROR', 'Cannot connect to issue reboot command', job_details)
                    return None
                
                self._exec_ssh(reboot_client, 'nohup reboot &')
                reboot_client.close()
                reboot_initiated = True
            except Exception as e:
                self._log_console(job_id, 'WARN', f'SSH reboot command error (expected): {e}', job_details)
                reboot_initiated = True  # Command may have worked even if error
        
        # ALWAYS wait for SSH to fail after initiating reboot (confirms VM is actually rebooting)
        if reboot_initiated:
            time.sleep(3)  # Give reboot command time to start
            self._log_console(job_id, 'INFO', 'Waiting for VM to shut down...', job_details)
            consecutive_failures = 0
            
            for _ in range(30):
                test_client = self._connect_ssh_password(vm_ip, 'root', root_password)
                if test_client:
                    test_client.close()
                    consecutive_failures = 0
                else:
                    consecutive_failures += 1
                    if consecutive_failures >= 3:
                        shutdown_confirmed = True
                        break
                time.sleep(1)
        
        if not shutdown_confirmed:
            self._log_console(job_id, 'ERROR', 'VM did not shut down after 30s - reboot may have failed', job_details)
            return None
        
        shutdown_time = int(time.time() - shutdown_start)
        self._log_console(job_id, 'INFO', f'VM shutdown confirmed after {shutdown_time}s, waiting for boot...', job_details)
        
        # Wait for VM to come back up
        self._log_console(job_id, 'INFO', f'Waiting up to {max_wait}s for VM to boot...', job_details)
        start_time = time.time()
        ssh_client = None
        
        while time.time() - start_time < max_wait:
            elapsed = int(time.time() - start_time)
            try:
                ssh_client = self._connect_ssh_password(vm_ip, 'root', root_password)
                if ssh_client:
                    self._log_console(job_id, 'INFO', f'SSH reconnected after {elapsed}s', job_details)
                    break
            except Exception:
                pass
            
            # Log progress every 30 seconds
            if elapsed % 30 == 0 and elapsed > 0:
                self._log_console(job_id, 'INFO', f'Still waiting for VM to boot... ({elapsed}s)', job_details)
            
            time.sleep(5)
        
        if not ssh_client:
            self._log_console(job_id, 'ERROR', f'VM did not come back up within {max_wait}s', job_details)
            return None
        
        # Give the system a moment to fully initialize services
        time.sleep(5)
        
        # Verify ZFS module is loaded
        self._log_console(job_id, 'INFO', 'Verifying ZFS kernel module after reboot...', job_details)
        result = self._exec_ssh(ssh_client, 'lsmod | grep -E "^zfs\\s"')
        
        if result['exit_code'] == 0 and 'zfs' in result['stdout']:
            self._log_console(job_id, 'INFO', 'ZFS module loaded successfully after reboot', job_details)
            
            # Also verify zpool/zfs commands work
            zfs_check = self._exec_ssh(ssh_client, 'zfs version 2>/dev/null')
            if zfs_check['exit_code'] == 0:
                self._log_console(job_id, 'INFO', f'ZFS verified: {zfs_check["stdout"].strip().split(chr(10))[0]}', job_details)
            
            return ssh_client
        else:
            # ZFS module not loaded - try to load it manually
            self._log_console(job_id, 'WARN', 'ZFS module not auto-loaded, attempting manual load...', job_details)
            
            # Try modprobe
            result = self._exec_ssh(ssh_client, 'modprobe zfs 2>&1')
            if result['exit_code'] == 0:
                # Check again
                lsmod_result = self._exec_ssh(ssh_client, 'lsmod | grep -E "^zfs\\s"')
                if lsmod_result['exit_code'] == 0:
                    self._log_console(job_id, 'INFO', 'ZFS module loaded via modprobe after reboot', job_details)
                    
                    # Ensure it loads on next boot too
                    self._exec_ssh(ssh_client, 'echo "zfs" >> /etc/modules-load.d/zfs.conf')
                    self._log_console(job_id, 'INFO', 'Added zfs to /etc/modules-load.d/zfs.conf for future boots', job_details)
                    
                    return ssh_client
            
            # If still failing, try DKMS rebuild with detailed diagnostics
            self._log_console(job_id, 'WARN', 'modprobe failed, attempting DKMS rebuild...', job_details)
            
            # Get kernel info for diagnostics
            kernel_info = self._exec_ssh(ssh_client, 'uname -r')
            kernel_version = kernel_info['stdout'].strip()
            self._log_console(job_id, 'INFO', f'Current kernel: {kernel_version}', job_details)
            
            # Check DKMS status
            dkms_status = self._exec_ssh(ssh_client, 'dkms status 2>&1')
            self._log_console(job_id, 'INFO', f'DKMS status: {dkms_status["stdout"].strip()}', job_details)
            
            # Check if headers are installed for current kernel
            headers_check = self._exec_ssh(ssh_client, f'ls -la /lib/modules/{kernel_version}/build 2>&1')
            if headers_check['exit_code'] != 0:
                self._log_console(job_id, 'ERROR', f'Kernel headers missing for {kernel_version}: {headers_check["stderr"]}', job_details)
                # Try to install headers
                self._exec_ssh(ssh_client, f'apt-get update && apt-get install -y linux-headers-{kernel_version} || apt-get install -y linux-headers-amd64')
            
            # Run dkms autoinstall with output
            autoinstall_result = self._exec_ssh(ssh_client, 'dkms autoinstall 2>&1')
            self._log_console(job_id, 'INFO', f'DKMS autoinstall output:\n{autoinstall_result["stdout"][-500:]}', job_details)
            
            result = self._exec_ssh(ssh_client, 'modprobe zfs 2>&1')
            
            if result['exit_code'] == 0:
                lsmod_result = self._exec_ssh(ssh_client, 'lsmod | grep -E "^zfs\\s"')
                if lsmod_result['exit_code'] == 0:
                    self._log_console(job_id, 'INFO', 'ZFS module loaded after DKMS rebuild', job_details)
                    self._exec_ssh(ssh_client, 'echo "zfs" >> /etc/modules-load.d/zfs.conf')
                    return ssh_client
            
            # Complete failure - provide detailed diagnostics
            self._log_console(job_id, 'ERROR', 'ZFS kernel module failed to load after reboot', job_details)
            
            # Collect detailed diagnostic information
            modinfo_result = self._exec_ssh(ssh_client, 'modinfo zfs 2>&1')
            dmesg_result = self._exec_ssh(ssh_client, 'dmesg | grep -i zfs | tail -10 2>&1')
            
            error_details = f"""
=== ZFS Module Diagnostics ===
Kernel: {kernel_version}
DKMS Status: {dkms_status['stdout'].strip()}
modinfo zfs: {modinfo_result['stderr'].strip() if modinfo_result['exit_code'] != 0 else modinfo_result['stdout'][:200]}
dmesg ZFS: {dmesg_result['stdout'].strip()[-300:]}
modprobe error: {result['stdout']} {result['stderr']}
"""
            self._log_console(job_id, 'ERROR', error_details, job_details)
            job_details['zfs_diagnostics'] = {
                'kernel': kernel_version,
                'dkms_status': dkms_status['stdout'].strip(),
                'modinfo': modinfo_result['stderr'] if modinfo_result['exit_code'] != 0 else modinfo_result['stdout'][:200],
                'dmesg': dmesg_result['stdout'].strip()[-300:],
            }
            
            ssh_client.close()
            return None
    
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
                    self.log(f'Retrieved vCenter settings for {vc.get("host", "unknown")} (user: {vc.get("username", "unknown")})', 'DEBUG')
                    # Decrypt password
                    if vc.get('password_encrypted'):
                        decrypted = self._decrypt_password(vc['password_encrypted'])
                        # Detect if decryption failed (returned encrypted string unchanged)
                        if decrypted == vc['password_encrypted']:
                            self.log('WARNING: vCenter password may not have been decrypted correctly - check encryption key configuration', 'WARNING')
                        vc['password'] = decrypted
                    else:
                        self.log('WARNING: No encrypted password found for vCenter', 'WARNING')
                    return vc
            return None
        except Exception as e:
            self.log(f'Failed to get vCenter settings: {e}', 'ERROR')
            return None
    
    def _decrypt_password(self, encrypted: str) -> str:
        """Decrypt password using database RPC function (AES encryption)"""
        if not encrypted:
            return ''
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            # First get the encryption key
            key_response = requests.get(
                f'{DSM_URL}/rest/v1/rpc/get_encryption_key',
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json'
                },
                verify=VERIFY_SSL
            )
            
            if key_response.status_code != 200:
                self.log(f'Failed to get encryption key: {key_response.status_code}', 'ERROR')
                return encrypted
                
            encryption_key = key_response.json()
            if not encryption_key:
                self.log('WARNING: No encryption key available in database', 'WARNING')
                return encrypted
            
            # Call the database decrypt_password RPC function
            response = requests.post(
                f'{DSM_URL}/rest/v1/rpc/decrypt_password',
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json'
                },
                json={
                    'encrypted': encrypted,
                    'key': encryption_key
                },
                verify=VERIFY_SSL
            )
            
            if response.status_code == 200:
                decrypted = response.json()
                if decrypted:
                    self.log('Password decrypted successfully via RPC', 'DEBUG')
                    return decrypted
                else:
                    self.log('Decryption RPC returned null', 'WARNING')
                    return encrypted
            else:
                self.log(f'Decryption RPC failed: {response.status_code} - {response.text}', 'ERROR')
                return encrypted
                
        except Exception as e:
            self.log(f'Password decryption failed: {e}', 'ERROR')
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
    
    def _find_resource_pool_for_cluster(self, si: Any, cluster_name: str) -> Optional[Any]:
        """Find resource pool for a given cluster name"""
        try:
            if not cluster_name:
                self.log('No cluster name provided for resource pool lookup', 'WARNING')
                return None
            
            content = si.RetrieveContent()
            
            # Search all datacenters for the cluster
            for dc in content.rootFolder.childEntity:
                if hasattr(dc, 'hostFolder'):
                    # Search compute resources (clusters and standalone hosts)
                    for compute_resource in dc.hostFolder.childEntity:
                        if hasattr(compute_resource, 'name') and compute_resource.name == cluster_name:
                            if hasattr(compute_resource, 'resourcePool'):
                                self.log(f'Found resource pool for cluster: {cluster_name}', 'DEBUG')
                                return compute_resource.resourcePool
            
            self.log(f'No resource pool found for cluster: {cluster_name}', 'WARNING')
            return None
        except Exception as e:
            self.log(f'Failed to find resource pool for cluster {cluster_name}: {e}', 'ERROR')
            return None
