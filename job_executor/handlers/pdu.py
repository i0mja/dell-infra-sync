"""
PDU (Power Distribution Unit) management handler for Schneider Electric/APC PDUs.

Supports:
- NMC (Network Management Card) web interface for outlet control
- SNMP v1/v2c for outlet control (no session limitations)
- Auto mode: tries NMC first, falls back to SNMP if session is blocked
"""

import re
import time
import asyncio
import urllib3
from enum import IntEnum
from typing import Dict, List, Optional, Any, Tuple

import requests

import sys
import subprocess

# =============================================================================
# pysnmp version-aware import (supports both v4-6 classic API and v7+ async API)
# =============================================================================
SNMP_AVAILABLE = False
PYSNMP_VERSION = None
PYSNMP_V7_PLUS = False

# v7+ async function references (set by _import_pysnmp_v7)
get_cmd_async = None
set_cmd_async = None
bulk_cmd_async = None
SnmpDispatcher = None
Integer = None

def _import_pysnmp_classic():
    """Import pysnmp using the classic API (v4.x/5.x/6.x)"""
    global SNMP_AVAILABLE, setCmd, getCmd, nextCmd, SnmpEngine, CommunityData
    global UdpTransportTarget, ContextData, ObjectType, ObjectIdentity, Integer
    
    from pysnmp.hlapi import (
        setCmd, getCmd, nextCmd, SnmpEngine, CommunityData,
        UdpTransportTarget, ContextData, ObjectType, ObjectIdentity, Integer
    )
    SNMP_AVAILABLE = True
    print(f"pysnmp {PYSNMP_VERSION} (classic API) loaded successfully")

def _import_pysnmp_v7():
    """Import pysnmp using the v7+ asyncio API (pysnmp-lextudio)"""
    global SNMP_AVAILABLE, PYSNMP_V7_PLUS
    global get_cmd_async, set_cmd_async, bulk_cmd_async
    global SnmpDispatcher, CommunityData, UdpTransportTarget
    global ObjectType, ObjectIdentity, Integer
    
    # v7+ uses v1arch.asyncio path with async functions
    from pysnmp.hlapi.v1arch.asyncio import (
        SnmpDispatcher,
        CommunityData,
        UdpTransportTarget,
        ObjectType,
        ObjectIdentity,
        get_cmd as get_cmd_async,
        set_cmd as set_cmd_async,
        bulk_cmd as bulk_cmd_async,
    )
    from pysnmp.proto.rfc1902 import Integer32 as Integer
    
    SNMP_AVAILABLE = True
    PYSNMP_V7_PLUS = True
    print(f"pysnmp {PYSNMP_VERSION} (v7+ asyncio API) loaded successfully")

# =============================================================================
# Async-to-Sync SNMP wrappers for pysnmp v7+ (asyncio-only API)
# =============================================================================

def _run_snmp_get_v7(ip: str, port: int, community: str, oid: str,
                      timeout: int = 10, retries: int = 2):
    """Synchronous wrapper for pysnmp v7+ async get_cmd"""
    async def _do_get():
        async with SnmpDispatcher() as snmpDispatcher:
            return await get_cmd_async(
                snmpDispatcher,
                CommunityData(community),
                await UdpTransportTarget.create((ip, port), timeout=timeout, retries=retries),
                ObjectType(ObjectIdentity(oid))
            )
    return asyncio.run(_do_get())

def _run_snmp_set_v7(ip: str, port: int, community: str, oid: str,
                      value: int, timeout: int = 5, retries: int = 2):
    """Synchronous wrapper for pysnmp v7+ async set_cmd"""
    async def _do_set():
        async with SnmpDispatcher() as snmpDispatcher:
            return await set_cmd_async(
                snmpDispatcher,
                CommunityData(community),
                await UdpTransportTarget.create((ip, port), timeout=timeout, retries=retries),
                ObjectType(ObjectIdentity(oid), Integer(value))
            )
    return asyncio.run(_do_set())

def _run_snmp_walk_v7(ip: str, port: int, community: str, base_oid: str,
                       timeout: int = 10, retries: int = 2) -> list:
    """Synchronous wrapper for pysnmp v7+ async bulk walk"""
    async def _do_walk():
        results = []
        async with SnmpDispatcher() as snmpDispatcher:
            transport = await UdpTransportTarget.create((ip, port), timeout=timeout, retries=retries)
            current_oid = base_oid
            while True:
                error_indication, error_status, error_index, var_binds = await bulk_cmd_async(
                    snmpDispatcher,
                    CommunityData(community),
                    transport,
                    0, 25,  # nonRepeaters, maxRepetitions
                    ObjectType(ObjectIdentity(current_oid)),
                )
                if error_indication or error_status:
                    break
                if not var_binds:
                    break
                for var_bind in var_binds:
                    oid_str = str(var_bind[0])
                    if not oid_str.startswith(base_oid):
                        return results  # Left the subtree
                    results.append(var_bind)
                    current_oid = oid_str  # Continue from last OID
        return results
    return asyncio.run(_do_walk())

# Try to import pysnmp with version detection and fallback between API styles
try:
    import pysnmp
    PYSNMP_VERSION = getattr(pysnmp, '__version__', '0.0.0')
    major_version = int(PYSNMP_VERSION.split('.')[0])
    
    if major_version >= 7:
        # v7+ - try v7 async API first, fallback to classic
        try:
            _import_pysnmp_v7()
        except Exception as v7_err:
            print(f"v7 asyncio API import failed: {v7_err}, trying classic API...")
            try:
                _import_pysnmp_classic()
            except Exception as classic_err:
                print(f"Classic API also failed: {classic_err}")
                SNMP_AVAILABLE = False
    else:
        # Version 6.x or lower - try classic first, then v7
        try:
            _import_pysnmp_classic()
        except Exception as classic_err:
            print(f"Classic API import failed: {classic_err}, trying v7 asyncio API...")
            try:
                _import_pysnmp_v7()
            except Exception as v7_err:
                print(f"v7 asyncio API also failed: {v7_err}")
                SNMP_AVAILABLE = False
                
except ImportError as initial_error:
    # pysnmp not installed at all - attempt auto-installation
    print(f"pysnmp import failed: {initial_error}")
    print("Attempting to install pysnmp-lextudio...")
    try:
        subprocess.check_call(
            [sys.executable, '-m', 'pip', 'install', 'pysnmp-lextudio'],
            timeout=120
        )
        import pysnmp
        PYSNMP_VERSION = getattr(pysnmp, '__version__', '0.0.0')
        # After fresh install, try v7 first (lextudio default), fallback to classic
        try:
            _import_pysnmp_v7()
        except Exception as v7_err:
            print(f"Post-install v7 asyncio API failed: {v7_err}, trying classic...")
            try:
                _import_pysnmp_classic()
            except Exception as classic_err:
                print(f"Post-install classic API also failed: {classic_err}")
                SNMP_AVAILABLE = False
        print(f"Successfully installed pysnmp-lextudio, SNMP_AVAILABLE={SNMP_AVAILABLE}")
    except Exception as e:
        print(f"Warning: Could not install pysnmp: {e}")
        SNMP_AVAILABLE = False

