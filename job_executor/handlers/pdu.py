"""
PDU (Power Distribution Unit) management handler for Schneider Electric/APC PDUs.

Supports:
- NMC (Network Management Card) web interface for outlet control
- SNMP v1/v2c for outlet control (no session limitations)
- Auto mode: tries NMC first, falls back to SNMP if session is blocked
"""

import re
import time
import urllib3
from enum import IntEnum
from typing import Dict, List, Optional, Any, Tuple

import requests

try:
    from pysnmp.hlapi import (
        setCmd, getCmd, nextCmd, SnmpEngine, CommunityData,
        UdpTransportTarget, ContextData, ObjectType, ObjectIdentity, Integer
    )
    SNMP_AVAILABLE = True
except ImportError:
    SNMP_AVAILABLE = False

from .base import BaseHandler

# Suppress InsecureRequestWarning for self-signed certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


# =============================================================================
# APC SNMP OIDs for PDU outlet control
# =============================================================================

# Switched Rack PDU (older models: AP7XXX, AP8XXX)
SPDU_OUTLET_CTL_OID = '1.3.6.1.4.1.318.1.1.4.4.2.1.3'  # sPDUOutletCtl
SPDU_OUTLET_STATE_OID = '1.3.6.1.4.1.318.1.1.4.4.2.1.4'  # sPDUOutletCtlOutletState

# Rack PDU2 (newer models)
RPDU2_OUTLET_CMD_OID = '1.3.6.1.4.1.318.1.1.12.3.3.1.1.4'  # rPDUOutletControlOutletCommand
RPDU2_OUTLET_STATE_OID = '1.3.6.1.4.1.318.1.1.12.3.5.1.1.4'  # rPDU2OutletSwitchedStatusOutletState


class SnmpOutletCommand(IntEnum):
    """APC SNMP outlet control commands"""
    IMMEDIATE_ON = 1
    IMMEDIATE_OFF = 2
    IMMEDIATE_REBOOT = 3
    DELAYED_ON = 4
    DELAYED_OFF = 5
    DELAYED_REBOOT = 6
    CANCEL_PENDING = 7


class SnmpOutletState(IntEnum):
    """APC SNMP outlet state values"""
    ON = 1
    OFF = 2


class OutletCommand(IntEnum):
    """APC outlet control commands via NMC web interface"""
    NO_ACTION = 1
    ON_IMMEDIATE = 2
    ON_DELAYED = 3
    OFF_IMMEDIATE = 4
    OFF_DELAYED = 5
    REBOOT_IMMEDIATE = 6
    REBOOT_DELAYED = 7
    CANCEL_PENDING = 8


class OutletState(IntEnum):
    """APC outlet state values"""
    OFF = 1
    ON = 2
    UNKNOWN = 0


