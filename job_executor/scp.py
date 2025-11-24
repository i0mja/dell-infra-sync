import hashlib
import json
import time
from datetime import datetime
from typing import Dict, List, Optional
from urllib.parse import urlparse

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
                        targets.append('IDRAC')
                    if details.get('include_nic', True):
                        targets.append('NIC')
                    if details.get('include_raid', True):
                        targets.append('RAID')

                    # Build ShareParameters following Dell iDRAC expectations.
                    # Default to "Local" exports (content returned directly in the task monitor)
                    # unless the caller explicitly provides share details for SMB/NFS exports.
                    share_type = str(details.get('share_type', 'Local') or 'Local')
                    share_parameters: Dict[str, str]

                    if share_type.lower() == 'local':
                        # Local export: return SCP content in the task response (no share parameters required)
                        share_parameters = {
                            "Target": ",".join(targets)
                        }
                    else:
                        # Optional network share fields (commonly used by iDRAC Redfish)
                        # See https://www.dell.com/support/kbdoc/en-us/000177312 for parameters
                        share_parameters = {
                            "Target": ",".join(targets),
                            "ShareType": share_type
                        }

                        if details.get('share_address'):
                            share_parameters['IPAddress'] = str(details['share_address'])
                        if details.get('share_name'):
                            share_parameters['ShareName'] = str(details['share_name'])
                        if details.get('share_username'):
                            share_parameters['UserName'] = str(details['share_username'])
                        if details.get('share_password'):
                            share_parameters['Password'] = str(details['share_password'])
                        if details.get('share_file_name'):
                            share_parameters['FileName'] = str(details['share_file_name'])

                    payload = {
                        "ExportFormat": "JSON",
                        "ShareParameters": share_parameters,
                        "ExportUse": details.get('export_use', 'Clone'),
                        "IncludeInExport": details.get('include_in_export', 'Default'),
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
                        response_body=_safe_json_parse(response),
                        status_code=response.status_code,
                        response_time_ms=response_time_ms,
                        success=response.status_code in [200, 202],
                        operation_type='idrac_api'
                    )

                    if response.status_code not in [200, 202]:
                        raise Exception(f"Export failed: {response.status_code} - {response.text}")

                    if response.status_code == 202:
                        scp_content = self._wait_for_scp_export(
                            ip,
                            username,
                            password,
                            response.headers,
                            _safe_json_parse(response),
                            job,
                            server_id
                        )
                    else:
                        export_data = _safe_json_parse(response)
                        scp_content = self._extract_scp_content(export_data) or export_data

                    if scp_content is None:
                        raise Exception("SCP export completed but returned no content")

                    if isinstance(scp_content, (dict, list)):
                        serialized_for_file = json.dumps(scp_content, indent=2)
                        serialized_for_checksum = json.dumps(scp_content, separators=(',', ':'))
                    else:
                        serialized_for_file = str(scp_content)
                        serialized_for_checksum = serialized_for_file

                    file_size = len(serialized_for_file.encode('utf-8'))
                    checksum = hashlib.sha256(serialized_for_checksum.encode()).hexdigest()

                    backup_data = {
                        'server_id': server_id,
                        'export_job_id': job['id'],
                        'backup_name': f"{backup_name} - {server.get('hostname') or ip}",
                        'description': details.get('description'),
                        'scp_content': scp_content,
                        'scp_file_size_bytes': file_size,
                        'include_bios': details.get('include_bios', True),
                        'include_idrac': details.get('include_idrac', True),
                        'include_nic': details.get('include_nic', True),
                        'include_raid': details.get('include_raid', True),
                        'checksum': checksum,
                        'scp_checksum': checksum,
                        'components': ",".join(targets),
                        'exported_at': datetime.now().isoformat(),
                        'created_by': job['created_by'],
                        'is_valid': True
                    }

                    headers = {
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json'
                    }

                    db_response = requests.post(
                        f"{SUPABASE_URL}/rest/v1/scp_backups",
                        headers=headers,
                        json=backup_data,
                        timeout=30
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
                    'note': None
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

    def _wait_for_scp_export(
        self,
        ip: str,
        username: str,
        password: str,
        response_headers: Dict,
        response_body: Dict,
        job: Dict,
        server_id: str,
        timeout_seconds: int = 300,
        poll_interval: int = 5
    ) -> Dict:
        """Poll an async SCP export task until completion and return SCP content."""

        task_uri = self._extract_task_uri(response_headers, response_body)
        if not task_uri:
            raise Exception("Export accepted but no task URI provided")

        monitor_url = task_uri if task_uri.startswith('http') else f"https://{ip}{task_uri}"
        endpoint = urlparse(monitor_url).path

        self.log(f"  SCP export accepted, polling task: {monitor_url}")

        start_time = time.time()
        last_state = None
        last_response = None

        while time.time() - start_time < timeout_seconds:
            poll_start = time.time()
            response = requests.get(
                monitor_url,
                auth=(username, password),
                verify=False,
                timeout=30
            )
            response_time_ms = int((time.time() - poll_start) * 1000)

            data = _safe_json_parse(response)
            task_state = self._extract_task_state(data)
            messages = self._extract_task_messages(data)
            last_response = (response, response_time_ms, data, task_state, messages)

            if task_state and task_state != last_state:
                self.log(f"    Task state: {task_state}")
                last_state = task_state

            if response.status_code == 200 and self._is_task_success(task_state):
                scp_content = self._extract_scp_content(data) or self._fetch_scp_content_fallback(
                    monitor_url,
                    username,
                    password,
                    server_id,
                    job,
                    endpoint
                )
                success = scp_content is not None

                self.log_idrac_command(
                    server_id=server_id,
                    job_id=job['id'],
                    task_id=None,
                    command_type='GET',
                    endpoint=endpoint,
                    full_url=monitor_url,
                    request_headers={'Authorization': '[REDACTED]'},
                    request_body=None,
                    status_code=response.status_code,
                    response_time_ms=response_time_ms,
                    response_body=data,
                    success=success,
                    error_message=None if success else "SCP content missing",
                    operation_type='idrac_api'
                )

                if not scp_content:
                    raise Exception("SCP export task completed but no configuration data was returned")

                return scp_content

            if response.status_code == 200 and self._is_task_failure(task_state):
                error_message = messages[0] if messages else f"Task failed with state {task_state}"
                self.log_idrac_command(
                    server_id=server_id,
                    job_id=job['id'],
                    task_id=None,
                    command_type='GET',
                    endpoint=endpoint,
                    full_url=monitor_url,
                    request_headers={'Authorization': '[REDACTED]'},
                    request_body=None,
                    status_code=response.status_code,
                    response_time_ms=response_time_ms,
                    response_body=data,
                    success=False,
                    error_message=error_message,
                    operation_type='idrac_api'
                )
                raise Exception(f"SCP export task failed: {error_message}")

            time.sleep(poll_interval)

        if last_response:
            response, response_time_ms, data, task_state, messages = last_response
            self.log_idrac_command(
                server_id=server_id,
                job_id=job['id'],
                task_id=None,
                command_type='GET',
                endpoint=endpoint,
                full_url=monitor_url,
                request_headers={'Authorization': '[REDACTED]'},
                request_body=None,
                status_code=response.status_code,
                response_time_ms=response_time_ms,
                response_body=data,
                success=False,
                error_message="SCP export task timed out",
                operation_type='idrac_api'
            )

        raise TimeoutError(f"SCP export task did not complete within {timeout_seconds} seconds")

    def _extract_task_state(self, data: Dict) -> Optional[str]:
        if isinstance(data, str):
            return self._maybe_parse_content(data)

        if not isinstance(data, dict):
            return None

        oem = data.get('Oem', {}) if isinstance(data.get('Oem'), dict) else {}
        dell = oem.get('Dell', {}) if isinstance(oem.get('Dell'), dict) else {}

        return (
            data.get('TaskState')
            or data.get('Status')
            or dell.get('JobState')
            or dell.get('Status')
        )

    def _extract_task_messages(self, data: Dict) -> List[str]:
        messages: List[str] = []

        if isinstance(data, dict):
            for msg in data.get('Messages', []) or []:
                if isinstance(msg, dict):
                    messages.append(msg.get('Message') or msg.get('MessageId') or str(msg))
                else:
                    messages.append(str(msg))

            if isinstance(data.get('Message'), str):
                messages.append(data['Message'])

            oem = data.get('Oem', {}) if isinstance(data.get('Oem'), dict) else {}
            dell = oem.get('Dell', {}) if isinstance(oem.get('Dell'), dict) else {}
            if isinstance(dell.get('Message'), str):
                messages.append(dell['Message'])

        return messages

    def _extract_task_uri(self, headers: Dict, body: Dict) -> Optional[str]:
        if headers:
            location = headers.get('Location') or headers.get('location')
            if location:
                return location

        if isinstance(body, dict):
            return body.get('@odata.id') or body.get('TaskUri') or body.get('Location') or body.get('task')

        return None

    def _is_task_success(self, state: Optional[str]) -> bool:
        if not state:
            return False
        return state.lower() in ['completed', 'completedok', 'success', 'succeeded']

    def _is_task_failure(self, state: Optional[str]) -> bool:
        if not state:
            return False
        return state.lower() in ['exception', 'killed', 'cancelled', 'failed', 'failure']

    def _fetch_scp_content_fallback(
        self,
        monitor_url: str,
        username: str,
        password: str,
        server_id: str,
        job: Dict,
        endpoint: str
    ):
        """Attempt to retrieve SCP content from common fallback URLs.

        Some iDRAC versions return SCP content at ``/$value`` or ``/ExportedData``
        endpoints even when the primary task response lacks the configuration
        payload. This helper makes one pass over those endpoints and returns the
        first valid configuration blob it finds.
        """

        base_url = monitor_url.rstrip('/')
        fallback_urls = [
            # Some iDRAC versions honor content negotiation on the task URI itself.
            # Re-request the same task with an XML/txt Accept header before trying
            # Redfish-specific $value/ExportedData paths.
            (base_url, {"Accept": "application/xml,application/json,text/plain"}),
            (f"{base_url}/$value", {"Accept": "application/xml,text/plain"}),
            (f"{base_url}/ExportedData", {"Accept": "application/xml,text/plain"}),
        ]

        for url, headers in fallback_urls:
            try:
                poll_start = time.time()
                response = requests.get(
                    url,
                    auth=(username, password),
                    headers=headers,
                    verify=False,
                    timeout=30
                )
                response_time_ms = int((time.time() - poll_start) * 1000)

                parsed_body = _safe_json_parse(response)
                content = self._extract_scp_content(parsed_body)

                # If JSON parsing failed (common when XML/text is returned), fall back
                # to the raw body so we still capture the SCP payload.
                if content is None:
                    content = self._maybe_parse_content(response.text)

                success = response.status_code == 200 and content is not None

                self.log_idrac_command(
                    server_id=server_id,
                    job_id=job['id'],
                    task_id=None,
                    command_type='GET',
                    endpoint=urlparse(url).path,
                    full_url=url,
                    request_headers={'Authorization': '[REDACTED]'},
                    request_body=None,
                    status_code=response.status_code,
                    response_time_ms=response_time_ms,
                    response_body=parsed_body,
                    success=success,
                    error_message=None if success else "SCP content not available at fallback URI",
                    operation_type='idrac_api'
                )

                if success:
                    return content
            except Exception as exc:  # pragma: no cover - best-effort fallback
                self.log(
                    f"    Fallback SCP fetch failed for {url}: {exc}",
                    level="WARN"
                )

        return None

    def _extract_scp_content(self, data: Dict):
        if isinstance(data, str):
            return self._maybe_parse_content(data)

        if not isinstance(data, dict):
            return None

        def _extract_from_obj(obj: Dict, keys: List[str]):
            for key in keys:
                if key in obj:
                    content = obj.get(key)
                    parsed = self._maybe_parse_content(content)
                    if parsed is not None:
                        return parsed
                    if content is not None:
                        return content
            return None

        top_level = _extract_from_obj(data, ['SystemConfiguration', 'ExportedSystemConfiguration'])
        if top_level is not None:
            return top_level

        oem = data.get('Oem', {}) if isinstance(data.get('Oem'), dict) else {}
        dell = oem.get('Dell', {}) if isinstance(oem.get('Dell'), dict) else {}

        dell_config = _extract_from_obj(dell, ['SystemConfiguration', 'ExportedSystemConfiguration'])
        if dell_config is not None:
            return dell_config

        for key in ['Data', 'ExportedData']:
            if key in data:
                content = data.get(key)
                parsed = self._maybe_parse_content(content)
                if parsed is not None:
                    return parsed
            if key in dell:
                content = dell.get(key)
                parsed = self._maybe_parse_content(content)
                if parsed is not None:
                    return parsed

        # Fallback: if the response object captured the raw body, return it so we don't lose the SCP text.
        if isinstance(data, dict) and data.get('_raw_response'):
            parsed = self._maybe_parse_content(data['_raw_response'])
            return parsed if parsed is not None else data['_raw_response']

        return None

    def _maybe_parse_content(self, content):
        if isinstance(content, (dict, list)):
            return content

        if isinstance(content, str):
            stripped = content.strip()
            if stripped.startswith('{') or stripped.startswith('['):
                try:
                    return json.loads(stripped)
                except Exception:
                    return content
            return stripped

        return None

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