# Log final SNMP status at startup
print(f"SNMP_AVAILABLE: {SNMP_AVAILABLE}, Version: {PYSNMP_VERSION}, V7_ASYNC: {PYSNMP_V7_PLUS}")

from .base import BaseHandler
from datetime import datetime, timezone

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

# rPDU Bank Outlet State (bank-aware models like AP8XXX with multiple banks)
RPDU_BANK_OUTLET_STATE_OID = '1.3.6.1.4.1.318.1.1.12.3.4.1.1.4'  # rPDUOutletStatusOutletState


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
        self._diagnostics = []  # Collect diagnostics during operations
    
    def _add_diagnostic(self, level: str, operation: str, message: str, details: dict = None):
        """Add a diagnostic entry for later saving to database"""
        self._diagnostics.append({
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'level': level,
            'operation': operation,
            'message': message,
            'details': details
        })
        # Also log it
        self.log(f"[DIAG:{operation}] {message}", level)
    
    def _save_diagnostics(self, pdu_id: str):
        """Save collected diagnostics to the PDU record in the database"""
        if not self._diagnostics:
            return
        
        try:
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            
            diagnostics_data = {
                'last_sync_diagnostics': {
                    'collected_at': datetime.now(timezone.utc).isoformat(),
                    'snmp_available': SNMP_AVAILABLE,
                    'entries': self._diagnostics[-50:]  # Keep last 50 entries
                }
            }
            
            resp = requests.patch(
                f"{DSM_URL}/rest/v1/pdus",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                params={'id': f'eq.{pdu_id}'},
                json=diagnostics_data,
                verify=VERIFY_SSL,
                timeout=10
            )
            self.log(f"Saved {len(self._diagnostics)} diagnostic entries to PDU record (status: {resp.status_code})")
        except Exception as e:
            self.log(f"Failed to save diagnostics: {e}", "WARN")
        finally:
            self._diagnostics = []  # Clear after saving
    
    def _clear_diagnostics(self):
        """Clear collected diagnostics"""
        self._diagnostics = []
    
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
                        decrypted = self.executor.decrypt_password(pdu['password_encrypted'])
                        if decrypted:
                            pdu['password'] = decrypted
                        else:
                            # Decryption failed - might be plain text, use raw value with warning
                            self.log("Password decryption failed - using raw value (may be plain text)", "WARN")
                            pdu['password'] = pdu['password_encrypted']
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
                # Enhanced diagnostics for 403 and other errors
                if response.status_code == 403:
                    headers_dict = dict(response.headers)
                    body_snippet = response.text[:1000]
                    self._add_diagnostic('ERROR', 'nmc_login', f'403 Forbidden on login page', {
                        'url': login_page_url,
                        'response_headers': headers_dict,
                        'response_body_snippet': body_snippet,
                        'possible_causes': [
                            'IP access control enabled on PDU',
                            'Rate limiting/account lockout',
                            'Firewall or proxy blocking',
                            'PDU requires HTTPS only'
                        ]
                    })
                    body_lower = response.text.lower()
                    if 'access denied' in body_lower or 'blocked' in body_lower:
                        return False, "Login page returned status 403 - IP may be blocked or access control enabled on PDU"
                    if 'rate limit' in body_lower or 'too many' in body_lower:
                        return False, "Login page returned status 403 - Rate limited, wait and retry"
                else:
                    self._add_diagnostic('ERROR', 'nmc_login', f'Unexpected HTTP status {response.status_code}', {
                        'url': login_page_url,
                        'status_code': response.status_code
                    })
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
            
            # Extract ALL hidden fields from the login form (CSRF tokens, session IDs, etc.)
            hidden_input_pattern = r'<input[^>]*type=["\']hidden["\'][^>]*>'
            hidden_inputs = re.findall(hidden_input_pattern, response.text, re.IGNORECASE)
            
            # Build payload with all hidden fields first
            payload = {}
            for hidden_input in hidden_inputs:
                name_match = re.search(r'name=["\']([^"\']+)["\']', hidden_input, re.IGNORECASE)
                value_match = re.search(r'value=["\']([^"\']*)["\']', hidden_input, re.IGNORECASE)
                if name_match:
                    name = name_match.group(1)
                    value = value_match.group(1) if value_match else ''
                    payload[name] = value
                    self.log(f"Found hidden field: {name}={value[:30] if value else '(empty)'}...")
            
            # Add username/password fields
            payload[username_field] = username
            payload[password_field] = password
            payload['submit'] = 'Log On'
            
            headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': login_page_url
            }
            
            self.log(f"Submitting login to: {login_url} with {len(payload)} fields: {list(payload.keys())}")
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
            
            # Try harder to extract session token from response content before giving up
            # Look for any NMC link pattern in the page content
            link_patterns = [
                r'/NMC/([a-zA-Z0-9+/=_-]{8,})/',       # Standard NMC token in links
                r'href=["\'][^"\']*NMC/([^/"\']+)/',   # Token in href attributes
                r'action=["\'][^"\']*NMC/([^/"\']+)/', # Token in form actions
                r'NMC/([a-zA-Z0-9+/=_-]{8,})/\w+\.htm', # Token in any .htm URL
            ]
            
            for pattern in link_patterns:
                content_match = re.search(pattern, response.text)
                if content_match:
                    token = content_match.group(1)
                    if token not in ['logon', 'login', 'logout', 'logoff']:  # Skip these pseudo-tokens
                        self._session_token = token
                        self.log(f"Session token extracted from content: {self._session_token[:8]}...")
                        return True, "Login successful"
            
            # Alternative success detection: Look for logout/logoff links (but still need to find token)
            if 'logoff' in response.text.lower() or 'logout' in response.text.lower():
                self.log("Detected logout link - login appears successful but no token found")
                # Try to extract from logout link itself
                logout_match = re.search(r'href=["\'][^"\']*NMC/([^/"\']+)/log(?:out|off)', response.text, re.IGNORECASE)
                if logout_match:
                    self._session_token = logout_match.group(1)
                    self.log(f"Session token from logout link: {self._session_token[:8]}...")
                    return True, "Login successful"
                # Last resort - try cookie-based auth (some newer firmware)
                self._session_token = "cookie-auth"
                self.log("Using cookie-based authentication (no URL token)")
                return True, "Login successful (cookie-based)"
            
            # Alternative: Check if we landed on a home/status page (not login)
            if 'home.htm' in final_url.lower() or 'status' in final_url.lower():
                self.log("Landed on home/status page - login successful but no token in URL")
                self._session_token = "cookie-auth"
                return True, "Login successful (redirected to home)"
            
            # Alternative: No login form in response means we're authenticated
            if 'logon.htm' not in response.text.lower() and '<input' not in response.text.lower():
                self.log("No login form in response - likely authenticated via cookies")
                self._session_token = "cookie-auth"
                return True, "Login successful"
            
            # Check if we're still on the login page (bad credentials)
            if 'logon.htm' in final_url or 'login' in final_url.lower():
                # But also check if response contains error messages
                if 'invalid' in response.text.lower() or 'incorrect' in response.text.lower() or 'failed' in response.text.lower():
                    return False, "Invalid credentials (server reported authentication failure)"
                # Still on login page but no explicit error - could be redirect issue
                self.log("Still on login page but no explicit error - may need different auth flow")
                return False, "Login failed - still on login page"
            
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
        from datetime import datetime, timezone
        
        try:
            update_data = {'connection_status': status}
            if last_seen:
                update_data['last_seen'] = datetime.now(timezone.utc).isoformat()
            
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
        Supports both pysnmp v4-6 (classic API) and v7+ (asyncio API with wrappers).
        
        Tries both SPDU and RPDU2 OIDs for compatibility with different models.
        """
        if not SNMP_AVAILABLE:
            return False, "SNMP library (pysnmp) not available"
        
        self.log(f"SNMP control: outlet={outlet}, command={command.name}, ip={ip} [pysnmp v7+: {PYSNMP_V7_PLUS}]")
        
        # Try primary OID first (sPDUOutletCtl for older models)
        oids_to_try = [
            (f'{SPDU_OUTLET_CTL_OID}.{outlet}', 'sPDUOutletCtl'),
            (f'{RPDU2_OUTLET_CMD_OID}.{outlet}', 'rPDUOutletControlOutletCommand'),
        ]
        
        last_error = None
        
        for oid, oid_name in oids_to_try:
            try:
                self.log(f"Trying SNMP SET with OID {oid_name}: {oid}")
                
                if PYSNMP_V7_PLUS:
                    # Use async-to-sync wrapper for v7+
                    error_indication, error_status, error_index, var_binds = \
                        _run_snmp_set_v7(ip, 161, community, oid, command.value)
                else:
                    # Classic API (v4-6)
                    iterator = setCmd(
                        SnmpEngine(),
                        CommunityData(community, mpModel=0),  # SNMP v1
                        UdpTransportTarget((ip, 161), timeout=5, retries=2),
                        ContextData(),
                        ObjectType(ObjectIdentity(oid), Integer(command.value))
                    )
                    error_indication, error_status, error_index, var_binds = next(iterator)
                
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
        """Get single outlet state via SNMP with detailed error logging.
        Supports both pysnmp v4-6 (classic API) and v7+ (asyncio API with wrappers)."""
        if not SNMP_AVAILABLE:
            self.log("SNMP library (pysnmp) not available", "DEBUG")
            return None
        
        # Try multiple OID types for different APC PDU models
        oids_to_try = [
            (f'{SPDU_OUTLET_STATE_OID}.{outlet}', 'sPDU'),
            (f'{RPDU2_OUTLET_STATE_OID}.{outlet}', 'rPDU2'),
            (f'{RPDU_BANK_OUTLET_STATE_OID}.{outlet}', 'rPDU-Bank'),
        ]
        
        last_error = None
        for oid, oid_name in oids_to_try:
            try:
                if PYSNMP_V7_PLUS:
                    # Use async-to-sync wrapper for v7+
                    error_indication, error_status, error_index, var_binds = \
                        _run_snmp_get_v7(ip, 161, community, oid)
                else:
                    # Classic API (v4-6)
                    iterator = getCmd(
                        SnmpEngine(),
                        CommunityData(community, mpModel=0),
                        UdpTransportTarget((ip, 161), timeout=10, retries=3),
                        ContextData(),
                        ObjectType(ObjectIdentity(oid))
                    )
                    error_indication, error_status, error_index, var_binds = next(iterator)
                
                if error_indication:
                    last_error = f"{oid_name}: {error_indication}"
                    self.log(f"SNMP {oid_name} outlet {outlet}: error_indication={error_indication}", "DEBUG")
                    continue
                    
                if error_status:
                    last_error = f"{oid_name}: {error_status.prettyPrint()} at {error_index}"
                    self.log(f"SNMP {oid_name} outlet {outlet}: error_status={error_status.prettyPrint()}", "DEBUG")
                    continue
                
                for var_bind in var_binds:
                    try:
                        value = int(var_bind[1])
                        if value == SnmpOutletState.ON:
                            return 'on'
                        elif value == SnmpOutletState.OFF:
                            return 'off'
                        else:
                            self.log(f"SNMP {oid_name} outlet {outlet}: unknown state value={value}", "DEBUG")
                    except (ValueError, TypeError) as e:
                        self.log(f"SNMP {oid_name} outlet {outlet}: value parse error={e}", "DEBUG")
                        continue
                    
            except Exception as e:
                last_error = f"{oid_name}: {str(e)}"
                self.log(f"SNMP {oid_name} outlet {outlet}: exception={e}", "DEBUG")
                continue
        
        if last_error and outlet == 1:
            # Log detailed error only for first outlet to avoid spam
            self.log(f"SNMP failed for outlet 1: {last_error}", "WARN")
        
        return None
    
    def _snmp_walk_outlet_states(self, ip: str, community: str, base_oid: str, oid_name: str) -> Dict[int, str]:
        """
        Walk an SNMP OID subtree to discover all outlet states.
        This works regardless of the PDU's OID indexing scheme (sequential, bank-indexed, etc.)
        Supports both pysnmp v4-6 (classic API) and v7+ (asyncio API with wrappers).
        
        Returns dict mapping outlet number (1-based) to state ('on' or 'off')
        """
        outlet_states = {}
        
        try:
            self.log(f"SNMP walking OID: {oid_name} ({base_oid}) [pysnmp v7+: {PYSNMP_V7_PLUS}]")
            outlet_index = 1  # Sequential outlet numbering
            
            if PYSNMP_V7_PLUS:
                # Use async-to-sync wrapper for v7+ bulk walk
                var_binds_list = _run_snmp_walk_v7(ip, 161, community, base_oid)
                
                for var_bind in var_binds_list:
                    oid_str = str(var_bind[0])
                    try:
                        value = int(var_bind[1])
                        if value == SnmpOutletState.ON:
                            state = 'on'
                        elif value == SnmpOutletState.OFF:
                            state = 'off'
                        else:
                            self.log(f"SNMP walk: unknown state value {value} at {oid_str}", "DEBUG")
                            continue
                        
                        outlet_states[outlet_index] = state
                        self.log(f"SNMP walk: outlet {outlet_index} = {state} (OID: {oid_str})", "DEBUG")
                        outlet_index += 1
                    except (ValueError, TypeError) as e:
                        self.log(f"SNMP walk: parse error at {oid_str}: {e}", "DEBUG")
                        continue
            else:
                # Classic API (v4-6)
                iterator = nextCmd(
                    SnmpEngine(),
                    CommunityData(community, mpModel=0),
                    UdpTransportTarget((ip, 161), timeout=10, retries=2),
                    ContextData(),
                    ObjectType(ObjectIdentity(base_oid)),
                    lexicographicMode=False  # Stop when leaving this OID subtree
                )
                
                for error_indication, error_status, error_index, var_binds in iterator:
                    if error_indication:
                        self.log(f"SNMP walk error_indication: {error_indication}", "DEBUG")
                        self._add_diagnostic('WARN', 'snmp_walk', f'SNMP error: {error_indication}', {
                            'oid_name': oid_name,
                            'error': str(error_indication)
                        })
                        break
                    if error_status:
                        self.log(f"SNMP walk error_status: {error_status.prettyPrint()}", "DEBUG")
                        break
                    
                    for var_bind in var_binds:
                        oid_str = str(var_bind[0])
                        # Verify we're still in the target OID subtree
                        if not oid_str.startswith(base_oid):
                            self.log(f"SNMP walk left subtree at {oid_str}", "DEBUG")
                            break
                        
                        try:
                            value = int(var_bind[1])
                            if value == SnmpOutletState.ON:
                                state = 'on'
                            elif value == SnmpOutletState.OFF:
                                state = 'off'
                            else:
                                self.log(f"SNMP walk: unknown state value {value} at {oid_str}", "DEBUG")
                                continue
                            
                            outlet_states[outlet_index] = state
                            self.log(f"SNMP walk: outlet {outlet_index} = {state} (OID: {oid_str})", "DEBUG")
                            outlet_index += 1
                        except (ValueError, TypeError) as e:
                            self.log(f"SNMP walk: parse error at {oid_str}: {e}", "DEBUG")
                            continue
            
            if outlet_states:
                self.log(f"SNMP walk via {oid_name} found {len(outlet_states)} outlets")
                
        except Exception as e:
            self.log(f"SNMP walk exception for {oid_name}: {e}", "WARN")
            self._add_diagnostic('ERROR', 'snmp_walk', f'Exception during SNMP walk: {e}', {
                'oid_name': oid_name,
                'exception': str(e),
                'pysnmp_version': PYSNMP_VERSION
            })
        
        return outlet_states
    
    def _snmp_get_all_outlet_states(self, ip: str, community: str, 
                                     max_outlets: int = 24, pdu_id: str = None) -> Dict[int, str]:
        """
        Get all outlet states via SNMP walk with automatic OID discovery.
        Tries multiple OID bases to support different APC PDU models.
        """
        if not SNMP_AVAILABLE:
            self._add_diagnostic('ERROR', 'snmp_sync', 'SNMP library (pysnmp) not available', {
                'snmp_available': False,
                'ip': ip
            })
            return {}
        
        self._add_diagnostic('INFO', 'snmp_sync', f'Starting SNMP discovery from {ip}', {
            'snmp_available': True,
            'ip': ip,
            'community_length': len(community) if community else 0
        })
        
        # Try all OID bases using SNMP walk
        oid_bases = [
            (SPDU_OUTLET_STATE_OID, 'sPDU'),
            (RPDU2_OUTLET_STATE_OID, 'rPDU2'),
            (RPDU_BANK_OUTLET_STATE_OID, 'rPDU-Bank'),
        ]
        
        for base_oid, oid_name in oid_bases:
            self._add_diagnostic('DEBUG', 'snmp_walk', f'Trying OID: {oid_name}', {
                'base_oid': base_oid,
                'oid_name': oid_name
            })
            outlet_states = self._snmp_walk_outlet_states(ip, community, base_oid, oid_name)
            if outlet_states:
                self._add_diagnostic('INFO', 'snmp_sync', f'SNMP walk discovered {len(outlet_states)} outlets via {oid_name}', {
                    'oid_used': oid_name,
                    'outlet_count': len(outlet_states),
                    'outlets': outlet_states
                })
                return outlet_states
        
        self._add_diagnostic('WARN', 'snmp_sync', 'SNMP walk returned no outlets', {
            'oids_tried': [oid[1] for oid in oid_bases],
            'possible_causes': [
                'SNMP not enabled on PDU',
                f"Community string '{community}' lacks read access",
                'UDP port 161 blocked by firewall',
                'Wrong SNMP version (trying v1/v2c)',
            ]
        })
        return {}
    
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
            
            # NMC login failed - try SNMP fallback in auto mode for ANY failure
            if protocol == 'auto':
                self.log(f"NMC login failed ({message}), trying SNMP fallback", "WARN")
                snmp_success, snmp_message = self._snmp_test_connection(ip_address, snmp_community)
                
                if snmp_success:
                    self._update_pdu_status(pdu_id, 'online', last_seen=True)
                    return {
                        'success': True,
                        'message': f'Connection successful via SNMP (NMC: {message})',
                        'pdu_name': pdu.get('name'),
                        'ip_address': ip_address,
                        'protocol_used': 'snmp',
                        'nmc_blocked': True,
                        'nmc_error': message
                    }
                else:
                    self._update_pdu_status(pdu_id, 'error')
                    return {
                        'success': False,
                        'error': f'NMC: {message}; SNMP: {snmp_message}',
                        'pdu_name': pdu.get('name'),
                        'ip_address': ip_address
                    }
            
            # NMC-only mode failed
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
                # Try SNMP fallback in auto mode for ANY NMC failure
                if protocol == 'auto':
                    self.log(f"NMC login failed ({message}), trying SNMP for discovery", "WARN")
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
            from datetime import datetime, timezone
            
            update_data = {'last_sync': datetime.now(timezone.utc).isoformat()}
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
        
        # Auto mode - try SNMP first (fast and reliable), fall back to NMC
        if protocol == 'auto':
            self.log("Auto mode: trying SNMP first (preferred for control)")
            snmp_command = snmp_command_map.get(action)
            
            if action == 'status':
                outlet_states = self._snmp_get_all_outlet_states(ip_address, snmp_read_community)
                if outlet_states:
                    for outlet_num, state in outlet_states.items():
                        self._update_outlet_state(pdu_id, outlet_num, state)
                    return {
                        'success': True,
                        'action': 'status',
                        'outlet_states': outlet_states,
                        'protocol_used': 'snmp'
                    }
            elif snmp_command:
                # Try SNMP control
                results = []
                all_success = True
                for outlet in outlet_numbers:
                    success, message = self._snmp_control_outlet(ip_address, snmp_write_community, outlet, snmp_command)
                    results.append({'outlet': outlet, 'success': success, 'message': message})
                    if not success:
                        all_success = False
                
                if all_success:
                    self._update_pdu_status(pdu_id, 'online', last_seen=True)
                    new_state = 'on' if action == 'on' else ('off' if action == 'off' else 'unknown')
                    if action != 'reboot':
                        for outlet_num in outlet_numbers:
                            self._update_outlet_state(pdu_id, outlet_num, new_state)
                    
                    return {
                        'success': True,
                        'action': action,
                        'outlet_numbers': outlet_numbers,
                        'results': results,
                        'protocol_used': 'snmp'
                    }
                else:
                    self.log("SNMP control failed, falling back to NMC", "WARN")
        
        # NMC mode or Auto fallback - try NMC web interface
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
                # SNMP already tried for auto mode above, so this is a hard fail
                if protocol == 'auto':
                    return {'success': False, 'error': f'Both SNMP and NMC failed: {message}'}
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
        
        # Clear any previous diagnostics
        self._clear_diagnostics()
        self._add_diagnostic('INFO', 'sync_start', f'Starting sync for PDU {pdu_id}')
        
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
        
        # SNMP-only mode (with NMC fallback)
        if protocol == 'snmp':
            outlet_states = self._snmp_get_all_outlet_states(ip_address, snmp_community)
            
            if outlet_states:
                for outlet_num, state in outlet_states.items():
                    self._update_outlet_state(pdu_id, outlet_num, state)
                
                # Update last_sync using REST API
                from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
                from datetime import datetime, timezone
                
                current_time = datetime.now(timezone.utc).isoformat()
                requests.patch(
                    f"{DSM_URL}/rest/v1/pdus",
                    headers={
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                    },
                    params={'id': f'eq.{pdu_id}'},
                    json={'last_sync': current_time},
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
                # SNMP failed - fall back to NMC web interface
                self.log("SNMP sync failed for snmp-mode PDU, falling back to NMC web interface", "WARN")
                try:
                    success, message = self._login(pdu_url, username, password)
                    
                    # If session conflict detected, try Telnet clear and retry
                    if not success and self._is_session_conflict(message):
                        self.log("Session conflict detected, attempting Telnet session clear", "WARN")
                        clear_success, clear_msg = self._clear_pdu_sessions_via_telnet(ip_address, username, password)
                        if clear_success:
                            self.log("Telnet clear successful, retrying NMC login")
                            time.sleep(2)
                            success, message = self._login(pdu_url, username, password)
                    
                    if success:
                        outlet_states = self._get_outlet_states()
                        if outlet_states:
                            for outlet_num, state in outlet_states.items():
                                self._update_outlet_state(pdu_id, outlet_num, state)
                            
                            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
                            from datetime import datetime, timezone
                            
                            current_time = datetime.now(timezone.utc).isoformat()
                            requests.patch(
                                f"{DSM_URL}/rest/v1/pdus",
                                headers={
                                    'apikey': SERVICE_ROLE_KEY,
                                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                    'Content-Type': 'application/json',
                                    'Prefer': 'return=minimal'
                                },
                                params={'id': f'eq.{pdu_id}'},
                                json={'last_sync': current_time},
                                verify=VERIFY_SSL,
                                timeout=10
                            )
                            
                            self._logout()
                            self._update_pdu_status(pdu_id, 'online', last_seen=True)
                            
                            return {
                                'success': True,
                                'outlet_states': outlet_states,
                                'outlets_synced': len(outlet_states),
                                'protocol_used': 'nmc_fallback',
                                'warning': 'SNMP failed, used NMC web interface as fallback'
                            }
                        else:
                            self._logout()
                            return {'success': False, 'error': 'SNMP failed and NMC returned no outlet data'}
                    else:
                        self._add_diagnostic('ERROR', 'sync_failed', f'SNMP failed and NMC login failed: {message}')
                        self._save_diagnostics(pdu_id)
                        return {'success': False, 'error': f'SNMP failed and NMC login failed: {message}'}
                except Exception as e:
                    self.log(f"NMC fallback error: {e}", "ERROR")
                    self._add_diagnostic('ERROR', 'sync_failed', f'NMC fallback exception: {e}')
                    self._save_diagnostics(pdu_id)
                    return {'success': False, 'error': f'SNMP failed and NMC fallback failed: {e}'}
                finally:
                    self._logout()
        
        # Auto mode - try SNMP first (fast and reliable), fall back to NMC
        if protocol == 'auto':
            self.log("Auto mode: trying SNMP first (preferred for sync)")
            outlet_states = self._snmp_get_all_outlet_states(ip_address, snmp_community)
            
            if outlet_states:
                for outlet_num, state in outlet_states.items():
                    self._update_outlet_state(pdu_id, outlet_num, state)
                
                # Update last_sync using REST API
                from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
                from datetime import datetime, timezone
                
                current_time = datetime.now(timezone.utc).isoformat()
                requests.patch(
                    f"{DSM_URL}/rest/v1/pdus",
                    headers={
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                    },
                    params={'id': f'eq.{pdu_id}'},
                    json={'last_sync': current_time},
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
                self.log("SNMP sync failed, falling back to NMC web interface", "WARN")
        
        # NMC mode or Auto fallback
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
                # SNMP already tried for auto mode above
                if protocol == 'auto':
                    self._add_diagnostic('ERROR', 'sync_failed', f'Both SNMP and NMC failed: {message}')
                    self._save_diagnostics(pdu_id)
                    return {'success': False, 'error': f'Both SNMP and NMC failed: {message}'}
                self._add_diagnostic('ERROR', 'sync_failed', f'NMC login failed: {message}')
                self._save_diagnostics(pdu_id)
                return {'success': False, 'error': f'NMC login failed: {message}'}
            
            # Get outlet states via NMC
            outlet_states = self._get_outlet_states()
            
            if outlet_states:
                for outlet_num, state in outlet_states.items():
                    self._update_outlet_state(pdu_id, outlet_num, state)
                
                # Update last_sync using REST API
                from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
                from datetime import datetime, timezone
                
                current_time = datetime.now(timezone.utc).isoformat()
                requests.patch(
                    f"{DSM_URL}/rest/v1/pdus",
                    headers={
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                    },
                    params={'id': f'eq.{pdu_id}'},
                    json={'last_sync': current_time},
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
            
            self._update_pdu_status(pdu_id, 'online', last_seen=True)
            
            # Get outlet states
            outlet_states = self._get_outlet_states()
            
            # Update database
            for outlet_num, state in outlet_states.items():
                self._update_outlet_state(pdu_id, outlet_num, state)
            
            # Update PDU last_sync using REST API
            from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
            from datetime import datetime, timezone
            
            current_time = datetime.now(timezone.utc).isoformat()
            requests.patch(
                f"{DSM_URL}/rest/v1/pdus",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                params={'id': f'eq.{pdu_id}'},
                json={'last_sync': current_time},
                verify=VERIFY_SSL,
                timeout=10
            )
            
            self._logout()
            
            # Build response with debug info when 0 outlets found
            response_data = {
                'success': True,
                'outlet_states': outlet_states,
                'outlets_synced': len(outlet_states),
                'protocol_used': 'nmc'
            }
            
            # Include debug info when no outlets found
            if len(outlet_states) == 0:
                response_data['debug'] = {
                    'session_token': self._session_token[:20] if self._session_token else None,
                    'outlet_page_url': getattr(self, '_successful_outlet_url', None),
                    'html_snippet': getattr(self, '_last_outlet_html', None)
                }
            
            return response_data
            
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
        # Initialize debug attributes
        self._last_outlet_html = None
        self._successful_outlet_url = None
        
        if not self._session_token or not self._session:
            self.log("Cannot get outlet states: no session token or session", "WARN")
            self._last_outlet_html = "NO_SESSION"
            return {}
        
        try:
            # Try multiple possible outlet page URLs for different APC firmware versions
            outlet_urls = []
            
            # Cookie-based auth uses root URLs directly
            if self._session_token == "cookie-auth":
                outlet_urls = [
                    f"{self._pdu_url}/outlctrl.htm",
                    f"{self._pdu_url}/outctl.htm",
                    f"{self._pdu_url}/outlet.htm",
                    f"{self._pdu_url}/outlets.htm",
                    f"{self._pdu_url}/status.htm",
                    f"{self._pdu_url}/rPDUout.htm",
                    f"{self._pdu_url}/rPDUOutletControl.htm",
                    f"{self._pdu_url}/rpdu/outlpwr.htm",
                    f"{self._pdu_url}/rpdu/outlctrl.htm",
                    f"{self._pdu_url}/rpdu/outlet.htm",
                    f"{self._pdu_url}/rpdu/status.htm",
                    f"{self._pdu_url}/ms/outlctrl.htm",
                    f"{self._pdu_url}/status/outlets.htm",
                ]
            else:
                # Token-based auth uses NMC path
                outlet_urls = [
                    f"{self._pdu_url}/NMC/{self._session_token}/outlctrl.htm",
                    f"{self._pdu_url}/NMC/{self._session_token}/outctl.htm",
                    f"{self._pdu_url}/NMC/{self._session_token}/outlet.htm",
                    f"{self._pdu_url}/NMC/{self._session_token}/outlets.htm",
                    f"{self._pdu_url}/NMC/{self._session_token}/status.htm",
                    f"{self._pdu_url}/NMC/{self._session_token}/rPDUout.htm",
                    f"{self._pdu_url}/NMC/{self._session_token}/rPDUOutletControl.htm",
                    # Rack PDU specific paths
                    f"{self._pdu_url}/NMC/{self._session_token}/rpdu/outlpwr.htm",
                    f"{self._pdu_url}/NMC/{self._session_token}/rpdu/outlctrl.htm",
                    f"{self._pdu_url}/NMC/{self._session_token}/rpdu/outlet.htm",
                    f"{self._pdu_url}/NMC/{self._session_token}/rpdu/status.htm",
                    f"{self._pdu_url}/NMC/{self._session_token}/ms/outlctrl.htm",
                    f"{self._pdu_url}/NMC/{self._session_token}/status/outlets.htm",
                    # Also try without token in case session is cookie-based
                    f"{self._pdu_url}/outlctrl.htm",
                    f"{self._pdu_url}/outlet.htm",
                    f"{self._pdu_url}/rpdu/outlpwr.htm",
                ]
            
            content = None
            successful_url = None
            discovered_pages = []  # Pages discovered from navigation links
            
            self.log(f"Session token being used: {self._session_token[:20] if self._session_token else 'None'}...")
            
            # First pass: try direct URLs and collect navigation pages
            nav_pages = []
            for url in outlet_urls:
                self.log(f"Trying outlet URL: {url}")
                try:
                    response = self._session.get(url, timeout=self._request_timeout)
                    self.log(f"Response: {response.status_code}, length: {len(response.text)}")
                    
                    if response.status_code == 200:
                        text_lower = response.text.lower()
                        
                        # Check if this is a navigation/menu page (has links but no outlet data tables)
                        has_outlet_keyword = 'outlet' in text_lower or 'pdu' in text_lower
                        # Enhanced detection for APC page patterns
                        has_table_data = '<table' in text_lower and (
                            'on</td>' in text_lower or 
                            'off</td>' in text_lower or 
                            'state' in text_lower or
                            'ledon' in text_lower or
                            'ledoff' in text_lower
                        )
                        has_js_data = 'outletstate' in text_lower or 'olstate' in text_lower
                        # APC outlet control form indicators
                        has_apc_form = 'hashform' in text_lower or 'outlctrl1' in text_lower or 'ol_ctrl' in text_lower
                        # APC status indicators - check for numbered outlet rows
                        has_outlet_table = ('outlet 1' in text_lower or 'outlet1' in text_lower) and '<table' in text_lower
                        
                        if has_table_data or has_js_data or has_apc_form or has_outlet_table:
                            # This looks like actual outlet data
                            content = response.text
                            successful_url = url
                            self.log(f"Found outlet DATA page at: {url} (table:{has_table_data}, js:{has_js_data}, form:{has_apc_form}, tbl:{has_outlet_table})")
                            break
                        elif has_outlet_keyword:
                            # This might be a navigation page - save it to scan for links
                            nav_pages.append((url, response.text))
                            self.log(f"Found potential nav page at: {url}, will scan for links")
                except Exception as e:
                    self.log(f"Error fetching {url}: {e}")
                    continue
            
            # Second pass: if no data page found, scan navigation pages for links
            if not content and nav_pages:
                self.log(f"Scanning {len(nav_pages)} navigation pages for outlet data links...")
                for nav_url, nav_html in nav_pages:
                    # Find links that might lead to outlet data
                    link_pattern = r'href=["\']([^"\']*(?:outlet|status|control|power|rpdu)[^"\']*\.htm)["\']'
                    links = re.findall(link_pattern, nav_html, re.IGNORECASE)
                    self.log(f"Found {len(links)} potential outlet links in {nav_url}: {links[:5]}")
                    
                    for link in links:
                        # Resolve relative URLs
                        if link.startswith('/'):
                            full_url = f"{self._pdu_url}{link}"
                        elif link.startswith('http'):
                            full_url = link
                        else:
                            # Relative to current path
                            base_path = nav_url.rsplit('/', 1)[0]
                            full_url = f"{base_path}/{link}"
                        
                        if full_url in [u for u, _ in nav_pages] or full_url in discovered_pages:
                            continue  # Already tried this URL
                        
                        discovered_pages.append(full_url)
                        self.log(f"Trying discovered link: {full_url}")
                        
                        try:
                            response = self._session.get(full_url, timeout=self._request_timeout)
                            if response.status_code == 200:
                                text_lower = response.text.lower()
                                has_table_data = '<table' in text_lower and (
                                    'on</td>' in text_lower or 'off</td>' in text_lower or
                                    'ledon' in text_lower or 'ledoff' in text_lower
                                )
                                has_js_data = 'outletstate' in text_lower or 'olstate' in text_lower
                                has_apc_form = 'hashform' in text_lower or 'outlctrl1' in text_lower or 'ol_ctrl' in text_lower
                                has_outlet_table = ('outlet 1' in text_lower or 'outlet1' in text_lower) and '<table' in text_lower
                                
                                if has_table_data or has_js_data or has_apc_form or has_outlet_table:
                                    content = response.text
                                    successful_url = full_url
                                    self.log(f"Found outlet DATA page via link discovery: {full_url}")
                                    break
                        except Exception as e:
                            self.log(f"Error fetching discovered link {full_url}: {e}")
                    
                    if content:
                        break
            
            # If still no data page, use the first nav page for pattern matching
            if not content and nav_pages:
                content = nav_pages[0][1]
                successful_url = nav_pages[0][0]
                self.log(f"Using nav page for pattern matching: {successful_url}")
            
            # Store for debugging
            self._successful_outlet_url = successful_url
            
            if not content:
                self.log("No outlet page found at any URL", "WARN")
                self._last_outlet_html = "NO_PAGE_FOUND"
                return {}
            
            self.log(f"Outlet page HTML snippet (first 1000 chars): {content[:1000]}")
            
            outlet_states = {}
            
            # Parse outlet states from the page using multiple patterns
            
            # Pattern 1: Table-based status - <td>Outlet 1</td><td>On</td>
            table_pattern = r'Outlet\s*(\d+)[^<]*</td>\s*<td[^>]*>([^<]+)</td>'
            matches = re.findall(table_pattern, content, re.IGNORECASE)
            self.log(f"Pattern 1 (table) matches: {len(matches)}")
            
            for match in matches:
                outlet_num = int(match[0])
                state_text = match[1].strip().lower()
                if 'on' in state_text:
                    outlet_states[outlet_num] = 'on'
                elif 'off' in state_text:
                    outlet_states[outlet_num] = 'off'
                else:
                    outlet_states[outlet_num] = 'unknown'
            
            # Pattern 2: JavaScript-based status - outletState[1] = "On"
            js_pattern = r'outletState\[(\d+)\]\s*=\s*["\']([^"\']+)["\']'
            js_matches = re.findall(js_pattern, content, re.IGNORECASE)
            self.log(f"Pattern 2 (JS) matches: {len(js_matches)}")
            
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
            on_pattern = r'class="[^"]*outletOn[^"]*"[^>]*>.*?Outlet\s*(\d+)'
            off_pattern = r'class="[^"]*outletOff[^"]*"[^>]*>.*?Outlet\s*(\d+)'
            
            on_matches = re.findall(on_pattern, content, re.IGNORECASE)
            off_matches = re.findall(off_pattern, content, re.IGNORECASE)
            self.log(f"Pattern 3 (CSS) on/off matches: {len(on_matches)}/{len(off_matches)}")
            
            for match in on_matches:
                outlet_states[int(match)] = 'on'
            for match in off_matches:
                outlet_states[int(match)] = 'off'
            
            # Pattern 4: Alternative table format - <td>1</td>...<td>On</td>
            alt_table_pattern = r'<td[^>]*>\s*(\d{1,2})\s*</td>.*?<td[^>]*>\s*(On|Off)\s*</td>'
            alt_matches = re.findall(alt_table_pattern, content, re.IGNORECASE | re.DOTALL)
            self.log(f"Pattern 4 (alt table) matches: {len(alt_matches)}")
            
            for match in alt_matches:
                outlet_num = int(match[0])
                if outlet_num <= 48:  # Reasonable outlet number limit
                    state = 'on' if match[1].lower() == 'on' else 'off'
                    if outlet_num not in outlet_states:
                        outlet_states[outlet_num] = state
            
            # Pattern 5: Select/Option based - Outlet 1 - On
            option_pattern = r'Outlet\s*(\d+)[^<]*[-:]\s*(On|Off)'
            option_matches = re.findall(option_pattern, content, re.IGNORECASE)
            self.log(f"Pattern 5 (option) matches: {len(option_matches)}")
            
            for match in option_matches:
                outlet_num = int(match[0])
                state = 'on' if match[1].lower() == 'on' else 'off'
                if outlet_num not in outlet_states:
                    outlet_states[outlet_num] = state
            
            # Pattern 6: Image-based status - <img src="images/on.gif"/>
            img_pattern = r'(?:Outlet|outlet)\s*(\d+).*?<img[^>]*src="[^"]*/(on|off)\.(?:gif|png|jpg)'
            img_matches = re.findall(img_pattern, content, re.IGNORECASE | re.DOTALL)
            self.log(f"Pattern 6 (image) matches: {len(img_matches)}")
            
            for match in img_matches:
                outlet_num = int(match[0])
                state = match[1].lower()
                if outlet_num not in outlet_states:
                    outlet_states[outlet_num] = state
            
            # Pattern 7: JavaScript state arrays - olState = [1,1,0,1,0,0,0,0]
            array_pattern = r'(?:olState|outletState|outlets)\s*=\s*\[([\d,\s]+)\]'
            array_match = re.search(array_pattern, content, re.IGNORECASE)
            if array_match:
                states_str = array_match.group(1)
                states = [int(s.strip()) for s in states_str.split(',') if s.strip().isdigit()]
                self.log(f"Pattern 7 (JS array) found {len(states)} states: {states}")
                for i, state_val in enumerate(states):
                    outlet_num = i + 1  # 1-indexed
                    if outlet_num not in outlet_states:
                        outlet_states[outlet_num] = 'on' if state_val == 1 else 'off'
            
            # Pattern 8: Checkbox with outlet number - OL_Ctrl1_1 value="1"
            checkbox_pattern = r'OL_Ctrl(\d+)[_\d]*[^>]*(?:checked|value="1")'
            checkbox_matches = re.findall(checkbox_pattern, content, re.IGNORECASE)
            self.log(f"Pattern 8 (checkbox) matches: {len(checkbox_matches)}")
            
            for match in checkbox_matches:
                outlet_num = int(match)
                if outlet_num not in outlet_states:
                    outlet_states[outlet_num] = 'on'
            
            # Pattern 9: APC specific - name column followed by state column
            # Matches: <td class="...">ServerName</td><td>...</td><td>On</td>
            apc_row_pattern = r'<tr[^>]*>.*?<td[^>]*>[^<]*</td>.*?<td[^>]*>[^<]*(\d+)[^<]*</td>.*?<td[^>]*>\s*(On|Off)\s*</td>.*?</tr>'
            apc_matches = re.findall(apc_row_pattern, content, re.IGNORECASE | re.DOTALL)
            self.log(f"Pattern 9 (APC row) matches: {len(apc_matches)}")
            
            for match in apc_matches:
                outlet_num = int(match[0])
                if outlet_num <= 48 and outlet_num not in outlet_states:
                    outlet_states[outlet_num] = 'on' if match[1].lower() == 'on' else 'off'
            
            # Pattern 10: APC LED indicators - <td><img src="...ledOn.gif"/></td>
            led_pattern = r'<img[^>]*src="[^"]*led(On|Off)[^"]*"[^>]*>.*?(?:Outlet|outlet)\s*(\d+)'
            led_matches = re.findall(led_pattern, content, re.IGNORECASE | re.DOTALL)
            self.log(f"Pattern 10 (LED) matches: {len(led_matches)}")
            
            for match in led_matches:
                state = 'on' if match[0].lower() == 'on' else 'off'
                outlet_num = int(match[1])
                if outlet_num <= 48 and outlet_num not in outlet_states:
                    outlet_states[outlet_num] = state
            
            # Also try reverse order (outlet number before LED)
            led_pattern2 = r'(?:Outlet|outlet)\s*(\d+).*?<img[^>]*src="[^"]*led(On|Off)[^"]*"[^>]*>'
            led_matches2 = re.findall(led_pattern2, content, re.IGNORECASE | re.DOTALL)
            self.log(f"Pattern 10b (LED reverse) matches: {len(led_matches2)}")
            
            for match in led_matches2:
                outlet_num = int(match[0])
                state = 'on' if match[1].lower() == 'on' else 'off'
                if outlet_num <= 48 and outlet_num not in outlet_states:
                    outlet_states[outlet_num] = state
            
            # Pattern 11: APC select dropdown with state - <select name="OL_Ctrl_1">...<option selected>On</option>
            select_pattern = r'(?:OL_Ctrl|olCtrl)[_]?(\d+)[^>]*>.*?<option[^>]*selected[^>]*>\s*(On|Off)\s*</option>'
            select_matches = re.findall(select_pattern, content, re.IGNORECASE | re.DOTALL)
            self.log(f"Pattern 11 (select) matches: {len(select_matches)}")
            
            for match in select_matches:
                outlet_num = int(match[0])
                state = 'on' if match[1].lower() == 'on' else 'off'
                if outlet_num <= 48 and outlet_num not in outlet_states:
                    outlet_states[outlet_num] = state
            
            # Pattern 12: Generic table row with Outlet N and On/Off in same row
            # More flexible: finds rows that contain both an outlet number and a state
            row_flex_pattern = r'<tr[^>]*>(.*?)</tr>'
            rows = re.findall(row_flex_pattern, content, re.IGNORECASE | re.DOTALL)
            self.log(f"Pattern 12 (flexible row) checking {len(rows)} rows")
            
            for row in rows:
                # Look for outlet number
                outlet_match = re.search(r'[>\s](\d{1,2})[<\s]', row)
                # Look for On/Off state
                state_match = re.search(r'>\s*(On|Off)\s*<', row, re.IGNORECASE)
                
                if outlet_match and state_match:
                    outlet_num = int(outlet_match.group(1))
                    if 1 <= outlet_num <= 48 and outlet_num not in outlet_states:
                        state = 'on' if state_match.group(1).lower() == 'on' else 'off'
                        outlet_states[outlet_num] = state
                        self.log(f"Pattern 12 found: Outlet {outlet_num} = {state}")
            
            # Pattern 13: State in input value - <input name="state_1" value="On">
            input_pattern = r'(?:state|outlet)[_]?(\d+)[^>]*value=["\']([^"\']*)["\']'
            input_matches = re.findall(input_pattern, content, re.IGNORECASE)
            self.log(f"Pattern 13 (input) matches: {len(input_matches)}")
            
            for match in input_matches:
                outlet_num = int(match[0])
                val = match[1].lower()
                if outlet_num <= 48 and outlet_num not in outlet_states:
                    if 'on' in val or val == '1':
                        outlet_states[outlet_num] = 'on'
                    elif 'off' in val or val == '0':
                        outlet_states[outlet_num] = 'off'
            
            # Pattern 14: APC Switched Rack PDU specific - look for any numbered cell followed by On/Off within 500 chars
            if not outlet_states:
                self.log("Trying Pattern 14 (proximity search)...")
                # Find all potential outlet numbers
                number_matches = list(re.finditer(r'[>\s](\d{1,2})[<\s]', content))
                for num_match in number_matches:
                    outlet_num = int(num_match.group(1))
                    if 1 <= outlet_num <= 48:
                        # Look for On/Off within next 500 characters
                        search_range = content[num_match.end():num_match.end()+500]
                        state_match = re.search(r'>\s*(On|Off)\s*<', search_range, re.IGNORECASE)
                        if state_match and outlet_num not in outlet_states:
                            state = 'on' if state_match.group(1).lower() == 'on' else 'off'
                            outlet_states[outlet_num] = state
                            self.log(f"Pattern 14 found: Outlet {outlet_num} = {state}")
            
            # Pattern 15: APC text-concatenated format without HTML delimiters
            # Matches: On[1-N]1 HUS-110On[1-N]2 s06-els-qua-d04...
            # Format: State[PendingIndicator]Bank OutletName - repeated for each outlet
            if not outlet_states:
                self.log("Trying Pattern 15 (APC text-concatenated format)...")
                # This pattern matches: On or Off, followed by [X-Y], then bank number, then outlet name
                # The outlet name continues until the next On/Off[, asterisk, or end
                text_concat_pattern = r'(On|Off)\[\d+-[A-Z]\]\d+\s+([^\[]+?)(?=(?:On|Off)\[|\*\s*Indicates|$)'
                text_matches = re.findall(text_concat_pattern, content, re.IGNORECASE)
                self.log(f"Pattern 15 matches: {len(text_matches)}")
                
                outlet_num = 1
                for match in text_matches:
                    state = 'on' if match[0].lower() == 'on' else 'off'
                    outlet_name = match[1].strip()
                    if outlet_num <= 48:
                        outlet_states[outlet_num] = state
                        self.log(f"Pattern 15 found: Outlet {outlet_num} ({outlet_name}) = {state}")
                    outlet_num += 1
            
            # Store HTML for debugging (increased to 8000 chars)
            self._last_outlet_html = content[:8000] if content else "EMPTY_CONTENT"
            
            if not outlet_states:
                self.log("No outlet patterns matched in HTML - may need new regex patterns", "WARN")
                self.log(f"Full HTML for debugging:\n{content[:3000]}", "DEBUG")
            else:
                self.log(f"Parsed {len(outlet_states)} outlet states: {outlet_states}")
            
            return outlet_states
            
        except Exception as e:
            self.log(f"Error getting outlet states: {e}", "ERROR")
            self._last_outlet_html = f"ERROR: {e}"
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
        from datetime import datetime, timezone
        
        try:
            current_time = datetime.now(timezone.utc).isoformat()
            
            outlet_data = {
                'pdu_id': pdu_id,
                'outlet_number': outlet_number,
                'outlet_state': state,
                'last_updated': current_time
            }
            if state != 'unknown':
                outlet_data['last_state_change'] = current_time
            
            self.log(f"Upserting outlet {outlet_number} state: {state}")
            
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
                self.log(f"Outlet {outlet_number} upsert failed: {response.status_code} - {response.text}", "WARN")
            else:
                self.log(f"Outlet {outlet_number} updated successfully")
        except Exception as e:
            self.log(f"Error updating outlet state: {e}", "ERROR")
