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
    
    def check_job_cancelled(self, job_id: str) -> bool:
        """Check if job has been cancelled by querying the database"""
        if not job_id:
            return False
        
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/jobs?id=eq.{job_id}&select=status",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL,
                timeout=5
            )
            if response.status_code == 200:
                jobs = _safe_json_parse(response)
                if jobs and jobs[0].get('status') == 'cancelled':
                    self.log(f"Job {job_id} has been cancelled by user")
                    return True
        except Exception as e:
            self.log(f"Warning: Failed to check job cancellation status: {e}", "WARN")
        return False
    
    def analyze_maintenance_blockers(self, host_id: str, source_vcenter_id: str = None) -> Dict:
        """
        Analyze what VMs/conditions will block maintenance mode entry for a host.
        
        Checks for:
        - VMs with local storage (VMDK on local-only datastores)
        - VMs with USB/PCI passthrough devices
        - VMs with CPU/Memory affinity rules
        - VMs with connected CD/Floppy from client
        - Critical infrastructure VMs (VCSA, NSX, vRA)
        - VMs that can't be migrated due to DRS rules
        
        Args:
            host_id: The vcenter_host database ID to analyze
            source_vcenter_id: Optional vCenter ID for connection
            
        Returns:
            {
                'host_id': str,
                'host_name': str,
                'can_enter_maintenance': bool,
                'blockers': [
                    {
                        'vm_name': str,
                        'vm_id': str,
                        'reason': str,  # local_storage, passthrough, affinity, connected_media, vcsa, critical_infra
                        'severity': 'critical' | 'warning',
                        'details': str,
                        'remediation': str,
                        'auto_fixable': bool
                    }
                ],
                'warnings': [],
                'total_powered_on_vms': int,
                'migratable_vms': int,
                'blocked_vms': int,
                'estimated_evacuation_time': int  # seconds
            }
        """
        result = {
            'host_id': host_id,
            'host_name': None,
            'can_enter_maintenance': True,
            'blockers': [],
            'warnings': [],
            'total_powered_on_vms': 0,
            'migratable_vms': 0,
            'blocked_vms': 0,
            'estimated_evacuation_time': 0
        }
        
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            from job_executor.utils import _safe_json_parse
            
            # Fetch host details
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{host_id}&select=id,name,vcenter_id,source_vcenter_id",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            
            if response.status_code != 200:
                self.log(f"  Failed to fetch host details: {response.status_code}", "WARN")
                return result
            
            hosts = _safe_json_parse(response) or []
            if not hosts:
                return result
            
            host_info = hosts[0]
            result['host_name'] = host_info.get('name')
            
            # Get vCenter connection
            vcenter_id = source_vcenter_id or host_info.get('source_vcenter_id')
            vcenter_settings = self.get_vcenter_settings(vcenter_id) if vcenter_id else None
            
            vc = self.connect_vcenter(settings=vcenter_settings)
            if not vc:
                self.log(f"  Cannot connect to vCenter for blocker analysis", "WARN")
                return result
            
            content = vc.RetrieveContent()
            
            # Find the host object
            host_container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.HostSystem], True
            )
            
            target_host = None
            host_vcenter_id = host_info.get('vcenter_id')
            
            for host_obj in host_container.view:
                if str(host_obj._moId) == host_vcenter_id:
                    target_host = host_obj
                    break
            
            host_container.Destroy()
            
            if not target_host:
                self.log(f"  Host not found in vCenter: {host_vcenter_id}", "WARN")
                return result
            
            # Get local datastores for this host
            local_datastores = set()
            for ds in target_host.datastore:
                try:
                    if ds.summary.type == 'VMFS':
                        # Check if datastore is local (only accessible from this host)
                        if len(ds.host) == 1:
                            local_datastores.add(ds.name)
                except:
                    pass
            
            # VCSA/Critical VM patterns
            vcsa_patterns = ['vcsa', 'vcenter', 'vcs']
            critical_patterns = ['vcsa', 'vcenter', 'nsx', 'vra', 'vrops', 'vrealize', 'vrni', 'log-insight', 'srm']
            
            # Analyze each VM on the host
            for vm in target_host.vm:
                try:
                    vm_name = vm.name
                    vm_name_lower = vm_name.lower()
                    power_state = str(vm.runtime.powerState) if vm.runtime else 'unknown'
                    
                    # Only analyze powered-on VMs (they need to migrate)
                    if power_state != 'poweredOn':
                        continue
                    
                    result['total_powered_on_vms'] += 1
                    vm_has_blocker = False
                    
                    # Check 1: VCSA detection (critical)
                    is_vcsa = any(p in vm_name_lower for p in vcsa_patterns)
                    guest_os = ''
                    if vm.summary and vm.summary.config:
                        guest_os = (vm.summary.config.guestFullName or '').lower()
                    if 'photon' in guest_os:
                        is_vcsa = True
                    
                    if is_vcsa:
                        result['blockers'].append({
                            'vm_name': vm_name,
                            'vm_id': str(vm._moId),
                            'reason': 'vcsa',
                            'severity': 'critical',
                            'details': 'vCenter Server Appliance - manages vMotion, cannot self-migrate',
                            'remediation': 'Manually migrate VCSA to another host before maintenance, or update this host last after VCSA migrates to an already-updated host',
                            'auto_fixable': False
                        })
                        vm_has_blocker = True
                        result['can_enter_maintenance'] = False
                    
                    # Check 2: Other critical infrastructure VMs (warning)
                    elif any(p in vm_name_lower for p in critical_patterns):
                        result['blockers'].append({
                            'vm_name': vm_name,
                            'vm_id': str(vm._moId),
                            'reason': 'critical_infra',
                            'severity': 'warning',
                            'details': 'Critical infrastructure VM - ensure safe to migrate',
                            'remediation': 'Verify this VM can migrate safely; consider manual migration first',
                            'auto_fixable': False
                        })
                        vm_has_blocker = True
                    
                    # Check 3: Local storage
                    vm_uses_local = False
                    try:
                        for device in vm.config.hardware.device:
                            if isinstance(device, vim.vm.device.VirtualDisk):
                                backing = device.backing
                                if hasattr(backing, 'fileName') and backing.fileName:
                                    # Extract datastore name from [datastore] path/to/file.vmdk
                                    ds_name = backing.fileName.split(']')[0].strip('[') if '[' in backing.fileName else ''
                                    if ds_name in local_datastores:
                                        vm_uses_local = True
                                        break
                    except:
                        pass
                    
                    if vm_uses_local:
                        result['blockers'].append({
                            'vm_name': vm_name,
                            'vm_id': str(vm._moId),
                            'reason': 'local_storage',
                            'severity': 'critical',
                            'details': 'VM uses local storage - cannot vMotion',
                            'remediation': 'Power off this VM, or migrate storage to shared datastore first',
                            'auto_fixable': False
                        })
                        vm_has_blocker = True
                        result['can_enter_maintenance'] = False
                    
                    # Check 4: Passthrough devices (USB, PCI)
                    has_passthrough = False
                    try:
                        for device in vm.config.hardware.device:
                            if isinstance(device, (vim.vm.device.VirtualPCIPassthrough, vim.vm.device.VirtualUSBController)):
                                # Check for USB passthrough
                                if isinstance(device, vim.vm.device.VirtualUSBController):
                                    if hasattr(device, 'autoConnectDevices') and device.autoConnectDevices:
                                        has_passthrough = True
                                        break
                                else:
                                    has_passthrough = True
                                    break
                    except:
                        pass
                    
                    if has_passthrough:
                        result['blockers'].append({
                            'vm_name': vm_name,
                            'vm_id': str(vm._moId),
                            'reason': 'passthrough',
                            'severity': 'critical',
                            'details': 'VM has passthrough devices (USB/PCI) - cannot vMotion',
                            'remediation': 'Remove passthrough devices or power off this VM',
                            'auto_fixable': False
                        })
                        vm_has_blocker = True
                        result['can_enter_maintenance'] = False
                    
                    # Check 5: Connected CD/Floppy from client
                    has_client_device = False
                    try:
                        for device in vm.config.hardware.device:
                            if isinstance(device, (vim.vm.device.VirtualCdrom, vim.vm.device.VirtualFloppy)):
                                if hasattr(device, 'connectable') and device.connectable:
                                    if device.connectable.connected:
                                        backing = device.backing
                                        if isinstance(backing, vim.vm.device.VirtualCdrom.RemoteAtapiBackingInfo):
                                            has_client_device = True
                                            break
                    except:
                        pass
                    
                    if has_client_device:
                        result['blockers'].append({
                            'vm_name': vm_name,
                            'vm_id': str(vm._moId),
                            'reason': 'connected_media',
                            'severity': 'warning',
                            'details': 'VM has client-connected CD/DVD - may block vMotion',
                            'remediation': 'Disconnect CD/DVD from VM console',
                            'auto_fixable': True
                        })
                        vm_has_blocker = True
                    
                    # Check 6: CPU/Memory affinity
                    has_affinity = False
                    try:
                        if vm.config.cpuAffinity and vm.config.cpuAffinity.affinitySet:
                            has_affinity = True
                    except:
                        pass
                    
                    if has_affinity:
                        result['blockers'].append({
                            'vm_name': vm_name,
                            'vm_id': str(vm._moId),
                            'reason': 'affinity',
                            'severity': 'warning',
                            'details': 'VM has CPU/memory affinity rules - may restrict migration',
                            'remediation': 'Remove affinity rules or acknowledge migration may fail',
                            'auto_fixable': False
                        })
                        vm_has_blocker = True
                    
                    # Count blockers vs migratable
                    if vm_has_blocker:
                        result['blocked_vms'] += 1
                    else:
                        result['migratable_vms'] += 1
                        
                except Exception as vm_err:
                    self.log(f"  Error analyzing VM: {vm_err}", "DEBUG")
                    continue
            
            # Estimate evacuation time (rough: 30 seconds per migratable VM)
            result['estimated_evacuation_time'] = result['migratable_vms'] * 30
            
            # Add summary warnings
            if result['blocked_vms'] > 0:
                critical_count = len([b for b in result['blockers'] if b['severity'] == 'critical'])
                if critical_count > 0:
                    result['warnings'].append(f"{critical_count} VM(s) have critical issues that will block maintenance mode")
            
            self.log(f"  Blocker analysis for {result['host_name']}: {result['total_powered_on_vms']} VMs, {result['blocked_vms']} blocked, {result['migratable_vms']} migratable")
            
            return result
            
        except Exception as e:
            self.log(f"  Maintenance blocker analysis error: {e}", "WARN")
            import traceback
            self.log(f"  Traceback: {traceback.format_exc()}", "DEBUG")
            return result
    
    def detect_vcsa_on_hosts(self, host_ids: List[str], cluster_name: str = None) -> Dict:
        """
        Detect which host(s) in a list contain the vCenter Server Appliance (VCSA).
        
        VCSA detection patterns:
        - VM name contains 'vcsa' or 'vcenter' (case-insensitive)
        - VM guest OS is 'VMware Photon OS' (VCSA 6.7+)
        - VM name matches common patterns like '*-VCSA', 'vCSA-*'
        
        Args:
            host_ids: List of vcenter_host database IDs to check
            cluster_name: Optional cluster name for logging
            
        Returns:
            {
                'vcsa_host_id': str or None,  # The host_id containing VCSA
                'vcsa_host_name': str or None,
                'vcsa_vm_name': str or None,
                'vcsa_vm_details': dict or None,
                'critical_vms': list,  # List of critical infra VMs found
                'checked_hosts': int
            }
        """
        result = {
            'vcsa_host_id': None,
            'vcsa_host_name': None,
            'vcsa_vm_name': None,
            'vcsa_vm_details': None,
            'critical_vms': [],
            'checked_hosts': 0
        }
        
        if not host_ids:
            return result
        
        try:
            self.log(f"  Scanning {len(host_ids)} hosts for VCSA...")
            
            # Fetch host details including source_vcenter_id
            host_id_list = ','.join([f'"{h}"' for h in host_ids])
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_hosts?id=in.({host_id_list})&select=id,name,vcenter_id,source_vcenter_id",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            
            if response.status_code != 200:
                self.log(f"    Failed to fetch host details: {response.status_code}", "WARN")
                return result
            
            hosts = _safe_json_parse(response) or []
            if not hosts:
                return result
            
            # Get vCenter connection
            source_vcenter_id = hosts[0].get('source_vcenter_id')
            vcenter_settings = self.get_vcenter_settings(source_vcenter_id) if source_vcenter_id else None
            
            vc = self.connect_vcenter(settings=vcenter_settings)
            if not vc:
                self.log(f"    Cannot connect to vCenter for VCSA detection", "WARN")
                return result
            
            content = vc.RetrieveContent()
            
            # Build vcenter_id to host mapping
            host_vcenter_ids = {h['vcenter_id']: h for h in hosts}
            
            # Get all hosts
            host_container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.HostSystem], True
            )
            
            vcsa_patterns = ['vcsa', 'vcenter', 'vcs']
            critical_vm_patterns = ['vcsa', 'vcenter', 'vra', 'nsx', 'vrops', 'vrealize', 'dc', 'domain']
            
            for host_obj in host_container.view:
                host_vcenter_id = str(host_obj._moId)
                if host_vcenter_id not in host_vcenter_ids:
                    continue
                
                host_info = host_vcenter_ids[host_vcenter_id]
                result['checked_hosts'] += 1
                
                # Check VMs on this host
                for vm in host_obj.vm:
                    try:
                        vm_name = vm.name.lower()
                        vm_power_state = str(vm.runtime.powerState) if vm.runtime else 'unknown'
                        
                        # Only care about powered-on VMs
                        if vm_power_state != 'poweredOn':
                            continue
                        
                        guest_os = ''
                        if vm.summary and vm.summary.config:
                            guest_os = (vm.summary.config.guestFullName or '').lower()
                        
                        # Check for VCSA specifically
                        is_vcsa = (
                            any(p in vm_name for p in vcsa_patterns) or
                            'photon' in guest_os  # VCSA 6.7+ uses Photon OS
                        )
                        
                        if is_vcsa and not result['vcsa_host_id']:
                            result['vcsa_host_id'] = host_info['id']
                            result['vcsa_host_name'] = host_info['name']
                            result['vcsa_vm_name'] = vm.name
                            result['vcsa_vm_details'] = {
                                'name': vm.name,
                                'power_state': vm_power_state,
                                'guest_os': guest_os,
                                'cpu_count': vm.summary.config.numCpu if vm.summary and vm.summary.config else None,
                                'memory_mb': vm.summary.config.memorySizeMB if vm.summary and vm.summary.config else None
                            }
                            self.log(f"    ⚠️ VCSA detected on {host_info['name']}: {vm.name}")
                        
                        # Track other critical VMs
                        if any(p in vm_name for p in critical_vm_patterns):
                            result['critical_vms'].append({
                                'vm_name': vm.name,
                                'host_id': host_info['id'],
                                'host_name': host_info['name'],
                                'type': next((p for p in critical_vm_patterns if p in vm_name), 'unknown')
                            })
                            
                    except Exception as vm_err:
                        continue
            
            host_container.Destroy()
            
            if result['vcsa_host_id']:
                self.log(f"    VCSA host identified: {result['vcsa_host_name']} (will be updated last)")
            else:
                self.log(f"    No VCSA detected on checked hosts")
            
            if result['critical_vms']:
                unique_vms = list({v['vm_name']: v for v in result['critical_vms']}.values())
                result['critical_vms'] = unique_vms
                self.log(f"    Found {len(unique_vms)} critical infrastructure VM(s)")
            
            return result
            
        except Exception as e:
            self.log(f"    VCSA detection error: {e}", "WARN")
            return result
    
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

    def connect_vcenter(self, settings=None, force_reconnect=False):
        """Connect to vCenter if not already connected, with session validation.
        
        Args:
            settings: Optional vCenter connection settings dict
            force_reconnect: If True, disconnect existing connection and reconnect
        
        Returns:
            vCenter connection object or None if connection fails
        """
        # If we have a cached connection, validate it's still alive
        if self.vcenter_conn and not force_reconnect:
            try:
                # Quick validation - check session is still authenticated
                content = self.vcenter_conn.RetrieveContent()
                session = content.sessionManager.currentSession
                if session is not None:
                    return self.vcenter_conn  # Session still valid
                else:
                    self.log("vCenter session expired (no active session), reconnecting...", "WARN")
            except vim.fault.NotAuthenticated:
                self.log("vCenter session not authenticated, reconnecting...", "WARN")
            except Exception as e:
                self.log(f"vCenter connection lost ({e}), reconnecting...", "WARN")
            
            # Clear stale connection
            try:
                Disconnect(self.vcenter_conn)
            except:
                pass
            self.vcenter_conn = None
        elif force_reconnect and self.vcenter_conn:
            # Force disconnect existing connection
            try:
                Disconnect(self.vcenter_conn)
            except:
                pass
            self.vcenter_conn = None

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

    def ensure_vcenter_connection(self, settings=None):
        """Ensure vCenter connection is valid, reconnecting if necessary.
        
        Use this before operations that may have waited a long time since
        the last vCenter call (e.g., after firmware updates, reboots).
        This is critical for long-running workflows to prevent 
        vim.fault.NotAuthenticated errors.
        
        Args:
            settings: Optional vCenter connection settings dict
            
        Returns:
            vCenter connection object or None if connection fails
        """
        if not self.vcenter_conn:
            return self.connect_vcenter(settings=settings)
        
        try:
            content = self.vcenter_conn.RetrieveContent()
            session = content.sessionManager.currentSession
            if session:
                return self.vcenter_conn
        except vim.fault.NotAuthenticated:
            self.log("vCenter session not authenticated, reconnecting...", "WARN")
        except Exception as e:
            self.log(f"vCenter connection check failed: {e}, reconnecting...", "WARN")
        
        # Session invalid - force reconnect
        return self.connect_vcenter(settings=settings, force_reconnect=True)

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
                # Check for cancellation every 25 VMs
                if i % 25 == 0 and job_id:
                    if self.check_job_cancelled(job_id):
                        self.log(f"Job cancelled - stopping VM sync at {i}/{total_vms}")
                        container.Destroy()
                        return {'synced': synced, 'total': total_vms, 'cancelled': True, 'reason': 'User cancelled'}
                
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
                    
                    # Check if host exists by name + source_vcenter_id (more reliable than vcenter_id)
                    from urllib.parse import quote
                    existing_response = requests.get(
                        f"{DSM_URL}/rest/v1/vcenter_hosts?name=eq.{quote(host.name)}&source_vcenter_id=eq.{source_vcenter_id}&select=id",
                        headers={
                            'apikey': SERVICE_ROLE_KEY,
                            'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                        },
                        verify=VERIFY_SSL
                    )
                    
                    existing_host = None
                    if existing_response.status_code == 200:
                        existing_hosts = _safe_json_parse(existing_response)
                        if existing_hosts:
                            existing_host = existing_hosts[0]
                    
                    if existing_host:
                        # Update existing host
                        response = requests.patch(
                            f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{existing_host['id']}",
                            headers={
                                'apikey': SERVICE_ROLE_KEY,
                                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                'Content-Type': 'application/json',
                                'Prefer': 'return=representation'
                            },
                            json=host_data,
                            verify=VERIFY_SSL
                        )
                    else:
                        # Insert new host
                        response = requests.post(
                            f"{DSM_URL}/rest/v1/vcenter_hosts",
                            headers={
                                'apikey': SERVICE_ROLE_KEY,
                                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                'Content-Type': 'application/json',
                                'Prefer': 'return=representation'
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

    def _get_evacuation_blockers(self, host_obj, host_name: str) -> dict:
        """
        Get details about VMs blocking evacuation when maintenance mode times out.
        
        Returns:
            {
                'vms_remaining': [
                    {'name': str, 'power_state': str, 'reason': str},
                    ...
                ],
                'total_vms': int,
                'reason': str
            }
        """
        blockers = {
            'vms_remaining': [],
            'total_vms': 0,
            'reason': None
        }
        
        try:
            # Get all powered-on VMs still on the host
            powered_on_vms = []
            for vm in host_obj.vm:
                try:
                    power_state = str(vm.runtime.powerState) if vm.runtime else 'unknown'
                    if power_state == 'poweredOn':
                        vm_info = {
                            'name': vm.name,
                            'power_state': power_state,
                            'reason': None
                        }
                        
                        # Try to determine why this VM couldn't migrate
                        vm_name_lower = vm.name.lower()
                        
                        # Check for VCSA
                        if any(p in vm_name_lower for p in ['vcsa', 'vcenter', 'vcs']):
                            vm_info['reason'] = 'vCenter Server - cannot self-migrate'
                        
                        # Check for local storage
                        elif hasattr(vm, 'config') and vm.config:
                            for device in vm.config.hardware.device:
                                if isinstance(device, vim.vm.device.VirtualDisk):
                                    backing = device.backing
                                    if hasattr(backing, 'fileName') and backing.fileName:
                                        # Check if this is local storage
                                        if '[datastore1]' in backing.fileName or '[Local]' in backing.fileName:
                                            vm_info['reason'] = 'local storage'
                                            break
                        
                        # Check for passthrough devices
                        if not vm_info['reason'] and hasattr(vm, 'config') and vm.config:
                            for device in vm.config.hardware.device:
                                if isinstance(device, vim.vm.device.VirtualPCIPassthrough):
                                    vm_info['reason'] = 'PCI passthrough device'
                                    break
                        
                        # Check for affinity rules
                        if not vm_info['reason'] and hasattr(vm, 'config') and vm.config:
                            if hasattr(vm.config, 'cpuAffinity') and vm.config.cpuAffinity:
                                if vm.config.cpuAffinity.affinitySet:
                                    vm_info['reason'] = 'CPU affinity rules'
                        
                        # Default reason
                        if not vm_info['reason']:
                            vm_info['reason'] = 'DRS could not find suitable destination'
                        
                        powered_on_vms.append(vm_info)
                except Exception as vm_err:
                    # Still add the VM even if we can't get details
                    powered_on_vms.append({
                        'name': getattr(vm, 'name', 'unknown'),
                        'power_state': 'unknown',
                        'reason': 'could not analyze'
                    })
            
            blockers['vms_remaining'] = powered_on_vms
            blockers['total_vms'] = len(powered_on_vms)
            
            if powered_on_vms:
                blockers['reason'] = f"DRS could not evacuate {len(powered_on_vms)} VM(s) within the timeout period"
                self.log(f"  ⚠️ {len(powered_on_vms)} VMs still on host after timeout:", "WARN")
                for vm in powered_on_vms[:5]:
                    self.log(f"    - {vm['name']}: {vm['reason']}", "WARN")
                if len(powered_on_vms) > 5:
                    self.log(f"    ... and {len(powered_on_vms) - 5} more", "WARN")
                    
        except Exception as e:
            self.log(f"  Failed to get evacuation blockers: {e}", "WARN")
            blockers['reason'] = f"Could not determine blocking VMs: {e}"
        
        return blockers

    def enter_vcenter_maintenance_mode(self, host_id: str, timeout: int = 600, _retry_count: int = 0) -> dict:
        """Put ESXi host into maintenance mode.
        
        Args:
            host_id: vCenter host ID from database
            timeout: Timeout in seconds for maintenance mode entry
            _retry_count: Internal retry counter for NotAuthenticated handling
        """
        start_time = time.time()
        host_name = host_id
        max_retries = 2

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

            # Connect to vCenter - use ensure_vcenter_connection for session validation
            vc = self.ensure_vcenter_connection(settings=vcenter_settings)
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
                    # Capture which VMs are still on the host (blocking evacuation)
                    evacuation_blockers = self._get_evacuation_blockers(host_obj, host_name)
                    
                    self.log_vcenter_activity(
                        operation="enter_maintenance_mode",
                        endpoint=host_name,
                        success=False,
                        response_time_ms=int((time.time() - start_time) * 1000),
                        error=f'Maintenance mode timeout after {timeout}s'
                    )
                    return {
                        'success': False, 
                        'error': f'Maintenance mode timeout after {timeout}s',
                        'evacuation_blockers': evacuation_blockers
                    }

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

        except vim.fault.NotAuthenticated as auth_err:
            # Handle session expiry with automatic retry
            if _retry_count < max_retries:
                self.log(f"  vCenter session not authenticated, reconnecting (retry {_retry_count + 1}/{max_retries})...", "WARN")
                self.vcenter_conn = None  # Force fresh connection
                return self.enter_vcenter_maintenance_mode(host_id, timeout, _retry_count=_retry_count + 1)
            else:
                self.log_vcenter_activity(
                    operation="enter_maintenance_mode",
                    endpoint=host_name,
                    success=False,
                    response_time_ms=int((time.time() - start_time) * 1000),
                    error=f'Session authentication failed after {max_retries} retries: {str(auth_err)}'
                )
                return {'success': False, 'error': f'Session authentication failed: {str(auth_err)}'}
        except Exception as e:
            self.log_vcenter_activity(
                operation="enter_maintenance_mode",
                endpoint=host_name,
                success=False,
                response_time_ms=int((time.time() - start_time) * 1000),
                error=str(e)
            )
            return {'success': False, 'error': str(e)}
    
    def exit_vcenter_maintenance_mode(self, host_id: str, timeout: int = 300, _retry_count: int = 0) -> dict:
        """Exit ESXi host from maintenance mode.
        
        Args:
            host_id: vCenter host ID from database
            timeout: Timeout in seconds for maintenance mode exit
            _retry_count: Internal retry counter for NotAuthenticated handling
        """
        start_time = time.time()
        host_name = host_id
        max_retries = 2

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

            # Connect to vCenter - use ensure_vcenter_connection for session validation
            vc = self.ensure_vcenter_connection(settings=vcenter_settings)
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

        except vim.fault.NotAuthenticated as auth_err:
            # Handle session expiry with automatic retry
            if _retry_count < max_retries:
                self.log(f"  vCenter session not authenticated, reconnecting (retry {_retry_count + 1}/{max_retries})...", "WARN")
                self.vcenter_conn = None  # Force fresh connection
                return self.exit_vcenter_maintenance_mode(host_id, timeout, _retry_count=_retry_count + 1)
            else:
                self.log_vcenter_activity(
                    operation="exit_maintenance_mode",
                    endpoint=host_name,
                    success=False,
                    response_time_ms=int((time.time() - start_time) * 1000),
                    error=f'Session authentication failed after {max_retries} retries: {str(auth_err)}'
                )
                return {'success': False, 'error': f'Session authentication failed: {str(auth_err)}'}
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
        """Wait for ESXi host to be in CONNECTED state via live vCenter query"""
        start_time = time.time()
        
        try:
            # Fetch host details from database to get vCenter connection info
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{host_id}&select=*",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            hosts = _safe_json_parse(response)
            if not hosts:
                self.log(f"  Host {host_id} not found in database", "WARN")
                return False
            
            host_data = hosts[0]
            vcenter_moref = host_data.get('vcenter_id')  # VMware moId
            host_name = host_data.get('name', host_id)
            source_vcenter_id = host_data.get('source_vcenter_id')
            
            if not vcenter_moref:
                self.log(f"  Host {host_name} has no vCenter moRef, falling back to database check", "WARN")
                # Fallback to database polling if no moRef
                while time.time() - start_time < timeout:
                    resp = requests.get(
                        f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{host_id}&select=status",
                        headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                        verify=VERIFY_SSL
                    )
                    h = _safe_json_parse(resp)
                    if h and h[0].get('status') == 'connected':
                        return True
                    time.sleep(5)
                return False
            
            # Get vCenter connection
            vcenter_settings = None
            if source_vcenter_id:
                vcenter_settings = self.get_vcenter_settings(source_vcenter_id)
            
            vc = self.ensure_vcenter_connection(settings=vcenter_settings)
            if not vc:
                self.log(f"  Could not connect to vCenter for live status check", "WARN")
                return False
            
            # Find host object by moRef
            content = vc.RetrieveContent()
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.HostSystem], True
            )
            
            host_obj = None
            for h in container.view:
                if str(h._moId) == vcenter_moref:
                    host_obj = h
                    break
            container.Destroy()
            
            if not host_obj:
                self.log(f"  Host {host_name} not found in vCenter (moRef: {vcenter_moref})", "WARN")
                return False
            
            # Poll vCenter LIVE for connection state
            self.log(f"  Waiting for host {host_name} to connect (live vCenter poll)...")
            while time.time() - start_time < timeout:
                try:
                    connection_state = str(host_obj.runtime.connectionState)
                    if connection_state == 'connected':
                        elapsed = int(time.time() - start_time)
                        self.log(f"  ✓ Host {host_name} connected after {elapsed}s")
                        return True
                    
                    self.log(f"    Current state: {connection_state}, waiting...")
                    time.sleep(5)
                except Exception as poll_err:
                    self.log(f"    Poll error: {poll_err}", "WARN")
                    time.sleep(5)
            
            self.log(f"  Timeout waiting for host {host_name} to connect after {timeout}s", "WARN")
            return False
            
        except Exception as e:
            self.log(f"  Error checking host connection: {e}", "WARN")
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
