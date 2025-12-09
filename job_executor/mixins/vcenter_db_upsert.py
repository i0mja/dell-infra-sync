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
        progress_callback: Optional[Callable[[int, str], None]] = None
    ) -> Dict[str, Any]:
        """
        Batch upsert all inventory from sync_vcenter_fast() to database.
        
        Args:
            inventory: Output from sync_vcenter_fast()
            source_vcenter_id: vCenter UUID for foreign key
            vcenter_name: Human-readable name for logging
            job_id: Optional job ID for activity logging
            progress_callback: Optional (percent, message) callback
            
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
            "errors": []
        }
        
        prefix = f"[{vcenter_name}] " if vcenter_name else ""
        
        # 1. Upsert clusters
        self.log(f"{prefix}Upserting {len(inventory['clusters'])} clusters...")
        if progress_callback:
            progress_callback(10, f"{prefix}Syncing clusters...")
        
        cluster_result = self._upsert_clusters_batch(
            inventory["clusters"], source_vcenter_id, job_id
        )
        results["clusters"] = cluster_result
        
        # 2. Upsert hosts (with auto-link to servers)
        self.log(f"{prefix}Upserting {len(inventory['hosts'])} hosts...")
        if progress_callback:
            progress_callback(30, f"{prefix}Syncing hosts...")
        
        host_result = self._upsert_hosts_batch(
            inventory["hosts"], source_vcenter_id, job_id
        )
        results["hosts"] = host_result
        
        # 3. Upsert datastores
        self.log(f"{prefix}Upserting {len(inventory['datastores'])} datastores...")
        if progress_callback:
            progress_callback(50, f"{prefix}Syncing datastores...")
        
        ds_result = self._upsert_datastores_batch(
            inventory["datastores"], source_vcenter_id, job_id
        )
        results["datastores"] = ds_result
        
        # 4. Upsert networks (standard + distributed)
        total_networks = len(inventory["networks"]) + len(inventory["dvpgs"])
        self.log(f"{prefix}Upserting {total_networks} networks...")
        if progress_callback:
            progress_callback(70, f"{prefix}Syncing networks...")
        
        net_result = self._upsert_networks_batch(
            inventory["networks"], 
            inventory["dvpgs"],
            inventory["dvswitches"],
            source_vcenter_id, 
            job_id
        )
        results["networks"] = net_result
        
        # 5. Upsert VMs
        self.log(f"{prefix}Upserting {len(inventory['vms'])} VMs...")
        if progress_callback:
            progress_callback(85, f"{prefix}Syncing VMs...")
        
        vm_result = self._upsert_vms_batch(
            inventory["vms"], source_vcenter_id, job_id
        )
        results["vms"] = vm_result
        
        if progress_callback:
            progress_callback(100, f"{prefix}Inventory sync complete")
        
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
                'cluster': h.get('cluster_name', ''),  # Updated field name
                'serial_number': h.get('serial_number', ''),
                'status': status,
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
                self.log(f"  Host batch upsert failed: {response.status_code}", "WARN")
                
        except Exception as e:
            self.log(f"  Host upsert error: {e}", "ERROR")
        
        return {"synced": synced, "total": len(hosts), "auto_linked": auto_linked}
    
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
                self.log(f"  Datastore batch upsert failed: {response.status_code}", "WARN")
                return {"synced": 0, "total": len(datastores)}
                
        except Exception as e:
            self.log(f"  Datastore upsert error: {e}", "ERROR")
            return {"synced": 0, "total": len(datastores)}
    
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
        
        batch = []
        
        # Standard networks - use Phase 5 field names
        for n in networks:
            batch.append({
                'name': n.get('name', ''),
                'vcenter_id': n.get('vcenter_id', n.get('id', '')),
                'source_vcenter_id': source_vcenter_id,
                'network_type': n.get('network_type', 'StandardNetwork'),
                'vlan_id': n.get('vlan_id'),
                'vlan_type': n.get('vlan_type'),
                'vlan_range': n.get('vlan_range'),
                'accessible': n.get('accessible', True),
                'host_count': n.get('host_count', 0),
                'vm_count': n.get('vm_count', 0),
                'uplink_port_group': n.get('uplink_port_group', False),
                'last_sync': utc_now_iso()
            })
        
        # Distributed port groups - use Phase 5 field names
        for d in dvpgs:
            batch.append({
                'name': d.get('name', ''),
                'vcenter_id': d.get('vcenter_id', d.get('id', '')),
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
        
        if not batch:
            return {"synced": 0, "total": 0}
        
        try:
            response = requests.post(
                f"{DSM_URL}/rest/v1/vcenter_networks",
                headers=headers,
                json=batch,
                verify=VERIFY_SSL,
                timeout=30
            )
            
            if response.status_code in [200, 201, 204]:
                self.log(f"  ✓ Batch upserted {len(batch)} networks")
                return {"synced": len(batch), "total": len(networks) + len(dvpgs)}
            else:
                self.log(f"  Network batch upsert failed: {response.status_code}", "WARN")
                return {"synced": 0, "total": len(networks) + len(dvpgs)}
                
        except Exception as e:
            self.log(f"  Network upsert error: {e}", "ERROR")
            return {"synced": 0, "total": len(networks) + len(dvpgs)}
    
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
                    'last_sync': utc_now_iso()
                })
            
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
                    self.log(f"  VM batch {i//batch_size + 1} upsert failed: {response.status_code}", "WARN")
                    
            except Exception as e:
                self.log(f"  VM batch upsert error: {e}", "ERROR")
        
        self.log(f"  ✓ Batch upserted {synced}/{len(vms)} VMs")
        return {"synced": synced, "total": len(vms)}
