"""vCenter sync and connectivity handlers"""

from typing import Dict, Optional
from datetime import datetime
import time
import requests
from .base import BaseHandler


class VCenterHandlers(BaseHandler):
    """Handles vCenter sync and connectivity test operations"""
    
    def execute_vcenter_sync(self, job: Dict):
        """Execute vCenter sync - fetch ESXi hosts and auto-link to Dell servers"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        from job_executor.utils import _safe_json_parse
        from pyVmomi import vim
        
        sync_start = time.time()
        vcenter_host = None
        source_vcenter_id = None
        sync_errors = []
        
        try:
            self.log(f"Starting vCenter sync job: {job['id']}")
            self.update_job_status(
                job['id'], 
                'running', 
                started_at=datetime.now().isoformat(),
                details={"current_step": "Initializing"}
            )
            
            # Create tasks for each sync phase
            sync_phases = [
                {'name': 'connect', 'label': 'Connecting to vCenter'},
                {'name': 'clusters', 'label': 'Syncing clusters'},
                {'name': 'datastores', 'label': 'Syncing datastores'},
                {'name': 'vms', 'label': 'Syncing VMs'},
                {'name': 'alarms', 'label': 'Syncing alarms'},
                {'name': 'hosts', 'label': 'Syncing ESXi hosts'}
            ]
            
            phase_tasks = {}
            for phase in sync_phases:
                task_id = self.create_task(job['id'])
                if task_id:
                    self.update_task_status(task_id, 'pending', log=phase['label'], progress=0)
                    phase_tasks[phase['name']] = task_id
            
            # Fetch vCenter from new vcenters table
            self.log("📋 Fetching vCenter configuration...")
            self.update_job_status(
                job['id'], 
                'running',
                details={"current_step": "Fetching vCenter configuration"}
            )
            
            # Get target vCenter ID from job details or use first sync-enabled vCenter
            job_details = job.get('details', {})
            target_vcenter_id = job_details.get('vcenter_id')
            
            if target_vcenter_id:
                vcenter_url = f"{DSM_URL}/rest/v1/vcenters?id=eq.{target_vcenter_id}&select=*"
            else:
                vcenter_url = f"{DSM_URL}/rest/v1/vcenters?sync_enabled=eq.true&order=created_at.asc&limit=1"
            
            response = requests.get(
                vcenter_url,
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                verify=VERIFY_SSL
            )
            
            if response.status_code != 200:
                raise Exception(f"Failed to fetch vCenter configuration: {response.status_code}")
            
            vcenters_list = _safe_json_parse(response)
            if not vcenters_list:
                raise Exception("No vCenter connection configured or sync is disabled")

            vcenter_config = vcenters_list[0]
            source_vcenter_id = vcenter_config['id']
            vcenter_host = vcenter_config.get('host')
            vcenter_name = vcenter_config['name']
            self.log(f"✓ vCenter: {vcenter_name} ({vcenter_host})")

            # Connect to vCenter using database settings
            self.log("🔌 Connecting to vCenter...")
            self.update_job_status(
                job['id'], 
                'running',
                details={"current_step": f"Connecting to {vcenter_host}"}
            )
            vc = self.executor.connect_vcenter(vcenter_config)
            if not vc:
                raise Exception("Failed to connect to vCenter - check credentials and network connectivity")
            
            # Mark connect phase complete
            if 'connect' in phase_tasks:
                self.update_task_status(
                    phase_tasks['connect'],
                    'completed',
                    log='✓ Connected to vCenter',
                    progress=100
                )
            
            # Get vCenter content for all syncs
            content = vc.RetrieveContent()
            
            # Sync all vCenter entities with progress updates
            self.log("📊 Syncing clusters...")
            if 'clusters' in phase_tasks:
                self.update_task_status(phase_tasks['clusters'], 'running', log='Syncing clusters...', progress=0)
            
            if not self.executor.check_vcenter_connection(content):
                raise Exception("vCenter connection lost before cluster sync")
            
            clusters_result = self.executor.sync_vcenter_clusters(content, source_vcenter_id, vcenter_name=vcenter_name)
            self.log(f"✓ Clusters synced: {clusters_result.get('synced', 0)}")
            
            if 'clusters' in phase_tasks:
                self.update_task_status(
                    phase_tasks['clusters'],
                    'completed',
                    log=f'✓ Synced {clusters_result.get("synced", 0)} clusters',
                    progress=100
                )
            
            # Sync datastores
            self.log("📦 Syncing datastores...")
            if 'datastores' in phase_tasks:
                self.update_task_status(phase_tasks['datastores'], 'running', log='Syncing datastores...', progress=0)
            
            if not self.executor.check_vcenter_connection(content):
                raise Exception("vCenter connection lost before datastore sync")
            
            # Create progress callback for datastores
            def datastore_progress(pct, msg):
                if 'datastores' in phase_tasks:
                    self.update_task_status(phase_tasks['datastores'], 'running', log=msg, progress=pct)
                self.update_job_status(job['id'], 'running', details={'current_step': msg})
            
            datastores_result = self.executor.sync_vcenter_datastores(content, source_vcenter_id, progress_callback=datastore_progress, vcenter_name=vcenter_name)
            self.log(f"✓ Datastores synced: {datastores_result.get('synced', 0)}")
            
            if 'datastores' in phase_tasks:
                self.update_task_status(
                    phase_tasks['datastores'],
                    'completed',
                    log=f'✓ Synced {datastores_result.get("synced", 0)} datastores',
                    progress=100
                )
            
            # Sync VMs
            self.log("🖥️ Syncing VMs...")
            if 'vms' in phase_tasks:
                self.update_task_status(phase_tasks['vms'], 'running', log='Syncing VMs...', progress=0)
            
            if not self.executor.check_vcenter_connection(content):
                raise Exception("vCenter connection lost before VM sync")
            
            vms_result = self.executor.sync_vcenter_vms(content, source_vcenter_id, job['id'], vcenter_name=vcenter_name)
            self.log(f"✓ VMs synced: {vms_result.get('synced', 0)}")
            
            if 'vms' in phase_tasks:
                self.update_task_status(
                    phase_tasks['vms'],
                    'completed',
                    log=f'✓ Synced {vms_result.get("synced", 0)} VMs',
                    progress=100
                )
            
            # Sync alarms
            self.log("🚨 Syncing alarms...")
            if 'alarms' in phase_tasks:
                self.update_task_status(phase_tasks['alarms'], 'running', log='Syncing alarms...', progress=0)
            
            if not self.executor.check_vcenter_connection(content):
                raise Exception("vCenter connection lost before alarm sync")
            
            # Create progress callback for alarms
            def alarm_progress(pct, msg):
                if 'alarms' in phase_tasks:
                    self.update_task_status(phase_tasks['alarms'], 'running', log=msg, progress=pct)
                self.update_job_status(job['id'], 'running', details={'current_step': msg})
            
            alarms_result = self.executor.sync_vcenter_alarms(content, source_vcenter_id, progress_callback=alarm_progress, vcenter_name=vcenter_name)
            self.log(f"✓ Alarms synced: {alarms_result.get('synced', 0)}")
            
            if 'alarms' in phase_tasks:
                self.update_task_status(
                    phase_tasks['alarms'],
                    'completed',
                    log=f'✓ Synced {alarms_result.get("synced", 0)} alarms',
                    progress=100
                )
            
            # Sync ESXi hosts
            self.log("🖥️ Syncing ESXi hosts...")
            if 'hosts' in phase_tasks:
                self.update_task_status(phase_tasks['hosts'], 'running', log='Syncing hosts...', progress=0)
            
            if not self.executor.check_vcenter_connection(content):
                raise Exception("vCenter connection lost before host sync")
            
            # Create progress callback for hosts
            def host_progress(pct, msg):
                if 'hosts' in phase_tasks:
                    self.update_task_status(phase_tasks['hosts'], 'running', log=msg, progress=pct)
                self.update_job_status(job['id'], 'running', details={'current_step': msg})
            
            hosts_result = self.executor.sync_vcenter_hosts(content, source_vcenter_id, progress_callback=host_progress, vcenter_name=vcenter_name)
            self.log(f"✓ Hosts synced: {hosts_result.get('synced', 0)}, auto-linked: {hosts_result.get('auto_linked', 0)}")
            
            if 'hosts' in phase_tasks:
                self.update_task_status(
                    phase_tasks['hosts'],
                    'completed',
                    log=f'✓ Synced {hosts_result.get("synced", 0)} hosts, auto-linked {hosts_result.get("auto_linked", 0)}',
                    progress=100
                )
            
            # Complete job
            sync_duration = int(time.time() - sync_start)
            
            self.log(f"✓ vCenter sync completed in {sync_duration}s")
            
            summary = {
                'vcenter_host': vcenter_host,
                'sync_duration_seconds': sync_duration,
                'clusters': clusters_result.get('synced', 0),
                'datastores': datastores_result.get('synced', 0),
                'vms': vms_result.get('synced', 0),
                'alarms': alarms_result.get('synced', 0),
                'hosts': hosts_result.get('synced', 0),
                'auto_linked': hosts_result.get('auto_linked', 0),
                'errors': sync_errors if sync_errors else None
            }
            
            self.update_job_status(
                job['id'], 
                'completed',
                completed_at=datetime.now().isoformat(),
                details=summary
            )
            
        except Exception as e:
            self.log(f"vCenter sync failed: {e}", "ERROR")
            self.update_job_status(
                job['id'], 
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e), 'vcenter_host': vcenter_host}
            )
    
    def execute_vcenter_connectivity_test(self, job: Dict):
        """Test vCenter connectivity"""
        try:
            self.log(f"Starting vCenter connectivity test: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            # Implementation here - test vCenter connection
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details={'message': 'Connectivity test placeholder'}
            )
            
        except Exception as e:
            self.log(f"vCenter connectivity test failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
    
    def execute_openmanage_sync(self, job: Dict):
        """Execute OpenManage Enterprise sync operation"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        from job_executor.utils import _safe_json_parse
        
        try:
            self.log(f"Starting OpenManage sync: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            # Fetch OME settings
            response = requests.get(
                f"{DSM_URL}/rest/v1/openmanage_settings?select=*&limit=1",
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            
            if response.status_code != 200 or not _safe_json_parse(response):
                raise Exception("OpenManage settings not configured")
            
            settings = _safe_json_parse(response)[0]
            
            if not settings.get('sync_enabled'):
                raise Exception("OpenManage sync is disabled in settings")
            
            # Authenticate with OME
            self.log("Authenticating with OpenManage Enterprise...")
            auth_token = self.executor.authenticate_ome(settings)
            
            # Retrieve devices
            self.log("Retrieving devices from OpenManage Enterprise...")
            devices = self.executor.get_ome_devices(settings, auth_token)
            
            # Process and sync devices
            results = {
                'total': len(devices),
                'new': 0,
                'updated': 0,
                'skipped': 0,
                'errors': []
            }
            
            for device in devices:
                try:
                    device_data = self.executor.process_ome_device(device)
                    
                    if not device_data['service_tag'] or not device_data['ip_address']:
                        self.log(f"  Skipping device {device_data.get('hostname', 'Unknown')} - missing required fields", "WARN")
                        results['skipped'] += 1
                        continue
                    
                    self.log(f"  Syncing: {device_data['service_tag']} - {device_data['ip_address']}")
                    
                    action, success = self.executor.sync_ome_device_to_db(device_data)
                    
                    if success:
                        if action == 'new':
                            results['new'] += 1
                        elif action == 'updated':
                            results['updated'] += 1
                    else:
                        results['errors'].append(f"Failed to sync {device_data['service_tag']}")
                        
                except Exception as e:
                    self.log(f"  Error processing device: {e}", "ERROR")
                    results['errors'].append(str(e))
            
            # Update last_sync timestamp in settings
            requests.patch(
                f"{DSM_URL}/rest/v1/openmanage_settings?id=eq.{settings['id']}",
                json={'last_sync': datetime.now().isoformat()},
                headers={'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'},
                verify=VERIFY_SSL
            )
            
            self.log(f"✓ OpenManage sync completed: {results['new']} new, {results['updated']} updated, {results['skipped']} skipped")
            
            self.update_job_status(
                job['id'], 'completed',
                completed_at=datetime.now().isoformat(),
                details=results
            )
            
        except Exception as e:
            self.log(f"OpenManage sync failed: {e}", "ERROR")
            self.update_job_status(
                job['id'], 'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
