"""
Cross-vCenter Template Copy Handler

Handles copying VM templates between vCenters using OVF export/import.
This is useful for replicating ZFS target templates across sites.
"""

import os
import ssl
import time
import tempfile
import shutil
from typing import Dict, Optional, Any
from datetime import datetime, timezone

from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim

from job_executor.handlers.base import BaseHandler
from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
from job_executor.utils import utc_now_iso

import requests


class TemplateCopyHandler(BaseHandler):
    """
    Handles cross-vCenter template copying via OVF export/import.
    
    The process:
    1. Connect to source vCenter
    2. Export template as OVF to temporary directory
    3. Connect to destination vCenter
    4. Import OVF to create new VM
    5. Convert VM to template
    6. Update database with new template entry
    """
    
    def execute_copy_template(self, job: Dict):
        """
        Execute cross-vCenter template copy.
        
        Expected job details:
        - source_template_id: UUID of the zfs_target_templates entry
        - source_vcenter_id: UUID of source vCenter
        - source_template_moref: MoRef ID of source template
        - source_template_name: Name of source template
        - dest_vcenter_id: UUID of destination vCenter
        - dest_datacenter: Optional datacenter name in destination
        - dest_cluster: Optional cluster name in destination
        - dest_datastore: Required datastore name in destination
        - new_template_name: Name for the new template
        - create_db_entry: Whether to create a zfs_target_templates entry
        - template_settings: Settings to copy to new template entry
        """
        job_id = job['id']
        details = job.get('details', {}) or {}
        
        # Initialize job
        job_details = {
            'progress_percent': 0,
            'current_step': 'Initializing',
            'console_log': []
        }
        
        self._log_console(job_id, 'INFO', 'Starting cross-vCenter template copy', job_details)
        self.update_job_status(job_id, 'running', started_at=utc_now_iso(), details=job_details)
        
        # Extract parameters
        source_vcenter_id = details.get('source_vcenter_id')
        source_template_moref = details.get('source_template_moref')
        source_template_name = details.get('source_template_name')
        dest_vcenter_id = details.get('dest_vcenter_id')
        dest_datacenter = details.get('dest_datacenter')
        dest_cluster = details.get('dest_cluster')
        dest_datastore = details.get('dest_datastore')
        new_template_name = details.get('new_template_name')
        create_db_entry = details.get('create_db_entry', True)
        template_settings = details.get('template_settings', {})
        
        # Validate required fields
        if not all([source_vcenter_id, source_template_moref, dest_vcenter_id, dest_datastore, new_template_name]):
            self._fail_job(job_id, 'Missing required parameters', job_details)
            return
        
        source_conn = None
        dest_conn = None
        temp_dir = None
        
        try:
            # Step 1: Get vCenter credentials
            job_details['current_step'] = 'Fetching vCenter credentials'
            job_details['progress_percent'] = 5
            self._log_console(job_id, 'INFO', 'Fetching vCenter credentials...', job_details)
            self._update_details(job_id, job_details)
            
            source_vc = self._get_vcenter_settings(source_vcenter_id)
            dest_vc = self._get_vcenter_settings(dest_vcenter_id)
            
            if not source_vc or not dest_vc:
                self._fail_job(job_id, 'Failed to get vCenter settings', job_details)
                return
            
            # Step 2: Connect to source vCenter
            job_details['current_step'] = 'Connecting to source vCenter'
            job_details['progress_percent'] = 10
            self._log_console(job_id, 'INFO', f'Connecting to source vCenter: {source_vc["host"]}', job_details)
            self._update_details(job_id, job_details)
            
            source_conn = self._connect_vcenter(
                source_vc['host'],
                source_vc['username'],
                source_vc['password'],
                source_vc.get('port', 443),
                source_vc.get('verify_ssl', False)
            )
            
            if not source_conn:
                self._fail_job(job_id, f'Failed to connect to source vCenter: {source_vc["host"]}', job_details)
                return
            
            # Step 3: Find source template
            job_details['current_step'] = 'Finding source template'
            job_details['progress_percent'] = 15
            self._log_console(job_id, 'INFO', f'Looking for template: {source_template_name} ({source_template_moref})', job_details)
            self._update_details(job_id, job_details)
            
            source_vm = self._find_vm_by_moref(source_conn, source_template_moref)
            if not source_vm:
                self._fail_job(job_id, f'Template not found: {source_template_moref}', job_details)
                return
            
            self._log_console(job_id, 'INFO', f'Found template: {source_vm.name}', job_details)
            
            # Step 4: Connect to destination vCenter
            job_details['current_step'] = 'Connecting to destination vCenter'
            job_details['progress_percent'] = 20
            self._log_console(job_id, 'INFO', f'Connecting to destination vCenter: {dest_vc["host"]}', job_details)
            self._update_details(job_id, job_details)
            
            dest_conn = self._connect_vcenter(
                dest_vc['host'],
                dest_vc['username'],
                dest_vc['password'],
                dest_vc.get('port', 443),
                dest_vc.get('verify_ssl', False)
            )
            
            if not dest_conn:
                self._fail_job(job_id, f'Failed to connect to destination vCenter: {dest_vc["host"]}', job_details)
                return
            
            # Step 5: Find destination resources
            job_details['current_step'] = 'Finding destination resources'
            job_details['progress_percent'] = 25
            self._log_console(job_id, 'INFO', 'Finding destination cluster, datastore, and resource pool...', job_details)
            self._update_details(job_id, job_details)
            
            dest_resources = self._find_destination_resources(
                dest_conn, dest_datacenter, dest_cluster, dest_datastore
            )
            
            if not dest_resources.get('datastore'):
                self._fail_job(job_id, f'Datastore not found: {dest_datastore}', job_details)
                return
            
            self._log_console(job_id, 'INFO', f'Found datastore: {dest_resources["datastore"].name}', job_details)
            
            if dest_resources.get('cluster'):
                self._log_console(job_id, 'INFO', f'Found cluster: {dest_resources["cluster"].name}', job_details)
            
            # Step 6: Clone template using Cross-vCenter Clone
            job_details['current_step'] = 'Cloning template to destination'
            job_details['progress_percent'] = 30
            self._log_console(job_id, 'INFO', 'Starting template clone (this may take several minutes)...', job_details)
            self._update_details(job_id, job_details)
            
            # Use cross-vCenter clone if possible, otherwise fall back to OVF
            new_vm = self._clone_template_cross_vcenter(
                source_conn, dest_conn, source_vm,
                dest_resources, new_template_name,
                job_id, job_details
            )
            
            if not new_vm:
                # Fall back to OVF export/import
                self._log_console(job_id, 'INFO', 'Direct clone not available, using OVF export/import...', job_details)
                
                temp_dir = tempfile.mkdtemp(prefix='template_copy_')
                self._log_console(job_id, 'INFO', f'Using temp directory: {temp_dir}', job_details)
                
                # Export OVF
                job_details['current_step'] = 'Exporting OVF from source'
                job_details['progress_percent'] = 40
                self._update_details(job_id, job_details)
                
                ovf_path = self._export_ovf(source_conn, source_vm, temp_dir, job_id, job_details)
                if not ovf_path:
                    self._fail_job(job_id, 'Failed to export OVF', job_details)
                    return
                
                # Import OVF
                job_details['current_step'] = 'Importing OVF to destination'
                job_details['progress_percent'] = 60
                self._update_details(job_id, job_details)
                
                new_vm = self._import_ovf(
                    dest_conn, ovf_path, dest_resources,
                    new_template_name, job_id, job_details
                )
                
                if not new_vm:
                    self._fail_job(job_id, 'Failed to import OVF', job_details)
                    return
            
            # Step 7: Mark as template
            job_details['current_step'] = 'Converting to template'
            job_details['progress_percent'] = 85
            self._log_console(job_id, 'INFO', 'Marking VM as template...', job_details)
            self._update_details(job_id, job_details)
            
            try:
                new_vm.MarkAsTemplate()
                self._log_console(job_id, 'INFO', 'VM marked as template successfully', job_details)
            except Exception as e:
                self._log_console(job_id, 'WARN', f'Could not mark as template (may already be): {e}', job_details)
            
            # Step 8: Create database entry if requested
            new_template_id = None
            new_moref = str(new_vm._moId) if new_vm else None
            
            if create_db_entry and template_settings:
                job_details['current_step'] = 'Creating database entry'
                job_details['progress_percent'] = 90
                self._log_console(job_id, 'INFO', 'Creating template database entry...', job_details)
                self._update_details(job_id, job_details)
                
                new_template_id = self._create_template_db_entry(
                    dest_vcenter_id, new_moref, new_template_name,
                    dest_cluster, dest_datastore, template_settings
                )
                
                if new_template_id:
                    self._log_console(job_id, 'INFO', f'Created template entry: {new_template_id}', job_details)
                else:
                    self._log_console(job_id, 'WARN', 'Failed to create database entry', job_details)
            
            # Success!
            job_details['current_step'] = 'Complete'
            job_details['progress_percent'] = 100
            job_details['success'] = True
            job_details['new_template_moref'] = new_moref
            job_details['new_template_name'] = new_template_name
            job_details['new_template_id'] = new_template_id
            
            self._log_console(job_id, 'INFO', f'✓ Template copied successfully: {new_template_name}', job_details)
            self.update_job_status(job_id, 'completed', completed_at=utc_now_iso(), details=job_details)
            
        except Exception as e:
            self.log(f'Template copy failed: {e}', 'ERROR')
            self._log_console(job_id, 'ERROR', f'Copy failed: {str(e)}', job_details)
            self._fail_job(job_id, str(e), job_details)
        
        finally:
            # Cleanup
            if source_conn:
                try:
                    Disconnect(source_conn)
                except:
                    pass
            if dest_conn:
                try:
                    Disconnect(dest_conn)
                except:
                    pass
            if temp_dir and os.path.exists(temp_dir):
                try:
                    shutil.rmtree(temp_dir)
                except:
                    pass
    
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
                    # Decrypt password
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
        """Find VM/template by MoRef ID."""
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
    
    def _find_destination_resources(self, conn, datacenter_name: Optional[str],
                                    cluster_name: Optional[str], datastore_name: str) -> Dict:
        """Find destination resources in vCenter."""
        resources = {}
        content = conn.RetrieveContent()
        
        try:
            # Find datacenter
            datacenter = None
            for dc in content.rootFolder.childEntity:
                if isinstance(dc, vim.Datacenter):
                    if not datacenter_name or dc.name == datacenter_name:
                        datacenter = dc
                        break
            
            if datacenter:
                resources['datacenter'] = datacenter
                
                # Find cluster
                if cluster_name:
                    for cluster in datacenter.hostFolder.childEntity:
                        if isinstance(cluster, vim.ClusterComputeResource) and cluster.name == cluster_name:
                            resources['cluster'] = cluster
                            resources['resource_pool'] = cluster.resourcePool
                            break
                
                # If no cluster specified, find any resource pool
                if not resources.get('resource_pool'):
                    for entity in datacenter.hostFolder.childEntity:
                        if isinstance(entity, vim.ClusterComputeResource):
                            resources['resource_pool'] = entity.resourcePool
                            break
                        elif isinstance(entity, vim.ComputeResource):
                            resources['resource_pool'] = entity.resourcePool
                            break
                
                # Find datastore
                for ds in datacenter.datastore:
                    if ds.name == datastore_name:
                        resources['datastore'] = ds
                        break
                
                # Find network (use first available)
                if datacenter.network:
                    resources['network'] = datacenter.network[0]
                
                # VM folder
                resources['folder'] = datacenter.vmFolder
            
        except Exception as e:
            self.log(f'Error finding destination resources: {e}', 'ERROR')
        
        return resources
    
    def _clone_template_cross_vcenter(self, source_conn, dest_conn, source_vm,
                                       dest_resources: Dict, new_name: str,
                                       job_id: str, job_details: Dict):
        """
        Try to clone template directly (works if vCenters are in same SSO domain).
        Returns None if cross-vCenter clone is not supported.
        """
        try:
            # For cross-vCenter in same SSO domain, we can use regular clone
            # with linked clone disabled
            
            # Create clone spec
            relocate_spec = vim.vm.RelocateSpec()
            relocate_spec.datastore = dest_resources.get('datastore')
            relocate_spec.pool = dest_resources.get('resource_pool')
            relocate_spec.folder = dest_resources.get('folder')
            
            clone_spec = vim.vm.CloneSpec()
            clone_spec.location = relocate_spec
            clone_spec.powerOn = False
            clone_spec.template = True
            
            # Try the clone
            folder = dest_resources.get('folder')
            if not folder:
                return None
            
            self._log_console(job_id, 'INFO', 'Attempting direct clone...', job_details)
            
            task = source_vm.Clone(folder=folder, name=new_name, spec=clone_spec)
            
            # Monitor task
            while task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
                if task.info.progress:
                    progress = 30 + int(task.info.progress * 0.5)  # 30-80%
                    job_details['progress_percent'] = progress
                    self._update_details(job_id, job_details)
                time.sleep(5)
            
            if task.info.state == vim.TaskInfo.State.success:
                self._log_console(job_id, 'INFO', 'Clone completed successfully', job_details)
                return task.info.result
            else:
                self._log_console(job_id, 'WARN', f'Clone failed: {task.info.error}', job_details)
                return None
                
        except Exception as e:
            self._log_console(job_id, 'INFO', f'Direct clone not available: {e}', job_details)
            return None
    
    def _export_ovf(self, conn, vm, temp_dir: str, job_id: str, job_details: Dict) -> Optional[str]:
        """Export VM as OVF to temporary directory."""
        try:
            self._log_console(job_id, 'INFO', 'Creating OVF export lease...', job_details)
            
            # Get HTTP NFC lease for export
            lease = vm.ExportVm()
            
            # Wait for lease to be ready
            while lease.state == vim.HttpNfcLease.State.initializing:
                time.sleep(1)
            
            if lease.state != vim.HttpNfcLease.State.ready:
                self._log_console(job_id, 'ERROR', f'Lease failed: {lease.error}', job_details)
                return None
            
            self._log_console(job_id, 'INFO', 'Export lease ready, downloading files...', job_details)
            
            # Download OVF files
            ovf_path = os.path.join(temp_dir, f'{vm.name}.ovf')
            
            # For each device URL in the lease, download the file
            for device_url in lease.info.deviceUrl:
                if device_url.disk:
                    url = device_url.url
                    filename = device_url.targetId or 'disk.vmdk'
                    filepath = os.path.join(temp_dir, filename)
                    
                    self._log_console(job_id, 'INFO', f'Downloading: {filename}', job_details)
                    
                    # Download with session cookies
                    # Note: In production, use proper authentication
                    response = requests.get(url, verify=False, stream=True)
                    with open(filepath, 'wb') as f:
                        for chunk in response.iter_content(chunk_size=8192):
                            f.write(chunk)
                            lease.HttpNfcLeaseProgress(50)
            
            lease.HttpNfcLeaseComplete()
            
            self._log_console(job_id, 'INFO', 'OVF export completed', job_details)
            return ovf_path
            
        except Exception as e:
            self._log_console(job_id, 'ERROR', f'OVF export failed: {e}', job_details)
            try:
                lease.HttpNfcLeaseAbort()
            except:
                pass
            return None
    
    def _import_ovf(self, conn, ovf_path: str, dest_resources: Dict,
                    new_name: str, job_id: str, job_details: Dict):
        """Import OVF to destination vCenter."""
        try:
            self._log_console(job_id, 'INFO', 'Preparing OVF import...', job_details)
            
            content = conn.RetrieveContent()
            
            # Read OVF descriptor
            with open(ovf_path, 'r') as f:
                ovf_descriptor = f.read()
            
            # Create import spec
            ovf_manager = content.ovfManager
            
            import_spec_params = vim.OvfManager.CreateImportSpecParams()
            import_spec_params.entityName = new_name
            
            resource_pool = dest_resources.get('resource_pool')
            datastore = dest_resources.get('datastore')
            
            import_spec = ovf_manager.CreateImportSpec(
                ovfDescriptor=ovf_descriptor,
                resourcePool=resource_pool,
                datastore=datastore,
                cisp=import_spec_params
            )
            
            if import_spec.error:
                self._log_console(job_id, 'ERROR', f'Import spec error: {import_spec.error}', job_details)
                return None
            
            # Start import
            folder = dest_resources.get('folder')
            lease = resource_pool.ImportVApp(import_spec.importSpec, folder)
            
            while lease.state == vim.HttpNfcLease.State.initializing:
                time.sleep(1)
            
            if lease.state != vim.HttpNfcLease.State.ready:
                self._log_console(job_id, 'ERROR', f'Import lease failed: {lease.error}', job_details)
                return None
            
            self._log_console(job_id, 'INFO', 'Import lease ready, uploading files...', job_details)
            
            # Upload disk files
            temp_dir = os.path.dirname(ovf_path)
            for device_url in lease.info.deviceUrl:
                if device_url.disk:
                    url = device_url.url
                    # Find matching file in temp dir
                    for file in os.listdir(temp_dir):
                        if file.endswith('.vmdk'):
                            filepath = os.path.join(temp_dir, file)
                            
                            self._log_console(job_id, 'INFO', f'Uploading: {file}', job_details)
                            
                            with open(filepath, 'rb') as f:
                                requests.put(url, data=f, verify=False)
                            
                            lease.HttpNfcLeaseProgress(80)
                            break
            
            lease.HttpNfcLeaseComplete()
            
            # Find the imported VM
            time.sleep(2)
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.VirtualMachine], True
            )
            
            for vm in container.view:
                if vm.name == new_name:
                    container.Destroy()
                    self._log_console(job_id, 'INFO', 'OVF import completed', job_details)
                    return vm
            
            container.Destroy()
            return None
            
        except Exception as e:
            self._log_console(job_id, 'ERROR', f'OVF import failed: {e}', job_details)
            return None
    
    def _create_template_db_entry(self, vcenter_id: str, moref: str, 
                                   template_name: str, cluster: Optional[str],
                                   datastore: str, settings: Dict) -> Optional[str]:
        """Create new entry in zfs_target_templates table."""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            }
            
            entry = {
                'name': settings.get('name', f'{template_name} Template'),
                'description': settings.get('description'),
                'vcenter_id': vcenter_id,
                'template_moref': moref,
                'template_name': template_name,
                'default_cluster': cluster,
                'default_datastore': datastore,
                'default_zfs_pool_name': settings.get('default_zfs_pool_name', 'tank'),
                'default_zfs_disk_path': settings.get('default_zfs_disk_path', '/dev/sdb'),
                'default_nfs_network': settings.get('default_nfs_network', '10.0.0.0/8'),
                'default_cpu_count': settings.get('default_cpu_count', 2),
                'default_memory_gb': settings.get('default_memory_gb', 8),
                'default_zfs_disk_gb': settings.get('default_zfs_disk_gb', 500),
                'default_ssh_username': settings.get('default_ssh_username', 'zfsadmin'),
                'is_active': True
            }
            
            response = requests.post(
                f'{DSM_URL}/rest/v1/zfs_target_templates',
                json=entry,
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.ok:
                data = response.json()
                if data and len(data) > 0:
                    return data[0].get('id')
            
            self.log(f'Failed to create template entry: {response.text}', 'ERROR')
            return None
            
        except Exception as e:
            self.log(f'Error creating template DB entry: {e}', 'ERROR')
            return None
    
    def _log_console(self, job_id: str, level: str, message: str, job_details: Dict):
        """Add timestamped message to console log."""
        timestamp = datetime.now(timezone.utc).strftime('%H:%M:%S')
        log_entry = f'[{timestamp}] [{level}] {message}'
        
        console_log = job_details.get('console_log', [])
        if not isinstance(console_log, list):
            console_log = []
        console_log.append(log_entry)
        job_details['console_log'] = console_log
        
        self.log(message, level)
    
    def _update_details(self, job_id: str, job_details: Dict):
        """Update job details in database."""
        self.update_job_details_field(job_id, job_details)
    
    def _fail_job(self, job_id: str, error: str, job_details: Dict):
        """Mark job as failed with error message."""
        job_details['success'] = False
        job_details['error'] = error
        self._log_console(job_id, 'ERROR', error, job_details)
        self.update_job_status(job_id, 'failed', completed_at=utc_now_iso(), details=job_details)
