import hashlib
import json
import time
import socket
import threading
import http.server
import socketserver
from datetime import datetime
from typing import Dict, List, Optional
from urllib.parse import urlparse

import requests

from job_executor.config import SERVICE_ROLE_KEY, SUPABASE_URL
from job_executor.utils import _safe_json_parse


class SCPReceiverHandler(http.server.BaseHTTPRequestHandler):
    """HTTP handler for receiving SCP content pushed from iDRAC."""
    received_content = None
    content_type = None
    
    def do_PUT(self):
        """Handle PUT request with SCP content."""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            SCPReceiverHandler.content_type = self.headers.get('Content-Type', 'application/octet-stream')
            SCPReceiverHandler.received_content = self.rfile.read(content_length)
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'OK')
        except Exception as e:
            self.send_response(500)
            self.end_headers()
    
    def do_POST(self):
        """Handle POST request (same as PUT)."""
        self.do_PUT()
    
    def log_message(self, format, *args):
        """Suppress HTTP server logging."""
        pass


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
                    
                    # Detect iDRAC version and capabilities
                    idrac_info = self._get_idrac_version(ip, username, password)
                    supports_local = idrac_info.get('supports_local', True)
                    firmware_version = idrac_info.get('firmware', 'unknown')
                    
                    if not supports_local:
                        self.log(f"    iDRAC {firmware_version} detected - Local export not supported, using HTTP Push")

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

                    # Try XML format first for better compatibility with older iDRAC versions
                    # XML is more universally supported than JSON in iDRAC Redfish implementations
                    payload = {
                        "ExportFormat": "XML",
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
                        try:
                            scp_content = self._wait_for_scp_export(
                                ip,
                                username,
                                password,
                                response.headers,
                                _safe_json_parse(response),
                                job,
                                server_id
                            )
                        except Exception as local_error:
                            # If Local export fails and HTTP Push is available, try it as fallback
                            if not supports_local or "no content" in str(local_error).lower():
                                self.log(f"    Local export failed: {local_error}")
                                self.log(f"    Attempting HTTP Push export as fallback...")
                                try:
                                    scp_content = self._export_via_http_push(
                                        ip,
                                        username,
                                        password,
                                        targets,
                                        details,
                                        job,
                                        server_id
                                    )
                                except Exception as http_push_error:
                                    # If HTTP Push also fails, try SMB share if configured
                                    self.log(f"    HTTP Push export failed: {http_push_error}")
                                    self.log(f"    Attempting SMB/NFS share export as final fallback...")
                                    scp_content = self._export_via_smb_share(
                                        ip,
                                        username,
                                        password,
                                        targets,
                                        details,
                                        job,
                                        server_id
                                    )
                            else:
                                raise
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
                scp_content = self._extract_scp_content(data)
                
                # Validate that we got actual SCP content, not task status
                if scp_content is None or not self._is_valid_scp_content(scp_content):
                    self.log(f"    Initial content invalid or missing, trying fallback URLs...")
                    scp_content = self._fetch_scp_content_fallback(
                        monitor_url,
                        username,
                        password,
                        server_id,
                        job,
                        endpoint
                    )
                
                # Final validation
                if scp_content and not self._is_valid_scp_content(scp_content):
                    self.log(f"    Content type validation failed: {type(scp_content)}, keys: {list(scp_content.keys()) if isinstance(scp_content, dict) else 'N/A'}", "WARN")
                    scp_content = None
                
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

        Some iDRAC versions return SCP content directly from the Task URI
        using content negotiation or Redfish-specific paths (``/$value``,
        ``/ExportedData``). Other versions expose the exported SCP only on
        the OEM Jobs URI (``/redfish/v1/Managers/iDRAC.Embedded.1/Jobs/JID_xxx``).

        This helper makes one pass over those endpoints and returns the
        first valid configuration blob it finds.
        """

        parsed_monitor = urlparse(monitor_url)
        task_path = parsed_monitor.path or ""
        base_url = f"{parsed_monitor.scheme}://{parsed_monitor.netloc}{task_path}".rstrip('/')

        # If this looks like a TaskService JID, construct the matching Jobs URI.
        job_base_url = None
        job_id = task_path.rsplit('/', 1)[-1]
        if job_id and job_id.startswith("JID_"):
            job_base_url = f"{parsed_monitor.scheme}://{parsed_monitor.netloc}/redfish/v1/Managers/iDRAC.Embedded.1/Jobs/{job_id}"

        # CRITICAL FIX: Use individual Accept headers instead of comma-separated lists
        # Some iDRAC versions return HTTP 406 "Unacceptable header" when given multiple types
        fallback_urls = [
            # Try JSON format first (our preferred format)
            (base_url, {"Accept": "application/json"}),
            # Try XML format (more widely supported on older iDRAC)
            (base_url, {"Accept": "application/xml"}),
            # Try plain text
            (base_url, {"Accept": "text/plain"}),
            # Try any type
            (base_url, {"Accept": "*/*"}),
            # Try Redfish $value endpoint with XML
            (f"{base_url}/$value", {"Accept": "application/xml"}),
            (f"{base_url}/$value", {"Accept": "application/octet-stream"}),
            (f"{base_url}/$value", {"Accept": "*/*"}),
            # Try ExportedData endpoint
            (f"{base_url}/ExportedData", {"Accept": "application/xml"}),
            (f"{base_url}/ExportedData", {"Accept": "application/json"}),
        ]

        # If we detected a JID, also try the Jobs resource variants
        if job_base_url:
            fallback_urls.extend([
                (job_base_url, {"Accept": "application/json"}),
                (job_base_url, {"Accept": "application/xml"}),
                (job_base_url, {"Accept": "*/*"}),
                (f"{job_base_url}/$value", {"Accept": "application/xml"}),
                (f"{job_base_url}/$value", {"Accept": "application/octet-stream"}),
                (f"{job_base_url}/ExportedData", {"Accept": "application/xml"}),
                (f"{job_base_url}/ExportedData", {"Accept": "application/json"}),
            ])

        for url, headers in fallback_urls:
            try:
                # Log which Accept header we're trying for debugging
                self.log(f"    Trying {url} with Accept: {headers.get('Accept', 'none')}")
                
                poll_start = time.time()
                response = requests.get(
                    url,
                    auth=(username, password),
                    headers=headers,
                    verify=False,
                    timeout=30
                )
                response_time_ms = int((time.time() - poll_start) * 1000)

                data = _safe_json_parse(response)
                content = self._extract_scp_content(data)

                # If JSON parsing fails (common when XML/text is returned),
                # fall back to the raw body so we still capture the SCP payload.
                if content is None and isinstance(response.text, str) and response.text.strip():
                    parsed = self._maybe_parse_content(response.text)
                    # Only accept if it's actual SCP data, not a task status
                    if self._is_valid_scp_content(parsed):
                        content = parsed

                success = response.status_code == 200 and content is not None and self._is_valid_scp_content(content)

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
                    response_body=data,
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

        # CRITICAL: Check for embedded SCP content in task completion response
        # Some iDRAC versions embed the SCP content directly in the task response
        # when using "Local" export mode, especially older firmware versions
        
        # Check for FileContent (base64 encoded or direct content)
        if 'FileContent' in data:
            file_content = data.get('FileContent')
            if isinstance(file_content, str):
                # Try to decode base64 if it looks encoded
                try:
                    import base64
                    decoded = base64.b64decode(file_content).decode('utf-8')
                    parsed = self._maybe_parse_content(decoded)
                    if parsed is not None:
                        return parsed
                except:
                    # Not base64, treat as direct content
                    parsed = self._maybe_parse_content(file_content)
                    if parsed is not None:
                        return parsed

        # Check for HttpPushUri response body embedded in task
        if 'HttpPushUri' in data:
            http_push_uri = data.get('HttpPushUri')
            if isinstance(http_push_uri, dict) and 'Body' in http_push_uri:
                parsed = self._maybe_parse_content(http_push_uri['Body'])
                if parsed is not None:
                    return parsed

        top_level = _extract_from_obj(data, ['SystemConfiguration', 'ExportedSystemConfiguration'])
        if top_level is not None:
            return top_level

        oem = data.get('Oem', {}) if isinstance(data.get('Oem'), dict) else {}
        dell = oem.get('Dell', {}) if isinstance(oem.get('Dell'), dict) else {}

        # Check Dell OEM section for embedded content
        dell_config = _extract_from_obj(dell, ['SystemConfiguration', 'ExportedSystemConfiguration', 'FileContent'])
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

    def _is_valid_scp_content(self, content) -> bool:
        """
        Check if content looks like actual SCP data vs a task status response.
        
        Real SCP content contains SystemConfiguration or Components.
        Task status responses contain TaskState, JobState, @odata.type, etc.
        """
        if isinstance(content, dict):
            # Real SCP JSON has SystemConfiguration or Components
            if 'SystemConfiguration' in content or 'Components' in content:
                return True
            
            # Reject if it looks like a task/job status response
            if any(key in content for key in ['TaskState', 'JobState', '@odata.type', '@odata.id']):
                return False
            
            # Check for Dell OEM job status structure
            if 'Oem' in content and isinstance(content.get('Oem'), dict):
                dell = content['Oem'].get('Dell', {})
                if isinstance(dell, dict) and any(key in dell for key in ['JobState', 'JobType', 'Name']):
                    return False
            
            # If we got here with a dict but no clear indicators, be conservative
            # Accept it if it has reasonable SCP-like structure
            return True
            
        elif isinstance(content, str):
            # Real SCP XML starts with <SystemConfiguration>
            stripped = content.strip()
            if stripped.startswith('<SystemConfiguration'):
                return True
            
            # Could also be JSON string - parse and check
            if stripped.startswith('{'):
                try:
                    parsed = json.loads(stripped)
                    return self._is_valid_scp_content(parsed)
                except:
                    pass
            
            # Accept non-empty strings as potential SCP content
            return bool(stripped)
        
        return False

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

    def _get_idrac_version(self, ip: str, username: str, password: str) -> Dict:
        """
        Get iDRAC version and determine export capabilities.
        
        Returns dict with:
        - firmware: Firmware version string
        - model: iDRAC model (e.g., "iDRAC9")
        - supports_local: Whether Local SCP export is supported
        """
        try:
            url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1"
            response = requests.get(url, auth=(username, password), verify=False, timeout=30)
            
            if response.status_code != 200:
                return {'firmware': 'unknown', 'model': 'unknown', 'supports_local': True}
            
            data = _safe_json_parse(response)
            firmware = data.get('FirmwareVersion', '')
            model = data.get('Model', '')
            
            # Determine Local export support based on firmware version
            # iDRAC9 with firmware 4.x+ supports Local export
            # iDRAC8 with firmware 2.70+ supports Local export
            # Older versions require HTTP Push or network share
            supports_local = self._check_local_support(firmware, model)
            
            return {
                'firmware': firmware,
                'model': model,
                'supports_local': supports_local
            }
            
        except Exception as e:
            self.log(f"    Failed to detect iDRAC version: {e}", "WARN")
            # Assume newer version with Local support by default
            return {'firmware': 'unknown', 'model': 'unknown', 'supports_local': True}
    
    def _check_local_support(self, firmware: str, model: str) -> bool:
        """Check if iDRAC version supports Local SCP export."""
        try:
            # Extract version numbers
            version_parts = firmware.split('.')
            if not version_parts:
                return True
            
            major_version = int(version_parts[0])
            
            if 'iDRAC9' in model or 'idrac9' in model.lower():
                # iDRAC9: Local export supported in 4.x+
                return major_version >= 4
            elif 'iDRAC8' in model or 'idrac8' in model.lower():
                # iDRAC8: Local export supported in 2.70+
                if major_version > 2:
                    return True
                if major_version == 2 and len(version_parts) > 1:
                    minor_version = int(version_parts[1])
                    return minor_version >= 70
                return False
            else:
                # For iDRAC7 and older, Local export is not supported
                return major_version >= 4
                
        except Exception:
            # If we can't parse version, assume it supports Local
            return True
    
    def _find_free_port(self) -> int:
        """Find a free TCP port for the HTTP server."""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('', 0))
            s.listen(1)
            port = s.getsockname()[1]
        return port
    
    def _get_local_ip(self) -> str:
        """Get the local IP address reachable from the network."""
        try:
            # Create a socket to determine which interface to use
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
            return local_ip
        except Exception:
            return '0.0.0.0'
    
    def _export_via_http_push(
        self,
        ip: str,
        username: str,
        password: str,
        targets: List[str],
        details: Dict,
        job: Dict,
        server_id: str
    ) -> Optional[str]:
        """
        Export SCP by having iDRAC push content to a temporary HTTP server.
        
        This method is used as a fallback for older iDRAC firmware that doesn't
        support "Local" export mode.
        """
        # Find free port and get local IP
        port = self._find_free_port()
        local_ip = self._get_local_ip()
        
        self.log(f"    Starting HTTP server on {local_ip}:{port} to receive SCP content...")
        
        # Reset handler state
        SCPReceiverHandler.received_content = None
        SCPReceiverHandler.content_type = None
        
        # Start temporary HTTP server
        server = socketserver.TCPServer((local_ip, port), SCPReceiverHandler)
        server.timeout = 300  # 5 minute timeout
        
        # Run server in background thread (handle one request)
        server_thread = threading.Thread(target=server.handle_request, daemon=True)
        server_thread.start()
        
        try:
            # Tell iDRAC to export to our HTTP server
            export_url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration"
            
            share_parameters = {
                "Target": ",".join(targets),
                "ShareType": "HTTP",
                "IPAddress": local_ip,
                "PortNumber": port,
                "FileName": "scp_export.xml"
            }
            
            payload = {
                "ExportFormat": "XML",
                "ShareParameters": share_parameters,
                "ExportUse": details.get('export_use', 'Clone'),
                "IncludeInExport": details.get('include_in_export', 'Default'),
            }
            
            self.log(f"    Requesting iDRAC to push SCP to http://{local_ip}:{port}/scp_export.xml")
            
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
                request_body={'ShareType': 'HTTP', 'IPAddress': local_ip, 'PortNumber': port},
                response_body=_safe_json_parse(response),
                status_code=response.status_code,
                response_time_ms=response_time_ms,
                success=response.status_code in [200, 202],
                operation_type='idrac_api'
            )
            
            if response.status_code not in [200, 202]:
                raise Exception(f"HTTP Push export request failed: {response.status_code} - {response.text}")
            
            # Wait for the server thread to receive content
            self.log(f"    Waiting for iDRAC to push SCP content...")
            server_thread.join(timeout=300)
            
            if SCPReceiverHandler.received_content:
                self.log(f"    ✓ Received SCP content via HTTP Push ({len(SCPReceiverHandler.received_content)} bytes)")
                
                # Decode and parse content
                content_bytes = SCPReceiverHandler.received_content
                content_str = content_bytes.decode('utf-8') if isinstance(content_bytes, bytes) else str(content_bytes)
                
                # Parse if it's JSON or return as XML string
                parsed = self._maybe_parse_content(content_str)
                return parsed if parsed is not None else content_str
            else:
                raise Exception("HTTP server timeout - iDRAC did not push SCP content")
                
        finally:
            server.server_close()
            self.log(f"    HTTP server stopped")

    def _export_via_smb_share(
        self,
        ip: str,
        username: str,
        password: str,
        targets: List[str],
        details: Dict,
        job: Dict,
        server_id: str
    ) -> Optional[str]:
        """
        Export SCP to SMB/NFS network share and retrieve content.
        
        This method is used as a final fallback for older iDRAC firmware in air-gapped
        environments where HTTP Push is not reliable.
        
        Requires share configuration in activity_settings table.
        """
        # Get share configuration from activity_settings
        try:
            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
            }
            settings_response = requests.get(
                f"{SUPABASE_URL}/rest/v1/activity_settings?select=*&limit=1",
                headers=headers,
                timeout=10
            )
            
            if settings_response.status_code != 200:
                raise Exception("Failed to fetch activity settings")
            
            settings_data = _safe_json_parse(settings_response)
            if not settings_data or len(settings_data) == 0:
                raise Exception("No activity settings found")
            
            settings = settings_data[0]
            
            # Check if SMB share is enabled
            if not settings.get('scp_share_enabled'):
                raise Exception("SMB/NFS share export is not configured. Configure in Settings → Activity Monitor.")
            
            share_type = settings.get('scp_share_type', 'CIFS')
            share_path = settings.get('scp_share_path')
            share_username = settings.get('scp_share_username')
            share_password_encrypted = settings.get('scp_share_password_encrypted')
            
            if not share_path:
                raise Exception("SMB/NFS share path is not configured")
            
            self.log(f"    Using {share_type} share: {share_path}")
            
            # Parse share path for iDRAC parameters
            # For CIFS: \\server\share\path -> IPAddress, ShareName, FileName
            # For NFS: server:/export/path -> IPAddress, ShareName, FileName
            if share_type == 'CIFS':
                # Parse UNC path: \\server\share\folder
                parts = share_path.replace('\\\\', '').replace('\\', '/').split('/')
                if len(parts) < 2:
                    raise Exception(f"Invalid CIFS path format: {share_path}. Expected \\\\server\\share\\path")
                
                share_ip = parts[0]
                share_name = parts[1]
                sub_path = '/'.join(parts[2:]) if len(parts) > 2 else ''
            else:  # NFS
                # Parse NFS path: server:/export/path
                if ':' not in share_path:
                    raise Exception(f"Invalid NFS path format: {share_path}. Expected server:/export/path")
                
                share_ip, path_part = share_path.split(':', 1)
                parts = path_part.strip('/').split('/')
                share_name = parts[0] if parts else ''
                sub_path = '/'.join(parts[1:]) if len(parts) > 1 else ''
            
            # Generate unique filename for this export
            import uuid
            filename = f"scp_export_{server_id[:8]}_{uuid.uuid4().hex[:8]}.xml"
            if sub_path:
                filename = f"{sub_path}/{filename}"
            
            # Build ShareParameters for iDRAC
            share_parameters = {
                "Target": ",".join(targets),
                "ShareType": share_type,
                "IPAddress": share_ip,
                "ShareName": share_name,
                "FileName": filename
            }
            
            # Add authentication for CIFS
            if share_type == 'CIFS':
                if not share_username:
                    raise Exception("CIFS share username is not configured")
                
                share_parameters['UserName'] = share_username
                
                # Decrypt password if provided
                if share_password_encrypted:
                    decrypt_response = requests.post(
                        f"{SUPABASE_URL}/rest/v1/rpc/decrypt_password",
                        headers=headers,
                        json={
                            'encrypted': share_password_encrypted,
                            'key': settings.get('encryption_key')
                        },
                        timeout=10
                    )
                    if decrypt_response.status_code == 200:
                        share_password = decrypt_response.text.strip('"')
                        share_parameters['Password'] = share_password
                    else:
                        raise Exception("Failed to decrypt share password")
            
            # Request iDRAC to export to network share
            export_url = f"https://{ip}/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration"
            
            payload = {
                "ExportFormat": "XML",
                "ShareParameters": share_parameters,
                "ExportUse": details.get('export_use', 'Clone'),
                "IncludeInExport": details.get('include_in_export', 'Default'),
            }
            
            self.log(f"    Requesting iDRAC to export SCP to {share_type} share: {share_ip}/{share_name}/{filename}")
            
            start_time = time.time()
            response = requests.post(
                export_url,
                auth=(username, password),
                json=payload,
                verify=False,
                timeout=30
            )
            response_time_ms = int((time.time() - start_time) * 1000)
            
            # Log command (without credentials)
            safe_params = share_parameters.copy()
            if 'Password' in safe_params:
                safe_params['Password'] = '[REDACTED]'
            
            self.log_idrac_command(
                server_id=server_id,
                job_id=job['id'],
                task_id=None,
                command_type='POST',
                endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration',
                full_url=export_url,
                request_headers={'Authorization': '[REDACTED]'},
                request_body={'ShareType': share_type, **safe_params},
                response_body=_safe_json_parse(response),
                status_code=response.status_code,
                response_time_ms=response_time_ms,
                success=response.status_code in [200, 202],
                operation_type='idrac_api'
            )
            
            if response.status_code not in [200, 202]:
                raise Exception(f"{share_type} share export request failed: {response.status_code} - {response.text}")
            
            # Poll task until complete
            if response.status_code == 202:
                response_data = _safe_json_parse(response)
                task_uri = self._extract_task_uri(response.headers, response_data)
                
                if task_uri:
                    monitor_url = task_uri if task_uri.startswith('http') else f"https://{ip}{task_uri}"
                    self.log(f"    Polling task: {monitor_url}")
                    
                    # Poll for completion
                    timeout_seconds = 300
                    poll_interval = 5
                    start_poll = time.time()
                    
                    while time.time() - start_poll < timeout_seconds:
                        time.sleep(poll_interval)
                        
                        poll_response = requests.get(
                            monitor_url,
                            auth=(username, password),
                            verify=False,
                            timeout=30
                        )
                        
                        if poll_response.status_code == 200:
                            poll_data = _safe_json_parse(poll_response)
                            task_state = self._extract_task_state(poll_data)
                            
                            if self._is_task_success(task_state):
                                self.log(f"    ✓ SCP exported to {share_type} share successfully")
                                break
                            elif self._is_task_failure(task_state):
                                messages = self._extract_task_messages(poll_data)
                                error_msg = messages[0] if messages else f"Task failed with state {task_state}"
                                raise Exception(f"{share_type} share export failed: {error_msg}")
                    else:
                        raise Exception(f"{share_type} share export timed out after {timeout_seconds}s")
            
            # Now read the file from the network share
            # NOTE: This requires the Job Executor to have access to the share
            # For production, you may want to use smbclient library or mount the share
            self.log(f"    ⚠️  File exported to share but automatic retrieval not implemented yet")
            self.log(f"    File location: {share_type}://{share_ip}/{share_name}/{filename}")
            self.log(f"    Please manually retrieve the file and upload to database if needed")
            
            # Return a placeholder to indicate successful export to share
            return f"{{\"__share_export\": true, \"share_type\": \"{share_type}\", \"share_path\": \"{share_ip}/{share_name}/{filename}\"}}"
            
        except Exception as e:
            self.log(f"    SMB/NFS share export failed: {e}", "ERROR")
            raise Exception(f"Network share export failed: {str(e)}. Check Settings → Activity Monitor for share configuration.")

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
                        targets.append('IDRAC')
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