class PDUHandler(BaseHandler):
    """
    Handler for PDU management operations using Schneider Electric/APC 
    Network Management Card (NMC) web interface or SNMP.
    
    Supported job types:
    - pdu_test_connection: Test connectivity and authentication
    - pdu_discover: Discover PDU model, firmware, and outlets
    - pdu_outlet_control: Control outlet power (on/off/reboot)
    - pdu_sync_status: Sync outlet status to database
    
    Protocol modes:
    - 'nmc': Use NMC web interface only
    - 'snmp': Use SNMP only (no session limitations)
    - 'auto': Try NMC first, fall back to SNMP if session is blocked
    """
    
    JOB_TYPES = ['pdu_test_connection', 'pdu_discover', 'pdu_outlet_control', 'pdu_sync_status']
    
    # Session conflict messages that trigger SNMP fallback
    SESSION_CONFLICT_PATTERNS = [
        'currently logged in',
        'session in use',
        'another user',
        'session active',
        'already logged in',
    ]
    
    def __init__(self, executor):
        super().__init__(executor)
        self._session = None
        self._session_token = None
        self._pdu_url = None
        self._request_timeout = 15
    
    def handle(self, job: Dict[str, Any]) -> Dict[str, Any]:
        """Route job to appropriate handler method"""
        job_type = job.get('job_type')
        details = job.get('details', {})
        
        if job_type == 'pdu_test_connection':
            return self._handle_test_connection(job, details)
        elif job_type == 'pdu_discover':
            return self._handle_discover(job, details)
        elif job_type == 'pdu_outlet_control':
            return self._handle_outlet_control(job, details)
        elif job_type == 'pdu_sync_status':
            return self._handle_sync_status(job, details)
        else:
            return {'success': False, 'error': f'Unknown job type: {job_type}'}
    
    def _is_session_conflict(self, message: str) -> bool:
        """Check if error message indicates a session conflict"""
        if not message:
            return False
        message_lower = message.lower()
        return any(pattern in message_lower for pattern in self.SESSION_CONFLICT_PATTERNS)
    
    def _clear_pdu_sessions_via_telnet(self, ip_address: str, username: str, password: str) -> Tuple[bool, str]:
        """
        Clear all active sessions on APC PDU via Telnet.
        Uses 'logoff -a' command to terminate all sessions.
        
        Returns:
            Tuple of (success, message)
        """
        import telnetlib
        
        try:
            self.log(f"Attempting to clear sessions via Telnet on {ip_address}")
            
            # Connect to PDU via Telnet (default port 23)
            tn = telnetlib.Telnet(ip_address, port=23, timeout=10)
            
            # Wait for login prompt and send username
            tn.read_until(b"User Name :", timeout=5)
            tn.write(username.encode('ascii') + b"\r\n")
            
            # Wait for password prompt and send password
            tn.read_until(b"Password  :", timeout=5)
            tn.write(password.encode('ascii') + b"\r\n")
            
            # Wait for command prompt (typically "apc>" or ">")
            # Read with timeout and check for successful login
            response = tn.read_until(b">", timeout=5)
            response_text = response.decode('ascii', errors='ignore').lower()
            
            if 'invalid' in response_text or 'failed' in response_text or 'denied' in response_text:
                tn.close()
                return False, "Telnet authentication failed"
            
            # Execute logoff command to clear all sessions
            self.log("Executing 'logoff -a' to clear all sessions")
            tn.write(b"logoff -a\r\n")
            
            # Read response and wait for prompt
            import time
            time.sleep(1)  # Give command time to execute
            response = tn.read_very_eager()
            self.log(f"Logoff response: {response.decode('ascii', errors='ignore')}")
            
            # Exit telnet session cleanly
            tn.write(b"exit\r\n")
            time.sleep(0.5)
            tn.close()
            
            self.log("Successfully cleared PDU sessions via Telnet")
            return True, "Sessions cleared successfully via Telnet"
            
        except ConnectionRefusedError:
            self.log("Telnet connection refused - port 23 may be disabled", "WARN")
            return False, "Telnet connection refused (port 23 disabled)"
        except TimeoutError:
            self.log("Telnet connection timed out", "WARN")
            return False, "Telnet connection timed out"
        except Exception as e:
            self.log(f"Telnet session clear failed: {e}", "WARN")
            return False, f"Telnet failed: {e}"
    
    # =========================================================================
    # Session Management
    # =========================================================================
    
    def _get_pdu_credentials(self, pdu_id: str) -> Optional[Dict[str, Any]]:
        """Fetch PDU credentials from database using REST API"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        
        # Store debug info for error reporting
        self._last_pdu_query_debug = {
            'url': None,
            'status_code': None,
            'response_body': None,
            'error': None
        }
        
        # Debug logging
        self.log(f"Fetching PDU {pdu_id} from {DSM_URL}/rest/v1/pdus")
        
        if not SERVICE_ROLE_KEY:
            self._last_pdu_query_debug['error'] = 'SERVICE_ROLE_KEY is not set'
            self.log("ERROR: SERVICE_ROLE_KEY is not set!", "ERROR")
            return None
        
        try:
            url = f"{DSM_URL}/rest/v1/pdus"
            params = {'id': f'eq.{pdu_id}', 'select': '*'}
            
            self._last_pdu_query_debug['url'] = f"{url}?id=eq.{pdu_id}"
            self.log(f"Making request to: {url} with params: {params}")
            
            response = requests.get(
                url,
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
                },
                params=params,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            self._last_pdu_query_debug['status_code'] = response.status_code
            self._last_pdu_query_debug['response_body'] = response.text[:500]  # First 500 chars
            
            self.log(f"Response status: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                self.log(f"PDU query returned {len(data)} records")
                if data and len(data) > 0:
                    pdu = data[0]
                    self.log(f"Found PDU: {pdu.get('name')} at {pdu.get('ip_address')}")
                    # Decrypt password if needed
                    if pdu.get('password_encrypted'):
                        pdu['password'] = self.executor.decrypt_password(pdu['password_encrypted'])
                    else:
                        pdu['password'] = 'apc'  # Default APC password
                    return pdu
                else:
                    self._last_pdu_query_debug['error'] = 'Query returned empty array (0 records)'
            else:
                self._last_pdu_query_debug['error'] = f'HTTP {response.status_code}: {response.text[:200]}'
                self.log(f"PDU query failed: {response.status_code} - {response.text}", "ERROR")
            
            return None
        except Exception as e:
            self._last_pdu_query_debug['error'] = str(e)
            self.log(f"Failed to fetch PDU credentials: {e}", "ERROR")
            import traceback
            self.log(f"Traceback: {traceback.format_exc()}", "ERROR")
            return None
    
    def _create_session(self) -> requests.Session:
        """Create a new requests session with common settings"""
        session = requests.Session()
        session.verify = False  # PDUs typically use self-signed certs
        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
        })
        return session
    
    def _determine_pdu_url(self, ip_address: str) -> str:
        """
        Determine the correct URL scheme (HTTPS or HTTP) for a PDU.
        Tries HTTPS first, falls back to HTTP if connection refused.
        """
        import socket
        
        # Try HTTPS first (port 443)
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2)
            result = sock.connect_ex((ip_address, 443))
            sock.close()
            if result == 0:
                self.log(f"PDU {ip_address} is reachable on HTTPS (port 443)")
                return f"https://{ip_address}"
        except Exception as e:
            self.log(f"HTTPS probe failed: {e}")
        
        # Try HTTP (port 80)
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2)
            result = sock.connect_ex((ip_address, 80))
            sock.close()
            if result == 0:
                self.log(f"PDU {ip_address} is reachable on HTTP (port 80)")
                return f"http://{ip_address}"
        except Exception as e:
            self.log(f"HTTP probe failed: {e}")
        
        # Default to HTTPS if neither works (will fail with meaningful error)
        self.log(f"Neither HTTP nor HTTPS reachable, defaulting to HTTPS", "WARN")
        return f"https://{ip_address}"
    
    def _login(self, pdu_url: str, username: str, password: str) -> Tuple[bool, str]:
        """
        Login to NMC web interface and get session token.
        
        Returns:
            Tuple of (success, message)
        """
        try:
            self._session = self._create_session()
            self._pdu_url = pdu_url.rstrip('/')
            
            # First, get the login page to establish session
            login_page_url = f"{self._pdu_url}/logon.htm"
            self.log(f"Accessing login page: {login_page_url}")
            
            try:
                response = self._session.get(login_page_url, timeout=self._request_timeout)
            except requests.exceptions.ConnectionError as e:
                return False, f"Connection failed: {e}"
            except requests.exceptions.Timeout:
                return False, "Connection timeout"
            
            if response.status_code != 200:
                return False, f"Login page returned status {response.status_code}"
            
            # Diagnostic: Log login page HTML structure
            self.log(f"Login page HTML snippet: {response.text[:500]}")
            
            # Try to detect the actual form action and field names
            form_action_match = re.search(r'<form[^>]*action=["\']([^"\']+)["\']', response.text, re.IGNORECASE)
            if form_action_match:
                detected_action = form_action_match.group(1)
                self.log(f"Detected form action: {detected_action}")
            else:
                detected_action = None
                self.log("No form action detected in login page")
            
            # Detect form field names
            username_field_match = re.search(r'<input[^>]*name=["\']([^"\']*user[^"\']*)["\']', response.text, re.IGNORECASE)
            password_field_match = re.search(r'<input[^>]*name=["\']([^"\']*pass[^"\']*)["\']', response.text, re.IGNORECASE)
            
            username_field = username_field_match.group(1) if username_field_match else 'login_username'
            password_field = password_field_match.group(1) if password_field_match else 'login_password'
            self.log(f"Detected form fields: username='{username_field}', password='{password_field}'")
            
            # Check for session conflict on the login page itself
            if self._is_session_conflict(response.text):
                return False, "Someone is currently logged into the APC Management Web Server"
            
            # Determine login URL - use detected action or default
            if detected_action:
                if detected_action.startswith('/'):
                    login_url = f"{self._pdu_url}{detected_action}"
                elif detected_action.startswith('http'):
                    login_url = detected_action
                else:
                    login_url = f"{self._pdu_url}/{detected_action}"
            else:
                login_url = f"{self._pdu_url}/Forms/login1"
            
            # Build payload with detected field names
            payload = {
                username_field: username,
                password_field: password,
                'submit': 'Log On'
            }
            headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': login_page_url
            }
            
            self.log(f"Submitting login to: {login_url} with fields: {list(payload.keys())}")
            response = self._session.post(
                login_url, 
                data=payload, 
                headers=headers,
                allow_redirects=True, 
                timeout=self._request_timeout
            )
            
            # Diagnostic: Log post-login response details
            self.log(f"Post-login URL: {response.url}")
            self.log(f"Post-login status: {response.status_code}")
            self.log(f"Post-login body snippet: {response.text[:300]}")
            
            if response.status_code != 200:
                return False, f"Login returned status {response.status_code}"
            
            # Check for session conflict in response
            if self._is_session_conflict(response.text):
                return False, "Someone is currently logged into the APC Management Web Server"
            
            # Extract session token from redirect URL
            # URL format: /NMC/{session_token}/home.htm
            final_url = response.url
            self.log(f"Redirected to: {final_url}")
            
            # Parse the session token from URL
            match = re.search(r'/NMC/([^/]+)/', final_url)
            if match:
                self._session_token = match.group(1)
                self.log(f"Session token acquired: {self._session_token[:8]}...")
                return True, "Login successful"
            
            # Alternative success detection: Look for logout/logoff links
            if 'logoff' in response.text.lower() or 'logout' in response.text.lower():
                self.log("Detected logout link - login appears successful")
                self._session_token = "no-token-required"
                return True, "Login successful (detected logout link)"
            
            # Alternative: Check if we landed on a home/status page (not login)
            if 'home.htm' in final_url.lower() or 'status' in final_url.lower():
                self.log("Landed on home/status page - login successful")
                self._session_token = "no-token-required"
                return True, "Login successful (redirected to home)"
            
            # Alternative: No login form in response means we're authenticated
            if 'logon.htm' not in response.text.lower() and '<input' not in response.text.lower():
                self.log("No login form in response - likely authenticated")
                self._session_token = "no-token-required"
                return True, "Login successful"
            
            # Check if we're still on the login page (bad credentials)
            if 'logon.htm' in final_url or 'login' in final_url.lower():
                # But also check if response contains error messages
                if 'invalid' in response.text.lower() or 'incorrect' in response.text.lower() or 'failed' in response.text.lower():
                    return False, "Invalid credentials (server reported authentication failure)"
                # Still on login page but no explicit error - could be redirect issue
                self.log("Still on login page but no explicit error - may need different auth flow")
                return False, "Login failed - still on login page"
            
            # Try to find session token in response content
            content_match = re.search(r'/NMC/([a-zA-Z0-9+/=]+)/', response.text)
            if content_match:
                self._session_token = content_match.group(1)
                self.log(f"Session token from content: {self._session_token[:8]}...")
                return True, "Login successful"
            
            return False, "Could not extract session token from response"
            
        except Exception as e:
            self.log(f"Login error: {e}", "ERROR")
            return False, f"Login error: {str(e)}"
    
    def _logout(self) -> None:
        """Logout from NMC session"""
        if self._session_token and self._pdu_url and self._session:
            try:
                logoff_url = f"{self._pdu_url}/NMC/{self._session_token}/logout.htm"
                self.log(f"Logging out: {logoff_url}")
                self._session.get(logoff_url, timeout=5)
            except Exception as e:
                self.log(f"Logout error (non-fatal): {e}", "WARN")
        
        self._session_token = None
        self._session = None
    
    def _update_pdu_status(self, pdu_id: str, status: str, last_seen: bool = False) -> None:
        """Update PDU connection status in database using REST API"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        
        try:
            update_data = {'connection_status': status}
            if last_seen:
                update_data['last_seen'] = 'now()'
            
            response = requests.patch(
                f"{DSM_URL}/rest/v1/pdus",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                params={'id': f'eq.{pdu_id}'},
                json=update_data,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.status_code not in [200, 204]:
                self.log(f"PDU status update returned {response.status_code}", "WARN")
        except Exception as e:
            self.log(f"Failed to update PDU status: {e}", "WARN")
    
    # =========================================================================
    # SNMP Operations
    # =========================================================================
    
    def _snmp_control_outlet(self, ip: str, community: str, outlet: int, 
                              command: SnmpOutletCommand) -> Tuple[bool, str]:
        """
        Control PDU outlet via SNMP - no session limitations.
        
        Tries both SPDU and RPDU2 OIDs for compatibility with different models.
        """
        if not SNMP_AVAILABLE:
            return False, "SNMP library (pysnmp) not available"
        
        self.log(f"SNMP control: outlet={outlet}, command={command.name}, ip={ip}")
        
        # Try primary OID first (sPDUOutletCtl for older models)
        oids_to_try = [
            (f'{SPDU_OUTLET_CTL_OID}.{outlet}', 'sPDUOutletCtl'),
            (f'{RPDU2_OUTLET_CMD_OID}.{outlet}', 'rPDUOutletControlOutletCommand'),
        ]
        
        last_error = None
        
        for oid, oid_name in oids_to_try:
            try:
                self.log(f"Trying SNMP SET with OID {oid_name}: {oid}")
                
                error_indication, error_status, error_index, var_binds = next(
                    setCmd(
                        SnmpEngine(),
                        CommunityData(community, mpModel=0),  # SNMP v1
                        UdpTransportTarget((ip, 161), timeout=5, retries=2),
                        ContextData(),
                        ObjectType(ObjectIdentity(oid), Integer(command.value))
                    )
                )
                
                if error_indication:
                    last_error = str(error_indication)
                    self.log(f"SNMP error indication ({oid_name}): {error_indication}", "WARN")
                    continue
                elif error_status:
                    last_error = f"SNMP error: {error_status.prettyPrint()} at {error_index}"
                    self.log(f"SNMP error status ({oid_name}): {last_error}", "WARN")
                    continue
                else:
                    self.log(f"SNMP command successful via {oid_name}")
                    return True, f"Outlet command sent via SNMP ({oid_name})"
                    
            except Exception as e:
                last_error = str(e)
                self.log(f"SNMP exception ({oid_name}): {e}", "WARN")
                continue
        
        return False, f"SNMP control failed: {last_error}"
    
    def _snmp_get_outlet_state(self, ip: str, community: str, outlet: int) -> Optional[str]:
        """Get single outlet state via SNMP"""
        if not SNMP_AVAILABLE:
            return None
        
        # Try both OID types
        oids_to_try = [
            f'{SPDU_OUTLET_STATE_OID}.{outlet}',
            f'{RPDU2_OUTLET_STATE_OID}.{outlet}',
        ]
        
        for oid in oids_to_try:
            try:
                error_indication, error_status, error_index, var_binds = next(
                    getCmd(
                        SnmpEngine(),
                        CommunityData(community, mpModel=0),
                        UdpTransportTarget((ip, 161), timeout=5, retries=2),
                        ContextData(),
                        ObjectType(ObjectIdentity(oid))
                    )
                )
                
                if error_indication or error_status:
                    continue
                
                for var_bind in var_binds:
                    value = int(var_bind[1])
                    if value == SnmpOutletState.ON:
                        return 'on'
                    elif value == SnmpOutletState.OFF:
                        return 'off'
                    
            except Exception:
                continue
        
        return None
    
    def _snmp_get_all_outlet_states(self, ip: str, community: str, 
                                     max_outlets: int = 24) -> Dict[int, str]:
        """Get all outlet states via SNMP walk"""
        if not SNMP_AVAILABLE:
            return {}
        
        outlet_states = {}
        
        # Try walking the outlet state OIDs
        base_oids = [SPDU_OUTLET_STATE_OID, RPDU2_OUTLET_STATE_OID]
        
        for base_oid in base_oids:
            try:
                for outlet_num in range(1, max_outlets + 1):
                    state = self._snmp_get_outlet_state(ip, community, outlet_num)
                    if state:
                        outlet_states[outlet_num] = state
                    else:
                        # If we get no response, assume we've reached the end
                        if outlet_num > 1 and not outlet_states:
                            break
                
                if outlet_states:
                    break
                    
            except Exception as e:
                self.log(f"SNMP walk error: {e}", "WARN")
                continue
        
        self.log(f"SNMP retrieved {len(outlet_states)} outlet states")
        return outlet_states
    
    def _snmp_test_connection(self, ip: str, community: str) -> Tuple[bool, str]:
        """Test SNMP connectivity by trying to read outlet 1 state"""
        if not SNMP_AVAILABLE:
            return False, "SNMP library (pysnmp) not available"
        
        state = self._snmp_get_outlet_state(ip, community, 1)
        if state:
            return True, f"SNMP connection successful (outlet 1 is {state})"
        else:
            return False, "SNMP connection failed - could not read outlet state"
    
    # =========================================================================
    # Job Handlers
    # =========================================================================
    
    def _handle_test_connection(self, job: Dict[str, Any], details: Dict[str, Any]) -> Dict[str, Any]:
        """Test PDU connectivity and authentication"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY
        
        pdu_id = details.get('pdu_id')
        
        if not pdu_id:
            return {'success': False, 'error': 'Missing pdu_id'}
        
        self.log(f"Testing connection to PDU: {pdu_id}")
        
        pdu = self._get_pdu_credentials(pdu_id)
        if not pdu:
            # Include diagnostic info in the error response
            return {
                'success': False, 
                'error': 'PDU not found',
                'debug': {
                    'pdu_id': pdu_id,
                    'dsm_url': DSM_URL,
                    'service_key_set': bool(SERVICE_ROLE_KEY),
                    'service_key_length': len(SERVICE_ROLE_KEY) if SERVICE_ROLE_KEY else 0,
                    'http_query': getattr(self, '_last_pdu_query_debug', {})
                }
            }
        
        protocol = pdu.get('protocol', 'auto')
        ip_address = pdu['ip_address']
        pdu_url = self._determine_pdu_url(ip_address)
        username = pdu.get('username', 'apc')
        password = pdu.get('password', 'apc')
        snmp_community = pdu.get('snmp_community', 'public')
        
        self.log(f"Protocol mode: {protocol}")
        
        # SNMP-only mode
        if protocol == 'snmp':
            success, message = self._snmp_test_connection(ip_address, snmp_community)
            status = 'online' if success else 'error'
            self._update_pdu_status(pdu_id, status, last_seen=success)
            return {
                'success': success,
                'message': message,
                'pdu_name': pdu.get('name'),
                'ip_address': ip_address,
                'protocol_used': 'snmp'
            }
        
        # NMC or Auto mode - try NMC first
        try:
            success, message = self._login(pdu_url, username, password)
            
            # If session conflict detected, try Telnet clear and retry
            if not success and self._is_session_conflict(message):
                self.log("Session conflict detected, attempting Telnet session clear", "WARN")
                clear_success, clear_msg = self._clear_pdu_sessions_via_telnet(ip_address, username, password)
                
                if clear_success:
                    self.log("Telnet clear successful, retrying NMC login")
                    import time
                    time.sleep(2)  # Give PDU time to release the session
                    success, message = self._login(pdu_url, username, password)
                else:
                    self.log(f"Telnet clear failed: {clear_msg}", "WARN")
            
            if success:
                self._update_pdu_status(pdu_id, 'online', last_seen=True)
                self._logout()
                return {
                    'success': True,
                    'message': 'Connection successful via NMC',
                    'pdu_name': pdu.get('name'),
                    'ip_address': ip_address,
                    'protocol_used': 'nmc'
                }
            
            # If auto mode and still session conflict after Telnet attempt, try SNMP fallback
            if protocol == 'auto' and self._is_session_conflict(message):
                self.log("NMC session still blocked after Telnet clear, trying SNMP fallback", "WARN")
                snmp_success, snmp_message = self._snmp_test_connection(ip_address, snmp_community)
                
                if snmp_success:
                    self._update_pdu_status(pdu_id, 'online', last_seen=True)
                    return {
                        'success': True,
                        'message': f'Connection successful via SNMP (NMC: {message})',
                        'pdu_name': pdu.get('name'),
                        'ip_address': ip_address,
                        'protocol_used': 'snmp',
                        'nmc_blocked': True
                    }
                else:
                    self._update_pdu_status(pdu_id, 'error')
                    return {
                        'success': False,
                        'error': f'NMC: {message}; SNMP: {snmp_message}',
                        'pdu_name': pdu.get('name'),
                        'ip_address': ip_address
                    }
            
            # NMC failed (not session conflict or nmc-only mode)
            self._update_pdu_status(pdu_id, 'error')
            return {
                'success': False,
                'error': message,
                'pdu_name': pdu.get('name'),
                'ip_address': ip_address
            }
            
        except Exception as e:
            self._update_pdu_status(pdu_id, 'offline')
            return {'success': False, 'error': str(e)}
        finally:
            self._logout()
    
    def _handle_discover(self, job: Dict[str, Any], details: Dict[str, Any]) -> Dict[str, Any]:
        """Discover PDU details - model, firmware, outlet count"""
        pdu_id = details.get('pdu_id')
        
        if not pdu_id:
            return {'success': False, 'error': 'Missing pdu_id'}
        
        self.log(f"Discovering PDU: {pdu_id}")
        
        pdu = self._get_pdu_credentials(pdu_id)
        if not pdu:
            return {'success': False, 'error': 'PDU not found'}
        
        protocol = pdu.get('protocol', 'auto')
        ip_address = pdu['ip_address']
        pdu_url = self._determine_pdu_url(ip_address)
        username = pdu.get('username', 'apc')
        password = pdu.get('password', 'apc')
        
        # Discovery requires NMC for detailed info
        # SNMP-only mode will have limited discovery
        if protocol == 'snmp':
            self.log("SNMP-only mode: limited discovery available")
            # Just verify SNMP works and count outlets
            snmp_community = pdu.get('snmp_community', 'public')
            outlet_states = self._snmp_get_all_outlet_states(ip_address, snmp_community)
            
            if outlet_states:
                total_outlets = max(outlet_states.keys())
                self._ensure_outlet_records(pdu_id, total_outlets)
                self._update_pdu_status(pdu_id, 'online', last_seen=True)
                
                return {
                    'success': True,
                    'discovered': {
                        'model': None,
                        'firmware_version': None,
                        'total_outlets': total_outlets,
                        'serial_number': None
                    },
                    'pdu_name': pdu.get('name'),
                    'protocol_used': 'snmp',
                    'note': 'Limited discovery via SNMP - use NMC for full details'
                }
            else:
                return {'success': False, 'error': 'SNMP discovery failed'}
        
        # NMC or Auto mode
        try:
            success, message = self._login(pdu_url, username, password)
            
            # If session conflict detected, try Telnet clear and retry
            if not success and self._is_session_conflict(message):
                self.log("Session conflict detected, attempting Telnet session clear", "WARN")
                clear_success, clear_msg = self._clear_pdu_sessions_via_telnet(ip_address, username, password)
                
                if clear_success:
                    self.log("Telnet clear successful, retrying NMC login")
                    import time
                    time.sleep(2)
                    success, message = self._login(pdu_url, username, password)
                else:
                    self.log(f"Telnet clear failed: {clear_msg}", "WARN")
            
            if not success:
                # Try SNMP fallback in auto mode
                if protocol == 'auto' and self._is_session_conflict(message):
                    self.log("NMC still blocked, trying SNMP for discovery", "WARN")
                    snmp_community = pdu.get('snmp_community', 'public')
                    outlet_states = self._snmp_get_all_outlet_states(ip_address, snmp_community)
                    
                    if outlet_states:
                        total_outlets = max(outlet_states.keys())
                        self._ensure_outlet_records(pdu_id, total_outlets)
                        self._update_pdu_status(pdu_id, 'online', last_seen=True)
                        
                        return {
                            'success': True,
                            'discovered': {
                                'model': None,
                                'firmware_version': None,
                                'total_outlets': total_outlets,
                                'serial_number': None
                            },
                            'pdu_name': pdu.get('name'),
                            'protocol_used': 'snmp',
                            'nmc_blocked': True
                        }
                
                self._update_pdu_status(pdu_id, 'error')
                return {'success': False, 'error': message}
            
            self._update_pdu_status(pdu_id, 'online', last_seen=True)
            
            # Get device info page
            info_url = f"{self._pdu_url}/NMC/{self._session_token}/about.htm"
            response = self._session.get(info_url, timeout=self._request_timeout)
            
            discovered = {
                'model': None,
                'firmware_version': None,
                'total_outlets': None,
                'serial_number': None
            }
            
            if response.status_code == 200:
                content = response.text
                
                # Parse model
                model_match = re.search(r'Model[:\s]+([A-Z0-9-]+)', content, re.IGNORECASE)
                if model_match:
                    discovered['model'] = model_match.group(1)
                
                # Parse firmware
                fw_match = re.search(r'Firmware[:\s]+v?([0-9.]+)', content, re.IGNORECASE)
                if fw_match:
                    discovered['firmware_version'] = fw_match.group(1)
                
                # Parse serial
                serial_match = re.search(r'Serial[:\s#]+([A-Z0-9]+)', content, re.IGNORECASE)
                if serial_match:
                    discovered['serial_number'] = serial_match.group(1)
            
            # Get outlet count from outlet control page
            outlet_url = f"{self._pdu_url}/NMC/{self._session_token}/outlctrl.htm"
            response = self._session.get(outlet_url, timeout=self._request_timeout)
            
            if response.status_code == 200:
                # Count outlet checkboxes or entries
                outlet_count = len(re.findall(r'outlet[_\s]*(\d+)', response.text, re.IGNORECASE))
                if outlet_count > 0:
                    discovered['total_outlets'] = outlet_count
                else:
                    # Default to 8 outlets if we can't detect
                    discovered['total_outlets'] = 8
            
            # Update PDU record with discovered info using REST API
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            update_data = {'last_sync': 'now()'}
            if discovered['model']:
                update_data['model'] = discovered['model']
            if discovered['firmware_version']:
                update_data['firmware_version'] = discovered['firmware_version']
            if discovered['total_outlets']:
                update_data['total_outlets'] = discovered['total_outlets']
            
            requests.patch(
                f"{DSM_URL}/rest/v1/pdus",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                params={'id': f'eq.{pdu_id}'},
                json=update_data,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            # Create outlet records if they don't exist
            if discovered['total_outlets']:
                self._ensure_outlet_records(pdu_id, discovered['total_outlets'])
            
            self._logout()
            
            return {
                'success': True,
                'discovered': discovered,
                'pdu_name': pdu.get('name'),
                'protocol_used': 'nmc'
            }
            
        except Exception as e:
            self.log(f"Discovery error: {e}", "ERROR")
            self._update_pdu_status(pdu_id, 'error')
            return {'success': False, 'error': str(e)}
        finally:
            self._logout()
    
    def _handle_outlet_control(self, job: Dict[str, Any], details: Dict[str, Any]) -> Dict[str, Any]:
        """Control PDU outlet - on/off/reboot"""
        pdu_id = details.get('pdu_id')
        outlet_numbers = details.get('outlet_numbers', [])
        action = details.get('action', 'status')  # on, off, reboot, status
        
        if not pdu_id:
            return {'success': False, 'error': 'Missing pdu_id'}
        
        if not outlet_numbers and action != 'status':
            return {'success': False, 'error': 'Missing outlet_numbers'}
        
        # Ensure outlet_numbers is a list
        if isinstance(outlet_numbers, int):
            outlet_numbers = [outlet_numbers]
        
        self.log(f"Outlet control: PDU={pdu_id}, outlets={outlet_numbers}, action={action}")
        
        pdu = self._get_pdu_credentials(pdu_id)
        if not pdu:
            return {'success': False, 'error': 'PDU not found'}
        
        protocol = pdu.get('protocol', 'auto')
        ip_address = pdu['ip_address']
        pdu_url = self._determine_pdu_url(ip_address)
        username = pdu.get('username', 'apc')
        password = pdu.get('password', 'apc')
        snmp_read_community = pdu.get('snmp_community', 'public')
        snmp_write_community = pdu.get('snmp_write_community', pdu.get('snmp_community', 'private'))
        
        # Map action to SNMP command
        snmp_command_map = {
            'on': SnmpOutletCommand.IMMEDIATE_ON,
            'off': SnmpOutletCommand.IMMEDIATE_OFF,
            'reboot': SnmpOutletCommand.IMMEDIATE_REBOOT,
        }
        
        # Map action to NMC command
        nmc_command_map = {
            'on': OutletCommand.ON_IMMEDIATE,
            'off': OutletCommand.OFF_IMMEDIATE,
            'reboot': OutletCommand.REBOOT_IMMEDIATE,
            'on_delayed': OutletCommand.ON_DELAYED,
            'off_delayed': OutletCommand.OFF_DELAYED,
            'reboot_delayed': OutletCommand.REBOOT_DELAYED,
        }
        
        # SNMP-only mode
        if protocol == 'snmp':
            if action == 'status':
                outlet_states = self._snmp_get_all_outlet_states(ip_address, snmp_read_community)
                for outlet_num, state in outlet_states.items():
                    self._update_outlet_state(pdu_id, outlet_num, state)
                return {
                    'success': True,
                    'action': 'status',
                    'outlet_states': outlet_states,
                    'protocol_used': 'snmp'
                }
            
            snmp_command = snmp_command_map.get(action)
            if not snmp_command:
                return {'success': False, 'error': f'Invalid action: {action}'}
            
            # Control each outlet
            results = []
            all_success = True
            for outlet in outlet_numbers:
                success, message = self._snmp_control_outlet(ip_address, snmp_write_community, outlet, snmp_command)
                results.append({'outlet': outlet, 'success': success, 'message': message})
                if not success:
                    all_success = False
            
            if all_success:
                self._update_pdu_status(pdu_id, 'online', last_seen=True)
                # Update outlet states
                new_state = 'on' if action == 'on' else ('off' if action == 'off' else 'unknown')
                if action != 'reboot':
                    for outlet_num in outlet_numbers:
                        self._update_outlet_state(pdu_id, outlet_num, new_state)
            
            return {
                'success': all_success,
                'action': action,
                'outlet_numbers': outlet_numbers,
                'results': results,
                'protocol_used': 'snmp'
            }
        
        # NMC or Auto mode - try NMC first
        try:
            success, message = self._login(pdu_url, username, password)
            
            # If session conflict detected, try Telnet clear and retry
            if not success and self._is_session_conflict(message):
                self.log("Session conflict detected, attempting Telnet session clear", "WARN")
                clear_success, clear_msg = self._clear_pdu_sessions_via_telnet(ip_address, username, password)
                
                if clear_success:
                    self.log("Telnet clear successful, retrying NMC login")
                    import time
                    time.sleep(2)
                    success, message = self._login(pdu_url, username, password)
                else:
                    self.log(f"Telnet clear failed: {clear_msg}", "WARN")
            
            if not success:
                # Try SNMP fallback in auto mode for control operations
                if protocol == 'auto' and self._is_session_conflict(message):
                    self.log("NMC still blocked, using SNMP for outlet control", "WARN")
                    
                    if action == 'status':
                        outlet_states = self._snmp_get_all_outlet_states(ip_address, snmp_read_community)
                        for outlet_num, state in outlet_states.items():
                            self._update_outlet_state(pdu_id, outlet_num, state)
                        return {
                            'success': True,
                            'action': 'status',
                            'outlet_states': outlet_states,
                            'protocol_used': 'snmp',
                            'nmc_blocked': True
                        }
                    
                    snmp_command = snmp_command_map.get(action)
                    if snmp_command:
                        results = []
                        all_success = True
                        for outlet in outlet_numbers:
                            snmp_success, snmp_msg = self._snmp_control_outlet(
                                ip_address, snmp_write_community, outlet, snmp_command
                            )
                            results.append({'outlet': outlet, 'success': snmp_success, 'message': snmp_msg})
                            if not snmp_success:
                                all_success = False
                        
                        if all_success:
                            self._update_pdu_status(pdu_id, 'online', last_seen=True)
                            new_state = 'on' if action == 'on' else ('off' if action == 'off' else 'unknown')
                            if action != 'reboot':
                                for outlet_num in outlet_numbers:
                                    self._update_outlet_state(pdu_id, outlet_num, new_state)
                        
                        return {
                            'success': all_success,
                            'action': action,
                            'outlet_numbers': outlet_numbers,
                            'results': results,
                            'protocol_used': 'snmp',
                            'nmc_blocked': True
                        }
                
                self._update_pdu_status(pdu_id, 'error')
                return {'success': False, 'error': message}
            
            self._update_pdu_status(pdu_id, 'online', last_seen=True)
            
            if action == 'status':
                # Just get status, don't send command
                outlet_states = self._get_outlet_states()
                self._logout()
                return {
                    'success': True,
                    'action': 'status',
                    'outlet_states': outlet_states,
                    'protocol_used': 'nmc'
                }
            
            command = nmc_command_map.get(action)
            if not command:
                return {'success': False, 'error': f'Invalid action: {action}'}
            
            # Send outlet control command
            success, ctrl_message = self._control_outlet(outlet_numbers, command)
            
            if success:
                # Update outlet states in database
                new_state = 'on' if action in ['on', 'on_delayed'] else ('off' if action in ['off', 'off_delayed'] else 'unknown')
                if action not in ['reboot', 'reboot_delayed']:
                    for outlet_num in outlet_numbers:
                        self._update_outlet_state(pdu_id, outlet_num, new_state)
            
            self._logout()
            
            return {
                'success': success,
                'action': action,
                'outlet_numbers': outlet_numbers,
                'message': ctrl_message,
                'protocol_used': 'nmc'
            }
            
        except Exception as e:
            self.log(f"Outlet control error: {e}", "ERROR")
            return {'success': False, 'error': str(e)}
        finally:
            self._logout()
    
    def _handle_sync_status(self, job: Dict[str, Any], details: Dict[str, Any]) -> Dict[str, Any]:
        """Sync all outlet states from PDU to database"""
        pdu_id = details.get('pdu_id')
        
        if not pdu_id:
            return {'success': False, 'error': 'Missing pdu_id'}
        
        self.log(f"Syncing status for PDU: {pdu_id}")
        
        pdu = self._get_pdu_credentials(pdu_id)
        if not pdu:
            return {'success': False, 'error': 'PDU not found'}
        
        protocol = pdu.get('protocol', 'auto')
        ip_address = pdu['ip_address']
        pdu_url = self._determine_pdu_url(ip_address)
        username = pdu.get('username', 'apc')
        password = pdu.get('password', 'apc')
        snmp_community = pdu.get('snmp_community', 'public')
        
        # SNMP-only mode
        if protocol == 'snmp':
            outlet_states = self._snmp_get_all_outlet_states(ip_address, snmp_community)
            
            if outlet_states:
                for outlet_num, state in outlet_states.items():
                    self._update_outlet_state(pdu_id, outlet_num, state)
                
                # Update last_sync using REST API
                from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
                requests.patch(
                    f"{DSM_URL}/rest/v1/pdus",
                    headers={
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                    },
                    params={'id': f'eq.{pdu_id}'},
                    json={'last_sync': 'now()'},
                    verify=VERIFY_SSL,
                    timeout=10
                )
                
                self._update_pdu_status(pdu_id, 'online', last_seen=True)
                
                return {
                    'success': True,
                    'outlet_states': outlet_states,
                    'outlets_synced': len(outlet_states),
                    'protocol_used': 'snmp'
                }
            else:
                return {'success': False, 'error': 'SNMP sync failed'}
        
        # NMC or Auto mode
        try:
            success, message = self._login(pdu_url, username, password)
            
            # If session conflict detected, try Telnet clear and retry
            if not success and self._is_session_conflict(message):
                self.log("Session conflict detected, attempting Telnet session clear", "WARN")
                clear_success, clear_msg = self._clear_pdu_sessions_via_telnet(ip_address, username, password)
                
                if clear_success:
                    self.log("Telnet clear successful, retrying NMC login")
                    import time
                    time.sleep(2)
                    success, message = self._login(pdu_url, username, password)
                else:
                    self.log(f"Telnet clear failed: {clear_msg}", "WARN")
            
            if not success:
                # Try SNMP fallback in auto mode
                if protocol == 'auto' and self._is_session_conflict(message):
                    self.log("NMC still blocked, using SNMP for sync", "WARN")
                    outlet_states = self._snmp_get_all_outlet_states(ip_address, snmp_community)
                    
                    if outlet_states:
                        for outlet_num, state in outlet_states.items():
                            self._update_outlet_state(pdu_id, outlet_num, state)
                        
                        # Update last_sync using REST API
                        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
                        requests.patch(
                            f"{DSM_URL}/rest/v1/pdus",
                            headers={
                                'apikey': SERVICE_ROLE_KEY,
                                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                'Content-Type': 'application/json',
                                'Prefer': 'return=minimal'
                            },
                            params={'id': f'eq.{pdu_id}'},
                            json={'last_sync': 'now()'},
                            verify=VERIFY_SSL,
                            timeout=10
                        )
                        
                        self._update_pdu_status(pdu_id, 'online', last_seen=True)
                        
                        return {
                            'success': True,
                            'outlet_states': outlet_states,
                            'outlets_synced': len(outlet_states),
                            'protocol_used': 'snmp',
                            'nmc_blocked': True
                        }
                
                self._update_pdu_status(pdu_id, 'error')
                return {'success': False, 'error': message}
            
            self._update_pdu_status(pdu_id, 'online', last_seen=True)
            
            # Get outlet states
            outlet_states = self._get_outlet_states()
            
            # Update database
            for outlet_num, state in outlet_states.items():
                self._update_outlet_state(pdu_id, outlet_num, state)
            
            # Update PDU last_sync using REST API
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            requests.patch(
                f"{DSM_URL}/rest/v1/pdus",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                params={'id': f'eq.{pdu_id}'},
                json={'last_sync': 'now()'},
                verify=VERIFY_SSL,
                timeout=10
            )
            
            self._logout()
            
            return {
                'success': True,
                'outlet_states': outlet_states,
                'outlets_synced': len(outlet_states),
                'protocol_used': 'nmc'
            }
            
        except Exception as e:
            self.log(f"Sync error: {e}", "ERROR")
            return {'success': False, 'error': str(e)}
        finally:
            self._logout()
    
    # =========================================================================
    # NMC Web Interface Operations
    # =========================================================================
    
    def _control_outlet(self, outlet_numbers: List[int], command: OutletCommand) -> Tuple[bool, str]:
        """
        Send outlet control command via NMC web interface.
        
        The NMC interface uses a form-based control system:
        1. POST to outlctrl1 with outlet selection and command
        2. Confirm action on rpduconf1
        """
        if not self._session_token or not self._session:
            return False, "Not logged in"
        
        try:
            # Step 1: Submit outlet control form
            ctrl_url = f"{self._pdu_url}/NMC/{self._session_token}/Forms/outlctrl1"
            headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': f'{self._pdu_url}/NMC/{self._session_token}/outlctrl.htm'
            }
            
            # Build form data
            form_data = f'rPDUOutletCtrl={command.value}'
            
            # Add outlet selections
            # Format depends on PDU model - trying common formats
            for outlet in outlet_numbers:
                # Format for newer PDUs (AP8XXX)
                if outlet <= 8:
                    form_data += f'&OL_Cntrl_Col1_Btn=%3F{outlet}%2C2'
                else:
                    form_data += f'&OL_Cntrl_Col2_Btn=%3F{outlet - 8}%2C2'
            
            form_data += '&submit=Next+>>'
            
            self.log(f"Sending control command to: {ctrl_url}")
            response = self._session.post(
                ctrl_url,
                data=form_data,
                headers=headers,
                timeout=self._request_timeout
            )
            
            if response.status_code != 200:
                return False, f"Control request failed with status {response.status_code}"
            
            # Step 2: Confirm the action
            confirm_url = f"{self._pdu_url}/NMC/{self._session_token}/Forms/rpduconf1"
            confirm_headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': f'{self._pdu_url}/NMC/{self._session_token}/rpduconf.htm'
            }
            confirm_data = 'submit=Apply'
            
            self.log(f"Confirming action: {confirm_url}")
            confirm_response = self._session.post(
                confirm_url,
                data=confirm_data,
                headers=confirm_headers,
                timeout=self._request_timeout
            )
            
            if confirm_response.status_code == 200:
                self.log("Outlet control command confirmed")
                return True, "Command executed successfully"
            else:
                return False, f"Confirmation failed with status {confirm_response.status_code}"
            
        except Exception as e:
            self.log(f"Control error: {e}", "ERROR")
            return False, str(e)
    
    def _get_outlet_states(self) -> Dict[int, str]:
        """
        Get current outlet states from NMC web interface.
        
        Returns dict of outlet_number -> state ('on', 'off', 'unknown')
        """
        if not self._session_token or not self._session:
            return {}
        
        try:
            status_url = f"{self._pdu_url}/NMC/{self._session_token}/outlctrl.htm"
            response = self._session.get(status_url, timeout=self._request_timeout)
            
            if response.status_code != 200:
                return {}
            
            content = response.text
            outlet_states = {}
            
            # Parse outlet states from the page
            # Look for patterns like "Outlet 1: On" or status indicators
            
            # Pattern 1: Table-based status
            # <td>Outlet 1</td><td>On</td>
            table_pattern = r'Outlet\s*(\d+)[^<]*</td>\s*<td[^>]*>([^<]+)</td>'
            matches = re.findall(table_pattern, content, re.IGNORECASE)
            
            for match in matches:
                outlet_num = int(match[0])
                state_text = match[1].strip().lower()
                if 'on' in state_text:
                    outlet_states[outlet_num] = 'on'
                elif 'off' in state_text:
                    outlet_states[outlet_num] = 'off'
                else:
                    outlet_states[outlet_num] = 'unknown'
            
            # Pattern 2: JavaScript-based status
            # outletState[1] = "On"
            js_pattern = r'outletState\[(\d+)\]\s*=\s*["\']([^"\']+)["\']'
            js_matches = re.findall(js_pattern, content, re.IGNORECASE)
            
            for match in js_matches:
                outlet_num = int(match[0])
                state_text = match[1].strip().lower()
                if 'on' in state_text:
                    outlet_states[outlet_num] = 'on'
                elif 'off' in state_text:
                    outlet_states[outlet_num] = 'off'
                else:
                    outlet_states[outlet_num] = 'unknown'
            
            # Pattern 3: CSS class-based status
            # <span class="outletOn">Outlet 1</span>
            on_pattern = r'class="[^"]*outletOn[^"]*"[^>]*>.*?Outlet\s*(\d+)'
            off_pattern = r'class="[^"]*outletOff[^"]*"[^>]*>.*?Outlet\s*(\d+)'
            
            for match in re.findall(on_pattern, content, re.IGNORECASE):
                outlet_states[int(match)] = 'on'
            for match in re.findall(off_pattern, content, re.IGNORECASE):
                outlet_states[int(match)] = 'off'
            
            self.log(f"Parsed outlet states: {outlet_states}")
            return outlet_states
            
        except Exception as e:
            self.log(f"Error getting outlet states: {e}", "ERROR")
            return {}
    
    # =========================================================================
    # Database Operations
    # =========================================================================
    
    def _ensure_outlet_records(self, pdu_id: str, outlet_count: int) -> None:
        """Ensure outlet records exist in database for all outlets using REST API"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        
        try:
            for outlet_num in range(1, outlet_count + 1):
                # Upsert outlet record using REST API
                response = requests.post(
                    f"{DSM_URL}/rest/v1/pdu_outlets",
                    headers={
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates,return=minimal'
                    },
                    params={'on_conflict': 'pdu_id,outlet_number'},
                    json={
                        'pdu_id': pdu_id,
                        'outlet_number': outlet_num,
                        'outlet_name': f'Outlet {outlet_num}',
                        'outlet_state': 'unknown'
                    },
                    verify=VERIFY_SSL,
                    timeout=10
                )
                
                if response.status_code not in [200, 201, 204]:
                    self.log(f"Outlet {outlet_num} upsert returned {response.status_code}", "WARN")
        except Exception as e:
            self.log(f"Error creating outlet records: {e}", "WARN")
    
    def _update_outlet_state(self, pdu_id: str, outlet_number: int, state: str) -> None:
        """Update single outlet state in database using REST API"""
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        
        try:
            outlet_data = {
                'pdu_id': pdu_id,
                'outlet_number': outlet_number,
                'outlet_state': state,
                'last_updated': 'now()'
            }
            if state != 'unknown':
                outlet_data['last_state_change'] = 'now()'
            
            response = requests.post(
                f"{DSM_URL}/rest/v1/pdu_outlets",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates,return=minimal'
                },
                params={'on_conflict': 'pdu_id,outlet_number'},
                json=outlet_data,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            if response.status_code not in [200, 201, 204]:
                self.log(f"Outlet state update returned {response.status_code}", "WARN")
        except Exception as e:
            self.log(f"Error updating outlet state: {e}", "WARN")
