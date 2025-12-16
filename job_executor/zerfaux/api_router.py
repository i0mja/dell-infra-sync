"""
Zerfaux API Router

HTTP API endpoints for /api/replication/* routes.
Handles all CRUD operations for replication entities and wizard endpoints.

API Surface:
============
CRUD Endpoints:
- GET/POST /api/replication/targets           - List/Create replication targets
- GET/PUT/DELETE /api/replication/targets/{id} - Get/Update/Delete target
- GET/POST /api/replication/protection-groups - List/Create protection groups
- GET/PUT/DELETE /api/replication/protection-groups/{id}
- GET/POST /api/replication/protection-groups/{id}/protected-vms
- DELETE /api/replication/protected-vms/{id}
- GET /api/replication/jobs                   - List replication jobs
- POST /api/replication/protection-groups/{id}/run-now - Trigger replication

vCenter Sync:
- GET /api/replication/vcenters               - List available vCenters
- POST /api/replication/vcenters/{id}/sync    - Sync VM inventory
- GET /api/replication/vcenters/{id}/vms      - Get synced VMs

Wizard Endpoints:
- GET /api/replication/protected-vms/{id}/protection-plan
- POST /api/replication/protected-vms/{id}/move-to-protection-datastore
- GET /api/replication/protected-vms/{id}/dr-shell-plan
- POST /api/replication/protected-vms/{id}/create-dr-shell

Configuration:
- Set ZERFAUX_USE_STUBS=false to enable real vCenter/ZFS operations
- Default is stub mode for offline testing
"""

import json
import re
import traceback
from datetime import datetime
from typing import Dict, Optional, Tuple
import logging

# Import based on configuration toggle
from . import USE_ZERFAUX_STUBS, VCenterInventory, ZFSReplication

logger = logging.getLogger(__name__)
logger.info(f"Zerfaux API Router initialized with USE_ZERFAUX_STUBS={USE_ZERFAUX_STUBS}")


