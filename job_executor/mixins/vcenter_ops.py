"""VCenter operations mixin for Job Executor"""

import os
import ssl
import time
import requests
from typing import Dict, List, Optional
from datetime import datetime
from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim, vmodl
import atexit

from job_executor.config import (
    DSM_URL,
    SERVICE_ROLE_KEY,
    VERIFY_SSL,
    VCENTER_HOST,
    VCENTER_USER,
    VCENTER_PASSWORD
)
from job_executor.utils import _safe_json_parse, utc_now_iso


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
                    
                    # Check 4: Passthrough devices (USB, PCI, vGPU)
                    has_passthrough = False
                    passthrough_type = None
                    try:
                        for device in vm.config.hardware.device:
                            # PCI Passthrough
                            if isinstance(device, vim.vm.device.VirtualPCIPassthrough):
                                has_passthrough = True
                                passthrough_type = 'PCI passthrough'
                                break
                            # USB Controller with auto-connect
                            if isinstance(device, vim.vm.device.VirtualUSBController):
                                if hasattr(device, 'autoConnectDevices') and device.autoConnectDevices:
                                    has_passthrough = True
                                    passthrough_type = 'USB passthrough (auto-connect)'
                                    break
                            # USB xHCI Controller (USB 3.0)
                            if hasattr(vim.vm.device, 'VirtualUSBXHCIController'):
                                if isinstance(device, vim.vm.device.VirtualUSBXHCIController):
                                    has_passthrough = True
                                    passthrough_type = 'USB 3.0 xHCI passthrough'
                                    break
                            # Specific USB device passthrough
                            if hasattr(vim.vm.device, 'VirtualUSB'):
                                if isinstance(device, vim.vm.device.VirtualUSB):
                                    if hasattr(device, 'backing') and device.backing:
                                        has_passthrough = True
                                        passthrough_type = 'USB device passthrough'
                                        break
                            # vGPU (NVIDIA GRID)
                            if hasattr(device, 'backing') and device.backing:
                                backing_type = str(type(device.backing)).lower()
                                if 'vgpu' in backing_type or 'nvidia' in backing_type:
                                    has_passthrough = True
                                    passthrough_type = 'vGPU (NVIDIA GRID)'
                                    break
                                # Check for shared passthrough vGPU
                                if hasattr(device.backing, 'vgpu'):
                                    has_passthrough = True
                                    passthrough_type = 'vGPU'
                                    break
                    except:
                        pass
                    
                    if has_passthrough:
                        result['blockers'].append({
                            'vm_name': vm_name,
                            'vm_id': str(vm._moId),
                            'reason': 'passthrough' if 'vGPU' not in (passthrough_type or '') else 'vgpu',
                            'severity': 'critical',
                            'details': f'VM has {passthrough_type or "passthrough devices"} - cannot vMotion',
                            'remediation': 'Remove passthrough devices or power off this VM before maintenance',
                            'auto_fixable': False
                        })
                        vm_has_blocker = True
                        result['can_enter_maintenance'] = False
                    
                    # Check 5: Fault Tolerance
                    has_ft = False
                    try:
                        ft_state = str(vm.runtime.faultToleranceState) if vm.runtime else 'notConfigured'
                        if ft_state != 'notConfigured':
                            has_ft = True
                    except:
                        pass
                    
                    if has_ft:
                        result['blockers'].append({
                            'vm_name': vm_name,
                            'vm_id': str(vm._moId),
                            'reason': 'fault_tolerance',
                            'severity': 'critical',
                            'details': 'VM has Fault Tolerance enabled - cannot vMotion without disabling FT',
                            'remediation': 'Disable Fault Tolerance before maintenance or power off VM',
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
            
            # Check 7: DRS compatibility - simulate maintenance mode recommendations
            drs_blockers = self._check_drs_evacuation_feasibility(target_host, content, result['host_name'])
            if drs_blockers:
                for drs_blocker in drs_blockers:
                    # Avoid duplicates
                    existing_vms = [b['vm_name'] for b in result['blockers']]
                    if drs_blocker['vm_name'] not in existing_vms:
                        result['blockers'].append(drs_blocker)
                        result['blocked_vms'] += 1
                        result['migratable_vms'] = max(0, result['migratable_vms'] - 1)
                        if drs_blocker['severity'] == 'critical':
                            result['can_enter_maintenance'] = False
            
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
    
    def _build_remediation_summary(self, blockers: List[Dict]) -> Dict:
        """Build a summary of recommended actions for blocker resolution."""
        summary = {
            'vms_to_power_off': [],
            'vms_to_migrate_manually': [],
            'vms_acknowledged': [],
            'total_critical': 0,
            'total_warnings': 0,
            'can_proceed_with_power_off': True
        }
        
        for blocker in blockers:
            reason = blocker.get('reason', '')
            vm_name = blocker.get('vm_name', 'Unknown')
            severity = blocker.get('severity', 'warning')
            
            if severity == 'critical':
                summary['total_critical'] += 1
            else:
                summary['total_warnings'] += 1
            
            if reason in ['passthrough', 'local_storage', 'fault_tolerance', 'vgpu']:
                summary['vms_to_power_off'].append({
                    'vm': vm_name,
                    'reason': blocker.get('details', reason),
                    'action': 'Power off before maintenance',
                    'blocker_type': reason
                })
            elif reason == 'vcsa':
                summary['vms_to_migrate_manually'].append({
                    'vm': vm_name,
                    'action': 'Migrate VCSA to another host first, or update this host last',
                    'blocker_type': reason
                })
                summary['can_proceed_with_power_off'] = False  # VCSA can't just be powered off
            elif reason == 'critical_infra':
                summary['vms_to_migrate_manually'].append({
                    'vm': vm_name,
                    'action': 'Verify safe to migrate or manually migrate first',
                    'blocker_type': reason
                })
            elif reason in ['connected_media', 'affinity']:
                summary['vms_acknowledged'].append({
                    'vm': vm_name,
                    'action': blocker.get('remediation', 'Acknowledge and proceed'),
                    'blocker_type': reason,
                    'auto_fixable': blocker.get('auto_fixable', False)
                })
        
        return summary

    def _check_drs_evacuation_feasibility(self, host_obj, content, host_name: str) -> List[Dict]:
        """
        Check if DRS can evacuate all VMs from a host by analyzing:
        - Anti-affinity rules that would be violated
        - Resource constraints on destination hosts
        - EVC mode incompatibilities
        
        Returns list of blocker dicts for VMs that DRS cannot migrate.
        """
        blockers = []
        
        try:
            # Get the cluster this host belongs to
            cluster = None
            if hasattr(host_obj, 'parent') and isinstance(host_obj.parent, vim.ClusterComputeResource):
                cluster = host_obj.parent
            
            if not cluster:
                return blockers
            
            # Check if DRS is enabled
            if not cluster.configuration.drsConfig.enabled:
                self.log(f"    DRS is disabled on cluster - manual VM migration required", "WARN")
                return blockers
            
            # Get cluster configuration for rules
            cluster_config = cluster.configuration
            
            # Analyze anti-affinity rules
            vm_to_antiaffinity = {}
            if hasattr(cluster_config, 'rule'):
                for rule in cluster_config.rule or []:
                    if isinstance(rule, vim.cluster.AntiAffinityRuleSpec) and rule.enabled:
                        for vm in rule.vm or []:
                            vm_to_antiaffinity[str(vm._moId)] = {
                                'rule_name': rule.name,
                                'vms_in_rule': [v.name for v in rule.vm]
                            }
            
            # Get resource availability on other hosts
            other_hosts_capacity = []
            for h in cluster.host:
                if h._moId == host_obj._moId:
                    continue  # Skip target host
                if str(h.runtime.connectionState) != 'connected':
                    continue
                if h.runtime.inMaintenanceMode:
                    continue
                    
                # Calculate available resources
                cpu_total = h.hardware.cpuInfo.numCpuCores * h.hardware.cpuInfo.hz
                cpu_usage = h.summary.quickStats.overallCpuUsage * 1000000  # MHz to Hz
                cpu_available = cpu_total - cpu_usage
                
                mem_total = h.hardware.memorySize
                mem_usage = h.summary.quickStats.overallMemoryUsage * 1024 * 1024  # MB to bytes
                mem_available = mem_total - mem_usage
                
                other_hosts_capacity.append({
                    'name': h.name,
                    'cpu_available': cpu_available,
                    'mem_available': mem_available,
                    'evc_mode': cluster.summary.currentEVCModeKey if cluster.summary else None
                })
            
            if not other_hosts_capacity:
                # No other hosts available
                for vm in host_obj.vm:
                    if str(vm.runtime.powerState) == 'poweredOn':
                        blockers.append({
                            'vm_name': vm.name,
                            'vm_id': str(vm._moId),
                            'reason': 'drs_no_destination',
                            'severity': 'critical',
                            'details': 'No other hosts available in cluster to receive VMs',
                            'remediation': 'Add more hosts to cluster or power off this VM',
                            'auto_fixable': True,
                            'power_off_eligible': True
                        })
                return blockers
            
            # Check each powered-on VM
            for vm in host_obj.vm:
                try:
                    if str(vm.runtime.powerState) != 'poweredOn':
                        continue
                    
                    vm_name = vm.name
                    vm_id = str(vm._moId)
                    
                    # Get VM resource requirements
                    vm_cpu_reservation = 0
                    vm_mem_reservation = 0
                    if vm.resourceConfig:
                        vm_cpu_reservation = vm.resourceConfig.cpuAllocation.reservation or 0
                        vm_mem_reservation = (vm.resourceConfig.memoryAllocation.reservation or 0) * 1024 * 1024
                    
                    # Check anti-affinity rules
                    if vm_id in vm_to_antiaffinity:
                        rule_info = vm_to_antiaffinity[vm_id]
                        # Check if other VMs in the rule are on the only available host
                        other_vms_hosts = set()
                        for other_vm_name in rule_info['vms_in_rule']:
                            if other_vm_name != vm_name:
                                # Find where this VM is
                                for h in cluster.host:
                                    if h._moId == host_obj._moId:
                                        continue
                                    for other_vm in h.vm:
                                        if other_vm.name == other_vm_name:
                                            other_vms_hosts.add(h.name)
                        
                        if len(other_vms_hosts) == len(other_hosts_capacity):
                            # All destination hosts have VMs from the anti-affinity rule
                            blockers.append({
                                'vm_name': vm_name,
                                'vm_id': vm_id,
                                'reason': 'drs_anti_affinity',
                                'severity': 'critical',
                                'details': f"Anti-affinity rule '{rule_info['rule_name']}' prevents migration - all destination hosts have conflicting VMs",
                                'remediation': f"Power off this VM or one of: {', '.join(rule_info['vms_in_rule'])}",
                                'auto_fixable': True,
                                'power_off_eligible': True
                            })
                            continue
                    
                    # Check resource constraints
                    can_fit_anywhere = False
                    for host_cap in other_hosts_capacity:
                        if host_cap['cpu_available'] >= vm_cpu_reservation and \
                           host_cap['mem_available'] >= vm_mem_reservation:
                            can_fit_anywhere = True
                            break
                    
                    if not can_fit_anywhere and vm_cpu_reservation + vm_mem_reservation > 0:
                        blockers.append({
                            'vm_name': vm_name,
                            'vm_id': vm_id,
                            'reason': 'drs_resource_constraint',
                            'severity': 'critical',
                            'details': 'Insufficient CPU/memory resources on other hosts',
                            'remediation': 'Power off this VM or reduce VM reservations',
                            'auto_fixable': True,
                            'power_off_eligible': True
                        })
                        
                except Exception as vm_err:
                    self.log(f"    Error checking VM {vm.name} for DRS: {vm_err}", "DEBUG")
                    continue
            
            if blockers:
                self.log(f"    DRS feasibility check found {len(blockers)} blocking VM(s)")
                
        except Exception as e:
            self.log(f"    DRS feasibility check error: {e}", "DEBUG")
        
        return blockers
    
    def power_off_vms_for_maintenance(self, host_id: str, vm_names: List[str], 
                                       graceful: bool = True, timeout: int = 120,
                                       source_vcenter_id: str = None) -> Dict:
        """
        Power off specified VMs to enable maintenance mode entry.
        
        Args:
            host_id: The vcenter_host database ID
            vm_names: List of VM names to power off
            graceful: If True, attempt graceful shutdown first
            timeout: Timeout for graceful shutdown before forcing power off
            source_vcenter_id: Optional vCenter ID
            
        Returns:
            {
                'success': bool,
                'vms_powered_off': [str],
                'vms_failed': [{'name': str, 'error': str}],
                'total_time_seconds': int
            }
        """
        result = {
            'success': True,
            'vms_powered_off': [],
            'vms_failed': [],
            'total_time_seconds': 0
        }
        
        start_time = time.time()
        
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            from job_executor.utils import _safe_json_parse
            
            # Fetch host details
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{host_id}&select=*",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            
            if response.status_code != 200:
                result['success'] = False
                return result
            
            hosts = _safe_json_parse(response) or []
            if not hosts:
                result['success'] = False
                return result
            
            host_info = hosts[0]
            vcenter_id = source_vcenter_id or host_info.get('source_vcenter_id')
            vcenter_settings = self.get_vcenter_settings(vcenter_id) if vcenter_id else None
            
            vc = self.connect_vcenter(settings=vcenter_settings)
            if not vc:
                result['success'] = False
                return result
            
            content = vc.RetrieveContent()
            
            # Find the host
            host_container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.HostSystem], True
            )
            
            target_host = None
            for host_obj in host_container.view:
                if str(host_obj._moId) == host_info.get('vcenter_id'):
                    target_host = host_obj
                    break
            
            host_container.Destroy()
            
            if not target_host:
                result['success'] = False
                return result
            
            # Find and power off the specified VMs
            for vm in target_host.vm:
                if vm.name not in vm_names:
                    continue
                    
                try:
                    if str(vm.runtime.powerState) != 'poweredOn':
                        result['vms_powered_off'].append(vm.name)
                        continue
                    
                    self.log(f"    Powering off VM: {vm.name}")
                    
                    if graceful and vm.guest.toolsStatus == 'toolsOk':
                        # Try graceful shutdown
                        vm.ShutdownGuest()
                        
                        # Wait for shutdown
                        shutdown_start = time.time()
                        while time.time() - shutdown_start < timeout:
                            time.sleep(5)
                            if str(vm.runtime.powerState) == 'poweredOff':
                                break
                        
                        if str(vm.runtime.powerState) != 'poweredOff':
                            # Force power off
                            self.log(f"    Graceful shutdown timed out, forcing power off: {vm.name}")
                            task = vm.PowerOff()
                            while task.info.state == vim.TaskInfo.State.running:
                                time.sleep(1)
                    else:
                        # Direct power off
                        task = vm.PowerOff()
                        while task.info.state == vim.TaskInfo.State.running:
                            time.sleep(1)
                    
                    if str(vm.runtime.powerState) == 'poweredOff':
                        result['vms_powered_off'].append(vm.name)
                        self.log(f"    ✓ VM powered off: {vm.name}")
                    else:
                        result['vms_failed'].append({'name': vm.name, 'error': 'Failed to power off'})
                        result['success'] = False
                        
                except Exception as vm_err:
                    result['vms_failed'].append({'name': vm.name, 'error': str(vm_err)})
                    result['success'] = False
            
            result['total_time_seconds'] = int(time.time() - start_time)
            
        except Exception as e:
            self.log(f"  Power off VMs error: {e}", "WARN")
            result['success'] = False
        
        return result
    
    def power_on_vms_after_maintenance(self, host_id: str, vm_names: List[str], 
                                        timeout: int = 300,
                                        source_vcenter_id: str = None) -> Dict:
        """
        Power on VMs that were powered off for maintenance mode.
        This is the mirror function to power_off_vms_for_maintenance.
        
        Args:
            host_id: The vcenter_host database ID
            vm_names: List of VM names to power on
            timeout: Timeout for waiting for VM tools to come online
            source_vcenter_id: Optional vCenter ID
            
        Returns:
            {
                'success': bool,
                'vms_powered_on': [str],
                'vms_failed': [{'name': str, 'error': str}],
                'vms_already_on': [str],
                'total_time_seconds': int
            }
        """
        result = {
            'success': True,
            'vms_powered_on': [],
            'vms_failed': [],
            'vms_already_on': [],
            'total_time_seconds': 0
        }
        
        if not vm_names:
            self.log(f"    No VMs to power on")
            return result
        
        start_time = time.time()
        
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            from job_executor.utils import _safe_json_parse
            
            # Fetch host details
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_hosts?id=eq.{host_id}&select=*",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            
            if response.status_code != 200:
                result['success'] = False
                result['error'] = f"Failed to fetch host details: HTTP {response.status_code}"
                return result
            
            hosts = _safe_json_parse(response) or []
            if not hosts:
                result['success'] = False
                result['error'] = "Host not found in database"
                return result
            
            host_info = hosts[0]
            vcenter_id = source_vcenter_id or host_info.get('source_vcenter_id')
            vcenter_settings = self.get_vcenter_settings(vcenter_id) if vcenter_id else None
            
            vc = self.connect_vcenter(settings=vcenter_settings)
            if not vc:
                result['success'] = False
                result['error'] = "Cannot connect to vCenter"
                return result
            
            content = vc.RetrieveContent()
            
            # Find the host
            host_container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.HostSystem], True
            )
            
            target_host = None
            for host_obj in host_container.view:
                if str(host_obj._moId) == host_info.get('vcenter_id'):
                    target_host = host_obj
                    break
            
            host_container.Destroy()
            
            if not target_host:
                result['success'] = False
                result['error'] = f"Host {host_info.get('name')} not found in vCenter"
                return result
            
            self.log(f"    Powering on {len(vm_names)} VM(s) after maintenance...")
            
            # Find and power on the specified VMs
            vms_found = set()
            for vm in target_host.vm:
                if vm.name not in vm_names:
                    continue
                    
                vms_found.add(vm.name)
                    
                try:
                    current_state = str(vm.runtime.powerState) if vm.runtime else 'unknown'
                    
                    if current_state == 'poweredOn':
                        result['vms_already_on'].append(vm.name)
                        self.log(f"      ✓ {vm.name} already powered on")
                        continue
                    
                    self.log(f"      Powering on: {vm.name}")
                    
                    # Power on the VM
                    task = vm.PowerOn()
                    
                    # Wait for task to complete
                    power_on_start = time.time()
                    while task.info.state == vim.TaskInfo.State.running:
                        if time.time() - power_on_start > 60:  # 1 minute timeout for power on task
                            break
                        time.sleep(2)
                    
                    if task.info.state == vim.TaskInfo.State.success:
                        result['vms_powered_on'].append(vm.name)
                        self.log(f"      ✓ {vm.name} powered on successfully")
                        
                        # Optionally wait for VMware Tools to come online
                        if timeout > 0:
                            tools_start = time.time()
                            while time.time() - tools_start < min(timeout, 120):  # Max 2 min per VM
                                try:
                                    if vm.guest and vm.guest.toolsStatus in ['toolsOk', 'toolsOld']:
                                        self.log(f"      ✓ {vm.name} VMware Tools online")
                                        break
                                except:
                                    pass
                                time.sleep(5)
                    else:
                        error_msg = str(task.info.error) if task.info.error else 'Power on task failed'
                        result['vms_failed'].append({'name': vm.name, 'error': error_msg})
                        self.log(f"      ✗ {vm.name} power on failed: {error_msg}", "WARN")
                        
                except Exception as vm_err:
                    result['vms_failed'].append({'name': vm.name, 'error': str(vm_err)})
                    self.log(f"      ✗ {vm.name} error: {vm_err}", "WARN")
            
            # Check for VMs that weren't found on the host
            for vm_name in vm_names:
                if vm_name not in vms_found:
                    # VM might have migrated to another host - try to find it cluster-wide
                    self.log(f"      ⚠ {vm_name} not found on host (may have migrated)", "DEBUG")
            
            result['total_time_seconds'] = int(time.time() - start_time)
            
            # Set success based on whether any VMs failed
            if result['vms_failed']:
                result['success'] = len(result['vms_failed']) < len(vm_names)
            
            powered_on_count = len(result['vms_powered_on'])
            already_on_count = len(result['vms_already_on'])
            failed_count = len(result['vms_failed'])
            
            if powered_on_count > 0 or already_on_count > 0:
                self.log(f"    ✓ Power on complete: {powered_on_count} started, {already_on_count} already on, {failed_count} failed")
            
        except Exception as e:
            self.log(f"  Power on VMs error: {e}", "WARN")
            result['success'] = False
            result['error'] = str(e)
        
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

    # =========================================================================
    # Live vCenter Entity Querying with Auto-Sync
    # =========================================================================
    
    def get_live_entity(self, vcenter_id: str, entity_type: str, identifier: str, 
                        auto_sync: bool = True) -> Dict:
        """
        Query live vCenter for entity status, optionally sync DB on mismatch.
        
        This is the canonical way to check real vCenter state instead of trusting
        potentially stale database records. Use this for pre-flight checks and
        critical operations.
        
        Args:
            vcenter_id: Database ID of the vCenter to query
            entity_type: One of 'datastore', 'vm', 'host', 'cluster', 'network'
            identifier: Name or MoRef of the entity to find
            auto_sync: If True, update database when live data differs from cached
            
        Returns:
            {
                'live': True,  # Indicates this is live vCenter data
                'found': bool,
                'data': dict or None,  # Entity details if found
                'synced': bool,  # True if DB was updated
                'error': str or None
            }
        """
        result = {'live': True, 'found': False, 'data': None, 'synced': False, 'error': None}
        
        try:
            vcenter_settings = self.get_vcenter_settings(vcenter_id)
            if not vcenter_settings:
                result['error'] = f"vCenter {vcenter_id} not found in database"
                return result
            
            vc = self.connect_vcenter(settings=vcenter_settings, force_reconnect=True)
            if not vc:
                result['error'] = f"Failed to connect to vCenter {vcenter_settings.get('host')}"
                return result
            
            content = vc.RetrieveContent()
            
            # Dispatch to entity-specific handler
            if entity_type == 'datastore':
                result = self._get_live_datastore_impl(content, vcenter_id, identifier, auto_sync)
            elif entity_type == 'vm':
                result = self._get_live_vm_impl(content, vcenter_id, identifier, auto_sync)
            elif entity_type == 'host':
                result = self._get_live_host_impl(content, vcenter_id, identifier, auto_sync)
            elif entity_type == 'network':
                result = self._get_live_network_impl(content, vcenter_id, identifier, auto_sync)
            else:
                result['error'] = f"Unknown entity type: {entity_type}"
                
            result['live'] = True
            return result
            
        except Exception as e:
            self.log(f"[get_live_entity] Error querying {entity_type} '{identifier}': {e}", "ERROR")
            result['error'] = str(e)
            return result
    
    def get_live_datastore(self, vcenter_id: str, datastore_name: str, 
                           auto_sync: bool = True) -> Dict:
        """
        Query live vCenter for datastore status.
        
        Returns:
            {
                'live': True,
                'found': bool,
                'data': {
                    'name': str,
                    'accessible': bool,
                    'capacity_bytes': int,
                    'free_bytes': int,
                    'type': str,  # NFS, VMFS, etc.
                    'hosts_mounted': int,
                    'host_details': [{'name': str, 'mounted': bool, 'accessible': bool}]
                },
                'synced': bool,
                'error': str or None
            }
        """
        return self.get_live_entity(vcenter_id, 'datastore', datastore_name, auto_sync)
    
    def _get_live_datastore_impl(self, content, vcenter_id: str, datastore_name: str, 
                                  auto_sync: bool) -> Dict:
        """Internal implementation of live datastore query."""
        result = {'live': True, 'found': False, 'data': None, 'synced': False, 'error': None}
        
        # Recursive search through all datacenters, folders, and StoragePods
        datastore = self._find_datastore_in_vcenter(content, datastore_name)
        
        if not datastore:
            self.log(f"[get_live_datastore] Datastore '{datastore_name}' NOT found in vCenter", "WARN")
            # If auto_sync and DB says it exists, mark it as inaccessible
            if auto_sync:
                self._sync_datastore_not_found(vcenter_id, datastore_name)
                result['synced'] = True
            return result
        
        result['found'] = True
        
        # Extract datastore details
        try:
            summary = datastore.summary
            host_mounts = []
            hosts_mounted = 0
            
            for host_mount in datastore.host:
                mount_info = host_mount.mountInfo
                host_obj = host_mount.key
                host_detail = {
                    'name': host_obj.name if host_obj else 'unknown',
                    'moref': str(host_obj._moId) if host_obj else None,
                    'mounted': mount_info.mounted if mount_info else False,
                    'accessible': mount_info.accessible if mount_info else False,
                    'path': mount_info.path if mount_info else None
                }
                host_mounts.append(host_detail)
                if host_detail['mounted'] and host_detail['accessible']:
                    hosts_mounted += 1
            
            result['data'] = {
                'name': summary.name,
                'moref': str(datastore._moId),
                'accessible': summary.accessible,
                'capacity_bytes': summary.capacity,
                'free_bytes': summary.freeSpace,
                'type': summary.type,  # NFS, VMFS, VSAN, etc.
                'url': summary.url if hasattr(summary, 'url') else None,
                'hosts_mounted': hosts_mounted,
                'hosts_total': len(host_mounts),
                'host_details': host_mounts
            }
            
            self.log(f"[get_live_datastore] Found '{datastore_name}': accessible={summary.accessible}, hosts={hosts_mounted}/{len(host_mounts)}")
            
            # Auto-sync to DB if enabled
            if auto_sync:
                synced = self._sync_datastore_to_db(vcenter_id, result['data'])
                result['synced'] = synced
                
        except Exception as e:
            self.log(f"[get_live_datastore] Error extracting datastore details: {e}", "WARN")
            result['error'] = str(e)
        
        return result
    
    def _find_datastore_in_vcenter(self, content, datastore_name: str):
        """
        Recursively search for datastore in vCenter, including StoragePods.
        
        This handles:
        - Direct children of datastoreFolder
        - Datastores inside StoragePods (datastore clusters)
        - Nested folder structures
        """
        def search_folder(folder, depth=0):
            if depth > 10:  # Prevent infinite recursion
                return None
            try:
                for item in folder.childEntity:
                    # Direct datastore match
                    if isinstance(item, vim.Datastore):
                        if item.name == datastore_name:
                            return item
                    # StoragePod (datastore cluster) - search children
                    elif isinstance(item, vim.StoragePod):
                        for ds in item.childEntity:
                            if isinstance(ds, vim.Datastore) and ds.name == datastore_name:
                                return ds
                    # Nested folder - recurse
                    elif hasattr(item, 'childEntity'):
                        result = search_folder(item, depth + 1)
                        if result:
                            return result
            except Exception as e:
                self.log(f"[_find_datastore] Error searching folder: {e}", "DEBUG")
            return None
        
        # Search all datacenters
        for dc in content.rootFolder.childEntity:
            if isinstance(dc, vim.Datacenter):
                if hasattr(dc, 'datastoreFolder') and dc.datastoreFolder:
                    result = search_folder(dc.datastoreFolder)
                    if result:
                        return result
        
        return None
    
    def _sync_datastore_to_db(self, vcenter_id: str, live_data: Dict) -> bool:
        """Update vcenter_datastores table with live data."""
        try:
            now = utc_now_iso()
            
            # Check if record exists
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_datastores?vcenter_id=eq.{vcenter_id}&name=eq.{live_data['name']}&select=id",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            
            existing = _safe_json_parse(response) if response.status_code == 200 else []
            
            update_data = {
                'vcenter_id': vcenter_id,
                'name': live_data['name'],
                'type': live_data['type'],
                'capacity_bytes': live_data['capacity_bytes'],
                'free_space_bytes': live_data['free_bytes'],
                'accessible': live_data['accessible'],
                'url': live_data.get('url'),
                'updated_at': now
            }
            
            if existing:
                # Update existing record
                response = requests.patch(
                    f"{DSM_URL}/rest/v1/vcenter_datastores?id=eq.{existing[0]['id']}",
                    headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}', 
                             'Content-Type': 'application/json', 'Prefer': 'return=minimal'},
                    json=update_data,
                    verify=VERIFY_SSL
                )
            else:
                # Insert new record
                update_data['created_at'] = now
                response = requests.post(
                    f"{DSM_URL}/rest/v1/vcenter_datastores",
                    headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                             'Content-Type': 'application/json', 'Prefer': 'return=minimal'},
                    json=update_data,
                    verify=VERIFY_SSL
                )
            
            if response.status_code in [200, 201, 204]:
                self.log(f"[_sync_datastore_to_db] Synced '{live_data['name']}' to database")
                return True
            else:
                self.log(f"[_sync_datastore_to_db] Failed to sync: {response.status_code}", "WARN")
                return False
                
        except Exception as e:
            self.log(f"[_sync_datastore_to_db] Error: {e}", "WARN")
            return False
    
    def _sync_datastore_not_found(self, vcenter_id: str, datastore_name: str) -> bool:
        """Mark datastore as inaccessible in DB when not found in live vCenter."""
        try:
            response = requests.patch(
                f"{DSM_URL}/rest/v1/vcenter_datastores?vcenter_id=eq.{vcenter_id}&name=eq.{datastore_name}",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                         'Content-Type': 'application/json', 'Prefer': 'return=minimal'},
                json={'accessible': False, 'updated_at': utc_now_iso()},
                verify=VERIFY_SSL
            )
            if response.status_code in [200, 204]:
                self.log(f"[_sync_datastore_not_found] Marked '{datastore_name}' as inaccessible")
                return True
            return False
        except Exception as e:
            self.log(f"[_sync_datastore_not_found] Error: {e}", "WARN")
            return False
    
    def _get_live_vm_impl(self, content, vcenter_id: str, vm_identifier: str, 
                          auto_sync: bool) -> Dict:
        """Internal implementation of live VM query."""
        result = {'live': True, 'found': False, 'data': None, 'synced': False, 'error': None}
        
        try:
            # Search for VM by name or MoRef
            vm_view = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.VirtualMachine], True
            )
            
            target_vm = None
            for vm in vm_view.view:
                if vm.name == vm_identifier or str(vm._moId) == vm_identifier:
                    target_vm = vm
                    break
            
            vm_view.Destroy()
            
            if not target_vm:
                return result
            
            result['found'] = True
            result['data'] = {
                'name': target_vm.name,
                'moref': str(target_vm._moId),
                'power_state': str(target_vm.runtime.powerState) if target_vm.runtime else 'unknown',
                'guest_os': target_vm.summary.config.guestFullName if target_vm.summary and target_vm.summary.config else None,
                'num_cpu': target_vm.summary.config.numCpu if target_vm.summary and target_vm.summary.config else None,
                'memory_mb': target_vm.summary.config.memorySizeMB if target_vm.summary and target_vm.summary.config else None,
                'host': target_vm.runtime.host.name if target_vm.runtime and target_vm.runtime.host else None
            }
            
        except Exception as e:
            result['error'] = str(e)
        
        return result
    
    def _get_live_host_impl(self, content, vcenter_id: str, host_identifier: str,
                            auto_sync: bool) -> Dict:
        """Internal implementation of live host query."""
        result = {'live': True, 'found': False, 'data': None, 'synced': False, 'error': None}
        
        try:
            host_view = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.HostSystem], True
            )
            
            target_host = None
            for host in host_view.view:
                if host.name == host_identifier or str(host._moId) == host_identifier:
                    target_host = host
                    break
            
            host_view.Destroy()
            
            if not target_host:
                return result
            
            result['found'] = True
            runtime = target_host.runtime
            result['data'] = {
                'name': target_host.name,
                'moref': str(target_host._moId),
                'connection_state': str(runtime.connectionState) if runtime else 'unknown',
                'power_state': str(runtime.powerState) if runtime else 'unknown',
                'in_maintenance_mode': runtime.inMaintenanceMode if runtime else False,
                'cluster': target_host.parent.name if isinstance(target_host.parent, vim.ClusterComputeResource) else None
            }
            
        except Exception as e:
            result['error'] = str(e)
        
        return result
    
    def _get_live_network_impl(self, content, vcenter_id: str, network_identifier: str,
                               auto_sync: bool) -> Dict:
        """Internal implementation of live network query."""
        result = {'live': True, 'found': False, 'data': None, 'synced': False, 'error': None}
        
        try:
            network_view = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.Network], True
            )
            
            target_network = None
            for net in network_view.view:
                if net.name == network_identifier or str(net._moId) == network_identifier:
                    target_network = net
                    break
            
            network_view.Destroy()
            
            if not target_network:
                return result
            
            result['found'] = True
            result['data'] = {
                'name': target_network.name,
                'moref': str(target_network._moId),
                'accessible': target_network.summary.accessible if hasattr(target_network, 'summary') else True,
                'type': type(target_network).__name__  # DistributedVirtualPortgroup, Network, etc.
            }
            
        except Exception as e:
            result['error'] = str(e)
        
        return result

    def connect_vcenter(self, settings=None, force_reconnect=False):
        """Connect to vCenter if not already connected, with session validation.
        
        Args:
            settings: Optional vCenter connection settings dict
            force_reconnect: If True, disconnect existing connection and reconnect
        
        Returns:
            vCenter connection object or None if connection fails
        """
        # Determine the target host for this connection request
        target_host = settings.get('host') if settings else VCENTER_HOST
        
        # If we have a cached connection, check if it's to the SAME vCenter
        if self.vcenter_conn and not force_reconnect:
            # Check if cached connection is to a DIFFERENT vCenter
            cached_host = getattr(self, 'vcenter_conn_host', None)
            if cached_host and cached_host != target_host:
                self.log(f"Switching vCenter connection: {cached_host} → {target_host}")
                # Force disconnect from old vCenter before connecting to new one
                try:
                    Disconnect(self.vcenter_conn)
                except:
                    pass
                self.vcenter_conn = None
                self.vcenter_conn_host = None
            else:
                # Same vCenter (or unknown) - validate session is still alive
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
                self.vcenter_conn_host = None
        elif force_reconnect and self.vcenter_conn:
            # Force disconnect existing connection
            try:
                Disconnect(self.vcenter_conn)
            except:
                pass
            self.vcenter_conn = None
            self.vcenter_conn_host = None

        # Use provided settings or fall back to environment variables
        host = target_host
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
            # Track which vCenter this connection is for
            self.vcenter_conn_host = host
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

    # =========================================================================
    # Legacy sync methods removed - now using PropertyCollector in
    # job_executor/mixins/vcenter_property_collector.py and
    # job_executor/mixins/vcenter_db_upsert.py
    # =========================================================================

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

    def _host_in_maintenance(self, content, host_obj) -> bool:
        """Check if host is already in maintenance mode with a fresh property read."""
        try:
            runtime = getattr(host_obj, "runtime", None)
            if runtime and getattr(runtime, "inMaintenanceMode", False):
                return True
        except Exception:
            pass

        try:
            pc = content.propertyCollector
            obj_spec = vmodl.query.PropertyCollector.ObjectSpec(obj=host_obj)
            prop_spec = vmodl.query.PropertyCollector.PropertySpec(
                type=vim.HostSystem,
                pathSet=["summary.runtime.inMaintenanceMode", "runtime.inMaintenanceMode"],
            )
            filter_spec = vmodl.query.PropertyCollector.FilterSpec(
                objectSet=[obj_spec],
                propSet=[prop_spec]
            )
            results = pc.RetrieveProperties(specSet=[filter_spec])
            for res in results:
                for prop in res.propSet:
                    if prop.name.endswith("inMaintenanceMode") and bool(prop.val):
                        return True
        except Exception as e:
            self.log(f"    Warning: Could not refresh maintenance mode state: {e}", "DEBUG")

        return False

    def _get_remaining_vms_on_host(self, host_obj) -> List[Dict]:
        """Return powered-on VMs currently running on the host with basic metadata."""
        remaining_vms: List[Dict] = []
        try:
            for vm in getattr(host_obj, "vm", []):
                try:
                    if getattr(vm.runtime, "powerState", None) != "poweredOn":
                        continue
                except Exception:
                    continue

                vm_entry = {
                    "name": getattr(vm, "name", "unknown"),
                    "power_state": "poweredOn",
                }
                try:
                    vm_entry["id"] = str(vm._moId)
                except Exception:
                    pass
                remaining_vms.append(vm_entry)
        except Exception as e:
            self.log(f"    Warning: Could not enumerate remaining VMs: {e}", "DEBUG")

        return remaining_vms

    def _update_evacuation_progress_state(
        self,
        progress_state: Dict,
        current_vm_count: int,
        active_tasks: Dict,
        host_in_maintenance: bool,
        stall_timeout: int,
        operator_wait_timeout: int,
        now: Optional[float] = None
    ) -> Dict:
        """
        Track progress signals for maintenance evacuation in a testable, side-effect-free way.

        Progress is detected when:
        - VM count decreases
        - Migration tasks appear/change/complete
        - Host transitions into maintenance mode
        """
        now = now or time.time()
        updated = dict(progress_state)
        previous_tasks = progress_state.get("last_tasks", {})
        progress_reason = None

        # Detect maintenance mode flip immediately
        if host_in_maintenance:
            progress_reason = "maintenance_mode"
        elif current_vm_count < progress_state.get("last_vm_count", current_vm_count):
            progress_reason = "vm_count"
        elif active_tasks != previous_tasks:
            if active_tasks:
                progress_reason = "task_activity"
            elif previous_tasks:
                progress_reason = "tasks_completed"

        if progress_reason:
            updated["last_progress_time"] = now
            updated["last_progress_reason"] = progress_reason
            updated["waiting_for_operator"] = False
            updated["waiting_started_at"] = None

        updated["last_tasks"] = active_tasks
        updated["last_vm_count"] = current_vm_count

        stall_duration = now - updated.get("last_progress_time", now)
        updated["stall_duration_seconds"] = int(stall_duration)

        if (
            stall_duration >= stall_timeout
            and current_vm_count > 0
            and len(active_tasks) == 0
        ):
            if not updated.get("waiting_for_operator"):
                updated["waiting_for_operator"] = True
                updated["waiting_started_at"] = now

        if updated.get("waiting_for_operator") and updated.get("waiting_started_at"):
            updated["operator_wait_elapsed"] = int(now - updated["waiting_started_at"])
        else:
            updated["operator_wait_elapsed"] = 0

        updated["operator_wait_timed_out"] = (
            updated.get("waiting_for_operator", False)
            and updated.get("operator_wait_elapsed", 0) >= operator_wait_timeout
        )

        return updated

    def _build_maintenance_status_payload(
        self,
        host_name: str,
        vms_before: int,
        remaining_vms: List[Dict],
        active_migrations: List[Dict],
        progress_state: Dict,
        status: str,
        stall_duration: int = 0,
        human_status: Optional[str] = None,
        evacuation_blockers: Optional[Dict] = None,
    ) -> Dict:
        """Normalize structured payload returned to UI for maintenance mode operations."""
        last_progress_ts = progress_state.get("last_progress_time", time.time())
        return {
            'host': host_name,
            'status': status,
            'vms_evacuated': max(0, vms_before - len(remaining_vms)),
            'vms_remaining': remaining_vms,
            'active_migrations': active_migrations or [],
            'last_progress_timestamp': datetime.fromtimestamp(last_progress_ts).isoformat(),
            'stall_duration_seconds': stall_duration,
            'human_readable_status': human_status,
            'evacuation_blockers': evacuation_blockers,
        }

    def _get_active_migration_tasks(
        self,
        content,
        host_obj,
        previous_snapshot: Optional[Dict] = None,
        remaining_vm_ids: Optional[set] = None
    ) -> dict:
        """Check for active vMotion/DRS migration tasks for VMs on this host.
        
        DRS evacuates VMs in batches/chunks. This method detects when migrations
        are in progress even if the VM count hasn't changed yet, preventing
        false-positive stall detection.
        
        Args:
            content: vCenter ServiceContent object
            host_obj: The vim.HostSystem object being evacuated
            
        Returns:
            {
                'count': int,           # Number of active migrations
                'migrations': [         # List of in-progress migrations
                    {
                        'vm_name': str,
                        'task_name': str,
                        'state': str,
                        'progress': int
                    }
                ]
            'snapshot': {task_key: {'state': str, 'progress': int}},
            'has_changes': bool
        """
        active_migrations = []
        snapshot = {}
        previous_snapshot = previous_snapshot or {}
        
        try:
            task_manager = content.taskManager
            if not task_manager or not task_manager.recentTask:
                return {'count': 0, 'migrations': [], 'snapshot': {}, 'has_changes': False}
            
            # Get set of VM moIds on this host for matching
            host_vm_ids = set()
            try:
                for vm in host_obj.vm:
                    host_vm_ids.add(str(vm._moId))
            except:
                pass

            if remaining_vm_ids:
                # Only consider migrations for remaining VMs if provided
                host_vm_ids = host_vm_ids.intersection(remaining_vm_ids)
            
            # Migration-related task patterns
            migration_patterns = ['relocate', 'migrate', 'drs', 'vmotion']
            
            for task in task_manager.recentTask:
                try:
                    task_info = task.info
                    if not task_info:
                        continue
                    
                    # Only check running or queued tasks
                    task_state = str(task_info.state) if task_info.state else ''
                    if task_state not in ['running', 'queued']:
                        continue
                    
                    task_key = str(getattr(task_info, "key", None) or getattr(task, "_moId", None) or id(task))

                    # Get task name/description
                    task_name = ''
                    if hasattr(task_info, 'descriptionId') and task_info.descriptionId:
                        task_name = str(task_info.descriptionId).lower()
                    elif hasattr(task_info, 'name') and task_info.name:
                        task_name = str(task_info.name).lower()
                    
                    # Check if this is a migration-related task
                    is_migration_task = any(pattern in task_name for pattern in migration_patterns)
                    if not is_migration_task:
                        continue
                    
                    # Check if task involves a VM from this host
                    entity = task_info.entity
                    if entity and hasattr(entity, '_moId'):
                        entity_id = str(entity._moId)
                        
                        # Check if entity is a VM on our host
                        if entity_id in host_vm_ids:
                            vm_name = task_info.entityName or 'Unknown VM'
                            progress = task_info.progress if task_info.progress else 0
                            destination = None
                            try:
                                if hasattr(task_info, "result") and isinstance(task_info.result, vim.HostSystem):
                                    destination = getattr(task_info.result, "name", None) or str(task_info.result)
                                elif hasattr(task_info, "reason") and getattr(task_info.reason, "host", None):
                                    destination = getattr(task_info.reason.host, "name", None)
                            except Exception:
                                destination = None
                            
                            active_migrations.append({
                                'vm_name': vm_name,
                                'task_key': task_key,
                                'task_name': task_name,
                                'state': task_state,
                                'progress': progress,
                                'destination': destination
                            })
                            snapshot[task_key] = {'state': task_state, 'progress': progress}
                        else:
                            # Also check if the entity is a VM and its current host matches
                            # (for cases where moId matching fails)
                            try:
                                if isinstance(entity, vim.VirtualMachine):
                                    if hasattr(entity, 'runtime') and entity.runtime:
                                        vm_host = entity.runtime.host
                                        if vm_host and str(vm_host._moId) == str(host_obj._moId):
                                            vm_name = task_info.entityName or entity.name or 'Unknown VM'
                                            progress = task_info.progress if task_info.progress else 0
                                            destination = None
                                            try:
                                                if hasattr(task_info, "result") and isinstance(task_info.result, vim.HostSystem):
                                                    destination = getattr(task_info.result, "name", None) or str(task_info.result)
                                            except Exception:
                                                destination = None
                                            
                                            active_migrations.append({
                                                'vm_name': vm_name,
                                                'task_key': task_key,
                                                'task_name': task_name,
                                                'state': task_state,
                                                'progress': progress,
                                                'destination': destination
                                            })
                                            snapshot[task_key] = {'state': task_state, 'progress': progress}
                            except:
                                pass
                                
                except Exception as task_err:
                    # Skip problematic tasks silently
                    continue
                    
        except Exception as e:
            self.log(f"    Warning: Could not check migration tasks: {e}", "DEBUG")
        
        has_changes = snapshot != previous_snapshot
        return {
            'count': len(active_migrations),
            'migrations': active_migrations,
            'snapshot': snapshot,
            'has_changes': has_changes
        }

    def enter_vcenter_maintenance_mode(self, host_id: str, timeout: int = 1800, _retry_count: int = 0) -> dict:
        """Put ESXi host into maintenance mode with progress monitoring.
        
        Args:
            host_id: vCenter host ID from database
            timeout: Maximum timeout in seconds (default 1800s/30min). 
                     The actual timeout extends dynamically if VMs are still migrating.
            _retry_count: Internal retry counter for NotAuthenticated handling
            
        Progress Monitoring:
            - Every 30 seconds, counts remaining VMs on host
            - Logs evacuation progress: "Evacuating: 36 → 28 → 15..."
            - Only fails if no progress is made for 5 minutes (stall detection)
            - Dynamically extends timeout if VMs are still migrating
        """
        start_time = time.time()
        host_name = host_id
        max_retries = 2

        # Progress monitoring settings
        progress_check_interval = max(10, int(os.getenv("VCENTER_MAINTENANCE_PROGRESS_INTERVAL", "15")))  # Seconds
        stall_timeout = int(os.getenv("VCENTER_MAINTENANCE_STALL_TIMEOUT", "900"))  # Default 15 minutes
        operator_wait_timeout = int(os.getenv("VCENTER_OPERATOR_WAIT_TIMEOUT", str(stall_timeout * 2)))
        # After all VMs evacuate, give vCenter extra time to finalize maintenance mode
        post_evacuation_grace = max(300, min(1800, int(timeout * 0.5)))

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

            blocker_analysis = self.analyze_maintenance_blockers(
                host_id,
                source_vcenter_id=source_vcenter_id
            )
            if blocker_analysis.get('can_enter_maintenance') is False:
                blockers = blocker_analysis.get('blockers', [])
                critical_blockers = [
                    blocker for blocker in blockers
                    if blocker.get('severity') == 'critical'
                ]
                blocker_summary = (
                    f"{len(critical_blockers)} critical blocker(s) detected"
                    if critical_blockers
                    else f"{len(blockers)} blocker(s) detected"
                )
                error_msg = f"Maintenance mode blocked: {blocker_summary}"
                self.log(f"  ✗ {error_msg}", "ERROR")
                
                # Build detailed blocker list with remediation
                blocker_details = []
                for blocker in blockers:
                    self.log(f"    - {blocker.get('vm_name')}: {blocker.get('reason')} - {blocker.get('details')}", "ERROR")
                    blocker_details.append({
                        'vm_name': blocker.get('vm_name'),
                        'vm_id': blocker.get('vm_id'),
                        'reason': blocker.get('reason'),
                        'severity': blocker.get('severity'),
                        'details': blocker.get('details'),
                        'remediation': blocker.get('remediation'),
                        'auto_fixable': blocker.get('auto_fixable', False)
                    })
                
                # Build remediation summary
                remediation_summary = self._build_remediation_summary(blockers)
                
                self.log_vcenter_activity(
                    operation="enter_maintenance_mode",
                    endpoint=host_name,
                    success=False,
                    response_time_ms=int((time.time() - start_time) * 1000),
                    error=error_msg,
                    details={
                        'maintenance_blockers': blocker_analysis,
                        'blocker_details': blocker_details,
                        'remediation_summary': remediation_summary
                    }
                )
                return {
                    'success': False,
                    'error': error_msg,
                    'maintenance_blockers': blocker_analysis,
                    'blocker_details': blocker_details,
                    'remediation_summary': remediation_summary
                }
            
            # Count running VMs before maintenance
            vms_before = len([vm for vm in host_obj.vm if vm.runtime.powerState == 'poweredOn'])
            self.log(f"  Host has {vms_before} running VMs to evacuate")
            
            # Enter maintenance mode - use a very long timeout, we'll manage it ourselves
            task = host_obj.EnterMaintenanceMode_Task(timeout=0, evacuatePoweredOffVms=False)

            self.log(f"  Entering maintenance mode (max timeout: {timeout}s, stall detection: {stall_timeout}s)...")
            
            # Progress monitoring state
            progress_state = {
                'last_vm_count': vms_before,
                'last_tasks': {},
                'last_progress_time': time.time(),
                'waiting_for_operator': False,
                'waiting_started_at': None,
                'last_progress_reason': 'start'
            }
            last_log_time = time.time()
            evacuation_completed_at = None
            latest_remaining_vms: List[Dict] = self._get_remaining_vms_on_host(host_obj)
            latest_migration_info = {'count': 0, 'migrations': [], 'snapshot': {}, 'has_changes': False}
            waiting_logged = False
            forced_success = False
            hard_deadline = timeout + operator_wait_timeout + post_evacuation_grace

            while task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
                time.sleep(2)
                now = time.time()
                elapsed = now - start_time

                if now - last_log_time >= progress_check_interval:
                    try:
                        host_in_maintenance = self._host_in_maintenance(content, host_obj)
                        latest_remaining_vms = self._get_remaining_vms_on_host(host_obj)
                        current_vms = len(latest_remaining_vms)
                        previous_vm_count = progress_state.get("last_vm_count", current_vms)
                        remaining_vm_ids = {vm.get("id") for vm in latest_remaining_vms if vm.get("id")}
                        latest_migration_info = self._get_active_migration_tasks(
                            content,
                            host_obj,
                            previous_snapshot=progress_state.get("last_tasks", {}),
                            remaining_vm_ids=remaining_vm_ids
                        )
                        progress_state = self._update_evacuation_progress_state(
                            progress_state=progress_state,
                            current_vm_count=current_vms,
                            active_tasks=latest_migration_info.get("snapshot", {}),
                            host_in_maintenance=host_in_maintenance,
                            stall_timeout=stall_timeout,
                            operator_wait_timeout=operator_wait_timeout,
                            now=now
                        )

                        stall_duration = progress_state.get("stall_duration_seconds", 0)
                        vms_evacuated = vms_before - current_vms
                        progress_pct = int((vms_evacuated / vms_before) * 100) if vms_before > 0 else 100

                        if host_in_maintenance and current_vms == 0:
                            self.log("    Host already in maintenance mode; finalizing...", "INFO")
                            forced_success = True
                            break

                        if current_vms < previous_vm_count:
                            self.log(f"    Evacuating: {previous_vm_count} → {current_vms} VMs ({progress_pct}% complete, {int(elapsed)}s elapsed)")
                            if current_vms == 0 and not evacuation_completed_at:
                                evacuation_completed_at = now
                                self.log(
                                    f"    All VMs evacuated. Waiting up to {post_evacuation_grace}s for vCenter to finalize maintenance mode..."
                                )
                            waiting_logged = False
                        elif latest_migration_info.get('count', 0) > 0:
                            migration_names = ', '.join([m.get('vm_name', 'VM') for m in latest_migration_info['migrations'][:3]])
                            if len(latest_migration_info['migrations']) > 3:
                                migration_names += f" +{len(latest_migration_info['migrations']) - 3} more"
                            self.log(f"    Migrating: {latest_migration_info['count']} task(s) active ({current_vms} VMs remaining) - {migration_names}")
                            waiting_logged = False
                        elif progress_state.get("waiting_for_operator"):
                            wait_msg = (
                                f"Waiting for operator to migrate remaining VMs ({current_vms} remaining, "
                                f"{stall_duration}s without progress). Will keep polling for "
                                f"{max(operator_wait_timeout - progress_state.get('operator_wait_elapsed', 0), 0)}s."
                            )
                            if not waiting_logged:
                                self.log(f"    {wait_msg}", "WARN")
                                waiting_logged = True
                            else:
                                self.log(f"    {wait_msg}", "DEBUG")
                        else:
                            self.log(f"    Waiting: {current_vms} VMs remaining ({stall_duration}s since last activity)")
                        last_log_time = now

                    except Exception as vm_count_err:
                        self.log(f"    Warning: Could not check VM count: {vm_count_err}", "WARN")
                        last_log_time = now

                # Evaluate stall/wait conditions outside of log cadence for responsiveness
                if progress_state.get("operator_wait_timed_out") and len(latest_remaining_vms) > 0:
                    if self._host_in_maintenance(content, host_obj):
                        forced_success = True
                        break
                    evacuation_blockers = self._get_evacuation_blockers(host_obj, host_name)
                    remaining_with_reasons = evacuation_blockers.get('vms_remaining') or latest_remaining_vms
                    error_msg = (
                        f"VM evacuation stalled after waiting {progress_state.get('operator_wait_elapsed', 0)}s for operator intervention "
                        f"({len(remaining_with_reasons)} VM(s) still on host)"
                    )
                    self.log(f"  ✗ {error_msg}", "ERROR")
                    payload = self._build_maintenance_status_payload(
                        host_name,
                        vms_before,
                        remaining_with_reasons,
                        latest_migration_info.get("migrations", []),
                        progress_state,
                        status="waiting_for_operator_timeout",
                        stall_duration=progress_state.get("stall_duration_seconds", 0),
                        human_status="Evacuation stalled with no active migrations; operator wait timed out",
                        evacuation_blockers=evacuation_blockers
                    )
                    self.log_vcenter_activity(
                        operation="enter_maintenance_mode",
                        endpoint=host_name,
                        success=False,
                        response_time_ms=int(elapsed * 1000),
                        error=error_msg,
                        details=payload
                    )
                    return {
                        'success': False,
                        'error': error_msg,
                        **payload,
                        'vms_remaining_count': len(remaining_with_reasons),
                        'total_elapsed_seconds': int(elapsed)
                    }

                # Allow extra grace after evacuation for maintenance flag propagation
                if evacuation_completed_at:
                    if now - evacuation_completed_at > post_evacuation_grace:
                        if self._host_in_maintenance(content, host_obj):
                            forced_success = True
                            break
                        error_msg = "Host did not report maintenance mode after VMs evacuated"
                        payload = self._build_maintenance_status_payload(
                            host_name,
                            vms_before,
                            latest_remaining_vms,
                            latest_migration_info.get("migrations", []),
                            progress_state,
                            status="finalization_timeout",
                            stall_duration=progress_state.get("stall_duration_seconds", 0),
                            human_status=error_msg
                        )
                        self.log_vcenter_activity(
                            operation="enter_maintenance_mode",
                            endpoint=host_name,
                            success=False,
                            response_time_ms=int(elapsed * 1000),
                            error=error_msg,
                            details=payload
                        )
                        return {'success': False, 'error': error_msg, **payload}

                if elapsed > hard_deadline:
                    if self._host_in_maintenance(content, host_obj):
                        forced_success = True
                        break
                    evacuation_blockers = self._get_evacuation_blockers(host_obj, host_name)
                    remaining_with_reasons = evacuation_blockers.get('vms_remaining') or latest_remaining_vms
                    error_msg = f'Maintenance mode timeout after {int(elapsed)}s'
                    human_status = (
                        "Timed out waiting for host to enter maintenance despite no VMs remaining"
                        if len(remaining_with_reasons) == 0
                        else error_msg
                    )
                    payload = self._build_maintenance_status_payload(
                        host_name,
                        vms_before,
                        remaining_with_reasons,
                        latest_migration_info.get("migrations", []),
                        progress_state,
                        status="timeout",
                        stall_duration=progress_state.get("stall_duration_seconds", 0),
                        human_status=human_status,
                        evacuation_blockers=evacuation_blockers
                    )
                    self.log_vcenter_activity(
                        operation="enter_maintenance_mode",
                        endpoint=host_name,
                        success=False,
                        response_time_ms=int(elapsed * 1000),
                        error=error_msg,
                        details=payload
                    )
                    return {
                        'success': False,
                        'error': error_msg,
                        **payload,
                        'total_elapsed_seconds': int(elapsed)
                    }

            if task.info.state == vim.TaskInfo.State.error and not forced_success:
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
            final_remaining_vms = self._get_remaining_vms_on_host(host_obj)
            vms_after = len(final_remaining_vms)
            in_maintenance = self._host_in_maintenance(content, host_obj)
            time_taken = int(time.time() - start_time)

            if not in_maintenance and not forced_success:
                error_msg = "Host did not enter maintenance mode"
                payload = self._build_maintenance_status_payload(
                    host_name,
                    vms_before,
                    final_remaining_vms,
                    latest_migration_info.get("migrations", []),
                    progress_state,
                    status="unexpected_state",
                    stall_duration=progress_state.get("stall_duration_seconds", 0),
                    human_status=error_msg
                )
                self.log_vcenter_activity(
                    operation="enter_maintenance_mode",
                    endpoint=host_name,
                    success=False,
                    response_time_ms=int((time.time() - start_time) * 1000),
                    error=error_msg,
                    details=payload
                )
                return {'success': False, 'error': error_msg, **payload}

            self.log(f"  [OK] Maintenance mode active ({vms_before - vms_after} VMs evacuated in {time_taken}s)")
            payload = self._build_maintenance_status_payload(
                host_name,
                vms_before,
                final_remaining_vms,
                latest_migration_info.get("migrations", []),
                progress_state,
                status="completed",
                stall_duration=progress_state.get("stall_duration_seconds", 0),
                human_status="Host in maintenance mode"
            )
            
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
                details={**payload, 'in_maintenance': True, 'time_taken_seconds': time_taken}
            )

            return {
                'success': True,
                'in_maintenance': True,
                'vms_evacuated': vms_before - vms_after,
                'time_taken_seconds': time_taken,
                **payload
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

    # =========================================================================
    # HA (High Availability) Management
    # =========================================================================

    def get_cluster_ha_status(self, cluster_name: str, source_vcenter_id: str) -> dict:
        """
        Get HA status for a cluster.
        
        Returns:
            {
                'success': bool,
                'ha_enabled': bool,
                'host_monitoring': str,  # 'enabled' or 'disabled'
                'admission_control': bool,
                'error': str or None
            }
        """
        start_time = time.time()
        try:
            vcenter_settings = self.get_vcenter_settings(source_vcenter_id) if source_vcenter_id else None
            vc = self.ensure_vcenter_connection(settings=vcenter_settings)
            
            if not vc:
                return {'success': False, 'error': 'Failed to connect to vCenter'}
            
            content = vc.RetrieveContent()
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.ClusterComputeResource], True
            )
            
            target_cluster = None
            for cluster in container.view:
                if cluster.name == cluster_name:
                    target_cluster = cluster
                    break
            
            container.Destroy()
            
            if not target_cluster:
                return {'success': False, 'error': f'Cluster {cluster_name} not found'}
            
            das_config = target_cluster.configuration.dasConfig
            
            result = {
                'success': True,
                'ha_enabled': das_config.enabled if das_config else False,
                'host_monitoring': das_config.hostMonitoring if das_config else 'disabled',
                'admission_control': das_config.admissionControlEnabled if das_config else False,
                'cluster_name': cluster_name
            }
            
            response_time = int((time.time() - start_time) * 1000)
            self.log_vcenter_activity(
                operation="get_cluster_ha_status",
                endpoint=f"Cluster/{cluster_name}/HA",
                success=True,
                response_time_ms=response_time,
                details=result
            )
            
            return result
            
        except Exception as e:
            self.log(f"Failed to get cluster HA status: {e}", "ERROR")
            return {'success': False, 'error': str(e)}

    def disable_cluster_ha(self, cluster_name: str, source_vcenter_id: str) -> dict:
        """
        Disable vSphere HA on a cluster before rolling updates.
        
        This prevents "HA failover operation in progress" alerts during maintenance.
        
        Returns:
            {
                'success': bool,
                'was_enabled': bool,
                'host_monitoring_was': str,
                'admission_control_was': bool,
                'error': str or None
            }
        """
        start_time = time.time()
        try:
            vcenter_settings = self.get_vcenter_settings(source_vcenter_id) if source_vcenter_id else None
            vc = self.ensure_vcenter_connection(settings=vcenter_settings)
            
            if not vc:
                return {'success': False, 'error': 'Failed to connect to vCenter'}
            
            content = vc.RetrieveContent()
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.ClusterComputeResource], True
            )
            
            target_cluster = None
            for cluster in container.view:
                if cluster.name == cluster_name:
                    target_cluster = cluster
                    break
            
            container.Destroy()
            
            if not target_cluster:
                return {'success': False, 'error': f'Cluster {cluster_name} not found'}
            
            das_config = target_cluster.configuration.dasConfig
            
            # Store original state for restoration
            original_state = {
                'was_enabled': das_config.enabled if das_config else False,
                'host_monitoring_was': das_config.hostMonitoring if das_config else 'disabled',
                'admission_control_was': das_config.admissionControlEnabled if das_config else False
            }
            
            # If HA is not enabled, nothing to do
            if not original_state['was_enabled']:
                self.log(f"  HA is not enabled on cluster {cluster_name} - skipping disable")
                return {
                    'success': True,
                    'already_disabled': True,
                    **original_state
                }
            
            # Check for Fault Tolerance VMs (HA cannot be disabled with FT VMs)
            try:
                for host in target_cluster.host:
                    for vm in host.vm:
                        if vm.runtime and vm.runtime.faultToleranceState:
                            ft_state = str(vm.runtime.faultToleranceState)
                            if ft_state not in ['notConfigured', 'disabled']:
                                return {
                                    'success': False,
                                    'error': f'Cannot disable HA: VM "{vm.name}" has Fault Tolerance enabled ({ft_state})',
                                    'ft_vm': vm.name,
                                    **original_state
                                }
            except Exception as ft_check_error:
                self.log(f"  Warning: Could not check for FT VMs: {ft_check_error}", "WARN")
            
            # Disable HA
            self.log(f"  Disabling HA on cluster {cluster_name}...")
            
            cluster_spec = vim.cluster.ConfigSpecEx()
            cluster_spec.dasConfig = vim.cluster.DasConfigInfo()
            cluster_spec.dasConfig.enabled = False
            
            task = target_cluster.ReconfigureComputeResource_Task(cluster_spec, modify=True)
            
            # Wait for task to complete
            while task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
                time.sleep(1)
            
            if task.info.state == vim.TaskInfo.State.error:
                error_msg = str(task.info.error.msg) if task.info.error else 'Unknown error'
                return {
                    'success': False,
                    'error': f'Failed to disable HA: {error_msg}',
                    **original_state
                }
            
            response_time = int((time.time() - start_time) * 1000)
            self.log_vcenter_activity(
                operation="disable_cluster_ha",
                endpoint=f"Cluster/{cluster_name}/HA",
                success=True,
                response_time_ms=response_time,
                details={'cluster': cluster_name, **original_state}
            )
            
            self.log(f"  ✓ HA disabled on cluster {cluster_name}")
            return {
                'success': True,
                **original_state
            }
            
        except Exception as e:
            self.log(f"Failed to disable cluster HA: {e}", "ERROR")
            import traceback
            self.log(f"Traceback: {traceback.format_exc()}", "DEBUG")
            return {'success': False, 'error': str(e)}

    def enable_cluster_ha(self, cluster_name: str, source_vcenter_id: str, 
                          host_monitoring: str = 'enabled', 
                          admission_control: bool = True) -> dict:
        """
        Re-enable vSphere HA on a cluster after rolling updates.
        
        Args:
            cluster_name: Name of the cluster
            source_vcenter_id: vCenter ID for connection
            host_monitoring: 'enabled' or 'disabled' (default: enabled)
            admission_control: Whether to enable admission control (default: True)
            
        Returns:
            {
                'success': bool,
                'now_enabled': bool,
                'error': str or None
            }
        """
        start_time = time.time()
        try:
            vcenter_settings = self.get_vcenter_settings(source_vcenter_id) if source_vcenter_id else None
            vc = self.ensure_vcenter_connection(settings=vcenter_settings)
            
            if not vc:
                return {'success': False, 'error': 'Failed to connect to vCenter'}
            
            content = vc.RetrieveContent()
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.ClusterComputeResource], True
            )
            
            target_cluster = None
            for cluster in container.view:
                if cluster.name == cluster_name:
                    target_cluster = cluster
                    break
            
            container.Destroy()
            
            if not target_cluster:
                return {'success': False, 'error': f'Cluster {cluster_name} not found'}
            
            # Check if HA is already enabled
            das_config = target_cluster.configuration.dasConfig
            if das_config and das_config.enabled:
                self.log(f"  HA is already enabled on cluster {cluster_name}")
                return {
                    'success': True,
                    'already_enabled': True,
                    'now_enabled': True
                }
            
            # Enable HA
            self.log(f"  Enabling HA on cluster {cluster_name}...")
            
            cluster_spec = vim.cluster.ConfigSpecEx()
            cluster_spec.dasConfig = vim.cluster.DasConfigInfo()
            cluster_spec.dasConfig.enabled = True
            cluster_spec.dasConfig.hostMonitoring = host_monitoring
            cluster_spec.dasConfig.admissionControlEnabled = admission_control
            
            task = target_cluster.ReconfigureComputeResource_Task(cluster_spec, modify=True)
            
            # Wait for task to complete
            while task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
                time.sleep(1)
            
            if task.info.state == vim.TaskInfo.State.error:
                error_msg = str(task.info.error.msg) if task.info.error else 'Unknown error'
                return {
                    'success': False,
                    'error': f'Failed to enable HA: {error_msg}',
                    'now_enabled': False
                }
            
            response_time = int((time.time() - start_time) * 1000)
            self.log_vcenter_activity(
                operation="enable_cluster_ha",
                endpoint=f"Cluster/{cluster_name}/HA",
                success=True,
                response_time_ms=response_time,
                details={'cluster': cluster_name, 'host_monitoring': host_monitoring, 'admission_control': admission_control}
            )
            
            self.log(f"  ✓ HA enabled on cluster {cluster_name}")
            return {
                'success': True,
                'now_enabled': True
            }
            
        except Exception as e:
            self.log(f"Failed to enable cluster HA: {e}", "ERROR")
            import traceback
            self.log(f"Traceback: {traceback.format_exc()}", "DEBUG")
            return {'success': False, 'error': str(e), 'now_enabled': False}

    def disable_host_monitoring(self, cluster_name: str, source_vcenter_id: str) -> dict:
        """
        Disable Host Monitoring only (less disruptive than full HA disable).
        
        Host Monitoring controls whether HA restarts VMs when a host fails.
        Disabling it prevents HA alerts during controlled maintenance.
        
        Returns:
            {
                'success': bool,
                'was_monitoring': str,  # 'enabled' or 'disabled'
                'error': str or None
            }
        """
        start_time = time.time()
        try:
            vcenter_settings = self.get_vcenter_settings(source_vcenter_id) if source_vcenter_id else None
            vc = self.ensure_vcenter_connection(settings=vcenter_settings)
            
            if not vc:
                return {'success': False, 'error': 'Failed to connect to vCenter'}
            
            content = vc.RetrieveContent()
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.ClusterComputeResource], True
            )
            
            target_cluster = None
            for cluster in container.view:
                if cluster.name == cluster_name:
                    target_cluster = cluster
                    break
            
            container.Destroy()
            
            if not target_cluster:
                return {'success': False, 'error': f'Cluster {cluster_name} not found'}
            
            das_config = target_cluster.configuration.dasConfig
            
            # Store original state
            original_monitoring = das_config.hostMonitoring if das_config else 'disabled'
            
            # If HA is not enabled or monitoring already disabled, nothing to do
            if not das_config or not das_config.enabled:
                return {'success': True, 'was_monitoring': original_monitoring, 'ha_not_enabled': True}
            
            if original_monitoring == 'disabled':
                return {'success': True, 'was_monitoring': original_monitoring, 'already_disabled': True}
            
            # Disable host monitoring
            self.log(f"  Disabling Host Monitoring on cluster {cluster_name}...")
            
            cluster_spec = vim.cluster.ConfigSpecEx()
            cluster_spec.dasConfig = vim.cluster.DasConfigInfo()
            cluster_spec.dasConfig.hostMonitoring = 'disabled'
            
            task = target_cluster.ReconfigureComputeResource_Task(cluster_spec, modify=True)
            
            while task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
                time.sleep(1)
            
            if task.info.state == vim.TaskInfo.State.error:
                error_msg = str(task.info.error.msg) if task.info.error else 'Unknown error'
                return {'success': False, 'error': f'Failed to disable host monitoring: {error_msg}', 'was_monitoring': original_monitoring}
            
            response_time = int((time.time() - start_time) * 1000)
            self.log_vcenter_activity(
                operation="disable_host_monitoring",
                endpoint=f"Cluster/{cluster_name}/HA/HostMonitoring",
                success=True,
                response_time_ms=response_time,
                details={'cluster': cluster_name, 'was_monitoring': original_monitoring}
            )
            
            self.log(f"  ✓ Host Monitoring disabled on cluster {cluster_name}")
            return {'success': True, 'was_monitoring': original_monitoring}
            
        except Exception as e:
            self.log(f"Failed to disable host monitoring: {e}", "ERROR")
            return {'success': False, 'error': str(e)}

    def enable_host_monitoring(self, cluster_name: str, source_vcenter_id: str) -> dict:
        """
        Re-enable Host Monitoring after maintenance.
        
        Returns:
            {
                'success': bool,
                'now_monitoring': str,
                'error': str or None
            }
        """
        start_time = time.time()
        try:
            vcenter_settings = self.get_vcenter_settings(source_vcenter_id) if source_vcenter_id else None
            vc = self.ensure_vcenter_connection(settings=vcenter_settings)
            
            if not vc:
                return {'success': False, 'error': 'Failed to connect to vCenter'}
            
            content = vc.RetrieveContent()
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.ClusterComputeResource], True
            )
            
            target_cluster = None
            for cluster in container.view:
                if cluster.name == cluster_name:
                    target_cluster = cluster
                    break
            
            container.Destroy()
            
            if not target_cluster:
                return {'success': False, 'error': f'Cluster {cluster_name} not found'}
            
            das_config = target_cluster.configuration.dasConfig
            
            # If HA is not enabled, we can't enable host monitoring
            if not das_config or not das_config.enabled:
                return {'success': False, 'error': 'HA is not enabled on cluster', 'now_monitoring': 'disabled'}
            
            # Enable host monitoring
            self.log(f"  Enabling Host Monitoring on cluster {cluster_name}...")
            
            cluster_spec = vim.cluster.ConfigSpecEx()
            cluster_spec.dasConfig = vim.cluster.DasConfigInfo()
            cluster_spec.dasConfig.hostMonitoring = 'enabled'
            
            task = target_cluster.ReconfigureComputeResource_Task(cluster_spec, modify=True)
            
            while task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
                time.sleep(1)
            
            if task.info.state == vim.TaskInfo.State.error:
                error_msg = str(task.info.error.msg) if task.info.error else 'Unknown error'
                return {'success': False, 'error': f'Failed to enable host monitoring: {error_msg}', 'now_monitoring': 'disabled'}
            
            response_time = int((time.time() - start_time) * 1000)
            self.log_vcenter_activity(
                operation="enable_host_monitoring",
                endpoint=f"Cluster/{cluster_name}/HA/HostMonitoring",
                success=True,
                response_time_ms=response_time,
                details={'cluster': cluster_name}
            )
            
            self.log(f"  ✓ Host Monitoring enabled on cluster {cluster_name}")
            return {'success': True, 'now_monitoring': 'enabled'}
            
        except Exception as e:
            self.log(f"Failed to enable host monitoring: {e}", "ERROR")
            return {'success': False, 'error': str(e), 'now_monitoring': 'unknown'}

    def sync_vcenter_alarms(self, content, source_vcenter_id: str, progress_callback=None, vcenter_name: str = "", job_id: str = None) -> Dict:
        """
        Sync triggered alarms from vCenter to the vcenter_alarms table.
        
        Args:
            content: vCenter ServiceInstance content object
            source_vcenter_id: The UUID of the vCenter in our database
            progress_callback: Optional callback(pct, msg) for progress updates
            vcenter_name: Name of the vCenter for logging
            job_id: Optional job ID for cancellation checking
            
        Returns:
            {'synced': int, 'cleared': int, 'errors': int}
        """
        result = {'synced': 0, 'cleared': 0, 'errors': 0}
        
        try:
            # Collect triggered alarms from vCenter
            root_folder = content.rootFolder
            triggered_alarm_states = root_folder.triggeredAlarmState or []
            
            self.log(f"  Found {len(triggered_alarm_states)} triggered alarms in vCenter")
            
            if progress_callback:
                progress_callback(5, f"Found {len(triggered_alarm_states)} triggered alarms")
            
            # Build alarm records
            alarm_records = []
            active_alarm_keys = set()
            
            for idx, alarm_state in enumerate(triggered_alarm_states):
                # Check for cancellation every 50 alarms
                if idx > 0 and idx % 50 == 0 and job_id:
                    if self.check_job_cancelled(job_id):
                        self.log(f"  Job cancelled during alarm sync at {idx}/{len(triggered_alarm_states)}")
                        return result
                
                try:
                    # Extract alarm details
                    alarm_key = str(alarm_state.key) if hasattr(alarm_state, 'key') else None
                    if not alarm_key:
                        # Generate key from alarm + entity
                        alarm_moref = str(alarm_state.alarm._moId) if alarm_state.alarm else 'unknown'
                        entity_moref = str(alarm_state.entity._moId) if alarm_state.entity else 'unknown'
                        alarm_key = f"{alarm_moref}.{entity_moref}"
                    
                    active_alarm_keys.add(alarm_key)
                    
                    # Entity info
                    entity = alarm_state.entity
                    entity_type = type(entity).__name__ if entity else 'Unknown'
                    entity_name = entity.name if entity and hasattr(entity, 'name') else 'Unknown'
                    entity_id = str(entity._moId) if entity else None
                    
                    # Alarm definition info
                    alarm_def = alarm_state.alarm
                    alarm_name = 'Unknown Alarm'
                    alarm_description = None
                    if alarm_def:
                        try:
                            alarm_info = alarm_def.info
                            alarm_name = alarm_info.name if alarm_info else 'Unknown Alarm'
                            alarm_description = alarm_info.description if alarm_info else None
                        except:
                            alarm_name = str(alarm_def._moId)
                    
                    # Status and timing
                    overall_status = str(alarm_state.overallStatus) if hasattr(alarm_state, 'overallStatus') else 'gray'
                    acknowledged = bool(alarm_state.acknowledged) if hasattr(alarm_state, 'acknowledged') else False
                    triggered_time = alarm_state.time if hasattr(alarm_state, 'time') else None
                    
                    # Convert time to ISO format
                    triggered_at = None
                    if triggered_time:
                        try:
                            triggered_at = triggered_time.isoformat()
                        except:
                            triggered_at = str(triggered_time)
                    
                    alarm_record = {
                        'alarm_key': alarm_key,
                        'entity_type': entity_type,
                        'entity_name': entity_name,
                        'entity_id': entity_id,
                        'alarm_name': alarm_name,
                        'alarm_status': overall_status,
                        'acknowledged': acknowledged,
                        'triggered_at': triggered_at,
                        'description': alarm_description,
                        'source_vcenter_id': source_vcenter_id,
                        'updated_at': utc_now_iso()
                    }
                    
                    alarm_records.append(alarm_record)
                    
                except Exception as alarm_err:
                    self.log(f"    Error processing alarm: {alarm_err}", "DEBUG")
                    result['errors'] += 1
                    continue
            
            # Upsert alarms to database
            if alarm_records:
                if progress_callback:
                    progress_callback(50, f"Upserting {len(alarm_records)} alarms to database")
                
                # Use upsert with ON CONFLICT
                headers = {
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates'
                }
                
                # Process in batches
                batch_size = 100
                for i in range(0, len(alarm_records), batch_size):
                    batch = alarm_records[i:i + batch_size]
                    
                    response = requests.post(
                        f"{DSM_URL}/rest/v1/vcenter_alarms?on_conflict=alarm_key",
                        headers=headers,
                        json=batch,
                        verify=VERIFY_SSL,
                        timeout=30
                    )
                    
                    if response.status_code in [200, 201]:
                        result['synced'] += len(batch)
                    else:
                        self.log(f"    Failed to upsert alarm batch: {response.status_code} - {response.text[:200]}", "WARN")
                        result['errors'] += len(batch)
            
            # Clear stale alarms (alarms no longer active in vCenter)
            if progress_callback:
                progress_callback(80, "Clearing stale alarms")
            
            # Get existing alarms for this vCenter
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_alarms?source_vcenter_id=eq.{source_vcenter_id}&select=id,alarm_key",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL,
                timeout=30
            )
            
            if response.status_code == 200:
                existing_alarms = _safe_json_parse(response) or []
                stale_alarm_ids = []
                
                for existing in existing_alarms:
                    if existing.get('alarm_key') not in active_alarm_keys:
                        stale_alarm_ids.append(existing['id'])
                
                # Delete stale alarms
                if stale_alarm_ids:
                    for alarm_id in stale_alarm_ids:
                        del_response = requests.delete(
                            f"{DSM_URL}/rest/v1/vcenter_alarms?id=eq.{alarm_id}",
                            headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                            verify=VERIFY_SSL,
                            timeout=10
                        )
                        if del_response.status_code in [200, 204]:
                            result['cleared'] += 1
                    
                    self.log(f"  Cleared {result['cleared']} stale alarms")
            
            if progress_callback:
                progress_callback(100, f"Alarm sync complete: {result['synced']} synced, {result['cleared']} cleared")
            
            self.log(f"  Alarm sync complete: {result['synced']} synced, {result['cleared']} cleared, {result['errors']} errors")
            
        except Exception as e:
            self.log(f"  Error syncing alarms: {e}", "ERROR")
            import traceback
            self.log(f"  Traceback: {traceback.format_exc()}", "DEBUG")
            result['errors'] += 1
        
        return result
