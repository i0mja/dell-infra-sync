import ssl
import time
from datetime import datetime, timezone
from typing import Dict

import requests

from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL, VCENTER_HOST, VCENTER_PASSWORD, VCENTER_USER
from job_executor.utils import _safe_json_parse, utc_now_iso


class ConnectivityMixin:
    def test_dns_resolution(self, hostname: str) -> dict:
        """Test DNS resolution for vCenter hostname."""
        import socket
        try:
            start = time.time()
            ip_addresses = socket.getaddrinfo(hostname, None)
            elapsed = (time.time() - start) * 1000
            return {
                'success': True,
                'resolved_ips': [addr[4][0] for addr in ip_addresses],
                'response_time_ms': round(elapsed, 2),
                'message': f'Resolved to {len(ip_addresses)} address(es)'
            }
        except socket.gaierror as e:
            return {
                'success': False,
                'error': str(e),
                'message': 'DNS resolution failed - check hostname or DNS server'
            }

    def test_port_connectivity(self, host: str, port: int, timeout: int = 5) -> dict:
        """Test TCP connectivity to vCenter port."""
        import socket
        try:
            start = time.time()
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            result = sock.connect_ex((host, port))
            elapsed = (time.time() - start) * 1000
            sock.close()

            if result == 0:
                return {
                    'success': True,
                    'response_time_ms': round(elapsed, 2),
                    'message': f'Port {port} is accessible'
                }
            else:
                return {
                    'success': False,
                    'error_code': result,
                    'message': f'Port {port} is not accessible - check firewall rules'
                }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': 'Network connectivity failed'
            }

    def test_ssl_certificate(self, host: str, port: int, verify_ssl: bool) -> dict:
        """Test SSL certificate validity."""
        import socket
        from datetime import datetime as dt
        try:
            start = time.time()
            context = ssl.create_default_context()
            if not verify_ssl:
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE

            with socket.create_connection((host, port), timeout=5) as sock:
                with context.wrap_socket(sock, server_hostname=host if verify_ssl else None) as ssock:
                    cert = ssock.getpeercert()
                    elapsed = (time.time() - start) * 1000

                    not_after = cert.get('notAfter')
                    expiry_date = dt.strptime(not_after, "%b %d %H:%M:%S %Y %Z") if not_after else None

                    return {
                        'success': True,
                        'response_time_ms': round(elapsed, 2),
                        'issuer': dict(x[0] for x in cert.get('issuer', [])),
                        'subject': dict(x[0] for x in cert.get('subject', [])),
                        'not_before': cert.get('notBefore'),
                        'not_after': not_after,
                        'days_until_expiry': (expiry_date - dt.now()).days if expiry_date else None,
                        'message': 'Certificate is valid'
                    }
        except ssl.SSLError as e:
            return {
                'success': False,
                'error': str(e),
                'message': 'SSL verification failed - check certificate trust'
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': 'SSL connection failed'
            }

    def test_vcenter_authentication(self, settings: dict) -> dict:
        """Attempt to authenticate to vCenter using provided settings."""
        try:
            self.log("Testing vCenter authentication...")

            if not settings.get('host'):
                return {'success': False, 'message': 'vCenter host not configured'}

            session_url = f"https://{settings['host']}/rest/com/vmware/cis/session"

            start_time = time.time()
            response = requests.post(
                session_url,
                auth=(settings.get('username', ''), settings.get('password', '')),
                verify=settings.get('verify_ssl', True),
                timeout=10
            )
            elapsed_ms = int((time.time() - start_time) * 1000)

            return {
                'success': response.status_code == 200,
                'status_code': response.status_code,
                'response_time_ms': elapsed_ms,
                'message': 'Authentication successful' if response.status_code == 200 else response.text
            }
        except Exception as e:
            return {'success': False, 'message': str(e)}

    def test_vcenter_api_functionality(self, settings: dict) -> dict:
        """Test basic vCenter API functionality."""
        try:
            self.log("Testing vCenter API functionality...")

            session_url = f"https://{settings['host']}/rest/com/vmware/cis/session"
            session_response = requests.post(
                session_url,
                auth=(settings.get('username', ''), settings.get('password', '')),
                verify=settings.get('verify_ssl', True),
                timeout=10
            )

            if session_response.status_code != 200:
                return {
                    'success': False,
                    'message': f"Failed to create session: {session_response.text}",
                    'status_code': session_response.status_code
                }

            session_data = _safe_json_parse(session_response)
            session_id = session_data.get('value') if isinstance(session_data, dict) else None

            if not session_id:
                return {'success': False, 'message': 'Could not retrieve session ID'}

            headers = {'vmware-api-session-id': session_id}
            hosts_url = f"https://{settings['host']}/rest/vcenter/host"
            hosts_response = requests.get(hosts_url, headers=headers, verify=settings.get('verify_ssl', True), timeout=10)

            success = hosts_response.status_code == 200
            host_count = len(_safe_json_parse(hosts_response).get('value', [])) if success else 0

            return {
                'success': success,
                'status_code': hosts_response.status_code,
                'host_count': host_count,
                'message': f"Retrieved {host_count} hosts" if success else hosts_response.text
            }
        except Exception as e:
            return {'success': False, 'message': str(e)}

    def log_vcenter_activity(self, operation: str, endpoint: str, success: bool,
                             status_code: int = None, response_time_ms: int = None,
                             error: str = None, details: dict = None):
        """Log vCenter activity to activity monitor."""
        try:
            payload = {
                'operation': operation,
                'endpoint': endpoint,
                'success': success,
                'status_code': status_code,
                'response_time_ms': response_time_ms,
                'error': error,
                'details': details,
                'source': 'job_executor',
                'timestamp': utc_now_iso()
            }

            headers = {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }

            response = requests.post(
                f"{DSM_URL}/rest/v1/vcenter_activity_log",
                headers=headers,
                json=payload,
                verify=VERIFY_SSL,
                timeout=10
            )

            if response.status_code not in [200, 201, 204]:
                self.log(f"Failed to log vCenter activity: {response.status_code} - {response.text}", "WARN")
        except Exception as e:
            self.log(f"Error logging vCenter activity: {e}", "WARN")

    def execute_vcenter_connectivity_test(self, job: Dict):
        """Run connectivity tests for vCenter and record the results."""
        try:
            self.log(f"Starting vCenter connectivity test job: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=utc_now_iso())

            details = job.get('details', {})
            settings = {
                'host': details.get('host', VCENTER_HOST),
                'username': details.get('username', VCENTER_USER),
                'password': details.get('password', VCENTER_PASSWORD),
                'verify_ssl': details.get('verify_ssl', True)
            }

            results = {
                'dns': self.test_dns_resolution(settings['host']),
                'ports': {
                    '443': self.test_port_connectivity(settings['host'], 443),
                    '902': self.test_port_connectivity(settings['host'], 902)
                },
                'ssl': self.test_ssl_certificate(settings['host'], 443, settings['verify_ssl']),
                'authentication': self.test_vcenter_authentication(settings),
                'api': self.test_vcenter_api_functionality(settings)
            }

            # Log each test result
            for test_name, result in results.items():
                if isinstance(result, dict):
                    self.log_vcenter_activity(
                        operation=f"connectivity_test_{test_name}",
                        endpoint=settings['host'],
                        success=result.get('success', False),
                        status_code=result.get('status_code'),
                        response_time_ms=result.get('response_time_ms'),
                        error=result.get('error'),
                        details=result
                    )

            overall_success = all(
                isinstance(r, dict) and r.get('success', False)
                for r in [results['dns'], results['ssl'], results['authentication'], results['api']]
            )

            status = 'completed' if overall_success else 'failed'

            self.update_job_status(
                job['id'],
                status,
                completed_at=utc_now_iso(),
                details={
                    'results': results,
                    'summary': f"Connectivity tests {'passed' if overall_success else 'failed'}"
                }
            )

        except Exception as e:
            self.log(f"vCenter connectivity test failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=utc_now_iso(),
                details={'error': str(e)}
            )