class ZerfauxAPIRouter:
    """
    Router for Zerfaux replication API endpoints.
    
    Integrates with the main API server to handle /api/replication/* routes.
    """
    
    def __init__(self, executor):
        """
        Initialize the router.
        
        Args:
            executor: JobExecutor instance for database access
        """
        self.executor = executor
        # Use configured implementation (stub or real based on USE_ZERFAUX_STUBS)
        self.vcenter_inventory = VCenterInventory(executor)
        self.zfs_replication = ZFSReplication(executor)
        logger.info(f"Zerfaux router using {'stub' if USE_ZERFAUX_STUBS else 'real'} implementations")
    
    def can_handle(self, path: str) -> bool:
        """Check if this router can handle the given path"""
        return path.startswith('/api/replication') or path.startswith('/api/zerfaux')
    
    def route_get(self, path: str, handler) -> bool:
        """
        Route GET requests.
        
        Args:
            path: Request path
            handler: HTTP request handler
            
        Returns:
            True if request was handled
        """
        try:
            # List replication targets
            if path == '/api/replication/targets':
                return self._list_targets(handler)
            
            # Get single target
            match = re.match(r'/api/replication/targets/([a-f0-9-]+)$', path)
            if match:
                return self._get_target(handler, match.group(1))
            
            # List protection groups
            if path == '/api/replication/protection-groups':
                return self._list_protection_groups(handler)
            
            # Get single protection group
            match = re.match(r'/api/replication/protection-groups/([a-f0-9-]+)$', path)
            if match:
                return self._get_protection_group(handler, match.group(1))
            
            # List protected VMs for a group
            match = re.match(r'/api/replication/protection-groups/([a-f0-9-]+)/protected-vms$', path)
            if match:
                return self._list_protected_vms(handler, match.group(1))
            
            # List replication jobs
            if path == '/api/replication/jobs':
                return self._list_replication_jobs(handler)
            
            # List vCenters
            if path == '/api/replication/vcenters':
                return self._list_vcenters(handler)
            
            # Get vCenter VMs
            match = re.match(r'/api/replication/vcenters/([a-f0-9-]+)/vms$', path)
            if match:
                return self._list_vcenter_vms(handler, match.group(1))
            
            # Protection plan wizard
            match = re.match(r'/api/replication/protected-vms/([a-f0-9-]+)/protection-plan$', path)
            if match:
                return self._get_protection_plan(handler, match.group(1))
            
            # DR shell plan wizard
            match = re.match(r'/api/replication/protected-vms/([a-f0-9-]+)/dr-shell-plan$', path)
            if match:
                return self._get_dr_shell_plan(handler, match.group(1))
            
            return False
            
        except Exception as e:
            logger.error(f"Zerfaux GET error: {e}")
            logger.error(traceback.format_exc())
            handler._send_error(str(e), 500)
            return True
    
    def route_post(self, path: str, handler) -> bool:
        """
        Route POST requests.
        
        Args:
            path: Request path
            handler: HTTP request handler
            
        Returns:
            True if request was handled
        """
        try:
            data = handler._read_json_body()
            
            # Create replication target
            if path == '/api/replication/targets':
                return self._create_target(handler, data)
            
            # Create protection group
            if path == '/api/replication/protection-groups':
                return self._create_protection_group(handler, data)
            
            # Add protected VM to group
            match = re.match(r'/api/replication/protection-groups/([a-f0-9-]+)/protected-vms$', path)
            if match:
                return self._add_protected_vm(handler, match.group(1), data)
            
            # Run replication now
            match = re.match(r'/api/replication/protection-groups/([a-f0-9-]+)/run-now$', path)
            if match:
                return self._run_replication_now(handler, match.group(1))
            
            # Sync vCenter
            match = re.match(r'/api/replication/vcenters/([a-f0-9-]+)/sync$', path)
            if match:
                return self._sync_vcenter(handler, match.group(1))
            
            # Move VM to protection datastore
            match = re.match(r'/api/replication/protected-vms/([a-f0-9-]+)/move-to-protection-datastore$', path)
            if match:
                return self._move_to_protection_datastore(handler, match.group(1), data)
            
            # Create DR shell VM
            match = re.match(r'/api/replication/protected-vms/([a-f0-9-]+)/create-dr-shell$', path)
            if match:
                return self._create_dr_shell(handler, match.group(1), data)
            
            # Batch storage vMotion for multiple VMs
            if path == '/api/zerfaux/batch-storage-vmotion':
                return self._batch_storage_vmotion(handler, data)
            
            return False
            
        except Exception as e:
            logger.error(f"Zerfaux POST error: {e}")
            logger.error(traceback.format_exc())
            handler._send_error(str(e), 500)
            return True
    
    def route_put(self, path: str, handler) -> bool:
        """Route PUT requests"""
        try:
            data = handler._read_json_body()
            
            # Update target
            match = re.match(r'/api/replication/targets/([a-f0-9-]+)$', path)
            if match:
                return self._update_target(handler, match.group(1), data)
            
            # Update protection group
            match = re.match(r'/api/replication/protection-groups/([a-f0-9-]+)$', path)
            if match:
                return self._update_protection_group(handler, match.group(1), data)
            
            return False
            
        except Exception as e:
            logger.error(f"Zerfaux PUT error: {e}")
            handler._send_error(str(e), 500)
            return True
    
    def route_delete(self, path: str, handler) -> bool:
        """Route DELETE requests"""
        try:
            # Delete target
            match = re.match(r'/api/replication/targets/([a-f0-9-]+)$', path)
            if match:
                return self._delete_target(handler, match.group(1))
            
            # Delete protection group
            match = re.match(r'/api/replication/protection-groups/([a-f0-9-]+)$', path)
            if match:
                return self._delete_protection_group(handler, match.group(1))
            
            # Delete protected VM
            match = re.match(r'/api/replication/protected-vms/([a-f0-9-]+)$', path)
            if match:
                return self._delete_protected_vm(handler, match.group(1))
            
            return False
            
        except Exception as e:
            logger.error(f"Zerfaux DELETE error: {e}")
            handler._send_error(str(e), 500)
            return True
    
    # ==========================================
    # Database Helpers
    # ==========================================
    
    def _db_query(self, table: str, params: Dict = None) -> list:
        """Query database table"""
        import requests
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        
        headers = {
            "apikey": SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}"
        }
        
        response = requests.get(
            f"{DSM_URL}/rest/v1/{table}",
            params=params or {},
            headers=headers,
            verify=VERIFY_SSL,
            timeout=30
        )
        
        if response.ok:
            return response.json()
        return []
    
    def _db_insert(self, table: str, data: Dict) -> Optional[Dict]:
        """Insert into database table"""
        import requests
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        
        headers = {
            "apikey": SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }
        
        response = requests.post(
            f"{DSM_URL}/rest/v1/{table}",
            json=data,
            headers=headers,
            verify=VERIFY_SSL,
            timeout=30
        )
        
        if response.ok:
            result = response.json()
            return result[0] if result else None
        
        logger.error(f"DB insert failed: {response.status_code} - {response.text}")
        return None
    
    def _db_update(self, table: str, id: str, data: Dict) -> bool:
        """Update database record"""
        import requests
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        
        headers = {
            "apikey": SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            "Content-Type": "application/json"
        }
        
        response = requests.patch(
            f"{DSM_URL}/rest/v1/{table}",
            params={'id': f"eq.{id}"},
            json=data,
            headers=headers,
            verify=VERIFY_SSL,
            timeout=30
        )
        
        return response.ok
    
    def _db_delete(self, table: str, id: str) -> bool:
        """Delete database record"""
        import requests
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        
        headers = {
            "apikey": SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}"
        }
        
        response = requests.delete(
            f"{DSM_URL}/rest/v1/{table}",
            params={'id': f"eq.{id}"},
            headers=headers,
            verify=VERIFY_SSL,
            timeout=30
        )
        
        return response.ok
    
    # ==========================================
    # Replication Targets CRUD
    # ==========================================
    
    def _list_targets(self, handler) -> bool:
        """List all replication targets"""
        targets = self._db_query('replication_targets', {'order': 'name'})
        handler._send_json({'success': True, 'targets': targets})
        return True
    
    def _get_target(self, handler, target_id: str) -> bool:
        """Get single replication target"""
        targets = self._db_query('replication_targets', {'id': f'eq.{target_id}'})
        if not targets:
            handler._send_error('Target not found', 404)
            return True
        
        # Check target health - pass target_id for auto credential lookup
        target = targets[0]
        health = self.zfs_replication.check_target_health(
            target['hostname'], 
            target['zfs_pool'],
            target_id=target_id  # Auto-fetch SSH credentials
        )
        target['health_check'] = health
        
        handler._send_json({'success': True, 'target': target})
        return True
    
    def _create_target(self, handler, data: Dict) -> bool:
        """Create replication target"""
        required = ['name', 'hostname', 'zfs_pool']
        for field in required:
            if not data.get(field):
                handler._send_error(f'{field} is required', 400)
                return True
        
        target = self._db_insert('replication_targets', {
            'name': data['name'],
            'description': data.get('description'),
            'target_type': data.get('target_type', 'zfs'),
            'hostname': data['hostname'],
            'port': data.get('port', 22),
            'zfs_pool': data['zfs_pool'],
            'zfs_dataset_prefix': data.get('zfs_dataset_prefix'),
            'ssh_username': data.get('ssh_username'),
            'dr_vcenter_id': data.get('dr_vcenter_id'),
            'is_active': True
        })
        
        if not target:
            handler._send_error('Failed to create target', 500)
            return True
        
        handler._send_json({'success': True, 'target': target}, 201)
        return True
    
    def _update_target(self, handler, target_id: str, data: Dict) -> bool:
        """Update replication target"""
        data['updated_at'] = datetime.utcnow().isoformat()
        
        if not self._db_update('replication_targets', target_id, data):
            handler._send_error('Failed to update target', 500)
            return True
        
        handler._send_json({'success': True, 'message': 'Target updated'})
        return True
    
    def _delete_target(self, handler, target_id: str) -> bool:
        """Delete replication target"""
        if not self._db_delete('replication_targets', target_id):
            handler._send_error('Failed to delete target', 500)
            return True
        
        handler._send_json({'success': True, 'message': 'Target deleted'})
        return True
    
    # ==========================================
    # Protection Groups CRUD
    # ==========================================
    
    def _list_protection_groups(self, handler) -> bool:
        """List all protection groups"""
        groups = self._db_query('protection_groups', {'order': 'name'})
        
        # Add VM counts
        for group in groups:
            vms = self._db_query('protected_vms', {
                'protection_group_id': f"eq.{group['id']}",
                'select': 'id'
            })
            group['vm_count'] = len(vms)
        
        handler._send_json({'success': True, 'protection_groups': groups})
        return True
    
    def _get_protection_group(self, handler, group_id: str) -> bool:
        """Get single protection group"""
        groups = self._db_query('protection_groups', {'id': f'eq.{group_id}'})
        if not groups:
            handler._send_error('Protection group not found', 404)
            return True
        
        group = groups[0]
        
        # Get protected VMs
        group['protected_vms'] = self._db_query('protected_vms', {
            'protection_group_id': f"eq.{group_id}",
            'order': 'priority,vm_name'
        })
        
        handler._send_json({'success': True, 'protection_group': group})
        return True
    
    def _create_protection_group(self, handler, data: Dict) -> bool:
        """Create protection group"""
        if not data.get('name'):
            handler._send_error('name is required', 400)
            return True
        
        group = self._db_insert('protection_groups', {
            'name': data['name'],
            'description': data.get('description'),
            'source_vcenter_id': data.get('source_vcenter_id'),
            'target_id': data.get('target_id'),
            'protection_datastore': data.get('protection_datastore'),
            'replication_schedule': data.get('replication_schedule'),
            'retention_policy': data.get('retention_policy', {'daily': 7, 'weekly': 4, 'monthly': 12}),
            'rpo_minutes': data.get('rpo_minutes', 60),
            'is_enabled': data.get('is_enabled', True)
        })
        
        if not group:
            handler._send_error('Failed to create protection group', 500)
            return True
        
        handler._send_json({'success': True, 'protection_group': group}, 201)
        return True
    
    def _update_protection_group(self, handler, group_id: str, data: Dict) -> bool:
        """Update protection group"""
        data['updated_at'] = datetime.utcnow().isoformat()
        
        if not self._db_update('protection_groups', group_id, data):
            handler._send_error('Failed to update protection group', 500)
            return True
        
        handler._send_json({'success': True, 'message': 'Protection group updated'})
        return True
    
    def _delete_protection_group(self, handler, group_id: str) -> bool:
        """Delete protection group (cascades to protected_vms)"""
        if not self._db_delete('protection_groups', group_id):
            handler._send_error('Failed to delete protection group', 500)
            return True
        
        handler._send_json({'success': True, 'message': 'Protection group deleted'})
        return True
    
    # ==========================================
    # Protected VMs
    # ==========================================
    
    def _list_protected_vms(self, handler, group_id: str) -> bool:
        """List protected VMs in a group"""
        vms = self._db_query('protected_vms', {
            'protection_group_id': f"eq.{group_id}",
            'order': 'priority,vm_name'
        })
        
        handler._send_json({'success': True, 'protected_vms': vms})
        return True
    
    def _add_protected_vm(self, handler, group_id: str, data: Dict) -> bool:
        """Add VM to protection group"""
        if not data.get('vm_name'):
            handler._send_error('vm_name is required', 400)
            return True
        
        # Get protection group to check target datastore
        groups = self._db_query('protection_groups', {'id': f'eq.{group_id}'})
        if not groups:
            handler._send_error('Protection group not found', 404)
            return True
        
        group = groups[0]
        protection_ds = group.get('protection_datastore')
        current_ds = data.get('current_datastore')
        
        # Check if storage vMotion is needed
        needs_vmotion = False
        if protection_ds and current_ds and protection_ds != current_ds:
            needs_vmotion = True
        
        protected_vm = self._db_insert('protected_vms', {
            'protection_group_id': group_id,
            'vm_id': data.get('vm_id'),
            'vm_name': data['vm_name'],
            'vm_vcenter_id': data.get('vm_vcenter_id'),
            'current_datastore': current_ds,
            'target_datastore': protection_ds,
            'needs_storage_vmotion': needs_vmotion,
            'priority': data.get('priority', 100),
            'replication_status': 'pending'
        })
        
        if not protected_vm:
            handler._send_error('Failed to add protected VM', 500)
            return True
        
        handler._send_json({'success': True, 'protected_vm': protected_vm}, 201)
        return True
    
    def _delete_protected_vm(self, handler, vm_id: str) -> bool:
        """Remove VM from protection"""
        if not self._db_delete('protected_vms', vm_id):
            handler._send_error('Failed to remove protected VM', 500)
            return True
        
        handler._send_json({'success': True, 'message': 'VM removed from protection'})
        return True
    
    # ==========================================
    # Replication Jobs
    # ==========================================
    
    def _list_replication_jobs(self, handler) -> bool:
        """List replication jobs"""
        jobs = self._db_query('replication_jobs', {
            'order': 'created_at.desc',
            'limit': '100'
        })
        
        handler._send_json({'success': True, 'jobs': jobs})
        return True
    
    def _run_replication_now(self, handler, group_id: str) -> bool:
        """Trigger immediate replication for a protection group"""
        # Get protection group
        groups = self._db_query('protection_groups', {'id': f'eq.{group_id}'})
        if not groups:
            handler._send_error('Protection group not found', 404)
            return True
        
        group = groups[0]
        
        # Get protected VMs
        protected_vms = self._db_query('protected_vms', {
            'protection_group_id': f"eq.{group_id}",
            'replication_status': 'eq.active'
        })
        
        # Create replication jobs for each VM
        jobs_created = []
        for vm in protected_vms:
            # Use stub replication
            result = self.zfs_replication.replicate_dataset(
                source_dataset=f"vmfs/{vm['vm_name']}",
                source_snapshot=self.zfs_replication._generate_snapshot_name(),
                target_host=group.get('target_id', 'dr-target'),
                target_dataset=f"dr-pool/{vm['vm_name']}",
                incremental_from=None  # Would be last snapshot in real impl
            )
            
            # Record job
            job = self._db_insert('replication_jobs', {
                'protection_group_id': group_id,
                'protected_vm_id': vm['id'],
                'job_type': 'manual',
                'status': 'completed' if result['success'] else 'failed',
                'started_at': result.get('started_at'),
                'completed_at': result.get('completed_at'),
                'bytes_transferred': result.get('bytes_transferred', 0),
                'source_snapshot': result.get('source_snapshot'),
                'details': result
            })
            
            if job:
                jobs_created.append(job)
            
            # Update protected VM status
            self._db_update('protected_vms', vm['id'], {
                'last_replication_at': datetime.utcnow().isoformat(),
                'replication_status': 'active' if result['success'] else 'error',
                'status_message': result.get('message')
            })
        
        # Update protection group
        self._db_update('protection_groups', group_id, {
            'last_replication_at': datetime.utcnow().isoformat()
        })
        
        handler._send_json({
            'success': True,
            'message': f'Replication triggered for {len(jobs_created)} VMs',
            'jobs': jobs_created
        })
        return True
    
    # ==========================================
    # vCenter Integration
    # ==========================================
    
    def _list_vcenters(self, handler) -> bool:
        """List available vCenters from existing vcenter_settings"""
        vcenters = self._db_query('vcenter_settings', {'order': 'host'})
        handler._send_json({'success': True, 'vcenters': vcenters})
        return True
    
    def _list_vcenter_vms(self, handler, vcenter_id: str) -> bool:
        """List VMs from vCenter (uses existing vcenter_vms table)"""
        vms = self._db_query('vcenter_vms', {
            'source_vcenter_id': f'eq.{vcenter_id}',
            'order': 'name'
        })
        handler._send_json({'success': True, 'vms': vms})
        return True
    
    def _sync_vcenter(self, handler, vcenter_id: str) -> bool:
        """Sync VM inventory from vCenter"""
        # Get vCenter settings
        vcenters = self._db_query('vcenter_settings', {'id': f'eq.{vcenter_id}'})
        if not vcenters:
            handler._send_error('vCenter not found', 404)
            return True
        
        vcenter = vcenters[0]
        
        # Use stub to sync
        result = self.vcenter_inventory.sync_inventory(
            vcenter_id=vcenter_id,
            vcenter_host=vcenter['host'],
            username=vcenter.get('username'),
            password=vcenter.get('password')
        )
        
        # In real implementation, would upsert to vcenter_vms table
        # For stub, just return the result
        
        handler._send_json({
            'success': result['success'],
            'vms_found': result.get('vms_found', 0),
            'synced_at': result.get('synced_at'),
            'message': result.get('message')
        })
        return True
    
    # ==========================================
    # Wizard Endpoints
    # ==========================================
    
    def _get_protection_plan(self, handler, protected_vm_id: str) -> bool:
        """
        Get protection plan for a VM.
        
        Returns analysis of what's needed to protect the VM:
        - Current datastore vs required datastore
        - Whether Storage vMotion is needed
        - Estimated data size
        """
        vms = self._db_query('protected_vms', {'id': f'eq.{protected_vm_id}'})
        if not vms:
            handler._send_error('Protected VM not found', 404)
            return True
        
        vm = vms[0]
        
        # Get protection group
        groups = self._db_query('protection_groups', {'id': f"eq.{vm['protection_group_id']}"})
        group = groups[0] if groups else {}
        
        plan = {
            'protected_vm_id': protected_vm_id,
            'vm_name': vm['vm_name'],
            'current_datastore': vm.get('current_datastore'),
            'required_datastore': group.get('protection_datastore'),
            'needs_storage_vmotion': vm.get('needs_storage_vmotion', False),
            'can_proceed': not vm.get('needs_storage_vmotion', False),
            'estimated_size_gb': 150,  # Stub value
            'steps': []
        }
        
        if vm.get('needs_storage_vmotion'):
            plan['steps'].append({
                'step': 1,
                'action': 'storage_vmotion',
                'description': f"Move VM to {group.get('protection_datastore')}",
                'required': True,
                'estimated_time_minutes': 30
            })
        
        plan['steps'].append({
            'step': len(plan['steps']) + 1,
            'action': 'initial_sync',
            'description': 'Perform initial replication sync',
            'required': True,
            'estimated_time_minutes': 60
        })
        
        handler._send_json({'success': True, 'plan': plan})
        return True
    
    def _move_to_protection_datastore(self, handler, protected_vm_id: str, data: Dict) -> bool:
        """
        Move VM to protection datastore via Storage vMotion.
        
        STUB: Simulates the relocation.
        """
        vms = self._db_query('protected_vms', {'id': f'eq.{protected_vm_id}'})
        if not vms:
            handler._send_error('Protected VM not found', 404)
            return True
        
        vm = vms[0]
        
        # Get protection group
        groups = self._db_query('protection_groups', {'id': f"eq.{vm['protection_group_id']}"})
        group = groups[0] if groups else {}
        
        target_datastore = data.get('target_datastore') or group.get('protection_datastore')
        
        if not target_datastore:
            handler._send_error('No target datastore specified', 400)
            return True
        
        # Use stub/real implementation to relocate
        result = self.vcenter_inventory.relocate_vm(
            vcenter_id=group.get('source_vcenter_id', ''),
            vm_moref=vm.get('vm_vcenter_id', ''),
            target_datastore=target_datastore,
            progress_callback=None  # No job context in direct API call
        )
        
        if result['success']:
            # Update protected VM
            self._db_update('protected_vms', protected_vm_id, {
                'current_datastore': target_datastore,
                'needs_storage_vmotion': False,
                'replication_status': 'active',
                'status_message': f'Relocated to {target_datastore}'
            })
        
        handler._send_json({
            'success': result['success'],
            'message': result.get('message'),
            'completed_at': result.get('completed_at')
        })
        return True
    
    def _get_dr_shell_plan(self, handler, protected_vm_id: str) -> bool:
        """
        Get DR shell VM creation plan.
        
        Returns what's needed to create a shell VM at DR site.
        """
        vms = self._db_query('protected_vms', {'id': f'eq.{protected_vm_id}'})
        if not vms:
            handler._send_error('Protected VM not found', 404)
            return True
        
        vm = vms[0]
        
        # Get protection group and target
        groups = self._db_query('protection_groups', {'id': f"eq.{vm['protection_group_id']}"})
        group = groups[0] if groups else {}
        
        targets = self._db_query('replication_targets', {'id': f"eq.{group.get('target_id')}"}) if group.get('target_id') else []
        target = targets[0] if targets else {}
        
        plan = {
            'protected_vm_id': protected_vm_id,
            'vm_name': vm['vm_name'],
            'suggested_dr_name': f"{vm['vm_name']}-DR",
            'dr_vcenter_id': target.get('dr_vcenter_id'),
            'target_datastore': target.get('zfs_pool'),
            'shell_vm_exists': vm.get('dr_shell_vm_created', False),
            'existing_shell_vm_name': vm.get('dr_shell_vm_name'),
            'replicated_disks': [
                {'path': f"[{target.get('zfs_pool', 'dr-pool')}] {vm['vm_name']}/{vm['vm_name']}.vmdk", 'size_gb': 100},
                {'path': f"[{target.get('zfs_pool', 'dr-pool')}] {vm['vm_name']}/{vm['vm_name']}_1.vmdk", 'size_gb': 200}
            ],
            'recommended_config': {
                'cpu_count': 4,
                'memory_mb': 8192
            }
        }
        
        handler._send_json({'success': True, 'plan': plan})
        return True
    
    def _discover_replicated_vmdks(self, dr_vcenter_id: str, datastore_name: str, 
                                     source_vm_name: str) -> list:
        """
        Browse DR datastore to find replicated VMDKs matching source VM name.
        
        Searches for patterns like:
        - [ds] source_vm_name/source_vm_name.vmdk
        - [ds] source_vm_name/*.vmdk
        
        Args:
            dr_vcenter_id: ID of the DR vCenter
            datastore_name: Name of the target datastore
            source_vm_name: Name of the source VM to search for
            
        Returns:
            List of full VMDK paths like '[datastore] vm_name/vm_name.vmdk'
        """
        try:
            # Check if we're in stub mode - just return empty in stub mode
            if USE_ZERFAUX_STUBS:
                logger.info(f"Stub mode: skipping VMDK discovery for {source_vm_name}")
                return []
            
            # Import pyVmomi here to avoid import errors in stub mode
            try:
                from pyVmomi import vim
                from pyVim.task import WaitForTask
                from pyVim.connect import Disconnect
            except ImportError:
                logger.warning("pyVmomi not available, cannot discover VMDKs")
                return []
            
            # Get vCenter connection settings
            settings = self.zfs_replication._get_vcenter_settings(dr_vcenter_id)
            if not settings:
                logger.warning(f"Could not get vCenter settings for {dr_vcenter_id}")
                return []
            
            password = self.zfs_replication._decrypt_password(settings.get('password_encrypted'))
            if not password:
                logger.warning("Could not decrypt vCenter password")
                return []
            
            si = self.zfs_replication._connect_vcenter(
                settings['host'],
                settings['username'],
                password,
                settings.get('port', 443),
                settings.get('verify_ssl', False)
            )
            
            if not si:
                logger.warning("Could not connect to vCenter for VMDK discovery")
                return []
            
            try:
                content = si.RetrieveContent()
                
                # Find the datastore
                ds_view = content.viewManager.CreateContainerView(
                    content.rootFolder, [vim.Datastore], True
                )
                
                target_ds = None
                for ds in ds_view.view:
                    if ds.name == datastore_name:
                        target_ds = ds
                        break
                ds_view.Destroy()
                
                if not target_ds:
                    logger.warning(f"Datastore {datastore_name} not found")
                    return []
                
                # Search for VMDKs matching source VM name
                browser = target_ds.browser
                search_spec = vim.host.DatastoreBrowser.SearchSpec()
                search_spec.matchPattern = ["*.vmdk"]
                
                # Search in folder matching source VM name
                datastore_path = f"[{datastore_name}] {source_vm_name}"
                
                try:
                    task = browser.SearchDatastoreSubFolders_Task(datastore_path, search_spec)
                    WaitForTask(task)
                    
                    disk_paths = []
                    for result in task.info.result:
                        folder_path = result.folderPath
                        for file_info in result.file:
                            # Skip -flat.vmdk files (they're data files, not descriptors)
                            if '-flat.vmdk' in file_info.path:
                                continue
                            # Skip -delta.vmdk files (snapshot deltas)
                            if '-delta.vmdk' in file_info.path:
                                continue
                            # Skip -ctk.vmdk files (change tracking)
                            if '-ctk.vmdk' in file_info.path:
                                continue
                            
                            # Build full path
                            full_path = f"{folder_path}{file_info.path}"
                            disk_paths.append(full_path)
                            logger.info(f"Discovered replicated VMDK: {full_path}")
                    
                    return disk_paths
                    
                except Exception as e:
                    logger.warning(f"Could not browse for VMDKs in {datastore_path}: {e}")
                    return []
            finally:
                Disconnect(si)
                
        except Exception as e:
            logger.error(f"VMDK discovery failed: {e}")
            return []
    
    def _create_dr_shell(self, handler, protected_vm_id: str, data: Dict) -> bool:
        """
        Create DR shell VM at DR site.
        
        Auto-discovers replicated VMDKs if disk_paths not provided.
        """
        vms = self._db_query('protected_vms', {'id': f'eq.{protected_vm_id}'})
        if not vms:
            handler._send_error('Protected VM not found', 404)
            return True
        
        vm = vms[0]
        
        shell_vm_name = data.get('shell_vm_name', f"{vm['vm_name']}-DR")
        
        # Get protection group and target
        groups = self._db_query('protection_groups', {'id': f"eq.{vm['protection_group_id']}"})
        group = groups[0] if groups else {}
        
        targets = self._db_query('replication_targets', {'id': f"eq.{group.get('target_id')}"}) if group.get('target_id') else []
        target = targets[0] if targets else {}
        
        # Prefer user-selected DR vCenter, fall back to target config
        dr_vcenter_id = data.get('dr_vcenter_id') or target.get('dr_vcenter_id', '')
        target_datastore = data.get('datastore_name') or target.get('zfs_pool', 'dr-pool')
        
        if not dr_vcenter_id:
            handler._send_error('No DR vCenter specified. Please select a DR vCenter in the wizard.', 400)
            return True
        
        # Get disk paths from request, or auto-discover
        disk_paths = data.get('disk_paths', [])
        
        # Auto-discover VMDKs if none provided
        if not disk_paths:
            source_vm_name = vm['vm_name']
            logger.info(f"No disk_paths provided, discovering replicated VMDKs for {source_vm_name} on {target_datastore}")
            disk_paths = self._discover_replicated_vmdks(
                dr_vcenter_id=dr_vcenter_id,
                datastore_name=target_datastore,
                source_vm_name=source_vm_name
            )
            logger.info(f"Discovered {len(disk_paths)} replicated VMDKs for {source_vm_name}")
        
        # Create the shell VM with discovered disks
        result = self.zfs_replication.create_dr_shell_vm(
            dr_vcenter_id=dr_vcenter_id,
            vm_name=shell_vm_name,
            target_datastore=target_datastore,
            cpu_count=data.get('cpu_count', 4),
            memory_mb=data.get('memory_mb', 8192),
            disk_paths=disk_paths
        )
        
        if result['success']:
            # Update protected VM
            self._db_update('protected_vms', protected_vm_id, {
                'dr_shell_vm_name': shell_vm_name,
                'dr_shell_vm_created': True,
                'dr_shell_vm_id': result.get('vm_moref'),
                'status_message': f"DR shell VM '{shell_vm_name}' created with {len(disk_paths)} disks"
            })
        
        handler._send_json({
            'success': result['success'],
            'shell_vm_name': shell_vm_name,
            'vm_moref': result.get('vm_moref'),
            'disks_attached': len(disk_paths),
            'disk_paths': disk_paths,
            'message': result.get('message')
        })
        return True
    
    def _batch_storage_vmotion(self, handler, data: Dict) -> bool:
        """
        Create storage vMotion jobs for multiple VMs.
        
        Expected data:
            vm_ids: List of protected VM IDs to migrate
        
        Returns:
            JSON response with created job IDs
        """
        vm_ids = data.get('vm_ids', [])
        if not vm_ids:
            handler._send_error('vm_ids is required', 400)
            return True
        
        logger.info(f"Creating batch storage vMotion for {len(vm_ids)} VMs")
        
        # Fetch protected VMs
        vm_ids_str = ','.join(vm_ids)
        vms = self._db_query('protected_vms', {
            'id': f"in.({vm_ids_str})",
            'select': '*'
        })
        
        if not vms:
            handler._send_error('No VMs found', 404)
            return True
        
        # Create a storage_vmotion job for each VM
        jobs_created = []
        errors = []
        skipped = []
        
        for vm in vms:
            # Validate VM has MoRef (vm_vcenter_id) required for vMotion
            if not vm.get('vm_vcenter_id'):
                logger.warning(f"Skipping VM {vm['vm_name']} - missing vm_vcenter_id (MoRef)")
                skipped.append({
                    'vm_id': vm['id'],
                    'vm_name': vm['vm_name'],
                    'reason': 'Missing vm_vcenter_id - VM needs to be re-added from vCenter inventory'
                })
                continue
            
            try:
                job = self._db_insert('jobs', {
                    'job_type': 'storage_vmotion',
                    'status': 'pending',
                    'target_scope': {
                        'protected_vm_id': vm['id']
                    },
                    'details': {
                        'protected_vm_id': vm['id'],
                        'vm_name': vm['vm_name'],
                        'vm_vcenter_id': vm.get('vm_vcenter_id'),
                        'source_datastore': vm.get('current_datastore'),
                        'target_datastore': vm.get('target_datastore'),
                        'protection_group_id': vm.get('protection_group_id')
                    }
                })
                if job:
                    jobs_created.append(job)
                    # Update the protected_vm status
                    self._db_update('protected_vms', vm['id'], {
                        'replication_status': 'migrating'
                    })
                    logger.info(f"Created storage vMotion job for VM {vm['vm_name']}")
            except Exception as e:
                logger.error(f"Failed to create job for VM {vm['vm_name']}: {e}")
                errors.append({'vm_id': vm['id'], 'vm_name': vm['vm_name'], 'error': str(e)})
        
        handler._send_json({
            'success': len(jobs_created) > 0,
            'jobs_created': len(jobs_created),
            'job_ids': [j['id'] for j in jobs_created],
            'skipped': skipped if skipped else None,
            'errors': errors if errors else None
        })
        return True
