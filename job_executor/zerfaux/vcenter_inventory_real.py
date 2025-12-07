"""
vCenter Inventory Module - Real Implementation

This module handles VM inventory synchronization from vCenter using pyVmomi.
Replaces VCenterInventoryStub when ZERFAUX_USE_STUBS=false.

Uses pyVmomi for:
- Connecting to vCenter via SmartConnect
- Fetching VM inventory (name, MoRef, power_state, resources, datastore)
- Fetching datastore information
- Storage vMotion (RelocateVM_Task)
"""

import ssl
import time
import logging
from datetime import datetime
from typing import Dict, List, Optional

try:
    from pyVim.connect import SmartConnect, Disconnect
    from pyVmomi import vim
    from pyVim.task import WaitForTask
    PYVMOMI_AVAILABLE = True
except ImportError:
    PYVMOMI_AVAILABLE = False
    vim = None

logger = logging.getLogger(__name__)


class VCenterInventoryReal:
    """
    Real implementation of vCenter inventory sync using pyVmomi.
    
    Connects to vCenter to retrieve actual VM inventory and perform
    Storage vMotion operations.
    """
    
    def __init__(self, executor=None):
        """
        Initialize the inventory handler.
        
        Args:
            executor: Optional reference to JobExecutor for DB access
        """
        self.executor = executor
        self._connections = {}  # Cache connections by vcenter_id
        
        if not PYVMOMI_AVAILABLE:
            logger.warning("pyVmomi not available - vCenter operations will fail")
    
    def _get_vcenter_settings(self, vcenter_id: str) -> Optional[Dict]:
        """Get vCenter settings from database"""
        if not self.executor:
            return None
        
        try:
            import requests
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenters",
                params={'id': f'eq.{vcenter_id}'},
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.ok:
                settings = response.json()
                return settings[0] if settings else None
        except Exception as e:
            logger.error(f"Failed to get vCenter settings: {e}")
        
        return None
    
    def _decrypt_password(self, encrypted: str) -> Optional[str]:
        """Decrypt password using executor's credentials mixin"""
        if not encrypted:
            return None
        
        if self.executor and hasattr(self.executor, 'decrypt_password'):
            return self.executor.decrypt_password(encrypted)
        
        # If not encrypted or no executor, return as-is
        return encrypted
    
    def _connect_vcenter(self, host: str, username: str, password: str, 
                         port: int = 443, verify_ssl: bool = False) -> Optional[object]:
        """
        Connect to vCenter using pyVmomi.
        
        Args:
            host: vCenter hostname or IP
            username: vCenter username
            password: vCenter password
            port: vCenter port (default 443)
            verify_ssl: Whether to verify SSL certificates
            
        Returns:
            ServiceInstance or None
        """
        if not PYVMOMI_AVAILABLE:
            logger.error("pyVmomi not installed")
            return None
        
        try:
            # Create SSL context
            ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            if not verify_ssl:
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE
            
            si = SmartConnect(
                host=host,
                user=username,
                pwd=password,
                port=port,
                sslContext=ssl_context,
                disableSslCertValidation=not verify_ssl
            )
            
            if si:
                logger.info(f"Connected to vCenter: {host}")
                return si
                
        except Exception as e:
            logger.error(f"Failed to connect to vCenter {host}: {e}")
        
        return None
    
    def sync_inventory(self, vcenter_id: str, vcenter_host: str, 
                       username: str = None, password: str = None) -> Dict:
        """
        Sync VM inventory from vCenter.
        
        Connects to vCenter via pyVmomi, retrieves all VMs, and returns
        the inventory data.
        
        Args:
            vcenter_id: UUID of vCenter connection
            vcenter_host: vCenter hostname or IP
            username: vCenter username
            password: vCenter password
            
        Returns:
            Dict with sync results
        """
        start_time = time.time()
        logger.info(f"Syncing inventory from vCenter: {vcenter_host}")
        
        if not PYVMOMI_AVAILABLE:
            return {
                'success': False,
                'vcenter_id': vcenter_id,
                'vcenter_host': vcenter_host,
                'vms_found': 0,
                'vms': [],
                'error': 'pyVmomi not installed',
                'message': 'pyVmomi library not available'
            }
        
        # Connect to vCenter
        si = self._connect_vcenter(vcenter_host, username, password)
        if not si:
            return {
                'success': False,
                'vcenter_id': vcenter_id,
                'vcenter_host': vcenter_host,
                'vms_found': 0,
                'vms': [],
                'error': 'Connection failed',
                'message': f'Failed to connect to vCenter {vcenter_host}'
            }
        
        try:
            content = si.RetrieveContent()
            
            # Create container view for VMs
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.VirtualMachine], True
            )
            
            vms = []
            for vm in container.view:
                try:
                    vm_data = self._extract_vm_data(vcenter_id, vm)
                    if vm_data:
                        vms.append(vm_data)
                except Exception as vm_err:
                    logger.warning(f"Error extracting VM data: {vm_err}")
                    continue
            
            container.Destroy()
            
            elapsed = time.time() - start_time
            logger.info(f"Synced {len(vms)} VMs from {vcenter_host} in {elapsed:.2f}s")
            
            return {
                'success': True,
                'vcenter_id': vcenter_id,
                'vcenter_host': vcenter_host,
                'vms_found': len(vms),
                'vms': vms,
                'synced_at': datetime.utcnow().isoformat(),
                'elapsed_seconds': round(elapsed, 2),
                'message': f'Synced {len(vms)} VMs from {vcenter_host}'
            }
            
        except Exception as e:
            logger.error(f"Error syncing inventory: {e}")
            return {
                'success': False,
                'vcenter_id': vcenter_id,
                'vcenter_host': vcenter_host,
                'vms_found': 0,
                'vms': [],
                'error': str(e),
                'message': f'Error syncing inventory: {e}'
            }
        finally:
            try:
                Disconnect(si)
            except:
                pass
    
    def _extract_vm_data(self, vcenter_id: str, vm) -> Optional[Dict]:
        """Extract VM data from pyVmomi VM object"""
        try:
            # Get basic info
            name = vm.name
            moref = str(vm._moId)
            
            # Power state
            power_state = 'unknown'
            if vm.runtime and vm.runtime.powerState:
                power_state = str(vm.runtime.powerState).replace('poweredOn', 'poweredOn').replace('poweredOff', 'poweredOff')
            
            # Config info
            cpu_count = 0
            memory_mb = 0
            guest_os = ''
            uuid = ''
            
            if vm.config:
                cpu_count = vm.config.hardware.numCPU if vm.config.hardware else 0
                memory_mb = vm.config.hardware.memoryMB if vm.config.hardware else 0
                guest_os = vm.config.guestFullName or ''
                uuid = vm.config.uuid or ''
            elif vm.summary and vm.summary.config:
                cpu_count = vm.summary.config.numCpu or 0
                memory_mb = vm.summary.config.memorySizeMB or 0
                guest_os = vm.summary.config.guestFullName or ''
            
            # Get primary datastore
            datastore = ''
            disk_gb = 0
            if vm.storage and vm.storage.perDatastoreUsage:
                for ds_usage in vm.storage.perDatastoreUsage:
                    if ds_usage.datastore:
                        datastore = ds_usage.datastore.name
                        disk_gb = round(ds_usage.committed / (1024**3), 2) if ds_usage.committed else 0
                        break
            
            # Get cluster
            cluster = ''
            host_name = ''
            if vm.runtime and vm.runtime.host:
                host = vm.runtime.host
                host_name = host.name if host else ''
                if hasattr(host, 'parent') and hasattr(host.parent, 'name'):
                    if isinstance(host.parent, vim.ClusterComputeResource):
                        cluster = host.parent.name
            
            # Get IP address
            ip_address = ''
            if vm.guest and vm.guest.ipAddress:
                ip_address = vm.guest.ipAddress
            
            # Tools status
            tools_status = ''
            tools_version = ''
            if vm.guest:
                tools_status = vm.guest.toolsStatus or ''
                tools_version = vm.guest.toolsVersion or ''
            
            return {
                'vcenter_id': vcenter_id,
                'vm_vcenter_id': moref,
                'name': name,
                'uuid': uuid,
                'power_state': power_state,
                'guest_os': guest_os,
                'cpu_count': cpu_count,
                'memory_mb': memory_mb,
                'disk_gb': disk_gb,
                'datastore': datastore,
                'cluster': cluster,
                'host': host_name,
                'ip_address': ip_address,
                'tools_status': tools_status,
                'tools_version': tools_version,
                'synced_at': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.warning(f"Error extracting VM data for {vm.name if hasattr(vm, 'name') else 'unknown'}: {e}")
            return None
    
    def get_vm_details(self, vcenter_id: str, vm_moref: str) -> Optional[Dict]:
        """
        Get detailed information about a specific VM.
        
        Args:
            vcenter_id: UUID of vCenter connection
            vm_moref: VMware MoRef ID of the VM
            
        Returns:
            Dict with VM details or None
        """
        settings = self._get_vcenter_settings(vcenter_id)
        if not settings:
            return None
        
        password = self._decrypt_password(settings.get('password_encrypted'))
        si = self._connect_vcenter(
            settings['host'],
            settings['username'],
            password,
            settings.get('port', 443),
            settings.get('verify_ssl', False)
        )
        
        if not si:
            return None
        
        try:
            content = si.RetrieveContent()
            
            # Find VM by MoRef
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.VirtualMachine], True
            )
            
            target_vm = None
            for vm in container.view:
                if str(vm._moId) == vm_moref:
                    target_vm = vm
                    break
            
            container.Destroy()
            
            if not target_vm:
                return None
            
            # Extract detailed info
            return self._extract_vm_data(vcenter_id, target_vm)
            
        except Exception as e:
            logger.error(f"Error getting VM details: {e}")
            return None
        finally:
            try:
                Disconnect(si)
            except:
                pass
    
    def get_datastores(self, vcenter_id: str) -> List[Dict]:
        """
        Get list of datastores from vCenter.
        
        Args:
            vcenter_id: UUID of vCenter connection
            
        Returns:
            List of datastore dicts
        """
        settings = self._get_vcenter_settings(vcenter_id)
        if not settings:
            return []
        
        password = self._decrypt_password(settings.get('password_encrypted'))
        si = self._connect_vcenter(
            settings['host'],
            settings['username'],
            password,
            settings.get('port', 443),
            settings.get('verify_ssl', False)
        )
        
        if not si:
            return []
        
        try:
            content = si.RetrieveContent()
            
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.Datastore], True
            )
            
            datastores = []
            for ds in container.view:
                try:
                    datastores.append({
                        'name': ds.name,
                        'capacity_gb': round(ds.summary.capacity / (1024**3), 2) if ds.summary.capacity else 0,
                        'free_gb': round(ds.summary.freeSpace / (1024**3), 2) if ds.summary.freeSpace else 0,
                        'type': ds.summary.type or 'Unknown'
                    })
                except:
                    continue
            
            container.Destroy()
            return datastores
            
        except Exception as e:
            logger.error(f"Error getting datastores: {e}")
            return []
        finally:
            try:
                Disconnect(si)
            except:
                pass
    
    def relocate_vm(self, vcenter_id: str, vm_moref: str, 
                    target_datastore: str) -> Dict:
        """
        Relocate (Storage vMotion) a VM to a different datastore.
        
        Uses pyVmomi RelocateVM_Task to perform the migration.
        
        Args:
            vcenter_id: UUID of vCenter connection
            vm_moref: VMware MoRef ID of the VM
            target_datastore: Name of target datastore
            
        Returns:
            Dict with relocation result
        """
        logger.info(f"Relocating VM {vm_moref} to {target_datastore}")
        start_time = time.time()
        
        if not PYVMOMI_AVAILABLE:
            return {
                'success': False,
                'vm_moref': vm_moref,
                'target_datastore': target_datastore,
                'error': 'pyVmomi not installed',
                'message': 'pyVmomi library not available'
            }
        
        settings = self._get_vcenter_settings(vcenter_id)
        if not settings:
            return {
                'success': False,
                'vm_moref': vm_moref,
                'target_datastore': target_datastore,
                'error': 'vCenter settings not found',
                'message': f'vCenter {vcenter_id} not found in settings'
            }
        
        password = self._decrypt_password(settings.get('password_encrypted'))
        si = self._connect_vcenter(
            settings['host'],
            settings['username'],
            password,
            settings.get('port', 443),
            settings.get('verify_ssl', False)
        )
        
        if not si:
            return {
                'success': False,
                'vm_moref': vm_moref,
                'target_datastore': target_datastore,
                'error': 'Connection failed',
                'message': f'Failed to connect to vCenter'
            }
        
        try:
            content = si.RetrieveContent()
            
            # Find VM by MoRef
            vm_container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.VirtualMachine], True
            )
            
            target_vm = None
            for vm in vm_container.view:
                if str(vm._moId) == vm_moref:
                    target_vm = vm
                    break
            
            vm_container.Destroy()
            
            if not target_vm:
                return {
                    'success': False,
                    'vm_moref': vm_moref,
                    'target_datastore': target_datastore,
                    'error': 'VM not found',
                    'message': f'VM with MoRef {vm_moref} not found'
                }
            
            # Find target datastore
            ds_container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.Datastore], True
            )
            
            target_ds = None
            for ds in ds_container.view:
                if ds.name == target_datastore:
                    target_ds = ds
                    break
            
            ds_container.Destroy()
            
            if not target_ds:
                return {
                    'success': False,
                    'vm_moref': vm_moref,
                    'target_datastore': target_datastore,
                    'error': 'Datastore not found',
                    'message': f'Datastore {target_datastore} not found'
                }
            
            # Build relocate spec
            relocate_spec = vim.vm.RelocateSpec()
            relocate_spec.datastore = target_ds
            
            # Execute Storage vMotion
            logger.info(f"Starting Storage vMotion for {target_vm.name} to {target_datastore}")
            task = target_vm.RelocateVM_Task(spec=relocate_spec)
            
            # Wait for task completion
            WaitForTask(task)
            
            elapsed = time.time() - start_time
            
            if task.info.state == vim.TaskInfo.State.success:
                logger.info(f"VM {target_vm.name} relocated successfully in {elapsed:.2f}s")
                return {
                    'success': True,
                    'vm_moref': vm_moref,
                    'vm_name': target_vm.name,
                    'target_datastore': target_datastore,
                    'elapsed_seconds': round(elapsed, 2),
                    'completed_at': datetime.utcnow().isoformat(),
                    'message': f'VM relocated to {target_datastore}'
                }
            else:
                error_msg = str(task.info.error) if task.info.error else 'Unknown error'
                logger.error(f"VM relocation failed: {error_msg}")
                return {
                    'success': False,
                    'vm_moref': vm_moref,
                    'target_datastore': target_datastore,
                    'error': error_msg,
                    'message': f'Relocation failed: {error_msg}'
                }
                
        except Exception as e:
            logger.error(f"Error relocating VM: {e}")
            return {
                'success': False,
                'vm_moref': vm_moref,
                'target_datastore': target_datastore,
                'error': str(e),
                'message': f'Relocation error: {e}'
            }
        finally:
            try:
                Disconnect(si)
            except:
                pass
