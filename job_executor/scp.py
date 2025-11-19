import hashlib
import json
import time
from datetime import datetime
from typing import Dict, List

import requests

from job_executor.config import SERVICE_ROLE_KEY, SUPABASE_URL
from job_executor.utils import _safe_json_parse


class ScpMixin:
    def execute_scp_export(self, job: Dict):
        """
        Execute SCP (Server Configuration Profile) export job

        Expected job details:
        {
            "backup_name": "pre-upgrade-backup",
            "description": "Backup before firmware update",
            "include_bios": true,
            "include_idrac": true,
            "include_nic": true,
            "include_raid": true
        }
        """
        try:
            self.log(f"Starting SCP export job: {job['id']}")

            details = job.get('details', {})
            backup_name = details.get('backup_name', f"backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}")

            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())

            target_scope = job.get('target_scope', {})
            server_ids = target_scope.get('server_ids', [])

            if not server_ids:
                raise ValueError("No target servers specified")

            success_count = 0
            failed_count = 0
            results: List[dict] = []

            for server_id in server_ids:
                try:
                    server = self.get_server_by_id(server_id)
                    if not server:
                        raise Exception(f"Server not found: {server_id}")

                    ip = server['ip_address']
                    username, password = self.get_credentials_for_server(server)

                    self.log(f"  Exporting SCP from {ip}...")

                    export_url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration"

                    targets = []
                    if details.get('include_bios', True):
                        targets.append('BIOS')
                    if details.get('include_idrac', True):
                        targets.append('iDRAC')
                    if details.get('include_nic', True):
                        targets.append('NIC')
                    if details.get('include_raid', True):
                        targets.append('RAID')

                    payload = {
                        "ExportFormat": "JSON",
                        "ShareParameters": {
                            "Target": ",".join(targets)
                        }
                    }

                    start_time = time.time()
                    response = requests.post(
                        export_url,
                        auth=(username, password),
                        json=payload,
                        verify=False,
                        timeout=30
                    )
                    response_time_ms = int((time.time() - start_time) * 1000)

                    self.log_idrac_command(
                        server_id=server_id,
                        job_id=job['id'],
                        task_id=None,
                        command_type='POST',
                        endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration',
                        full_url=export_url,
                        request_headers={'Authorization': '[REDACTED]'},
                        request_body=payload,
                        response_body=_safe_json_parse(response) if response.status_code == 200 else response.text,
                        status_code=response.status_code,
                        response_time_ms=response_time_ms,
                        success=response.status_code == 200,
                        operation_type='idrac_api'
                    )

                    if response.status_code != 200:
                        raise Exception(f"Export failed: {response.status_code} - {response.text}")

                    export_data = _safe_json_parse(response)
                    scp_content = export_data.get('SystemConfiguration', export_data)

                    scp_json = json.dumps(scp_content, indent=2)
                    file_size = len(scp_json.encode('utf-8'))
                    checksum = hashlib.sha256(scp_json.encode()).hexdigest()

                    backup_data = {
                        'server_id': server_id,
                        'export_job_id': job['id'],
                        'backup_name': f"{backup_name} - {server.get('hostname', ip)}",
                        'description': details.get('description'),
                        'scp_content': scp_content if file_size < 1024*1024 else None,
                        'scp_file_size_bytes': file_size,
                        'include_bios': details.get('include_bios', True),
                        'include_idrac': details.get('include_idrac', True),
                        'include_nic': details.get('include_nic', True),
                        'include_raid': details.get('include_raid', True),
                        'checksum': checksum,
                        'exported_at': datetime.now().isoformat(),
                        'created_by': job['created_by']
                    }

                    headers = {
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json'
                    }

                    db_response = requests.post(
                        f"{SUPABASE_URL}/rest/v1/scp_backups",
                        headers=headers,
                        json=backup_data
                    )

                    if db_response.status_code not in [200, 201]:
                        raise Exception(f"Failed to save backup: {db_response.text}")

                    self.log(f"  ✓ SCP exported from {ip} ({file_size/1024:.1f} KB)")
                    success_count += 1
                    results.append({
                        'server': ip,
                        'success': True,
                        'backup_name': backup_data['backup_name'],
                        'size_kb': round(file_size/1024, 1),
                        'checksum': checksum,
                        'targets': targets
                    })

                except Exception as e:
                    self.log(f"  ✗ Failed to export SCP from {server_id}: {e}", "ERROR")
                    failed_count += 1
                    results.append({
                        'server': server_id,
                        'success': False,
                        'error': str(e)
                    })

            status = 'completed' if failed_count == 0 else 'failed' if success_count == 0 else 'completed'

            self.update_job_status(
                job['id'],
                status,
                completed_at=datetime.now().isoformat(),
                details={
                    'success_count': success_count,
                    'failed_count': failed_count,
                    'results': results,
                    'backup_name': backup_name,
                    'note': 'Large SCP files stored externally' if any(r.get('size_kb', 0) > 1024 for r in results) else None
                }
            )

            if failed_count == 0:
                self.log("SCP export job completed successfully")
            else:
                self.log(f"SCP export job completed with {failed_count} failures", "WARN")

        except Exception as e:
            self.log(f"SCP export job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )

    def execute_scp_import(self, job: Dict):
        """
        Execute SCP (Server Configuration Profile) import job

        Expected job details:
        {
            "backup_id": 1,
            "shutdown_type": "Graceful",  # or "Forced"
            "host_power_state": "On"  # Desired power state after import
        }
        """
        try:
            self.log(f"Starting SCP import job: {job['id']}")

            details = job.get('details', {})
            backup_id = details.get('backup_id')
            shutdown_type = details.get('shutdown_type', 'Graceful')
            host_power_state = details.get('host_power_state', 'On')

            if not backup_id:
                raise ValueError("backup_id is required")

            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())

            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Content-Type': 'application/json'
            }
            backup_response = requests.get(
                f"{SUPABASE_URL}/rest/v1/scp_backups?id=eq.{backup_id}&select=*",
                headers=headers
            )

            if backup_response.status_code != 200:
                raise Exception(f"Failed to fetch backup: {backup_response.text}")

            backups = _safe_json_parse(backup_response)
            if not backups:
                raise Exception(f"Backup not found: {backup_id}")

            backup = backups[0]

            target_scope = job.get('target_scope', {})
            server_ids = target_scope.get('server_ids', [])

            if not server_ids:
                raise ValueError("No target servers specified")

            success_count = 0
            failed_count = 0
            results: List[dict] = []

            for server_id in server_ids:
                try:
                    server = self.get_server_by_id(server_id)
                    if not server:
                        raise Exception(f"Server not found: {server_id}")

                    ip = server['ip_address']
                    username, password = self.get_credentials_for_server(server)

                    self.log(f"  Importing SCP to {ip}...")

                    scp_content = backup.get('scp_content')
                    if not scp_content:
                        raise Exception("Backup does not contain SCP content")

                    import_url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ImportSystemConfiguration"

                    targets = []
                    if backup.get('include_bios', True):
                        targets.append('BIOS')
                    if backup.get('include_idrac', True):
                        targets.append('iDRAC')
                    if backup.get('include_nic', True):
                        targets.append('NIC')
                    if backup.get('include_raid', True):
                        targets.append('RAID')

                    payload = {
                        "ImportBuffer": json.dumps(scp_content),
                        "ShareParameters": {
                            "Target": ",".join(targets)
                        },
                        "ShutdownType": shutdown_type,
                        "HostPowerState": host_power_state
                    }

                    start_time = time.time()
                    response = requests.post(
                        import_url,
                        auth=(username, password),
                        json=payload,
                        verify=False,
                        timeout=30
                    )
                    response_time_ms = int((time.time() - start_time) * 1000)

                    self.log_idrac_command(
                        server_id=server_id,
                        job_id=job['id'],
                        task_id=None,
                        command_type='POST',
                        endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ImportSystemConfiguration',
                        full_url=import_url,
                        request_headers={'Authorization': '[REDACTED]'},
                        request_body={'ShareParameters': payload['ShareParameters'], 'ShutdownType': shutdown_type},
                        response_body=_safe_json_parse(response) if response.status_code in [200, 202] else response.text,
                        status_code=response.status_code,
                        response_time_ms=response_time_ms,
                        success=response.status_code in [200, 202],
                        operation_type='idrac_api'
                    )

                    if response.status_code not in [200, 202]:
                        raise Exception(f"Import failed: {response.status_code} - {response.text}")

                    import_data = _safe_json_parse(response)

                    requests.patch(
                        f"{SUPABASE_URL}/rest/v1/scp_backups?id=eq.{backup_id}",
                        headers=headers,
                        json={
                            'import_job_id': job['id'],
                            'last_imported_at': datetime.now().isoformat()
                        }
                    )

                    self.log(f"  ✓ SCP import initiated on {ip}")
                    success_count += 1
                    results.append({
                        'server': ip,
                        'success': True,
                        'components': targets,
                        'message': import_data.get('Message', 'Import job created')
                    })

                except Exception as e:
                    self.log(f"  ✗ Failed to import SCP to {ip}: {e}", "ERROR")
                    failed_count += 1
                    results.append({
                        'server': ip,
                        'success': False,
                        'error': str(e)
                    })

            if failed_count == 0:
                self.update_job_status(
                    job['id'],
                    'completed',
                    completed_at=datetime.now().isoformat(),
                    details={
                        'success_count': success_count,
                        'results': results,
                        'warning': 'Servers may need to reboot'
                    }
                )
                self.log(f"SCP import job completed successfully")
            else:
                status = 'failed' if success_count == 0 else 'completed'
                self.update_job_status(
                    job['id'],
                    status,
                    completed_at=datetime.now().isoformat(),
                    details={
                        'success_count': success_count,
                        'failed_count': failed_count,
                        'results': results
                    }
                )

        except Exception as e:
            self.log(f"SCP import job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
