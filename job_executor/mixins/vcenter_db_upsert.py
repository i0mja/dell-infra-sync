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
            "datastore_hosts": {"synced": 0, "total": 0},
            "datastore_vms": {"synced": 0, "total": 0},
            "networks": {"synced": 0, "total": 0},
            "network_vms": {"synced": 0, "total": 0},
            "vm_snapshots": {"synced": 0, "total": 0},
            "vm_custom_attributes": {"synced": 0, "total": 0},
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
        
        # 3b. Upsert datastore-host relationships (for cluster-aware filtering)
        self.log(f"{prefix}Upserting datastore-host relationships...")
        ds_hosts_result = self._upsert_datastore_hosts_batch(
            inventory["datastores"], source_vcenter_id, job_id
        )
        results["datastore_hosts"] = ds_hosts_result
        
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
        # DEBUG: Enhanced logging for Marseille VM sync diagnosis
        self.log(f"{prefix}Upserting {len(inventory['vms'])} VMs from inventory...")
        if len(inventory['vms']) < 100:
            # Log all VM names if count is suspiciously low
            vm_names = [vm.get('name', 'unknown') for vm in inventory['vms'][:20]]
            self.log(f"{prefix}  DEBUG: VM names (first 20): {vm_names}")
        if progress_callback:
            progress_callback(80, f"{prefix}Syncing VMs...", 4)
        
        vm_result = self._upsert_vms_batch(
            inventory["vms"], source_vcenter_id, job_id
        )
        results["vms"] = vm_result
        
        # 6. Upsert Network-VM relationships (phase 5)
        self.log(f"{prefix}Upserting network-VM relationships...")
        if progress_callback:
            progress_callback(85, f"{prefix}Syncing network-VM relationships...", 5)
        
        network_vm_result = self._upsert_network_vms_batch(
            inventory["vms"], source_vcenter_id, job_id
        )
        results["network_vms"] = network_vm_result
        
        # 7. Upsert Datastore-VM relationships (phase 6) - for decommission safety
        self.log(f"{prefix}Upserting datastore-VM relationships...")
        if progress_callback:
            progress_callback(90, f"{prefix}Syncing datastore-VM relationships...", 6)
        
        datastore_vm_result = self._upsert_datastore_vms_batch(
            inventory["vms"], source_vcenter_id, job_id
        )
        results["datastore_vms"] = datastore_vm_result
        
        # 8. Upsert VM snapshots (phase 7)
        self.log(f"{prefix}Upserting VM snapshots...")
        if progress_callback:
            progress_callback(94, f"{prefix}Syncing VM snapshots...", 7)
        
        snapshots_result = self._upsert_vm_snapshots_batch(
            inventory["vms"], source_vcenter_id, job_id
        )
        results["vm_snapshots"] = snapshots_result
        
        # 9. Upsert VM custom attributes (phase 8)
        self.log(f"{prefix}Upserting VM custom attributes...")
        if progress_callback:
            progress_callback(97, f"{prefix}Syncing VM custom attributes...", 8)
        
        custom_attrs_result = self._upsert_vm_custom_attributes_batch(
            inventory["vms"], source_vcenter_id, job_id
        )
        results["vm_custom_attributes"] = custom_attrs_result
        
        # 10. Update network VM counts from relationships
        self._update_network_vm_counts(source_vcenter_id)
        
        # Phase 6 (alarms) is handled separately in vcenter_handlers.py
        if progress_callback:
            progress_callback(100, f"{prefix}Inventory sync complete", 9)
        
        duration_ms = int((time.time() - start_time) * 1000)
        self.log(f"{prefix}Inventory upsert completed in {duration_ms}ms")
        
        return results
    
    def upsert_inventory_partial(
        self,
        inventory: Dict[str, Any],
        source_vcenter_id: str,
        sync_scope: str,
        vcenter_name: str = "",
        job_id: str = None
    ) -> Dict[str, Any]:
        """
        Upsert only a specific entity type from partial sync.
        
        Args:
            inventory: Output from sync_vcenter_partial()
            source_vcenter_id: vCenter UUID
            sync_scope: "vms", "hosts", "clusters", "datastores", or "networks"
            vcenter_name: Human-readable name for logging
            job_id: Optional job ID
            
        Returns:
            {"synced": int, "total": int, "error": Optional[str]}
        """
        prefix = f"[{vcenter_name}] " if vcenter_name else ""
        items = inventory.get("items", [])
        
        self.log(f"{prefix}Partial upsert: {len(items)} {sync_scope}")
        
        if sync_scope == 'vms':
            # Need to resolve host_id for VMs
            return self._upsert_vms_partial(items, source_vcenter_id, job_id)
        elif sync_scope == 'hosts':
            return self._upsert_hosts_batch(items, source_vcenter_id, job_id)
        elif sync_scope == 'clusters':
            return self._upsert_clusters_batch(items, source_vcenter_id, job_id)
        elif sync_scope == 'datastores':
            return self._upsert_datastores_batch(items, source_vcenter_id, job_id)
        elif sync_scope == 'networks':
            return self._upsert_networks_batch(items, [], [], source_vcenter_id, job_id)
        else:
            return {"synced": 0, "total": 0, "error": f"Unknown scope: {sync_scope}"}
    
    def _upsert_vms_partial(
        self,
        vms: List[Dict],
        source_vcenter_id: str,
        job_id: str = None
    ) -> Dict[str, int]:
        """Upsert VMs for partial sync (resolves host_id internally)."""
        if not vms:
            return {"synced": 0, "total": 0}
        
        # Fetch existing hosts for this vCenter to resolve host_id
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_hosts?source_vcenter_id=eq.{source_vcenter_id}&select=id,vcenter_id,name",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=15
            )
            
            host_id_map = {}
            if response.status_code == 200:
                for h in response.json():
                    if h.get('vcenter_id'):
                        host_id_map[h['vcenter_id']] = h['id']
                    if h.get('name'):
                        host_id_map[h['name']] = h['id']
        except Exception as e:
            self.log(f"Warning: Could not fetch hosts for VM resolution: {e}", "WARN")
            host_id_map = {}
        
        # Now upsert VMs
        return self._upsert_vms_batch(vms, source_vcenter_id, job_id, host_id_map)
    
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
                f"{DSM_URL}/rest/v1/vcenter_clusters?on_conflict=cluster_name",
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
            
            host_name = h.get('name', '')
            cluster_name = h.get('cluster_name', '')
            self.log(f"[HostUpsert] Preparing host '{host_name}' with cluster='{cluster_name}'")
            
            batch.append({
                'name': host_name,
                'vcenter_id': h.get('id', ''),
                'source_vcenter_id': source_vcenter_id,
                'cluster': cluster_name,
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
                f"{DSM_URL}/rest/v1/vcenter_hosts?on_conflict=vcenter_id,source_vcenter_id",
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
        """Batch upsert datastores with moRef change detection."""
        if not datastores:
            return {"synced": 0, "total": 0}
        
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal'
        }
        
        # Pre-fetch existing datastores for this vCenter to detect moRef changes
        existing_datastores = {}
        moref_updated = 0
        try:
            existing_response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_datastores",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                params={
                    'source_vcenter_id': f'eq.{source_vcenter_id}',
                    'select': 'id,name,vcenter_id'
                },
                verify=VERIFY_SSL,
                timeout=30
            )
            if existing_response.status_code == 200:
                from job_executor.utils import _safe_json_parse
                existing_list = _safe_json_parse(existing_response) or []
                # Map by name for moRef change detection
                for ds in existing_list:
                    name = ds.get('name', '')
                    if name:
                        if name not in existing_datastores:
                            existing_datastores[name] = []
                        existing_datastores[name].append(ds)
        except Exception as e:
            self.log(f"  Warning: Could not pre-fetch existing datastores: {e}", "WARN")
        
        batch = []
        for d in datastores:
            ds_name = d.get('name', '')
            ds_moref = d.get('id', '')
            
            # Check if this datastore name exists with a different moRef
            if ds_name in existing_datastores:
                existing_entries = existing_datastores[ds_name]
                for existing in existing_entries:
                    if existing['vcenter_id'] != ds_moref:
                        # moRef changed - update existing record instead of creating duplicate
                        try:
                            update_resp = requests.patch(
                                f"{DSM_URL}/rest/v1/vcenter_datastores?id=eq.{existing['id']}",
                                headers={
                                    'apikey': SERVICE_ROLE_KEY,
                                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                    'Content-Type': 'application/json',
                                    'Prefer': 'return=minimal'
                                },
                                json={
                                    'vcenter_id': ds_moref,
                                    'type': d.get('type', ''),
                                    'capacity_bytes': d.get('capacity_bytes', 0),
                                    'free_bytes': d.get('free_bytes', 0),
                                    'accessible': d.get('accessible', True),
                                    'host_count': d.get('host_count', 0),
                                    'vm_count': d.get('vm_count', 0),
                                    'last_sync': utc_now_iso()
                                },
                                verify=VERIFY_SSL,
                                timeout=15
                            )
                            if update_resp.status_code in [200, 204]:
                                moref_updated += 1
                                self.log(f"    Updated moRef for {ds_name}: {existing['vcenter_id']} -> {ds_moref}")
                        except Exception as upd_err:
                            self.log(f"    moRef update error for {ds_name}: {upd_err}", "WARN")
                        # Skip adding to batch - we updated instead
                        continue
            
            batch.append({
                'name': ds_name,
                'vcenter_id': ds_moref,
                'source_vcenter_id': source_vcenter_id,
                'type': d.get('type', ''),
                'capacity_bytes': d.get('capacity_bytes', 0),
                'free_bytes': d.get('free_bytes', 0),
                'accessible': d.get('accessible', True),
                'host_count': d.get('host_count', 0),
                'vm_count': d.get('vm_count', 0),
                'last_sync': utc_now_iso()
            })
        
        synced = moref_updated
        
        if batch:
            try:
                response = requests.post(
                    f"{DSM_URL}/rest/v1/vcenter_datastores?on_conflict=vcenter_id,source_vcenter_id",
                    headers=headers,
                    json=batch,
                    verify=VERIFY_SSL,
                    timeout=30
                )
                
                if response.status_code in [200, 201, 204]:
                    synced += len(batch)
                    self.log(f"  ✓ Batch upserted {len(batch)} datastores" + (f", updated {moref_updated} moRefs" if moref_updated else ""))
                else:
                    error_msg = f"HTTP {response.status_code}: {response.text[:300]}"
                    self.log(f"  Datastore batch upsert failed: {error_msg}", "WARN")
                    return {"synced": moref_updated, "total": len(datastores), "error": error_msg, "moref_updated": moref_updated}
                    
            except Exception as e:
                self.log(f"  Datastore upsert error: {e}", "ERROR")
                return {"synced": moref_updated, "total": len(datastores), "error": str(e), "moref_updated": moref_updated}
        else:
            self.log(f"  ✓ Updated {moref_updated} datastore moRefs (no new datastores)")
        
        return {"synced": synced, "total": len(datastores), "moref_updated": moref_updated}
    
    def _upsert_datastore_hosts_batch(
        self,
        datastores: List[Dict],
        source_vcenter_id: str,
        job_id: str = None
    ) -> Dict[str, int]:
        """
        Upsert datastore-host relationships to vcenter_datastore_hosts table.
        
        This enables cluster-aware datastore filtering in useAccessibleDatastores hook.
        """
        if not datastores:
            return {"synced": 0, "total": 0}
        
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal'
        }
        
        # First, get datastore UUIDs from database (we have MoRefs, need UUIDs)
        ds_morefs = [d.get('id', '') for d in datastores if d.get('id')]
        if not ds_morefs:
            return {"synced": 0, "total": 0}
        
        # Fetch datastore UUID mappings
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_datastores",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                },
                params={
                    'source_vcenter_id': f'eq.{source_vcenter_id}',
                    'select': 'id,vcenter_id'
                },
                verify=VERIFY_SSL,
                timeout=30
            )
            if response.status_code != 200:
                error_msg = f"Failed to fetch datastore mappings: {response.status_code}"
                self.log(f"  {error_msg}", "WARN")
                return {"synced": 0, "total": 0, "error": error_msg}
            
            ds_uuid_map = {d['vcenter_id']: d['id'] for d in response.json()}
        except Exception as e:
            self.log(f"  Error fetching datastore mappings: {e}", "ERROR")
            return {"synced": 0, "total": 0, "error": str(e)}
        
        # Fetch host UUID mappings
        try:
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_hosts",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                },
                params={
                    'source_vcenter_id': f'eq.{source_vcenter_id}',
                    'select': 'id,vcenter_id'
                },
                verify=VERIFY_SSL,
                timeout=30
            )
            if response.status_code != 200:
                error_msg = f"Failed to fetch host mappings: {response.status_code}"
                self.log(f"  {error_msg}", "WARN")
                return {"synced": 0, "total": 0, "error": error_msg}
            
            host_uuid_map = {h['vcenter_id']: h['id'] for h in response.json()}
        except Exception as e:
            self.log(f"  Error fetching host mappings: {e}", "ERROR")
            return {"synced": 0, "total": 0, "error": str(e)}
        
        # Build relationship batch
        batch = []
        for ds in datastores:
            ds_moref = ds.get('id', '')
            ds_uuid = ds_uuid_map.get(ds_moref)
            if not ds_uuid:
                continue
            
            host_morefs = ds.get('host_morefs', [])
            for host_moref in host_morefs:
                host_uuid = host_uuid_map.get(host_moref)
                if not host_uuid:
                    continue
                
                batch.append({
                    'datastore_id': ds_uuid,
                    'host_id': host_uuid,
                    'source_vcenter_id': source_vcenter_id,
                    'accessible': True,
                    'last_sync': utc_now_iso()
                })
        
        if not batch:
            self.log(f"  No datastore-host relationships to sync")
            return {"synced": 0, "total": 0}
        
        # Upsert in batches to avoid request size limits
        batch_size = 200
        synced = 0
        errors = []
        
        for i in range(0, len(batch), batch_size):
            chunk = batch[i:i + batch_size]
            try:
                response = requests.post(
                    f"{DSM_URL}/rest/v1/vcenter_datastore_hosts?on_conflict=datastore_id,host_id",
                    headers=headers,
                    json=chunk,
                    verify=VERIFY_SSL,
                    timeout=30
                )
                
                if response.status_code in [200, 201, 204]:
                    synced += len(chunk)
                else:
                    error_msg = f"HTTP {response.status_code}: {response.text[:200]}"
                    errors.append(error_msg)
                    self.log(f"  Datastore-host batch upsert failed: {error_msg}", "WARN")
            except Exception as e:
                errors.append(str(e))
                self.log(f"  Datastore-host upsert error: {e}", "ERROR")
        
        self.log(f"  ✓ Synced {synced}/{len(batch)} datastore-host relationships")
        
        result = {"synced": synced, "total": len(batch)}
        if errors:
            result["error"] = "; ".join(errors)
        return result
    
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
        job_id: str = None,
        host_id_map: Dict[str, str] = None
    ) -> Dict[str, int]:
        """Batch upsert VMs."""
        # DEBUG: Log incoming VM count for diagnosis
        self.log(f"  _upsert_vms_batch: Received {len(vms)} VMs for vCenter {source_vcenter_id}")
        
        if not vms:
            self.log(f"  _upsert_vms_batch: No VMs to upsert!", "WARN")
            return {"synced": 0, "total": 0}
        
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal'
        }
        
        # Use provided host_id_map or fetch if not provided
        if host_id_map is not None:
            host_lookup = host_id_map
        else:
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
                    # Phase 9: New fields
                    'resource_pool': v.get('resource_pool', ''),
                    'hardware_version': v.get('hardware_version', ''),
                    'folder_path': v.get('folder_path', ''),
                    'snapshot_count': v.get('snapshot_count', 0),
                    'last_sync': utc_now_iso()
                })
            
            errors = []
            try:
                response = requests.post(
                    f"{DSM_URL}/rest/v1/vcenter_vms?on_conflict=vcenter_id,source_vcenter_id",
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
    
    def _upsert_datastore_vms_batch(
        self,
        vms: List[Dict],
        source_vcenter_id: str,
        job_id: str = None
    ) -> Dict[str, int]:
        """
        Batch upsert datastore-VM relationships from VM datastore usage.
        
        This enables:
        - Tracking which VMs are stored on which datastores
        - Safe decommissioning of ZFS targets (knows which VMs would be affected)
        - Proactive discovery of unprotected VMs on replication datastores
        """
        if not vms:
            return {"synced": 0, "total": 0}
        
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal'
        }
        
        # Fetch datastore lookup (vcenter_id -> id mapping)
        try:
            datastores_response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_datastores?source_vcenter_id=eq.{source_vcenter_id}&select=id,vcenter_id",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=30
            )
            datastore_lookup = {}
            if datastores_response.status_code == 200:
                from job_executor.utils import _safe_json_parse
                datastores_list = _safe_json_parse(datastores_response) or []
                datastore_lookup = {d['vcenter_id']: d['id'] for d in datastores_list if d.get('vcenter_id')}
        except Exception as e:
            self.log(f"  Failed to fetch datastore mappings: {e}", "ERROR")
            return {"synced": 0, "total": 0, "error": str(e)}
        
        # Fetch VM lookup (vcenter_id -> id mapping)
        try:
            vms_response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_vms?source_vcenter_id=eq.{source_vcenter_id}&select=id,vcenter_id",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=30
            )
            vm_lookup = {}
            if vms_response.status_code == 200:
                from job_executor.utils import _safe_json_parse
                vms_list = _safe_json_parse(vms_response) or []
                vm_lookup = {v['vcenter_id']: v['id'] for v in vms_list if v.get('vcenter_id')}
        except Exception as e:
            self.log(f"  Failed to fetch VM mappings: {e}", "ERROR")
            return {"synced": 0, "total": 0, "error": str(e)}
        
        # Build relationship records from VM datastore_usage
        relationships = []
        for v in vms:
            vm_vcenter_id = v.get('id', '')
            vm_id = vm_lookup.get(vm_vcenter_id)
            if not vm_id:
                continue
            
            datastore_usage = v.get('datastore_usage', [])
            for ds_usage in datastore_usage:
                ds_moref = ds_usage.get('datastore_moref')
                datastore_id = datastore_lookup.get(ds_moref)
                
                if not datastore_id:
                    continue  # Can't resolve datastore
                
                relationships.append({
                    'datastore_id': datastore_id,
                    'vm_id': vm_id,
                    'source_vcenter_id': source_vcenter_id,
                    'committed_bytes': ds_usage.get('committed_bytes', 0),
                    'uncommitted_bytes': ds_usage.get('uncommitted_bytes', 0),
                    'is_primary_datastore': ds_usage.get('is_primary', False),
                    'last_sync': utc_now_iso()
                })
        
        if not relationships:
            self.log(f"  No datastore-VM relationships found")
            return {"synced": 0, "total": 0}
        
        # Clear old relationships for this vCenter before inserting new ones
        try:
            requests.delete(
                f"{DSM_URL}/rest/v1/vcenter_datastore_vms?source_vcenter_id=eq.{source_vcenter_id}",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=30
            )
        except Exception as e:
            self.log(f"  Failed to clear old datastore-VM relationships: {e}", "WARN")
        
        # Batch upsert relationships
        synced = 0
        batch_size = 100
        errors = []
        
        for i in range(0, len(relationships), batch_size):
            batch = relationships[i:i+batch_size]
            
            try:
                response = requests.post(
                    f"{DSM_URL}/rest/v1/vcenter_datastore_vms?on_conflict=datastore_id,vm_id",
                    headers=headers,
                    json=batch,
                    verify=VERIFY_SSL,
                    timeout=30
                )
                
                if response.status_code in [200, 201, 204]:
                    synced += len(batch)
                else:
                    error_msg = f"Batch {i//batch_size + 1}: HTTP {response.status_code}: {response.text[:200]}"
                    self.log(f"  Datastore-VM batch upsert failed: {error_msg}", "WARN")
                    errors.append(error_msg)
                    
            except Exception as e:
                error_msg = f"Batch {i//batch_size + 1}: {str(e)}"
                self.log(f"  Datastore-VM batch upsert error: {e}", "ERROR")
                errors.append(error_msg)
        
        self.log(f"  ✓ Batch upserted {synced}/{len(relationships)} datastore-VM relationships")
        result = {"synced": synced, "total": len(relationships)}
        if errors:
            result["error"] = "; ".join(errors)
        return result
    
    def detect_datastore_changes(
        self,
        source_vcenter_id: str,
        synced_datastores: List[Dict]
    ) -> Dict[str, Any]:
        """
        Detect datastores that have disappeared since last sync.
        
        Returns:
            {
                "disappeared": [...],  # All datastores that vanished
                "critical": [...],     # Replication-linked datastores that vanished
                "reappeared": [...]    # Previously missing datastores that are back
            }
        """
        if not synced_datastores:
            return {"disappeared": [], "critical": [], "reappeared": []}
        
        # Get list of MoRefs we just synced
        synced_morefs = set(d.get('id', '') for d in synced_datastores if d.get('id'))
        synced_names = set(d.get('name', '') for d in synced_datastores if d.get('name'))
        
        try:
            # Fetch all existing datastores for this vCenter from DB
            response = requests.get(
                f"{DSM_URL}/rest/v1/vcenter_datastores",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                params={
                    'source_vcenter_id': f'eq.{source_vcenter_id}',
                    'select': 'id,name,vcenter_id,replication_target_id,accessible,host_count'
                },
                verify=VERIFY_SSL,
                timeout=30
            )
            
            if response.status_code != 200:
                self.log(f"  Warning: Could not fetch existing datastores for change detection: {response.status_code}", "WARN")
                return {"disappeared": [], "critical": [], "reappeared": []}
            
            db_datastores = response.json()
            
            disappeared = []
            critical = []
            
            for ds in db_datastores:
                ds_moref = ds.get('vcenter_id', '')
                ds_name = ds.get('name', '')
                
                # Check if this datastore is no longer in vCenter
                # Match by MoRef primarily, fall back to name
                if ds_moref not in synced_morefs and ds_name not in synced_names:
                    disappeared.append({
                        'id': ds.get('id'),
                        'name': ds_name,
                        'vcenter_id': ds_moref,
                        'replication_target_id': ds.get('replication_target_id'),
                        'was_accessible': ds.get('accessible', False),
                        'host_count': ds.get('host_count', 0)
                    })
                    
                    # Check if it's linked to a replication target - CRITICAL
                    if ds.get('replication_target_id'):
                        critical.append({
                            'id': ds.get('id'),
                            'name': ds_name,
                            'vcenter_id': ds_moref,
                            'replication_target_id': ds.get('replication_target_id'),
                            'severity': 'critical',
                            'reason': 'replication_linked_datastore_missing'
                        })
            
            if disappeared:
                self.log(f"  ⚠️ Detected {len(disappeared)} disappeared datastores, {len(critical)} critical", "WARN")
            
            return {
                "disappeared": disappeared,
                "critical": critical,
                "reappeared": []  # Future: track datastores that come back
            }
            
        except Exception as e:
            self.log(f"  Warning: Datastore change detection failed: {e}", "WARN")
            return {"disappeared": [], "critical": [], "reappeared": []}
    
    def _upsert_vm_snapshots_batch(
        self,
        vms: List[Dict],
        source_vcenter_id: str,
        job_id: str = None
    ) -> Dict[str, int]:
        """Batch upsert VM snapshots from all VMs."""
        if not vms:
            return {"synced": 0, "total": 0}
        
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal'
        }
        
        # Fetch VM lookup (vcenter_id -> db id mapping)
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
        
        # Collect all snapshots from all VMs
        all_snapshots = []
        for vm in vms:
            vm_vcenter_id = vm.get('id', '')
            vm_db_id = vm_lookup.get(vm_vcenter_id)
            if not vm_db_id:
                continue
            
            for snap in vm.get('snapshots', []):
                all_snapshots.append({
                    'vm_id': vm_db_id,
                    'snapshot_id': snap.get('snapshot_id', ''),
                    'name': snap.get('name', ''),
                    'description': snap.get('description', ''),
                    'created_at': snap.get('created_at'),
                    'size_bytes': snap.get('size_bytes', 0),
                    'is_current': snap.get('is_current', False),
                    'parent_snapshot_id': snap.get('parent_snapshot_id'),
                    'source_vcenter_id': source_vcenter_id,
                    'last_sync': utc_now_iso()
                })
        
        if not all_snapshots:
            return {"synced": 0, "total": 0}
        
        # Delete existing snapshots for this vCenter (full refresh)
        try:
            requests.delete(
                f"{DSM_URL}/rest/v1/vcenter_vm_snapshots?source_vcenter_id=eq.{source_vcenter_id}",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=30
            )
        except Exception as e:
            self.log(f"  Warning: Could not delete old snapshots: {e}", "WARN")
        
        # Insert new snapshots in batches
        synced = 0
        batch_size = 100
        
        for i in range(0, len(all_snapshots), batch_size):
            batch = all_snapshots[i:i+batch_size]
            try:
                response = requests.post(
                    f"{DSM_URL}/rest/v1/vcenter_vm_snapshots",
                    headers=headers,
                    json=batch,
                    verify=VERIFY_SSL,
                    timeout=30
                )
                
                if response.status_code in [200, 201, 204]:
                    synced += len(batch)
                else:
                    self.log(f"  Snapshot batch insert failed: HTTP {response.status_code}", "WARN")
                    
            except Exception as e:
                self.log(f"  Snapshot batch insert error: {e}", "ERROR")
        
        self.log(f"  ✓ Synced {synced} VM snapshots")
        return {"synced": synced, "total": len(all_snapshots)}
    
    def _upsert_vm_custom_attributes_batch(
        self,
        vms: List[Dict],
        source_vcenter_id: str,
        job_id: str = None
    ) -> Dict[str, int]:
        """Batch upsert VM custom attributes from all VMs."""
        if not vms:
            return {"synced": 0, "total": 0}
        
        headers = {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal'
        }
        
        # Fetch VM lookup (vcenter_id -> db id mapping)
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
        
        # Collect all custom attributes from all VMs
        all_attrs = []
        for vm in vms:
            vm_vcenter_id = vm.get('id', '')
            vm_db_id = vm_lookup.get(vm_vcenter_id)
            if not vm_db_id:
                continue
            
            for attr in vm.get('custom_attributes', []):
                all_attrs.append({
                    'vm_id': vm_db_id,
                    'attribute_key': attr.get('attribute_key', ''),
                    'attribute_value': attr.get('attribute_value', ''),
                    'source_vcenter_id': source_vcenter_id,
                    'last_sync': utc_now_iso()
                })
        
        if not all_attrs:
            return {"synced": 0, "total": 0}
        
        # Delete existing custom attributes for this vCenter (full refresh)
        try:
            requests.delete(
                f"{DSM_URL}/rest/v1/vcenter_vm_custom_attributes?source_vcenter_id=eq.{source_vcenter_id}",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL,
                timeout=30
            )
        except Exception as e:
            self.log(f"  Warning: Could not delete old custom attributes: {e}", "WARN")
        
        # Insert new attributes in batches
        synced = 0
        batch_size = 100
        
        for i in range(0, len(all_attrs), batch_size):
            batch = all_attrs[i:i+batch_size]
            try:
                response = requests.post(
                    f"{DSM_URL}/rest/v1/vcenter_vm_custom_attributes",
                    headers=headers,
                    json=batch,
                    verify=VERIFY_SSL,
                    timeout=30
                )
                
                if response.status_code in [200, 201, 204]:
                    synced += len(batch)
                else:
                    self.log(f"  Custom attrs batch insert failed: HTTP {response.status_code}", "WARN")
                    
            except Exception as e:
                self.log(f"  Custom attrs batch insert error: {e}", "ERROR")
        
        self.log(f"  ✓ Synced {synced} VM custom attributes")
        return {"synced": synced, "total": len(all_attrs)}
