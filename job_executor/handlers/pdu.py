"""
PDU (Power Distribution Unit) management handler for Schneider Electric/APC PDUs.

Supports NMC (Network Management Card) web interface for outlet control.
"""

import re
import time
import urllib3
from enum import IntEnum
from typing import Dict, List, Optional, Any, Tuple

import requests

from .base import BaseHandler

# Suppress InsecureRequestWarning for self-signed certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


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
    Network Management Card (NMC) web interface.
    
    Supported job types:
    - pdu_test_connection: Test connectivity and authentication
    - pdu_discover: Discover PDU model, firmware, and outlets
    - pdu_outlet_control: Control outlet power (on/off/reboot)
    - pdu_sync_status: Sync outlet status to database
    """
    
    JOB_TYPES = ['pdu_test_connection', 'pdu_discover', 'pdu_outlet_control', 'pdu_sync_status']
    
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
    
    # =========================================================================
    # Session Management
    # =========================================================================
    
    def _get_pdu_credentials(self, pdu_id: str) -> Optional[Dict[str, Any]]:
        """Fetch PDU credentials from database"""
        try:
            result = self.executor.supabase.table('pdus').select('*').eq('id', pdu_id).single().execute()
            if result.data:
                pdu = result.data
                # Decrypt password if needed
                if pdu.get('password_encrypted'):
                    pdu['password'] = self.executor.decrypt_value(pdu['password_encrypted'])
                else:
                    pdu['password'] = 'apc'  # Default APC password
                return pdu
            return None
        except Exception as e:
            self.log(f"Failed to fetch PDU credentials: {e}", "ERROR")
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
            
            # Submit login form
            login_url = f"{self._pdu_url}/Forms/login1"
            payload = {
                'login_username': username,
                'login_password': password,
                'submit': 'Log On'
            }
            headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': login_page_url
            }
            
            self.log(f"Submitting login to: {login_url}")
            response = self._session.post(
                login_url, 
                data=payload, 
                headers=headers,
                allow_redirects=True, 
                timeout=self._request_timeout
            )
            
            if response.status_code != 200:
                return False, f"Login returned status {response.status_code}"
            
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
            
            # Check if we're still on the login page (bad credentials)
            if 'logon.htm' in final_url or 'login' in final_url.lower():
                return False, "Invalid credentials"
            
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
        """Update PDU connection status in database"""
        try:
            update_data = {'connection_status': status}
            if last_seen:
                update_data['last_seen'] = 'now()'
            
            self.executor.supabase.table('pdus').update(update_data).eq('id', pdu_id).execute()
        except Exception as e:
            self.log(f"Failed to update PDU status: {e}", "WARN")
    
    # =========================================================================
    # Job Handlers
    # =========================================================================
    
    def _handle_test_connection(self, job: Dict[str, Any], details: Dict[str, Any]) -> Dict[str, Any]:
        """Test PDU connectivity and authentication"""
        pdu_id = details.get('pdu_id')
        
        if not pdu_id:
            return {'success': False, 'error': 'Missing pdu_id'}
        
        self.log(f"Testing connection to PDU: {pdu_id}")
        
        pdu = self._get_pdu_credentials(pdu_id)
        if not pdu:
            return {'success': False, 'error': 'PDU not found'}
        
        pdu_url = f"https://{pdu['ip_address']}"
        username = pdu.get('username', 'apc')
        password = pdu.get('password', 'apc')
        
        try:
            success, message = self._login(pdu_url, username, password)
            
            if success:
                self._update_pdu_status(pdu_id, 'online', last_seen=True)
                self._logout()
                return {
                    'success': True,
                    'message': 'Connection successful',
                    'pdu_name': pdu.get('name'),
                    'ip_address': pdu.get('ip_address')
                }
            else:
                self._update_pdu_status(pdu_id, 'error')
                return {
                    'success': False,
                    'error': message,
                    'pdu_name': pdu.get('name'),
                    'ip_address': pdu.get('ip_address')
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
        
        pdu_url = f"https://{pdu['ip_address']}"
        username = pdu.get('username', 'apc')
        password = pdu.get('password', 'apc')
        
        try:
            success, message = self._login(pdu_url, username, password)
            
            if not success:
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
            
            # Update PDU record with discovered info
            update_data = {'last_sync': 'now()'}
            if discovered['model']:
                update_data['model'] = discovered['model']
            if discovered['firmware_version']:
                update_data['firmware_version'] = discovered['firmware_version']
            if discovered['total_outlets']:
                update_data['total_outlets'] = discovered['total_outlets']
            
            self.executor.supabase.table('pdus').update(update_data).eq('id', pdu_id).execute()
            
            # Create outlet records if they don't exist
            if discovered['total_outlets']:
                self._ensure_outlet_records(pdu_id, discovered['total_outlets'])
            
            self._logout()
            
            return {
                'success': True,
                'discovered': discovered,
                'pdu_name': pdu.get('name')
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
        
        pdu_url = f"https://{pdu['ip_address']}"
        username = pdu.get('username', 'apc')
        password = pdu.get('password', 'apc')
        
        try:
            success, message = self._login(pdu_url, username, password)
            
            if not success:
                self._update_pdu_status(pdu_id, 'error')
                return {'success': False, 'error': message}
            
            self._update_pdu_status(pdu_id, 'online', last_seen=True)
            
            # Map action to command
            command_map = {
                'on': OutletCommand.ON_IMMEDIATE,
                'off': OutletCommand.OFF_IMMEDIATE,
                'reboot': OutletCommand.REBOOT_IMMEDIATE,
                'on_delayed': OutletCommand.ON_DELAYED,
                'off_delayed': OutletCommand.OFF_DELAYED,
                'reboot_delayed': OutletCommand.REBOOT_DELAYED,
            }
            
            if action == 'status':
                # Just get status, don't send command
                outlet_states = self._get_outlet_states()
                self._logout()
                return {
                    'success': True,
                    'action': 'status',
                    'outlet_states': outlet_states
                }
            
            command = command_map.get(action)
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
                'message': ctrl_message
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
        
        pdu_url = f"https://{pdu['ip_address']}"
        username = pdu.get('username', 'apc')
        password = pdu.get('password', 'apc')
        
        try:
            success, message = self._login(pdu_url, username, password)
            
            if not success:
                self._update_pdu_status(pdu_id, 'error')
                return {'success': False, 'error': message}
            
            self._update_pdu_status(pdu_id, 'online', last_seen=True)
            
            # Get outlet states
            outlet_states = self._get_outlet_states()
            
            # Update database
            for outlet_num, state in outlet_states.items():
                self._update_outlet_state(pdu_id, outlet_num, state)
            
            # Update PDU last_sync
            self.executor.supabase.table('pdus').update({
                'last_sync': 'now()'
            }).eq('id', pdu_id).execute()
            
            self._logout()
            
            return {
                'success': True,
                'outlet_states': outlet_states,
                'outlets_synced': len(outlet_states)
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
        """Ensure outlet records exist in database for all outlets"""
        try:
            for outlet_num in range(1, outlet_count + 1):
                # Upsert outlet record
                self.executor.supabase.table('pdu_outlets').upsert({
                    'pdu_id': pdu_id,
                    'outlet_number': outlet_num,
                    'outlet_name': f'Outlet {outlet_num}',
                    'outlet_state': 'unknown'
                }, on_conflict='pdu_id,outlet_number').execute()
        except Exception as e:
            self.log(f"Error creating outlet records: {e}", "WARN")
    
    def _update_outlet_state(self, pdu_id: str, outlet_number: int, state: str) -> None:
        """Update single outlet state in database"""
        try:
            self.executor.supabase.table('pdu_outlets').upsert({
                'pdu_id': pdu_id,
                'outlet_number': outlet_number,
                'outlet_state': state,
                'last_updated': 'now()',
                'last_state_change': 'now()' if state != 'unknown' else None
            }, on_conflict='pdu_id,outlet_number').execute()
        except Exception as e:
            self.log(f"Error updating outlet state: {e}", "WARN")
