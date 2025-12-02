"""VCenter operations mixin for Job Executor"""

import ssl
import time
import requests
from typing import Dict, List, Optional
from datetime import datetime
from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim
import atexit

from job_executor.config import (
    DSM_URL,
    SERVICE_ROLE_KEY,
    VERIFY_SSL,
    VCENTER_HOST,
    VCENTER_USER,
    VCENTER_PASSWORD
)
from job_executor.utils import _safe_json_parse


class VCenterMixin:
    """Mixin providing vCenter operations for Job Executor"""
    
    def log_vcenter_activity(
        self,
        operation: str,
        endpoint: str,
        success: bool,
        status_code: int = None,
        response_time_ms: int = 0,
        error: str = None,
        details: Dict = None,
        job_id: str = None
    ):
        """Log vCenter API activity to idrac_commands table with operation_type='vcenter_api'"""
        try:
            log_entry = {
                'server_id': None,  # vCenter operations aren't server-specific
                'job_id': job_id,
                'task_id': None,
                'command_type': operation,
                'endpoint': endpoint,
                'full_url': f"vcenter://{endpoint}",
                'request_headers': None,
                'request_body': details,
                'status_code': status_code if status_code is not None else (200 if success else 500),
                'response_time_ms': response_time_ms,
                'response_body': details if success else None,
                'success': success,
                'error_message': error,
                'initiated_by': None,
                'source': 'job_executor',
                'operation_type': 'vcenter_api'
            }
            
            response = requests.post(
                f"{DSM_URL}/rest/v1/idrac_commands",
                headers={
                    "apikey": SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal"
                },
                json=log_entry,
                verify=VERIFY_SSL,
                timeout=5
            )
            
            if response.status_code not in [200, 201]:
                self.log(f"Failed to log vCenter activity: {response.status_code}", "DEBUG")
                
        except Exception as e:
            # Don't let logging failures break job execution
            self.log(f"vCenter logging exception: {e}", "DEBUG")

    def get_vcenter_settings(self, vcenter_id: str) -> Optional[Dict]:
        """Fetch vCenter connection settings from database by ID"""
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenters?id=eq.{vcenter_id}&select=*",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            if response.status_code == 200:
                vcenters = _safe_json_parse(response)
                if vcenters:
                    return vcenters[0]
            return None
        except Exception as e:
            self.log(f"Failed to fetch vCenter settings: {e}", "ERROR")
            return None

    def connect_vcenter(self, settings=None):
        """Connect to vCenter if not already connected"""
        if self.vcenter_conn:
            return self.vcenter_conn

        # Use provided settings or fall back to environment variables
        host = settings.get('host') if settings else VCENTER_HOST
        user = settings.get('username') if settings else VCENTER_USER
        
        # Handle encrypted passwords from database
        pwd = None
        if settings:
            # First try plain password (for backward compatibility)
            pwd = settings.get('password')
            # If no plain password, decrypt encrypted password
            if not pwd and settings.get('password_encrypted'):
                self.log("Decrypting vCenter password...")
                pwd = self.decrypt_password(settings.get('password_encrypted'))
                if not pwd:
                    raise Exception("Failed to decrypt vCenter password")
        else:
            pwd = VCENTER_PASSWORD
        
        verify_ssl = settings.get('verify_ssl', VERIFY_SSL) if settings else VERIFY_SSL
        
        # Log connection attempt BEFORE trying to connect
        self.log(f"Attempting to connect to vCenter at {host}...")
        self.log_vcenter_activity(
            operation="connect_vcenter_attempt",
            endpoint=host,
            success=True,
            details={"verify_ssl": verify_ssl, "status": "attempting"}
        )
            
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        if not verify_ssl:
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        
        try:
            # Add timeout to prevent indefinite hanging
            import socket
            old_timeout = socket.getdefaulttimeout()
            socket.setdefaulttimeout(30)  # 30 second timeout
            
            try:
                self.vcenter_conn = SmartConnect(
                    host=host,
                    user=user,
                    pwd=pwd,
                    sslContext=context
                )
            finally:
                socket.setdefaulttimeout(old_timeout)  # Reset timeout
            
            atexit.register(Disconnect, self.vcenter_conn)
            self.log(f"✓ Connected to vCenter at {host}")
            self.log_vcenter_activity(
                operation="connect_vcenter",
                endpoint=host,
                success=True,
                details={"verify_ssl": verify_ssl}
            )
            return self.vcenter_conn
        except Exception as e:
            self.log(f"✗ Failed to connect to vCenter: {e}", "ERROR")
            self.log_vcenter_activity(
                operation="connect_vcenter",
                endpoint=host,
                success=False,
                error=str(e)
            )
            return None

    def check_vcenter_connection(self, content) -> bool:
        """Verify vCenter connection is still valid"""
        try:
            # Simple test - get current session
            session = content.sessionManager.currentSession
            return session is not None
        except Exception as e:
            self.log(f"vCenter connection lost: {e}", "ERROR")
            return False

    def sync_vcenter_clusters(self, content, source_vcenter_id: str, vcenter_name: str = None, job_id: str = None) -> Dict:
        """Sync cluster statistics from vCenter"""
        start_time = time.time()
        try:
            self.log("Creating cluster container view...")
            
            # Log start
            endpoint_prefix = f"{vcenter_name} - " if vcenter_name else ""
            self.log_vcenter_activity(
                operation="sync_clusters_start",
                endpoint=f"{endpoint_prefix}Clusters",
                success=True,
                details={"source_vcenter_id": source_vcenter_id, "vcenter_name": vcenter_name},
                job_id=job_id
            )
            
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.ClusterComputeResource], True
            )
            
            total_clusters = len(container.view)
            self.log(f"Found {total_clusters} clusters in vCenter")
            
            synced = 0
            for cluster in container.view:
                try:
                    summary = cluster.summary
                    config = cluster.configuration.dasConfig if hasattr(cluster, 'configuration') else None
                    drs_config = cluster.configuration.drsConfig if hasattr(cluster, 'configuration') else None
                    
                    cluster_data = {
                        'cluster_name': cluster.name,
                        'vcenter_id': str(cluster._moId),
                        'source_vcenter_id': source_vcenter_id,
                        'total_cpu_mhz': summary.totalCpu if hasattr(summary, 'totalCpu') else None,
                        'used_cpu_mhz': summary.totalCpu - summary.effectiveCpu if hasattr(summary, 'totalCpu') and hasattr(summary, 'effectiveCpu') else None,
                        'total_memory_bytes': summary.totalMemory if hasattr(summary, 'totalMemory') else None,
                        'used_memory_bytes': summary.totalMemory - summary.effectiveMemory if hasattr(summary, 'totalMemory') and hasattr(summary, 'effectiveMemory') else None,
                        'host_count': summary.numHosts if hasattr(summary, 'numHosts') else 0,
                        'vm_count': summary.numVms if hasattr(summary, 'numVms') else 0,
                        'ha_enabled': config.enabled if config else False,
                        'drs_enabled': drs_config.enabled if drs_config else False,
                        'drs_automation_level': str(drs_config.defaultVmBehavior) if drs_config and hasattr(drs_config, 'defaultVmBehavior') else None,
                        'overall_status': str(summary.overallStatus) if hasattr(summary, 'overallStatus') else 'unknown',
                        'last_sync': datetime.now().isoformat()
                    }
                    
                    # Upsert cluster
                    response = requests.post(
                        f"{DSM_URL}/rest/v1/vcenter_clusters?on_conflict=cluster_name",
                        headers={
                            'apikey': SERVICE_ROLE_KEY,
                            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                            'Content-Type': 'application/json',
                            'Prefer': 'resolution=merge-duplicates'
                        },
                        json=cluster_data,
                        verify=VERIFY_SSL
                    )
                    
                    if response.status_code in [200, 201]:
                        synced += 1
                        self.log(f"  Synced cluster: {cluster.name}")
                    
                except Exception as e:
                    self.log(f"  Error syncing cluster {cluster.name}: {e}", "WARNING")
            
            container.Destroy()
            self.log(f"  Synced {synced}/{total_clusters} clusters")
            
            # Log completion
            response_time = int((time.time() - start_time) * 1000)
            endpoint_prefix = f"{vcenter_name} - " if vcenter_name else ""
            self.log_vcenter_activity(
                operation="sync_clusters_complete",
                endpoint=f"{endpoint_prefix}Clusters",
                success=True,
                response_time_ms=response_time,
                details={"synced": synced, "total": total_clusters},
                job_id=job_id
            )
            
            return {'synced': synced, 'total': total_clusters}
            
        except Exception as e:
            self.log(f"Failed to sync clusters: {e}", "ERROR")
            import traceback
            self.log(f"Traceback: {traceback.format_exc()}", "ERROR")
            
            # Log error
            endpoint_prefix = f"{vcenter_name} - " if vcenter_name else ""
            self.log_vcenter_activity(
                operation="sync_clusters_error",
                endpoint=f"{endpoint_prefix}Clusters",
                success=False,
                error=str(e),
                job_id=job_id
            )
            
            return {'synced': 0, 'error': str(e)}

    def sync_vcenter_vms(self, content, source_vcenter_id: str, job_id: str = None, vcenter_name: str = None) -> Dict:
        """Sync VM inventory from vCenter with batch processing and OS distribution tracking"""
        start_time = time.time()
        try:
            self.log("Creating VM container view...")
            
            # Log start
            endpoint_prefix = f"{vcenter_name} - " if vcenter_name else ""
            self.log_vcenter_activity(
                operation="sync_vms_start",
                endpoint=f"{endpoint_prefix}VMs",
                success=True,
                details={"source_vcenter_id": source_vcenter_id, "vcenter_name": vcenter_name}
            )
            
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.VirtualMachine], True
            )
            
            total_vms = len(container.view)
            self.log(f"Found {total_vms} VMs in vCenter")
            
            # Create job task for VM sync if job_id provided
            task_id = None
            if job_id:
                task_response = requests.post(
                    f"{DSM_URL}/rest/v1/job_tasks",
                    headers={
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json',
                        'Prefer': 'return=representation'
                    },
                    json={
                        'job_id': job_id,
                        'status': 'running',
                        'started_at': datetime.now().isoformat(),
                        'progress': 0,
                        'log': f'Starting VM sync ({total_vms} VMs)'
                    },
                    verify=VERIFY_SSL
                )
                if task_response.status_code in [200, 201]:
                    task_data = _safe_json_parse(task_response)
                    if task_data:
                        task_id = task_data[0]['id']
                        self.log(f"✓ Created task {task_id} for VM sync")
            
            synced = 0
            batch = []
            batch_size = 50
            os_counts = {}
            
            for i, vm in enumerate(container.view):
                # Update progress more frequently (every 50 VMs)
                if i % 50 == 0:
                    self.log(f"  Processing VM {i+1}/{total_vms}...")
                    
                    # Update job progress if job_id provided
                    if job_id:
                        self.update_job_status(
                            job_id,
                            'running',
                            details={
                                "current_step": f"Syncing VMs ({i+1}/{total_vms})",
                                "vms_processed": i + 1,  # Fixed: Use i+1 for accurate count
                                "vms_total": total_vms,
                                "synced": synced
                            }
                        )
                        
                        # Log progress to activity monitor
                        if i % 100 == 0:
                            endpoint_prefix = f"{vcenter_name} - " if vcenter_name else ""
                            self.log_vcenter_activity(
                                operation="vcenter_vm_sync_progress",
                                endpoint=f"{endpoint_prefix}VM Inventory",
                                success=True,
                                response_time_ms=0,
                                details={
                                    "progress": f"{i+1}/{total_vms}",
                                    "synced": synced,
                                    "job_id": job_id
                                }
                            )
                try:
                    config = vm.summary.config if hasattr(vm.summary, 'config') else None
                    runtime = vm.summary.runtime if hasattr(vm.summary, 'runtime') else None
                    guest = vm.summary.guest if hasattr(vm.summary, 'guest') else None
                    storage = vm.summary.storage if hasattr(vm.summary, 'storage') else None
                    
                    # Track OS distribution
                    guest_os = config.guestFullName if config and hasattr(config, 'guestFullName') else 'unknown'
                    os_counts[guest_os] = os_counts.get(guest_os, 0) + 1
                    
                    # Get host_id from vcenter_hosts table
                    host_id = None
                    if runtime and runtime.host:
                        host_response = requests.get(
                            f"{DSM_URL}/rest/v1/vcenter_hosts?select=id&name=eq.{runtime.host.name}",
                            headers={
                                'apikey': SERVICE_ROLE_KEY,
                                'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                            },
                            verify=VERIFY_SSL
                        )
                        if host_response.status_code == 200:
                            hosts = _safe_json_parse(host_response)
                            if hosts:
                                host_id = hosts[0]['id']
                    
                    # Get cluster name
                    cluster_name = None
                    if runtime and runtime.host and runtime.host.parent and isinstance(runtime.host.parent, vim.ClusterComputeResource):
                        cluster_name = runtime.host.parent.name
                    
                    vm_data = {
                        'name': config.name if config else vm.name,
                        'vcenter_id': str(vm._moId),
                        'source_vcenter_id': source_vcenter_id,
                        'host_id': host_id,
                        'cluster_name': cluster_name,
                        'power_state': str(runtime.powerState) if runtime else 'unknown',
                        'guest_os': guest_os,
                        'cpu_count': config.numCpu if config and hasattr(config, 'numCpu') else None,
                        'memory_mb': config.memorySizeMB if config and hasattr(config, 'memorySizeMB') else None,
                        'disk_gb': round(storage.committed / (1024**3), 2) if storage and hasattr(storage, 'committed') else None,
                        'ip_address': guest.ipAddress if guest and hasattr(guest, 'ipAddress') else None,
                        'tools_status': str(guest.toolsStatus) if guest and hasattr(guest, 'toolsStatus') else None,
                        'tools_version': guest.toolsVersion if guest and hasattr(guest, 'toolsVersion') else None,
                        'overall_status': str(vm.summary.overallStatus) if hasattr(vm.summary, 'overallStatus') else 'unknown',
                        'last_sync': datetime.now().isoformat()
                    }
                    
                    # Add to batch
                    batch.append(vm_data)
                    
                    # Process batch when it reaches batch_size
                    if len(batch) >= batch_size:
                        success_count = self._upsert_vm_batch(batch)
                        synced += success_count
                        batch = []
                    
                except Exception as e:
                    self.log(f"  Error preparing VM {vm.name}: {e}", "WARNING")
            
            # Process remaining VMs in batch
            if batch:
                self.log(f"  Processing final batch of {len(batch)} VMs...")
                success_count = self._upsert_vm_batch(batch)
                synced += success_count
            
            # Final progress update
            if job_id:
                self.update_job_status(
                    job_id,
                    'running',
                    details={
                        "current_step": f"Completed VM sync ({total_vms}/{total_vms})",
                        "vms_processed": total_vms,
                        "vms_total": total_vms,
                        "synced": synced,
                        "progress_percent": 100
                    }
                )
                
                # Mark task as completed
                if task_id:
                    requests.patch(
                        f"{DSM_URL}/rest/v1/job_tasks?id=eq.{task_id}",
                        headers={
                            'apikey': SERVICE_ROLE_KEY,
                            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                            'Content-Type': 'application/json',
                            'Prefer': 'return=minimal'
                        },
                        json={
                            'status': 'completed',
                            'completed_at': datetime.now().isoformat(),
                            'progress': 100,
                            'log': f'Completed: {synced}/{total_vms} VMs synced'
                        },
                        verify=VERIFY_SSL
                    )
            
            container.Destroy()
            self.log(f"  Synced {synced}/{total_vms} VMs")
            self.log(f"  VM OS distribution: {dict(sorted(os_counts.items(), key=lambda x: x[1], reverse=True)[:10])}")
            
            # Log completion
            response_time = int((time.time() - start_time) * 1000)
            endpoint_prefix = f"{vcenter_name} - " if vcenter_name else ""
            self.log_vcenter_activity(
                operation="sync_vms_complete",
                endpoint=f"{endpoint_prefix}VMs",
                success=True,
                response_time_ms=response_time,
                details={
                    "synced": synced,
                    "total": total_vms,
                    "os_distribution_sample": dict(list(os_counts.items())[:5])
                }
            )
            
            return {
                'synced': synced,
                'total': total_vms,
                'os_distribution': os_counts
            }
            
        except Exception as e:
            self.log(f"Failed to sync VMs: {e}", "ERROR")
            import traceback
            self.log(f"Traceback: {traceback.format_exc()}", "ERROR")
            
            # Log error
            endpoint_prefix = f"{vcenter_name} - " if vcenter_name else ""
            self.log_vcenter_activity(
                operation="sync_vms_error",
                endpoint=f"{endpoint_prefix}VMs",
                success=False,
                error=str(e)
            )
            
            return {'synced': 0, 'error': str(e)}
    
    def _upsert_vm_batch(self, batch: List[Dict]) -> int:
        """Upsert a batch of VM records"""
        try:
            self.log(f"  Upserting batch of {len(batch)} VMs...")
            # Use bulk upsert with on_conflict
            response = requests.post(
                f"{DSM_URL}/rest/v1/vcenter_vms",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates,return=minimal'
                },
                json=batch,
                verify=VERIFY_SSL,
                timeout=30
            )
            
            if response.status_code in [200, 201, 204]:
                self.log(f"  ✓ Batch upsert successful ({len(batch)} VMs)")
                return len(batch)
            else:
                self.log(f"  Batch upsert failed: HTTP {response.status_code} - {response.text}", "WARNING")
                # Fall back to individual inserts
                success_count = 0
                for vm_data in batch:
                    try:
                        resp = requests.post(
                            f"{DSM_URL}/rest/v1/vcenter_vms?on_conflict=vcenter_id",
                            headers={
                                'apikey': SERVICE_ROLE_KEY,
                                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                'Content-Type': 'application/json',
                                'Prefer': 'resolution=merge-duplicates'
                            },
                            json=vm_data,
                            verify=VERIFY_SSL
                        )
                        if resp.status_code in [200, 201]:
                            success_count += 1
                    except Exception as single_err:
                        self.log(f"    Failed to upsert VM individually: {single_err}", "WARNING")
                self.log(f"  ⚠️  Fallback: {success_count}/{len(batch)} VMs inserted individually")
                return success_count
                
        except Exception as e:
            self.log(f"  Error in batch upsert: {e}", "ERROR")
            import traceback
            self.log(f"  Traceback: {traceback.format_exc()}", "ERROR")
            return 0

    def sync_vcenter_datastores(self, content, source_vcenter_id: str, progress_callback=None, vcenter_name: str = None, job_id: str = None) -> Dict:
        """Sync datastore information from vCenter"""
        start_time = time.time()
        try:
            self.log("Creating datastore container view...")
            
            # Log start
            endpoint_prefix = f"{vcenter_name} - " if vcenter_name else ""
            self.log_vcenter_activity(
                operation="sync_datastores_start",
                endpoint=f"{endpoint_prefix}Datastores",
                success=True,
                details={"source_vcenter_id": source_vcenter_id, "vcenter_name": vcenter_name},
                job_id=job_id
            )
            
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.Datastore], True
            )
            
            total_datastores = len(container.view)
            self.log(f"Found {total_datastores} datastores in vCenter")
            
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            # Fetch all vcenter_hosts in one query for faster lookups
            all_hosts_response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_hosts?select=id,name&source_vcenter_id=eq.{source_vcenter_id}",
                headers=headers,
                verify=VERIFY_SSL
            )
            host_lookup = {}
            if all_hosts_response.status_code == 200:
                hosts = _safe_json_parse(all_hosts_response)
                if hosts:
                    host_lookup = {h['name']: h['id'] for h in hosts}
            
            synced = 0
            host_mount_synced = 0
            
            for i, ds in enumerate(container.view):
                try:
                    summary = ds.summary
                    
                    datastore_data = {
                        'name': summary.name,
                        'vcenter_id': str(ds._moId),
                        'source_vcenter_id': source_vcenter_id,
                        'type': summary.type if hasattr(summary, 'type') else None,
                        'capacity_bytes': summary.capacity if hasattr(summary, 'capacity') else None,
                        'free_bytes': summary.freeSpace if hasattr(summary, 'freeSpace') else None,
                        'accessible': summary.accessible if hasattr(summary, 'accessible') else True,
                        'maintenance_mode': summary.maintenanceMode if hasattr(summary, 'maintenanceMode') else None,
                        'vm_count': len(ds.vm) if hasattr(ds, 'vm') else 0,
                        'host_count': len(ds.host) if hasattr(ds, 'host') else 0,
                        'last_sync': datetime.now().isoformat()
                    }
                    
                    # Upsert datastore
                    response = requests.post(
                        f"{DSM_URL}/rest/v1/vcenter_datastores?on_conflict=vcenter_id",
                        headers={**headers, 'Prefer': 'resolution=merge-duplicates,return=representation'},
                        json=datastore_data,
                        verify=VERIFY_SSL,
                        timeout=10
                    )
                    
                    if response.status_code in [200, 201]:
                        synced += 1
                        datastore_result = _safe_json_parse(response)
                        datastore_db_id = None
                        if datastore_result:
                            datastore_db_id = datastore_result[0]['id'] if isinstance(datastore_result, list) else datastore_result.get('id')
                        
                        # Sync host mount info using batched host lookup
                        if datastore_db_id and hasattr(ds, 'host'):
                            for mount_info in ds.host:
                                try:
                                    host = mount_info.key
                                    
                                    # Use pre-fetched host lookup
                                    host_db_id = host_lookup.get(host.name)
                                    
                                    if host_db_id:
                                            
                                            mount_data = {
                                                'datastore_id': datastore_db_id,
                                                'host_id': host_db_id,
                                                'source_vcenter_id': source_vcenter_id,
                                                'accessible': mount_info.mountInfo.accessible if hasattr(mount_info, 'mountInfo') else True,
                                                'mount_path': mount_info.mountInfo.path if hasattr(mount_info, 'mountInfo') and hasattr(mount_info.mountInfo, 'path') else None,
                                                'read_only': False,
                                                'last_sync': datetime.now().isoformat()
                                            }
                                            
                                            mount_resp = requests.post(
                                                f"{DSM_URL}/rest/v1/vcenter_datastore_hosts",
                                                headers={**headers, 'Prefer': 'resolution=merge-duplicates'},
                                                json=mount_data,
                                                verify=VERIFY_SSL
                                            )
                                            
                                            if mount_resp.status_code in [200, 201]:
                                                host_mount_synced += 1
                                except Exception as mount_err:
                                    self.log(f"    Error syncing host mount: {mount_err}", "WARNING")
                        
                        self.log(f"  Synced datastore: {summary.name}")
                        
                        # Report progress
                        if progress_callback:
                            pct = int((i + 1) / total_datastores * 100)
                            progress_callback(pct, f"Synced {i+1}/{total_datastores} datastores")
                    
                except Exception as e:
                    self.log(f"  Error syncing datastore: {e}", "WARNING")
            
            container.Destroy()
            self.log(f"  Synced {synced}/{total_datastores} datastores, {host_mount_synced} host mounts")
            
            # Log completion
            response_time = int((time.time() - start_time) * 1000)
            self.log_vcenter_activity(
                operation="sync_datastores_complete",
                endpoint=f"{endpoint_prefix}Datastores",
                success=True,
                response_time_ms=response_time,
                details={
                    "synced": synced,
                    "total": total_datastores,
                    "host_mounts": host_mount_synced
                },
                job_id=job_id
            )
            
            return {'synced': synced, 'total': total_datastores, 'host_mounts': host_mount_synced}
            
        except Exception as e:
            self.log(f"Failed to sync datastores: {e}", "ERROR")
            import traceback
            self.log(f"Traceback: {traceback.format_exc()}", "ERROR")
            
            # Log error
            endpoint_prefix = f"{vcenter_name} - " if vcenter_name else ""
            self.log_vcenter_activity(
                operation="sync_datastores_error",
                endpoint=f"{endpoint_prefix}Datastores",
                success=False,
                error=str(e),
                job_id=job_id
            )
            
            return {'synced': 0, 'error': str(e)}

    def sync_vcenter_alarms(self, content, source_vcenter_id: str, progress_callback=None, vcenter_name: str = None, job_id: str = None) -> Dict:
        """Sync active alarms from vCenter"""
        start_time = time.time()
        try:
            self.log("Fetching alarm manager...")
            
            # Log start
            endpoint_prefix = f"{vcenter_name} - " if vcenter_name else ""
            self.log_vcenter_activity(
                operation="sync_alarms_start",
                endpoint=f"{endpoint_prefix}Alarms",
                success=True,
                details={"source_vcenter_id": source_vcenter_id, "vcenter_name": vcenter_name},
                job_id=job_id
            )
            
            alarm_manager = content.alarmManager
            if not alarm_manager:
                self.log("  No alarm manager available")
                return {'synced': 0}
            
            # Clear old alarms first
            requests.delete(
                f"{DSM_URL}/rest/v1/vcenter_alarms",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL
            )
            
            synced = 0
            
            # Get triggered alarms from all entities
            self.log("Creating entity container view for alarms...")
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.ManagedEntity], True
            )
            
            total_entities = len(container.view)
            self.log(f"Checking {total_entities} entities for alarms...")
            
            for i, entity in enumerate(container.view):
                try:
                    if hasattr(entity, 'triggeredAlarmState'):
                        for alarm_state in entity.triggeredAlarmState:
                            try:
                                alarm = alarm_state.alarm
                                alarm_info = alarm.info if hasattr(alarm, 'info') else None
                                
                                # Determine entity type
                                entity_type = 'unknown'
                                if isinstance(entity, vim.HostSystem):
                                    entity_type = 'host'
                                elif isinstance(entity, vim.VirtualMachine):
                                    entity_type = 'vm'
                                elif isinstance(entity, vim.ClusterComputeResource):
                                    entity_type = 'cluster'
                                elif isinstance(entity, vim.Datastore):
                                    entity_type = 'datastore'
                                
                                alarm_data = {
                                    'alarm_key': alarm_state.key,
                                    'source_vcenter_id': source_vcenter_id,
                                    'entity_type': entity_type,
                                    'entity_name': entity.name,
                                    'entity_id': str(entity._moId),
                                    'alarm_name': alarm_info.name if alarm_info else 'Unknown',
                                    'alarm_status': str(alarm_state.overallStatus),
                                    'acknowledged': alarm_state.acknowledged,
                                    'triggered_at': alarm_state.time.isoformat() if hasattr(alarm_state, 'time') else datetime.now().isoformat(),
                                    'description': alarm_info.description if alarm_info and hasattr(alarm_info, 'description') else None
                                }
                                
                                # Insert alarm
                                response = requests.post(
                                    f"{DSM_URL}/rest/v1/vcenter_alarms?on_conflict=alarm_key",
                                    headers={
                                        'apikey': SERVICE_ROLE_KEY,
                                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                        'Content-Type': 'application/json',
                                        'Prefer': 'resolution=merge-duplicates'
                                    },
                                    json=alarm_data,
                                    verify=VERIFY_SSL
                                )
                                
                                if response.status_code in [200, 201]:
                                    synced += 1
                                    
                            except Exception as e:
                                self.log(f"  Error processing alarm: {e}", "WARNING")
                                
                except Exception as e:
                    continue
                
                # Report progress every 100 entities
                if progress_callback and i % 100 == 0:
                    pct = int((i + 1) / total_entities * 100)
                    progress_callback(pct, f"Checked {i+1}/{total_entities} entities, found {synced} alarms")
            
            container.Destroy()
            self.log(f"  Synced {synced} active alarms")
            
            # Log completion
            response_time = int((time.time() - start_time) * 1000)
            endpoint_prefix = f"{vcenter_name} - " if vcenter_name else ""
            self.log_vcenter_activity(
                operation="sync_alarms_complete",
                endpoint=f"{endpoint_prefix}Alarms",
                success=True,
                response_time_ms=response_time,
                details={
                    "synced": synced,
                    "total_entities_checked": total_entities
                },
                job_id=job_id
            )
            
            return {'synced': synced}
            
        except Exception as e:
            self.log(f"Failed to sync alarms: {e}", "ERROR")
            import traceback
            self.log(f"Traceback: {traceback.format_exc()}", "ERROR")
            
            # Log error
            endpoint_prefix = f"{vcenter_name} - " if vcenter_name else ""
            self.log_vcenter_activity(
                operation="sync_alarms_error",
                endpoint=f"{endpoint_prefix}Alarms",
                success=False,
                error=str(e),
                job_id=job_id
            )
            
            return {'synced': 0, 'error': str(e)}

    def sync_vcenter_hosts(self, content, source_vcenter_id: str, progress_callback=None, vcenter_name: str = None, job_id: str = None) -> Dict:
        """Sync ESXi hosts from vCenter and auto-link to servers"""
        start_time = time.time()
        try:
            self.log("Creating host container view...")
            
            # Log start
            endpoint_prefix = f"{vcenter_name} - " if vcenter_name else ""
            self.log_vcenter_activity(
                operation="sync_hosts_start",
                endpoint=f"{endpoint_prefix}ESXi Hosts",
                success=True,
                details={"source_vcenter_id": source_vcenter_id, "vcenter_name": vcenter_name},
                job_id=job_id
            )
            
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.HostSystem], True
            )
            
            total_hosts = len(container.view)
            self.log(f"Found {total_hosts} ESXi hosts in vCenter")
            
            synced = 0
            auto_linked = 0
            
            for i, host in enumerate(container.view):
                try:
                    runtime = host.runtime if hasattr(host, 'runtime') else None
                    config = host.config if hasattr(host, 'config') else None
                    hardware = host.hardware if hasattr(host, 'hardware') else None
                    summary = host.summary if hasattr(host, 'summary') else None
                    
                    # Get cluster name
                    cluster_name = None
                    if host.parent and isinstance(host.parent, vim.ClusterComputeResource):
                        cluster_name = host.parent.name
                    
                    # Extract serial number from hardware - Dell servers use otherIdentifyingInfo for Service Tags
                    serial_number = None
                    if hardware and hasattr(hardware, 'systemInfo'):
                        system_info = hardware.systemInfo
                        
                        # Try direct serialNumber first
                        if hasattr(system_info, 'serialNumber') and system_info.serialNumber:
                            serial_number = system_info.serialNumber
                        
                        # Check otherIdentifyingInfo for Dell Service Tags (primary source for Dell servers)
                        if not serial_number and hasattr(system_info, 'otherIdentifyingInfo'):
                            for id_info in system_info.otherIdentifyingInfo or []:
                                try:
                                    id_type = id_info.identifierType
                                    id_value = id_info.identifierValue
                                    
                                    # Look for ServiceTag (Dell's identifier)
                                    if hasattr(id_type, 'key'):
                                        key = str(id_type.key).lower() if id_type.key else ''
                                        if 'servicetag' in key or 'service tag' in key:
                                            serial_number = str(id_value).strip() if id_value else None
                                            if serial_number:
                                                self.log(f"    Found Dell Service Tag: {serial_number}", "DEBUG")
                                                break
                                        # Also check for AssetTag as fallback
                                        elif 'assettag' in key or 'asset tag' in key:
                                            if not serial_number and id_value:
                                                serial_number = str(id_value).strip()
                                except Exception as e:
                                    self.log(f"    Warning: Error parsing identifier info: {e}", "DEBUG")
                        
                        # Log if still no serial number found
                        if not serial_number:
                            self.log(f"    Warning: Could not find serial number for {host.name}", "DEBUG")
                    
                    # Extract ESXi version
                    esxi_version = None
                    if config and hasattr(config, 'product'):
                        product = config.product
                        if hasattr(product, 'version') and hasattr(product, 'build'):
                            esxi_version = f"{product.version} (build {product.build})"
                    
                    # Determine status
                    status = 'unknown'
                    if runtime:
                        if hasattr(runtime, 'connectionState'):
                            conn_state = str(runtime.connectionState)
                            if conn_state == 'connected':
                                status = 'online'
                            elif conn_state == 'disconnected':
                                status = 'offline'
                            elif conn_state == 'notResponding':
                                status = 'unreachable'
                    
                    # Check maintenance mode
                    in_maintenance = runtime.inMaintenanceMode if runtime and hasattr(runtime, 'inMaintenanceMode') else False
                    
                    host_data = {
                        'name': host.name,
                        'vcenter_id': str(host._moId),
                        'source_vcenter_id': source_vcenter_id,
                        'cluster': cluster_name,
                        'serial_number': serial_number,
                        'esxi_version': esxi_version,
                        'status': status,
                        'maintenance_mode': in_maintenance,
                        'last_sync': datetime.now().isoformat()
                    }
                    
                    # Upsert host
                    response = requests.post(
                        f"{DSM_URL}/rest/v1/vcenter_hosts?on_conflict=vcenter_id,source_vcenter_id",
                        headers={
                            'apikey': SERVICE_ROLE_KEY,
                            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                            'Content-Type': 'application/json',
                            'Prefer': 'resolution=merge-duplicates,return=representation'
                        },
                        json=host_data,
                        verify=VERIFY_SSL
                    )
                    
                    if response.status_code in [200, 201]:
                        synced += 1
                        host_result = _safe_json_parse(response)
                        
                        # Auto-link to server if serial number matches
                        if serial_number and host_result:
                            host_id = host_result[0]['id']
                            
                            # Find matching server by service_tag (Dell's serial number)
                            server_response = requests.get(
                                f"{DSM_URL}/rest/v1/servers?select=id,hostname&service_tag=eq.{serial_number}&vcenter_host_id=is.null",
                                headers={
                                    'apikey': SERVICE_ROLE_KEY,
                                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                                },
                                verify=VERIFY_SSL
                            )
                            
                            if server_response.status_code == 200:
                                servers = _safe_json_parse(server_response)
                                if servers:
                                    server = servers[0]
                                    # Link server to vCenter host
                                    link_response = requests.patch(
                                        f"{DSM_URL}/rest/v1/servers?id=eq.{server['id']}",
                                        headers={
                                            'apikey': SERVICE_ROLE_KEY,
                                            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                            'Content-Type': 'application/json',
                                            'Prefer': 'return=minimal'
                                        },
                                        json={'vcenter_host_id': host_id},
                                        verify=VERIFY_SSL
                                    )
                                    
                                    if link_response.status_code == 204:
                                        # Also update vcenter_host with server_id
                                        requests.patch(
                                            f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{host_id}",
                                            headers={
                                                'apikey': SERVICE_ROLE_KEY,
                                                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                                'Content-Type': 'application/json',
                                                'Prefer': 'return=minimal'
                                            },
                                            json={'server_id': server['id']},
                                            verify=VERIFY_SSL
                                        )
                                        auto_linked += 1
                                        self.log(f"  Auto-linked {host.name} to server {server['hostname']}")
                        
                        self.log(f"  Synced host: {host.name}")
                        
                        # Report progress
                        if progress_callback:
                            pct = int((i + 1) / total_hosts * 100)
                            progress_callback(pct, f"Synced {i+1}/{total_hosts} hosts, auto-linked {auto_linked}")
                    
                except Exception as e:
                    self.log(f"  Error syncing host {host.name}: {e}", "WARNING")
            
            container.Destroy()
            self.log(f"  Synced {synced}/{total_hosts} hosts, auto-linked {auto_linked}")
            
            # Log completion
            response_time = int((time.time() - start_time) * 1000)
            endpoint_prefix = f"{vcenter_name} - " if vcenter_name else ""
            self.log_vcenter_activity(
                operation="sync_hosts_complete",
                endpoint=f"{endpoint_prefix}ESXi Hosts",
                success=True,
                response_time_ms=response_time,
                details={
                    "synced": synced,
                    "total": total_hosts,
                    "auto_linked": auto_linked
                },
                job_id=job_id
            )
            
            return {'synced': synced, 'total': total_hosts, 'auto_linked': auto_linked}
            
        except Exception as e:
            self.log(f"Failed to sync hosts: {e}", "ERROR")
            import traceback
            self.log(f"Traceback: {traceback.format_exc()}", "ERROR")
            
            # Log error
            endpoint_prefix = f"{vcenter_name} - " if vcenter_name else ""
            self.log_vcenter_activity(
                operation="sync_hosts_error",
                endpoint=f"{endpoint_prefix}ESXi Hosts",
                success=False,
                error=str(e),
                job_id=job_id
            )
            
            return {'synced': 0, 'auto_linked': 0, 'error': str(e)}

    def enter_vcenter_maintenance_mode(self, host_id: str, timeout: int = 600) -> dict:
        """Put ESXi host into maintenance mode"""
        start_time = time.time()
        host_name = host_id

        try:
            # Fetch host details from database
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{host_id}&select=*",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            
            if response.status_code != 200:
                self.log_vcenter_activity(
                    operation="enter_maintenance_mode",
                    endpoint=host_id,
                    success=False,
                    error='Failed to fetch host from database'
                )
                return {'success': False, 'error': 'Failed to fetch host from database'}

            hosts = _safe_json_parse(response)
            if not hosts:
                self.log_vcenter_activity(
                    operation="enter_maintenance_mode",
                    endpoint=host_id,
                    success=False,
                    error='Host not found in database'
                )
                return {'success': False, 'error': 'Host not found in database'}

            host_data = hosts[0]
            vcenter_id = host_data.get('vcenter_id')
            host_name = host_data.get('name', host_id)

            # Fetch vCenter settings from database
            source_vcenter_id = host_data.get('source_vcenter_id')
            vcenter_settings = None
            if source_vcenter_id:
                vcenter_settings = self.get_vcenter_settings(source_vcenter_id)
                if not vcenter_settings:
                    self.log_vcenter_activity(
                        operation="enter_maintenance_mode",
                        endpoint=host_name,
                        success=False,
                        error=f'vCenter settings not found for ID {source_vcenter_id}'
                    )
                    return {'success': False, 'error': f'vCenter settings not found for ID {source_vcenter_id}'}

            # Connect to vCenter
            vc = self.connect_vcenter(settings=vcenter_settings)
            if not vc:
                self.log_vcenter_activity(
                    operation="enter_maintenance_mode",
                    endpoint=host_name,
                    success=False,
                    error='Failed to connect to vCenter'
                )
                return {'success': False, 'error': 'Failed to connect to vCenter'}
            
            # Find the host object
            content = vc.RetrieveContent()
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.HostSystem], True
            )
            
            host_obj = None
            for h in container.view:
                if str(h._moId) == vcenter_id:
                    host_obj = h
                    break
            
            container.Destroy()

            if not host_obj:
                self.log_vcenter_activity(
                    operation="enter_maintenance_mode",
                    endpoint=host_name,
                    success=False,
                    error='Host not found in vCenter'
                )
                return {'success': False, 'error': f'Host not found in vCenter'}

            # Check if already in maintenance mode
            if host_obj.runtime.inMaintenanceMode:
                self.log(f"  Host {host_data['name']} already in maintenance mode")
                self.log_vcenter_activity(
                    operation="enter_maintenance_mode",
                    endpoint=host_name,
                    success=True,
                    response_time_ms=int((time.time() - start_time) * 1000),
                    details={'in_maintenance': True, 'vms_evacuated': 0}
                )
                return {
                    'success': True,
                    'in_maintenance': True,
                    'vms_evacuated': 0,
                    'time_taken_seconds': 0
                }
            
            # Count running VMs before maintenance
            vms_before = len([vm for vm in host_obj.vm if vm.runtime.powerState == 'poweredOn'])
            self.log(f"  Host has {vms_before} running VMs")
            
            # Enter maintenance mode
            task = host_obj.EnterMaintenanceMode_Task(timeout=timeout, evacuatePoweredOffVms=False)

            self.log(f"  Entering maintenance mode (timeout: {timeout}s)...")
            while task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
                time.sleep(2)
                if time.time() - start_time > timeout:
                    self.log_vcenter_activity(
                        operation="enter_maintenance_mode",
                        endpoint=host_name,
                        success=False,
                        response_time_ms=int((time.time() - start_time) * 1000),
                        error=f'Maintenance mode timeout after {timeout}s'
                    )
                    return {'success': False, 'error': f'Maintenance mode timeout after {timeout}s'}

            if task.info.state == vim.TaskInfo.State.error:
                error_msg = str(task.info.error) if task.info.error else 'Unknown error'
                self.log_vcenter_activity(
                    operation="enter_maintenance_mode",
                    endpoint=host_name,
                    success=False,
                    response_time_ms=int((time.time() - start_time) * 1000),
                    error=f'Maintenance mode failed: {error_msg}'
                )
                return {'success': False, 'error': f'Maintenance mode failed: {error_msg}'}
            
            # Verify maintenance mode active
            vms_after = len([vm for vm in host_obj.vm if vm.runtime.powerState == 'poweredOn'])
            time_taken = int(time.time() - start_time)
            
            self.log(f"  [OK] Maintenance mode active ({vms_before - vms_after} VMs evacuated in {time_taken}s)")
            
            # Update database
            requests.patch(
                f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{host_id}",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}', 'Content-Type': 'application/json'},
                json={'maintenance_mode': True, 'updated_at': datetime.now().isoformat()},
                verify=VERIFY_SSL
            )

            self.log_vcenter_activity(
                operation="enter_maintenance_mode",
                endpoint=host_name,
                success=True,
                response_time_ms=int((time.time() - start_time) * 1000),
                details={'in_maintenance': True, 'vms_evacuated': vms_before - vms_after, 'time_taken_seconds': time_taken}
            )

            return {
                'success': True,
                'in_maintenance': True,
                'vms_evacuated': vms_before - vms_after,
                'time_taken_seconds': time_taken
            }

        except Exception as e:
            self.log_vcenter_activity(
                operation="enter_maintenance_mode",
                endpoint=host_name,
                success=False,
                response_time_ms=int((time.time() - start_time) * 1000),
                error=str(e)
            )
            return {'success': False, 'error': str(e)}
    
    def exit_vcenter_maintenance_mode(self, host_id: str, timeout: int = 300) -> dict:
        """Exit ESXi host from maintenance mode"""
        start_time = time.time()
        host_name = host_id

        try:
            # Fetch host details
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{host_id}&select=*",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )

            hosts = _safe_json_parse(response)
            if not hosts:
                self.log_vcenter_activity(
                    operation="exit_maintenance_mode",
                    endpoint=host_id,
                    success=False,
                    error='Host not found'
                )
                return {'success': False, 'error': 'Host not found'}

            host_data = hosts[0]
            vcenter_id = host_data.get('vcenter_id')
            host_name = host_data.get('name', host_id)

            # Fetch vCenter settings from database
            source_vcenter_id = host_data.get('source_vcenter_id')
            vcenter_settings = None
            if source_vcenter_id:
                vcenter_settings = self.get_vcenter_settings(source_vcenter_id)
                if not vcenter_settings:
                    self.log_vcenter_activity(
                        operation="exit_maintenance_mode",
                        endpoint=host_name,
                        success=False,
                        error=f'vCenter settings not found for ID {source_vcenter_id}'
                    )
                    return {'success': False, 'error': f'vCenter settings not found for ID {source_vcenter_id}'}

            # Connect to vCenter
            vc = self.connect_vcenter(settings=vcenter_settings)
            if not vc:
                self.log_vcenter_activity(
                    operation="exit_maintenance_mode",
                    endpoint=host_name,
                    success=False,
                    error='Failed to connect to vCenter'
                )
                return {'success': False, 'error': 'Failed to connect to vCenter'}
            
            # Find host object
            content = vc.RetrieveContent()
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.HostSystem], True
            )
            
            host_obj = None
            for h in container.view:
                if str(h._moId) == vcenter_id:
                    host_obj = h
                    break
            
            container.Destroy()

            if not host_obj:
                self.log_vcenter_activity(
                    operation="exit_maintenance_mode",
                    endpoint=host_name,
                    success=False,
                    error='Host not found in vCenter'
                )
                return {'success': False, 'error': 'Host not found in vCenter'}

            # Check if already out of maintenance
            if not host_obj.runtime.inMaintenanceMode:
                self.log(f"  Host {host_data['name']} already out of maintenance mode")
                self.log_vcenter_activity(
                    operation="exit_maintenance_mode",
                    endpoint=host_name,
                    success=True,
                    response_time_ms=int((time.time() - start_time) * 1000),
                    details={'in_maintenance': False}
                )
                return {
                    'success': True,
                    'in_maintenance': False,
                    'time_taken_seconds': 0
                }
            
            # Exit maintenance mode
            task = host_obj.ExitMaintenanceMode_Task(timeout=timeout)
            
            self.log(f"  Exiting maintenance mode...")
            while task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
                time.sleep(2)
                if time.time() - start_time > timeout:
                    self.log_vcenter_activity(
                        operation="exit_maintenance_mode",
                        endpoint=host_name,
                        success=False,
                        response_time_ms=int((time.time() - start_time) * 1000),
                        error=f'Exit timeout after {timeout}s'
                    )
                    return {'success': False, 'error': f'Exit timeout after {timeout}s'}

            if task.info.state == vim.TaskInfo.State.error:
                error_msg = str(task.info.error) if task.info.error else 'Unknown error'
                self.log_vcenter_activity(
                    operation="exit_maintenance_mode",
                    endpoint=host_name,
                    success=False,
                    response_time_ms=int((time.time() - start_time) * 1000),
                    error=f'Exit failed: {error_msg}'
                )
                return {'success': False, 'error': f'Exit failed: {error_msg}'}

            time_taken = int(time.time() - start_time)
            self.log(f"  [OK] Exited maintenance mode ({time_taken}s)")
            
            # Update database
            requests.patch(
                f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{host_id}",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}', 'Content-Type': 'application/json'},
                json={'maintenance_mode': False, 'updated_at': datetime.now().isoformat()},
                verify=VERIFY_SSL
            )

            self.log_vcenter_activity(
                operation="exit_maintenance_mode",
                endpoint=host_name,
                success=True,
                response_time_ms=int((time.time() - start_time) * 1000),
                details={'in_maintenance': False, 'time_taken_seconds': time_taken}
            )

            return {
                'success': True,
                'in_maintenance': False,
                'time_taken_seconds': time_taken
            }

        except Exception as e:
            self.log_vcenter_activity(
                operation="exit_maintenance_mode",
                endpoint=host_name,
                success=False,
                response_time_ms=int((time.time() - start_time) * 1000),
                error=str(e)
            )
            return {'success': False, 'error': str(e)}
    
    def wait_for_vcenter_host_connected(self, host_id: str, timeout: int = 600) -> bool:
        """Wait for ESXi host to be in CONNECTED state"""
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            try:
                response = requests.get(
                    f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{host_id}&select=*",
                    headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                    verify=VERIFY_SSL
                )
                
                hosts = _safe_json_parse(response)
                if hosts and hosts[0].get('status') == 'connected':
                    return True
                
                time.sleep(5)
            except:
                time.sleep(5)
        
        return False

    def auto_link_vcenter(self, server_id: str, service_tag: str):
        """Attempt to auto-link server with vCenter host by serial number (bidirectional)"""
        if not service_tag:
            return
            
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            # Find matching vCenter host that isn't already linked
            vcenter_url = f"{DSM_URL}/rest/v1/vcenter_hosts?serial_number=eq.{service_tag}&server_id=is.null&select=id,name"
            response = requests.get(vcenter_url, headers=headers, verify=VERIFY_SSL)
            
            if response.status_code == 200:
                hosts = _safe_json_parse(response)
                if hosts:
                    vcenter_host_id = hosts[0]['id']
                    vcenter_name = hosts[0].get('name', 'Unknown')
                    
                    # Link server → vCenter host
                    requests.patch(
                        f"{DSM_URL}/rest/v1/servers?id=eq.{server_id}",
                        json={'vcenter_host_id': vcenter_host_id},
                        headers=headers,
                        verify=VERIFY_SSL
                    )
                    
                    # Link vCenter host → server (bidirectional)
                    requests.patch(
                        f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{vcenter_host_id}",
                        json={'server_id': server_id},
                        headers=headers,
                        verify=VERIFY_SSL
                    )
                    
                    self.log(f"  ✓ Auto-linked to vCenter host: {vcenter_name} ({vcenter_host_id})")
        except Exception as e:
            self.log(f"  Auto-link check failed: {e}", "WARN")

    def get_vcenter_host(self, host_id: str) -> Optional[Dict]:
        """Fetch vCenter host details from database"""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            url = f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{host_id}&select=*,servers(*)"
            response = requests.get(url, headers=headers, verify=VERIFY_SSL)
            
            if response.status_code == 200:
                hosts = _safe_json_parse(response)
                if hosts and len(hosts) > 0:
                    return hosts[0]
            
            return None
        except Exception as e:
            self.log(f"Error fetching vCenter host: {e}", "ERROR")
            return None
    
    def get_vcenter_settings(self, vcenter_id: str) -> Optional[Dict]:
        """Fetch vCenter connection settings from database"""
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            url = f"{DSM_URL}/rest/v1/vcenters?id=eq.{vcenter_id}"
            response = requests.get(url, headers=headers, verify=VERIFY_SSL)
            
            if response.status_code == 200:
                settings = _safe_json_parse(response)
                if settings and len(settings) > 0:
                    return settings[0]
            
            return None
        except Exception as e:
            self.log(f"Error fetching vCenter settings: {e}", "ERROR")
            return None
