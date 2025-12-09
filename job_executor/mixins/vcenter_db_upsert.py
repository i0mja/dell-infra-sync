"""
Database upsert functions for PropertyCollector-based vCenter sync.

These functions batch-upsert JSON-serializable inventory data from
sync_vcenter_fast() to the database.
"""

import time
import logging
import requests
from typing import Dict, List, Any, Optional, Callable

from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
from job_executor.utils import utc_now_iso

logger = logging.getLogger(__name__)


class VCenterDbUpsertMixin:
    """Mixin providing database upsert operations for PropertyCollector sync."""
    
    def upsert_inventory_fast(
        self,
        inventory: Dict[str, Any],
        source_vcenter_id: str,
        vcenter_name: str = "",
        job_id: str = None,
        progress_callback: Optional[Callable[[int, str, int], None]] = None
    ) -> Dict[str, Any]:
        """
        Batch upsert all inventory from sync_vcenter_fast() to database.
        
        Args:
            inventory: Output from sync_vcenter_fast()
            source_vcenter_id: vCenter UUID for foreign key
            vcenter_name: Human-readable name for logging
            job_id: Optional job ID for activity logging
            progress_callback: Optional (percent, message, phase_idx) callback
            
        Returns:
            {
                "clusters": {"synced": int, "total": int},
                "hosts": {"synced": int, "total": int, "auto_linked": int},
                "vms": {"synced": int, "total": int},
                "datastores": {"synced": int, "total": int},
                "networks": {"synced": int, "total": int},
                "errors": List[str]
            }
        """
        start_time = time.time()
        results = {
            "clusters": {"synced": 0, "total": 0},
            "hosts": {"synced": 0, "total": 0, "auto_linked": 0},
            "vms": {"synced": 0, "total": 0},
            "datastores": {"synced": 0, "total": 0},
            "networks": {"synced": 0, "total": 0},
            "network_vms": {"synced": 0, "total": 0},
            "errors": []
        }
        
        prefix = f"[{vcenter_name}] " if vcenter_name else ""
        
        # 1. Upsert clusters (phase 0)
        self.log(f"{prefix}Upserting {len(inventory['clusters'])} clusters...")
        if progress_callback:
            progress_callback(10, f"{prefix}Syncing clusters...", 0)
        
        cluster_result = self._upsert_clusters_batch(
            inventory["clusters"], source_vcenter_id, job_id
        )
        results["clusters"] = cluster_result
        
        # 2. Upsert hosts (phase 1)
        self.log(f"{prefix}Upserting {len(inventory['hosts'])} hosts...")
        if progress_callback:
            progress_callback(30, f"{prefix}Syncing hosts...", 1)
        
        host_result = self._upsert_hosts_batch(
            inventory["hosts"], source_vcenter_id, job_id
        )
        results["hosts"] = host_result
        
        # 3. Upsert datastores (phase 2)
        self.log(f"{prefix}Upserting {len(inventory['datastores'])} datastores...")
        if progress_callback:
            progress_callback(50, f"{prefix}Syncing datastores...", 2)
        
        ds_result = self._upsert_datastores_batch(
            inventory["datastores"], source_vcenter_id, job_id
        )
        results["datastores"] = ds_result
        
        # 4. Upsert networks (phase 3)
        total_networks = len(inventory["networks"]) + len(inventory["dvpgs"])
        self.log(f"{prefix}Upserting {total_networks} networks...")
        if progress_callback:
            progress_callback(70, f"{prefix}Syncing networks...", 3)
        
        net_result = self._upsert_networks_batch(
            inventory["networks"], 
            inventory["dvpgs"],
            inventory["dvswitches"],
            source_vcenter_id, 
            job_id
        )
        results["networks"] = net_result
        
        # 5. Upsert VMs (phase 4)
        self.log(f"{prefix}Upserting {len(inventory['vms'])} VMs...")
        if progress_callback:
            progress_callback(80, f"{prefix}Syncing VMs...", 4)
        
        vm_result = self._upsert_vms_batch(
            inventory["vms"], source_vcenter_id, job_id
        )
        results["vms"] = vm_result
        
        # 6. Upsert Network-VM relationships (phase 5)
        self.log(f"{prefix}Upserting network-VM relationships...")
        if progress_callback:
            progress_callback(90, f"{prefix}Syncing network-VM relationships...", 5)
        
        network_vm_result = self._upsert_network_vms_batch(
            inventory["vms"], source_vcenter_id, job_id
        )
        results["network_vms"] = network_vm_result
        
        # 7. Update network VM counts from relationships
        self._update_network_vm_counts(source_vcenter_id)
        
        # Phase 6 (alarms) is handled separately in vcenter_handlers.py
        if progress_callback:
            progress_callback(100, f"{prefix}Inventory sync complete", 5)
        
        duration_ms = int((time.time() - start_time) * 1000)
        self.log(f"{prefix}Inventory upsert completed in {duration_ms}ms")
        
        return results
    
    def _upsert_clusters_batch(
        self, 
        clusters: List[Dict], 
        source_vcenter_id: str,
        job_id: str = None
    ) -> Dict[str, int]:
        """Batch upsert clusters."""
        if not clusters:
            return {"synced": 0, "total": 0}
        
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal'
        }
        
        batch = []
        for c in clusters:
            batch.append({
                'cluster_name': c.get('name', ''),
                'vcenter_id': c.get('id', ''),
                'source_vcenter_id': source_vcenter_id,
                'total_cpu_mhz': c.get('total_cpu_mhz', 0),
                'used_cpu_mhz': c.get('used_cpu_mhz', 0),
                'total_memory_bytes': c.get('total_memory_bytes', 0),
                'used_memory_bytes': c.get('used_memory_bytes', 0),
                'total_storage_bytes': c.get('total_storage_bytes', 0),
                'used_storage_bytes': c.get('used_storage_bytes', 0),
                'host_count': c.get('num_hosts', 0),
                'vm_count': c.get('vm_count', 0),
                'ha_enabled': c.get('ha_enabled', False),
                'drs_enabled': c.get('drs_enabled', False),
                'drs_automation_level': c.get('drs_automation_level', ''),
                'overall_status': c.get('overall_status', ''),
                'last_sync': utc_now_iso()
            })
        
        try:
            response = requests.post(
                f"{DSM_URL}/rest/v1/vcenter_clusters",
                headers=headers,
                json=batch,
                verify=VERIFY_SSL,
                timeout=30
            )
            
            if response.status_code in [200, 201, 204]:
                self.log(f"  ✓ Batch upserted {len(batch)} clusters")
                return {"synced": len(batch), "total": len(clusters)}
            else:
                self.log(f"  Cluster batch upsert failed: {response.status_code}", "WARN")
                return {"synced": 0, "total": len(clusters), "error": response.text}
                
        except Exception as e:
            self.log(f"  Cluster upsert error: {e}", "ERROR")
            return {"synced": 0, "total": len(clusters), "error": str(e)}
    
    def _upsert_hosts_batch(
        self, 
        hosts: List[Dict], 
        source_vcenter_id: str,
        job_id: str = None
    ) -> Dict[str, int]:
        """Batch upsert hosts with auto-linking to servers."""
        if not hosts:
            return {"synced": 0, "total": 0, "auto_linked": 0}
        
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=representation'
        }
        
        # Pre-fetch unlinked servers for auto-linking
        servers_response = requests.get(
            f"{DSM_URL}/rest/v1/servers?select=id,hostname,service_tag&vcenter_host_id=is.null&service_tag=not.is.null",
            headers={
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
            },
            verify=VERIFY_SSL
        )
        server_by_service_tag = {}
        if servers_response.status_code == 200:
            from job_executor.utils import _safe_json_parse
            servers_list = _safe_json_parse(servers_response)
            if servers_list:
                server_by_service_tag = {s['service_tag']: s for s in servers_list if s.get('service_tag')}
        
        batch = []
        for h in hosts:
            # Map power state
            status = 'unknown'
            conn_state = h.get('connection_state', '').lower()
            if 'connected' in conn_state:
                status = 'online'
            elif 'disconnected' in conn_state:
                status = 'offline'
            elif 'notresponding' in conn_state:
                status = 'unreachable'
            
            batch.append({
                'name': h.get('name', ''),
                'vcenter_id': h.get('id', ''),
                'source_vcenter_id': source_vcenter_id,
                'cluster': h.get('cluster_name', ''),
                'serial_number': h.get('serial_number', ''),
                'status': status,
                # Phase 7: ESXi version and maintenance mode
                'esxi_version': h.get('esxi_version', ''),
                'maintenance_mode': h.get('maintenance_mode', False),
                # Phase 6: Quickstats metrics
                'cpu_usage_mhz': h.get('cpu_usage_mhz', 0),
                'memory_usage_mb': h.get('memory_usage_mb', 0),
                'uptime_seconds': h.get('uptime_seconds', 0),
                'memory_size': h.get('memory_size', 0),
                'last_sync': utc_now_iso()
            })
        
        synced = 0
        auto_linked = 0
        
        try:
            response = requests.post(
                f"{DSM_URL}/rest/v1/vcenter_hosts",
                headers=headers,
                json=batch,
                verify=VERIFY_SSL,
                timeout=30
            )
            
            error = None
            if response.status_code in [200, 201]:
                from job_executor.utils import _safe_json_parse
                upserted_hosts = _safe_json_parse(response) or []
                synced = len(upserted_hosts) if isinstance(upserted_hosts, list) else len(batch)
                
                # Auto-link to servers by serial number
                for upserted in (upserted_hosts if isinstance(upserted_hosts, list) else []):
                    serial = upserted.get('serial_number')
                    host_id = upserted.get('id')
                    
                    if serial and host_id and serial in server_by_service_tag:
                        server = server_by_service_tag[serial]
                        try:
                            link_resp = requests.patch(
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
                            if link_resp.status_code in [200, 204]:
                                auto_linked += 1
                                self.log(f"    Auto-linked {serial} to host {upserted.get('name', '')}")
                        except Exception as link_err:
                            self.log(f"    Auto-link error: {link_err}", "WARN")
                
                self.log(f"  ✓ Batch upserted {synced} hosts, auto-linked {auto_linked}")
            else:
                error = f"HTTP {response.status_code}: {response.text[:300]}"
                self.log(f"  Host batch upsert failed: {error}", "WARN")
                
        except Exception as e:
            error = str(e)
            self.log(f"  Host upsert error: {e}", "ERROR")
        
        result = {"synced": synced, "total": len(hosts), "auto_linked": auto_linked}
        if error:
            result["error"] = error
        return result
    
    def _upsert_datastores_batch(
        self, 
        datastores: List[Dict], 
        source_vcenter_id: str,
        job_id: str = None
    ) -> Dict[str, int]:
        """Batch upsert datastores."""
        if not datastores:
            return {"synced": 0, "total": 0}
        
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal'
        }
        
        batch = []
        for d in datastores:
            batch.append({
                'name': d.get('name', ''),
                'vcenter_id': d.get('id', ''),
                'source_vcenter_id': source_vcenter_id,
                'type': d.get('type', ''),
                'capacity_bytes': d.get('capacity_bytes', 0),
                'free_bytes': d.get('free_bytes', 0),
                'accessible': d.get('accessible', True),
                # Phase 7: Host and VM counts
                'host_count': d.get('host_count', 0),
                'vm_count': d.get('vm_count', 0),
                'last_sync': utc_now_iso()
            })
        
        try:
            response = requests.post(
                f"{DSM_URL}/rest/v1/vcenter_datastores",
                headers=headers,
                json=batch,
                verify=VERIFY_SSL,
                timeout=30
            )
            
            if response.status_code in [200, 201, 204]:
                self.log(f"  ✓ Batch upserted {len(batch)} datastores")
                return {"synced": len(batch), "total": len(datastores)}
            else:
                error_msg = f"HTTP {response.status_code}: {response.text[:300]}"
                self.log(f"  Datastore batch upsert failed: {error_msg}", "WARN")
                return {"synced": 0, "total": len(datastores), "error": error_msg}
                
        except Exception as e:
            self.log(f"  Datastore upsert error: {e}", "ERROR")
            return {"synced": 0, "total": len(datastores), "error": str(e)}
    
    def _upsert_networks_batch(
        self, 
        networks: List[Dict],
        dvpgs: List[Dict],
        dvswitches: List[Dict],
        source_vcenter_id: str,
        job_id: str = None
    ) -> Dict[str, int]:
        """Batch upsert networks (standard + distributed)."""
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal'
        }
        
        # Build DVS lookup (for backward compat if needed)
        dvs_lookup = {d.get('vcenter_id', d.get('id', '')): d['name'] for d in dvswitches}
        
        # Deduplicate networks by vcenter_id to avoid 400 errors from duplicate entries
        seen_vcenter_ids = set()
        duplicates_removed = 0
        skipped_empty_names = 0
        
        batch = []
        
        # Standard networks - use Phase 5 field names
        for n in networks:
            vid = n.get('vcenter_id', n.get('id', ''))
            name = n.get('name', '')
            
            # Skip entries with empty vcenter_id
            if not vid:
                self.log(f"    Skipping network with empty vcenter_id: name={name}", "WARN")
                continue
            
            # Skip entries with empty names (would violate NOT NULL constraint)
            if not name:
                self.log(f"    Skipping network with empty name: vcenter_id={vid}", "WARN")
                skipped_empty_names += 1
                continue
            
            # Skip duplicates
            if vid in seen_vcenter_ids:
                duplicates_removed += 1
                continue
            seen_vcenter_ids.add(vid)
            
            batch.append({
                'name': name,
                'vcenter_id': vid,
                'source_vcenter_id': source_vcenter_id,
                'network_type': n.get('network_type', 'StandardNetwork'),
                'vlan_id': n.get('vlan_id'),
                'vlan_type': n.get('vlan_type'),
                'vlan_range': n.get('vlan_range'),
                'parent_switch_name': None,  # Standard networks don't have a parent switch
                'parent_switch_id': None,    # Must match DVPG keys for PostgREST batch
                'accessible': n.get('accessible', True),
                'host_count': n.get('host_count', 0),
                'vm_count': n.get('vm_count', 0),
                'uplink_port_group': n.get('uplink_port_group', False),
                'last_sync': utc_now_iso()
            })
        
        # Distributed port groups - use Phase 5 field names
        for d in dvpgs:
            vid = d.get('vcenter_id', d.get('id', ''))
            name = d.get('name', '')
            
            # Skip entries with empty vcenter_id
            if not vid:
                self.log(f"    Skipping DVPG with empty vcenter_id: name={name}", "WARN")
                continue
            
            # Skip entries with empty names
            if not name:
                self.log(f"    Skipping DVPG with empty name: vcenter_id={vid}", "WARN")
                skipped_empty_names += 1
                continue
            
            # Skip duplicates
            if vid in seen_vcenter_ids:
                duplicates_removed += 1
                continue
            seen_vcenter_ids.add(vid)
            
            batch.append({
                'name': name,
                'vcenter_id': vid,
                'source_vcenter_id': source_vcenter_id,
                'network_type': d.get('network_type', 'DistributedVirtualPortgroup'),
                'vlan_id': d.get('vlan_id'),
                'vlan_type': d.get('vlan_type'),
                'vlan_range': d.get('vlan_range'),
                'parent_switch_name': d.get('parent_switch_name', ''),
                'parent_switch_id': d.get('parent_switch_id', ''),
                'accessible': d.get('accessible', True),
                'host_count': d.get('host_count', 0),
                'vm_count': d.get('vm_count', 0),
                'uplink_port_group': d.get('uplink_port_group', False),
                'last_sync': utc_now_iso()
            })
        
        # Log if we filtered anything
        if duplicates_removed > 0:
            self.log(f"    Removed {duplicates_removed} duplicate network entries", "WARN")
        if skipped_empty_names > 0:
            self.log(f"    Skipped {skipped_empty_names} networks with empty names", "WARN")
        
        if not batch:
            return {"synced": 0, "total": 0}
        
        try:
            response = requests.post(
                f"{DSM_URL}/rest/v1/vcenter_networks?on_conflict=vcenter_id,source_vcenter_id",
                headers=headers,
                json=batch,
                verify=VERIFY_SSL,
                timeout=30
            )
            
            if response.status_code in [200, 201, 204]:
                self.log(f"  ✓ Batch upserted {len(batch)} networks")
                return {"synced": len(batch), "total": len(networks) + len(dvpgs)}
            else:
                # Log the actual error response for debugging
                error_body = ""
                try:
                    error_body = response.text[:500]  # First 500 chars
                except:
                    pass
                self.log(f"  Network batch upsert failed: {response.status_code} - {error_body}", "WARN")
                return {"synced": 0, "total": len(networks) + len(dvpgs), "error": error_body}
                
        except Exception as e:
            self.log(f"  Network upsert error: {e}", "ERROR")
            return {"synced": 0, "total": len(networks) + len(dvpgs), "error": str(e)}
    
    def _upsert_vms_batch(
        self, 
        vms: List[Dict], 
        source_vcenter_id: str,
        job_id: str = None
    ) -> Dict[str, int]:
        """Batch upsert VMs."""
        if not vms:
            return {"synced": 0, "total": 0}
        
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal'
        }
        
        # Pre-fetch host lookup for this vCenter
        hosts_response = requests.get(
            f"{DSM_URL}/rest/v1/vcenter_hosts?source_vcenter_id=eq.{source_vcenter_id}&select=id,name",
            headers={
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
            },
            verify=VERIFY_SSL
        )
        host_lookup = {}
        if hosts_response.status_code == 200:
            from job_executor.utils import _safe_json_parse
            hosts_list = _safe_json_parse(hosts_response) or []
            host_lookup = {h['name']: h['id'] for h in hosts_list}
        
        synced = 0
        batch_size = 50
        
        for i in range(0, len(vms), batch_size):
            batch_vms = vms[i:i+batch_size]
            batch = []
            
            for v in batch_vms:
                # Resolve host_id from host name (Phase 3 uses host_name)
                host_id = host_lookup.get(v.get('host_name', ''))
                
                batch.append({
                    'name': v.get('name', ''),
                    'vcenter_id': v.get('id', ''),
                    'source_vcenter_id': source_vcenter_id,
                    'host_id': host_id,
                    'cluster_name': v.get('cluster_name', ''),
                    'power_state': v.get('power_state', 'unknown'),
                    'overall_status': v.get('connection_state', 'unknown'),
                    # Phase 7: VM resources
                    'cpu_count': v.get('cpu_count', 0),
                    'memory_mb': v.get('memory_mb', 0),
                    'disk_gb': v.get('disk_gb', 0),
                    # Phase 7: Guest info
                    'guest_os': v.get('guest_os', ''),
                    'ip_address': v.get('ip_address', ''),
                    'is_template': v.get('is_template', False),
                    # Phase 7: Tools info
                    'tools_status': v.get('tools_status', ''),
                    'tools_version': v.get('tools_version', ''),
                    'last_sync': utc_now_iso()
                })
            
            errors = []
            try:
                response = requests.post(
                    f"{DSM_URL}/rest/v1/vcenter_vms",
                    headers=headers,
                    json=batch,
                    verify=VERIFY_SSL,
                    timeout=30
                )
                
                if response.status_code in [200, 201, 204]:
                    synced += len(batch)
                else:
                    error_msg = f"Batch {i//batch_size + 1}: HTTP {response.status_code}: {response.text[:200]}"
                    self.log(f"  VM batch upsert failed: {error_msg}", "WARN")
                    errors.append(error_msg)
                    
            except Exception as e:
                error_msg = f"Batch {i//batch_size + 1}: {str(e)}"
                self.log(f"  VM batch upsert error: {e}", "ERROR")
                errors.append(error_msg)
        
        self.log(f"  ✓ Batch upserted {synced}/{len(vms)} VMs")
        result = {"synced": synced, "total": len(vms)}
        if errors:
            result["error"] = "; ".join(errors)
        return result
    
    def _upsert_network_vms_batch(
        self,
        vms: List[Dict],
        source_vcenter_id: str,
        job_id: str = None
    ) -> Dict[str, int]:
        """Batch upsert network-VM relationships from VM network interfaces."""
        if not vms:
            return {"synced": 0, "total": 0}
        
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal'
        }
        
        # Fetch network lookup (vcenter_id -> id mapping)
        networks_response = requests.get(
            f"{DSM_URL}/rest/v1/vcenter_networks?source_vcenter_id=eq.{source_vcenter_id}&select=id,vcenter_id,name",
            headers={
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
            },
            verify=VERIFY_SSL
        )
        network_lookup = {}
        network_name_lookup = {}
        if networks_response.status_code == 200:
            from job_executor.utils import _safe_json_parse
            networks_list = _safe_json_parse(networks_response) or []
            for n in networks_list:
                if n.get('vcenter_id'):
                    network_lookup[n['vcenter_id']] = n['id']
                if n.get('name'):
                    network_name_lookup[n['name']] = n['id']
        
        # Fetch VM lookup (vcenter_id -> id mapping)
        vms_response = requests.get(
            f"{DSM_URL}/rest/v1/vcenter_vms?source_vcenter_id=eq.{source_vcenter_id}&select=id,vcenter_id",
            headers={
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
            },
            verify=VERIFY_SSL
        )
        vm_lookup = {}
        if vms_response.status_code == 200:
            from job_executor.utils import _safe_json_parse
            vms_list = _safe_json_parse(vms_response) or []
            vm_lookup = {v['vcenter_id']: v['id'] for v in vms_list if v.get('vcenter_id')}
        
        # Build relationship records
        relationships = []
        for v in vms:
            vm_vcenter_id = v.get('id', '')
            vm_id = vm_lookup.get(vm_vcenter_id)
            if not vm_id:
                continue
            
            network_interfaces = v.get('network_interfaces', [])
            for nic in network_interfaces:
                # Try to resolve network by moref first, then by name
                network_moref = nic.get('network_moref')
                network_name = nic.get('network_name')
                network_id = None
                
                if network_moref:
                    network_id = network_lookup.get(network_moref)
                if not network_id and network_name:
                    network_id = network_name_lookup.get(network_name)
                
                if not network_id:
                    continue  # Can't resolve network
                
                relationships.append({
                    'network_id': network_id,
                    'vm_id': vm_id,
                    'source_vcenter_id': source_vcenter_id,
                    'nic_label': nic.get('nic_label'),
                    'mac_address': nic.get('mac_address'),
                    'ip_addresses': nic.get('ip_addresses', []),
                    'adapter_type': nic.get('adapter_type'),
                    'connected': nic.get('connected', True),
                    'last_sync': utc_now_iso()
                })
        
        if not relationships:
            self.log(f"  No network-VM relationships found")
            return {"synced": 0, "total": 0}
        
        # Clear old relationships for this vCenter before inserting new ones
        try:
            requests.delete(
                f"{DSM_URL}/rest/v1/vcenter_network_vms?source_vcenter_id=eq.{source_vcenter_id}",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=30
            )
        except Exception as e:
            self.log(f"  Failed to clear old network-VM relationships: {e}", "WARN")
        
        # Batch upsert relationships
        synced = 0
        batch_size = 100
        
        for i in range(0, len(relationships), batch_size):
            batch = relationships[i:i+batch_size]
            
            try:
                response = requests.post(
                    f"{DSM_URL}/rest/v1/vcenter_network_vms",
                    headers=headers,
                    json=batch,
                    verify=VERIFY_SSL,
                    timeout=30
                )
                
                if response.status_code in [200, 201, 204]:
                    synced += len(batch)
                else:
                    self.log(f"  Network-VM batch {i//batch_size + 1} upsert failed: {response.status_code} - {response.text}", "WARN")
                    
            except Exception as e:
                self.log(f"  Network-VM batch upsert error: {e}", "ERROR")
        
        self.log(f"  ✓ Batch upserted {synced}/{len(relationships)} network-VM relationships")
        return {"synced": synced, "total": len(relationships)}
    
    def _update_network_vm_counts(self, source_vcenter_id: str):
        """Update vm_count on networks based on relationship counts."""
        try:
            # Get counts per network from relationships
            count_response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_network_vms?source_vcenter_id=eq.{source_vcenter_id}&select=network_id",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL
            )
            
            if count_response.status_code != 200:
                self.log(f"  Failed to fetch network-VM counts", "WARN")
                return
            
            from job_executor.utils import _safe_json_parse
            relationships = _safe_json_parse(count_response) or []
            
            # Count VMs per network
            network_counts = {}
            for rel in relationships:
                net_id = rel.get('network_id')
                if net_id:
                    network_counts[net_id] = network_counts.get(net_id, 0) + 1
            
            # Update each network's vm_count
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            }
            
            updated = 0
            for network_id, count in network_counts.items():
                try:
                    response = requests.patch(
                        f"{DSM_URL}/rest/v1/vcenter_networks?id=eq.{network_id}",
                        headers=headers,
                        json={'vm_count': count},
                        verify=VERIFY_SSL,
                        timeout=10
                    )
                    if response.status_code in [200, 204]:
                        updated += 1
                except Exception:
                    pass
            
            self.log(f"  ✓ Updated VM counts for {updated} networks")
            
        except Exception as e:
            self.log(f"  Failed to update network VM counts: {e}", "WARN")
