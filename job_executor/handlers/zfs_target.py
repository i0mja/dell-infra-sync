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
        
        # Guest customization for hostname/IP
        hostname = details.get('hostname', vm_name)
        use_dhcp = details.get('use_dhcp', True)
        
        if hostname or not use_dhcp:
            self._log_console(job_id, 'INFO', f'Applying guest customization (hostname: {hostname})', details)
            clone_spec.customization = self._build_customization_spec(details)
        
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
                
                # Parse private key
                pkey = paramiko.RSAKey.from_private_key(io.StringIO(private_key))
                
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
                hostname = stdout.read().decode().strip()
                self._log_console(job_id, 'INFO', f'SSH connected to: {hostname}', details)
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
