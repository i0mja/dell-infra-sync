"""
Dell iDRAC Redfish Operations Module

Provides high-level operations for Dell iDRAC using the Redfish API.
All operations go through DellRedfishAdapter for throttling, logging, and error handling.
"""

from typing import Dict, List, Optional, Any, Tuple
import time
from .adapter import DellRedfishAdapter
from .helpers import DellRedfishHelpers
from .errors import DellRedfishError


class DellOperations:
    """
    High-level iDRAC operations using Dell Redfish API patterns.
    
    This class provides reliable methods for common iDRAC tasks following
    Dell's documented Redfish patterns while maintaining our throttling
    and logging infrastructure.
    """
    
    def __init__(self, adapter: DellRedfishAdapter):
        """
        Initialize operations with adapter.
        
        Args:
            adapter: DellRedfishAdapter instance for making API calls
        """
        self.adapter = adapter
        self.helpers = DellRedfishHelpers(adapter)
    
    # System Information Operations
    
    def get_kvm_launch_info(
        self,
        ip: str,
        username: str,
        password: str,
        server_id: str = None,
        job_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Get KVM console launch information with iDRAC version detection.
        
        - iDRAC9+ (firmware 3.x+): Uses GetKVMLaunchInfo endpoint with SSO
        - iDRAC8 (firmware 2.x): Fallback to direct console URL with manual login
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            server_id: Optional server ID for logging
            job_id: Optional job ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Contains console_url, session_type, and optionally requires_login
            
        Raises:
            DellRedfishError: On API errors
        """
        # Check iDRAC version
        try:
            manager_info = self.adapter.make_request(
                method='GET',
                ip=ip,
                endpoint='/redfish/v1/Managers/iDRAC.Embedded.1',
                username=username,
                password=password,
                operation_name='Get Manager Info',
                job_id=job_id,
                server_id=server_id,
                user_id=user_id
            )
            
            firmware = manager_info.get('FirmwareVersion', '')
            
            # iDRAC9+ firmware starts with 3.x, 4.x, 5.x, 6.x, 7.x
            # iDRAC8 firmware starts with 2.x
            is_idrac9_plus = firmware and firmware[0].isdigit() and int(firmware[0]) >= 3
            
            if is_idrac9_plus:
                # Use GetKVMLaunchInfo for iDRAC9+ with SSO
                return self._get_kvm_idrac9(ip, username, password, server_id, job_id, user_id)
            else:
                # Fallback for iDRAC8 and older
                return self._get_kvm_fallback(ip, username, password)
                
        except Exception as e:
            # If version check fails, try iDRAC9 method first
            try:
                return self._get_kvm_idrac9(ip, username, password, server_id, job_id, user_id)
            except:
                # Final fallback
                return self._get_kvm_fallback(ip, username, password)
    
    def _get_kvm_idrac9(
        self,
        ip: str,
        username: str,
        password: str,
        server_id: str = None,
        job_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Get KVM launch info for iDRAC9+ using Dell's official GetKVMSession API.
        
        Official Dell process:
        1. Set virtual console plugin to HTML5
        2. Get KVM session temp credentials
        3. Build console URL with temp credentials for SSO
        """
        try:
            # Step 1: Set Virtual Console plugin type to HTML5
            self.adapter.make_request(
                method='PATCH',
                ip=ip,
                endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Attributes',
                username=username,
                password=password,
                payload={"Attributes": {"VirtualConsole.1.PluginType": "HTML5"}},
                operation_name='Set Virtual Console Plugin',
                job_id=job_id,
                server_id=server_id,
                user_id=user_id
            )
            
            # Step 2: Get KVM Session with temp credentials
            # SessionTypeName should be a simple identifier like "HTML5"
            kvm_response = self.adapter.make_request(
                method='POST',
                ip=ip,
                endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Oem/Dell/DelliDRACCardService/Actions/DelliDRACCardService.GetKVMSession',
                username=username,
                password=password,
                payload={"SessionTypeName": "HTML5"},
                operation_name='Get KVM Session',
                job_id=job_id,
                server_id=server_id,
                user_id=user_id
            )
            
            temp_username = kvm_response.get('TempUsername', '')
            temp_password = kvm_response.get('TempPassword', '')
            
            if not temp_username or not temp_password:
                raise DellRedfishError(
                    message="Failed to get temporary KVM credentials",
                    error_code='NO_TEMP_CREDS'
                )
            
            # Step 3: Build authenticated console URL with SSO
            console_url = f"https://{ip}/console?username={username}&tempUsername={temp_username}&tempPassword={temp_password}"
            
            return {
                'console_url': console_url,
                'session_type': 'HTML5',
                'requires_login': False,
                'temp_username': temp_username
            }
            
        except DellRedfishError:
            raise
        except Exception as e:
            # If official method fails, raise to trigger fallback
            raise DellRedfishError(
                message=f"GetKVMSession failed: {str(e)}",
                error_code='KVM_SESSION_FAILED'
            )
    
    def _get_kvm_fallback(
        self,
        ip: str,
        username: str,
        password: str
    ) -> Dict[str, Any]:
        """
        Fallback KVM launch when SSO is not available.
        Returns direct console URL - user will need to log in manually.
        """
        return {
            'console_url': f"https://{ip}/console",
            'session_type': 'HTML5',
            'requires_login': True,
            'message': 'SSO console launch not available. Please log in manually.'
        }
    
    def get_system_info(
        self,
        ip: str,
        username: str,
        password: str,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Get comprehensive system information from iDRAC.
        
        Dell endpoint: GET /redfish/v1/Systems/System.Embedded.1
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: System information including model, BIOS version, health status
            
        Raises:
            DellRedfishError: On API errors
        """
        system_response = self.adapter.make_request(
            method='GET',
            ip=ip,
            endpoint='/redfish/v1/Systems/System.Embedded.1',
            username=username,
            password=password,
            operation_name='Get System Info',
            server_id=server_id,
            user_id=user_id
        )
        
        manager_response = self.adapter.make_request(
            method='GET',
            ip=ip,
            endpoint='/redfish/v1/Managers/iDRAC.Embedded.1',
            username=username,
            password=password,
            operation_name='Get Manager Info',
            server_id=server_id,
            user_id=user_id
        )
        
        return {
            'system': {
                'hostname': system_response.get('HostName'),
                'model': system_response.get('Model'),
                'manufacturer': system_response.get('Manufacturer'),
                'service_tag': system_response.get('SKU'),
                'serial_number': system_response.get('SerialNumber'),
                'bios_version': system_response.get('BiosVersion'),
                'power_state': system_response.get('PowerState'),
                'health': system_response.get('Status', {}).get('Health'),
                'cpu_count': system_response.get('ProcessorSummary', {}).get('Count'),
                'memory_gb': system_response.get('MemorySummary', {}).get('TotalSystemMemoryGiB'),
            },
            'manager': {
                'idrac_firmware': manager_response.get('FirmwareVersion'),
                'model': manager_response.get('Model'),
                'mac_address': manager_response.get('NetworkProtocol', {}).get('HostName'),
            },
            'redfish_version': system_response.get('RedfishVersion', '1.0.0')
        }
    
    def get_firmware_inventory(
        self,
        ip: str,
        username: str,
        password: str,
        server_id: str = None,
        user_id: str = None
    ) -> List[Dict[str, Any]]:
        """
        Get firmware inventory from iDRAC.
        
        Dell endpoint: GET /redfish/v1/UpdateService/FirmwareInventory
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            list: List of firmware components with versions
            
        Raises:
            DellRedfishError: On API errors
        """
        inventory_response = self.adapter.make_request(
            method='GET',
            ip=ip,
            endpoint='/redfish/v1/UpdateService/FirmwareInventory',
            username=username,
            password=password,
            operation_name='Get Firmware Inventory',
            server_id=server_id,
            user_id=user_id
        )
        
        firmware_list = []
        members = inventory_response.get('Members', [])
        
        # Fetch details for each firmware component
        for member in members:
            member_uri = member.get('@odata.id', '')
            if member_uri:
                try:
                    component = self.adapter.make_request(
                        method='GET',
                        ip=ip,
                        endpoint=member_uri,
                        username=username,
                        password=password,
                        operation_name='Get Firmware Component',
                        server_id=server_id,
                        user_id=user_id
                    )
                    
                    firmware_list.append({
                        'name': component.get('Name'),
                        'version': component.get('Version'),
                        'updateable': component.get('Updateable'),
                        'status': component.get('Status'),
                        'id': component.get('Id')
                    })
                except:
                    # Skip components that can't be read
                    continue
        
        return firmware_list
    
    # Firmware Update Operations
    
    def update_firmware_simple(
        self,
        ip: str,
        username: str,
        password: str,
        firmware_uri: str,
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Perform firmware update using SimpleUpdate method.
        
        Dell pattern:
        - POST /redfish/v1/UpdateService/Actions/UpdateService.SimpleUpdate
        - Monitor task until completion
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            firmware_uri: HTTP/HTTPS URI to firmware file (.exe)
            job_id: Optional job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Update results including task status
            
        Raises:
            DellRedfishError: On API errors
        """
        # Initiate SimpleUpdate
        payload = {
            'ImageURI': firmware_uri,
            'TransferProtocol': 'HTTP'
        }
        
        response = self.adapter.make_request(
            method='POST',
            ip=ip,
            endpoint='/redfish/v1/UpdateService/Actions/UpdateService.SimpleUpdate',
            username=username,
            password=password,
            payload=payload,
            operation_name='Initiate Firmware Update',
            job_id=job_id,
            server_id=server_id,
            user_id=user_id
        )
        
        # Get task URI from response
        task_uri = self.helpers.get_task_uri_from_response(response)
        if not task_uri:
            raise DellRedfishError(
                message="Failed to get task URI from firmware update response",
                error_code='NO_TASK_URI'
            )
        
        # Monitor task
        task_result = self.helpers.wait_for_task(
            ip=ip,
            username=username,
            password=password,
            task_uri=task_uri,
            timeout=1800,  # 30 minutes
            operation_name='Firmware Update',
            job_id=job_id,
            server_id=server_id,
            user_id=user_id
        )
        
        return {
            'task_uri': task_uri,
            'task_state': task_result.get('TaskState'),
            'messages': task_result.get('Messages', []),
            'percent_complete': task_result.get('PercentComplete', 100)
        }
    
    def monitor_firmware_task(
        self,
        ip: str,
        username: str,
        password: str,
        task_uri: str,
        timeout: int = 1800,
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Monitor firmware update task until completion.
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            task_uri: Task URI from update initiation
            timeout: Maximum wait time in seconds
            job_id: Optional job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Final task status
            
        Raises:
            DellRedfishError: On task failure or timeout
        """
        return self.helpers.wait_for_task(
            ip=ip,
            username=username,
            password=password,
            task_uri=task_uri,
            timeout=timeout,
            operation_name='Firmware Task Monitor',
            job_id=job_id,
            server_id=server_id,
            user_id=user_id
        )
    
    def update_firmware_multipart(
        self,
        ip: str,
        username: str,
        password: str,
        dup_file_path: str,
        install_option: str = "NextReboot",
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Upload and install firmware using multipart/form-data (Dell official method).
        
        This method uploads DUP files directly to iDRAC without requiring an HTTP file server,
        making it ideal for air-gapped environments.
        
        Uses Dell's official pattern from DeviceFirmwareMultipartUploadREDFISH.py:
        - POST /redfish/v1/UpdateService/MultipartUpload
        - Direct binary upload of .exe DUP file
        - Supports immediate or staged installation
        
        Requirements:
        - iDRAC8 firmware 2.x or newer
        - Valid Dell Update Package (.exe file)
        - Local file system access to DUP file
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            dup_file_path: Local path to Dell Update Package (.exe)
            install_option: "Now" for immediate, "NextReboot" for staged
            job_id: Optional job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Upload results with task_uri and status
            
        Raises:
            DellRedfishError: On upload or API errors
            FileNotFoundError: If DUP file doesn't exist
        """
        import os
        
        # Validate DUP file exists
        if not os.path.exists(dup_file_path):
            raise FileNotFoundError(f"DUP file not found: {dup_file_path}")
        
        # TODO: Import and use Dell's official multipart upload function
        # from .lib.DeviceFirmwareMultipartUploadREDFISH import multipart_upload_firmware
        # 
        # For now, implement basic multipart upload pattern
        
        try:
            import requests
            from requests.auth import HTTPBasicAuth
            
            url = f'https://{ip}/redfish/v1/UpdateService/MultipartUpload'
            
            with open(dup_file_path, 'rb') as dup_file:
                files = {
                    'UpdateFile': (
                        os.path.basename(dup_file_path),
                        dup_file,
                        'application/octet-stream'
                    )
                }
                
                data = {
                    '@Redfish.OperationApplyTime': install_option,
                    'Targets': []  # Empty = apply to all applicable components
                }
                
                # Make request through adapter for logging
                response = requests.post(
                    url,
                    files=files,
                    data=data,
                    auth=HTTPBasicAuth(username, password),
                    verify=False,
                    timeout=300  # 5 min timeout for upload
                )
                
                # Log the operation
                self.adapter.log_command(
                    ip=ip,
                    endpoint='/redfish/v1/UpdateService/MultipartUpload',
                    method='POST',
                    success=response.status_code == 202,
                    status_code=response.status_code,
                    response_time_ms=int(response.elapsed.total_seconds() * 1000),
                    operation_name='Multipart Firmware Upload',
                    job_id=job_id,
                    server_id=server_id,
                    user_id=user_id,
                    request_body={'firmware_file': os.path.basename(dup_file_path), 'install_option': install_option},
                    response_body=response.json() if response.status_code == 202 else {'error': response.text}
                )
                
                if response.status_code == 202:
                    task_uri = response.headers.get('Location', '')
                    
                    # Monitor task if immediate install
                    if install_option == "Now" and task_uri:
                        task_result = self.helpers.wait_for_task(
                            ip=ip,
                            username=username,
                            password=password,
                            task_uri=task_uri,
                            timeout=1800,  # 30 minutes
                            operation_name='Multipart Firmware Install',
                            job_id=job_id,
                            server_id=server_id,
                            user_id=user_id
                        )
                        
                        return {
                            'success': True,
                            'method': 'multipart_upload',
                            'task_uri': task_uri,
                            'install_option': install_option,
                            'task_state': task_result.get('TaskState'),
                            'messages': task_result.get('Messages', [])
                        }
                    
                    return {
                        'success': True,
                        'method': 'multipart_upload',
                        'task_uri': task_uri,
                        'install_option': install_option,
                        'status': 'staged' if install_option == "NextReboot" else 'installing'
                    }
                else:
                    raise DellRedfishError(
                        message=f"Multipart upload failed: {response.text}",
                        error_code='MULTIPART_UPLOAD_FAILED',
                        status_code=response.status_code
                    )
                    
        except Exception as e:
            if isinstance(e, DellRedfishError):
                raise
            raise DellRedfishError(
                message=f"Multipart firmware upload error: {str(e)}",
                error_code='MULTIPART_UPLOAD_ERROR'
            )
    
    def get_firmware_inventory(
        self,
        ip: str,
        username: str,
        password: str,
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> List[Dict[str, Any]]:
        """
        Get comprehensive firmware inventory from iDRAC.
        
        Uses Dell's official pattern from GetFirmwareInventoryREDFISH.py to retrieve
        all installed firmware versions for comparison with catalog.
        
        Dell pattern:
        - GET /redfish/v1/UpdateService/FirmwareInventory
        - Iterate through each component for detailed info
        - Returns Name, Version, Updateable, ComponentType
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            job_id: Optional job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            list: Firmware components with version and updateable status
            
        Example return:
            [
                {
                    'Name': 'Integrated Dell Remote Access Controller',
                    'Version': '7.00.00.174',
                    'Updateable': True,
                    'ComponentType': 'FRMW'
                },
                {
                    'Name': 'BIOS',
                    'Version': '2.23.0',
                    'Updateable': True,
                    'ComponentType': 'BIOS'
                }
            ]
            
        Raises:
            DellRedfishError: On API errors
        """
        # Get firmware inventory collection
        response = self.adapter.make_request(
            method='GET',
            ip=ip,
            endpoint='/redfish/v1/UpdateService/FirmwareInventory',
            username=username,
            password=password,
            operation_name='Get Firmware Inventory',
            job_id=job_id,
            server_id=server_id,
            user_id=user_id
        )
        
        members = response.get('Members', [])
        inventory = []
        
        # Get detailed info for each component
        for member in members:
            member_uri = member.get('@odata.id', '')
            if not member_uri:
                continue
            
            try:
                component = self.adapter.make_request(
                    method='GET',
                    ip=ip,
                    endpoint=member_uri,
                    username=username,
                    password=password,
                    operation_name='Get Firmware Component',
                    job_id=job_id,
                    server_id=server_id,
                    user_id=user_id
                )
                
                # Extract Dell-specific component type
                component_type = None
                oem = component.get('Oem', {})
                if 'Dell' in oem:
                    dell_sw = oem['Dell'].get('DellSoftwareInventory', {})
                    component_type = dell_sw.get('ComponentType')
                
                inventory.append({
                    'Name': component.get('Name'),
                    'Id': component.get('Id'),
                    'Version': component.get('Version'),
                    'Updateable': component.get('Updateable', False),
                    'ComponentType': component_type,
                    'Status': component.get('Status', {}).get('State', 'Unknown')
                })
                
            except Exception as e:
                # Log but don't fail entire inventory for one component
                print(f"Warning: Could not get info for {member_uri}: {e}")
                continue
        
        return inventory
    
    # SCP (Server Configuration Profile) Operations
    
    def export_scp(
        self,
        ip: str,
        username: str,
        password: str,
        target: str = "ALL",
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Export Server Configuration Profile (SCP).
        
        Dell pattern:
        - POST /redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration
        - Local export without network share (iDRAC 9 3.30+)
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            target: Export target (ALL, IDRAC, BIOS, NIC, RAID)
            job_id: Optional job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: SCP content and metadata
            
        Raises:
            DellRedfishError: On API errors
        """
        # Check if local export is supported
        if not self.helpers.check_feature_support(ip, username, password, 'local_scp_export', server_id, user_id):
            raise DellRedfishError(
                message="Local SCP export requires iDRAC 9 firmware 3.30 or later",
                error_code='FEATURE_NOT_SUPPORTED'
            )
        
        # Initiate export
        payload = {
            'ExportFormat': 'JSON',
            'ShareParameters': {
                'Target': target
            }
        }
        
        response = self.adapter.make_request(
            method='POST',
            ip=ip,
            endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration',
            username=username,
            password=password,
            payload=payload,
            operation_name='Export SCP',
            job_id=job_id,
            server_id=server_id,
            user_id=user_id
        )
        
        # Get task URI
        task_uri = self.helpers.get_task_uri_from_response(response)
        if not task_uri:
            raise DellRedfishError(
                message="Failed to get task URI from SCP export response",
                error_code='NO_TASK_URI'
            )
        
        # Wait for export to complete
        task_result = self.helpers.wait_for_task(
            ip=ip,
            username=username,
            password=password,
            task_uri=task_uri,
            timeout=300,
            operation_name='SCP Export',
            job_id=job_id,
            server_id=server_id,
            user_id=user_id
        )
        
        # Extract SCP content from task result
        # Dell returns SCP as base64 in Messages[0].Message or in Oem field
        messages = task_result.get('Messages', [])
        scp_content = None
        
        if messages and len(messages) > 0:
            # SCP typically in first message
            message_text = messages[0].get('Message', '')
            if message_text:
                scp_content = message_text
        
        return {
            'scp_content': scp_content,
            'target': target,
            'task_uri': task_uri,
            'export_timestamp': time.time()
        }
    
    def import_scp(
        self,
        ip: str,
        username: str,
        password: str,
        scp_content: str,
        shutdown_type: str = "Graceful",
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Import Server Configuration Profile (SCP).
        
        Dell pattern:
        - POST /redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ImportSystemConfiguration
        - Monitor job until completion
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            scp_content: SCP XML/JSON content
            shutdown_type: Graceful, Forced, NoReboot
            job_id: Optional job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Import job results
            
        Raises:
            DellRedfishError: On API errors
        """
        # Initiate import
        payload = {
            'ImportBuffer': scp_content,
            'ShareParameters': {
                'Target': 'ALL'
            },
            'ShutdownType': shutdown_type
        }
        
        response = self.adapter.make_request(
            method='POST',
            ip=ip,
            endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ImportSystemConfiguration',
            username=username,
            password=password,
            payload=payload,
            operation_name='Import SCP',
            job_id=job_id,
            server_id=server_id,
            user_id=user_id
        )
        
        # Extract job ID from response
        job_id_str = response.get('JobId') or response.get('Id')
        if not job_id_str:
            raise DellRedfishError(
                message="Failed to get job ID from SCP import response",
                error_code='NO_JOB_ID'
            )
        
        # Monitor job
        job_result = self.helpers.wait_for_job(
            ip=ip,
            username=username,
            password=password,
            job_id_str=job_id_str,
            timeout=1800,
            operation_name='SCP Import',
            parent_job_id=job_id,
            server_id=server_id,
            user_id=user_id
        )
        
        return {
            'job_id': job_id_str,
            'job_state': job_result.get('JobState'),
            'message': job_result.get('Message'),
            'percent_complete': job_result.get('PercentComplete', 100)
        }
    
    # Boot Configuration Operations
    
    def get_boot_order(
        self,
        ip: str,
        username: str,
        password: str,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Get current boot configuration.
        
        Dell endpoint: GET /redfish/v1/Systems/System.Embedded.1
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Boot configuration (order, mode, override settings)
            
        Raises:
            DellRedfishError: On API errors
        """
        response = self.adapter.make_request(
            method='GET',
            ip=ip,
            endpoint='/redfish/v1/Systems/System.Embedded.1',
            username=username,
            password=password,
            operation_name='Get Boot Order',
            server_id=server_id,
            user_id=user_id
        )
        
        boot = response.get('Boot', {})
        return {
            'boot_order': boot.get('BootOrder', []),
            'boot_mode': boot.get('BootSourceOverrideMode'),
            'boot_source_override_enabled': boot.get('BootSourceOverrideEnabled'),
            'boot_source_override_target': boot.get('BootSourceOverrideTarget'),
            'uefi_target': boot.get('UefiTargetBootSourceOverride')
        }
    
    def set_boot_order(
        self,
        ip: str,
        username: str,
        password: str,
        boot_order: List[str],
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Set boot device order.
        
        Dell pattern: PATCH /redfish/v1/Systems/System.Embedded.1
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            boot_order: Ordered list of boot devices
            job_id: Optional job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Update status
            
        Raises:
            DellRedfishError: On API errors
        """
        payload = {
            'Boot': {
                'BootOrder': boot_order
            }
        }
        
        response = self.adapter.make_request(
            method='PATCH',
            ip=ip,
            endpoint='/redfish/v1/Systems/System.Embedded.1',
            username=username,
            password=password,
            payload=payload,
            operation_name='Set Boot Order',
            job_id=job_id,
            server_id=server_id,
            user_id=user_id
        )
        
        return {'status': 'success', 'response': response}
    
    def set_one_time_boot(
        self,
        ip: str,
        username: str,
        password: str,
        boot_device: str,
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Set one-time boot device.
        
        Dell pattern: PATCH /redfish/v1/Systems/System.Embedded.1
        
        Valid boot devices:
        - Pxe: PXE boot
        - Cd: Virtual CD/DVD
        - Hdd: Hard drive
        - BiosSetup: Enter BIOS setup
        - None: Normal boot order
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            boot_device: Boot device target
            job_id: Optional job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Update status
            
        Raises:
            DellRedfishError: On API errors
        """
        payload = {
            'Boot': {
                'BootSourceOverrideEnabled': 'Once',
                'BootSourceOverrideTarget': boot_device
            }
        }
        
        response = self.adapter.make_request(
            method='PATCH',
            ip=ip,
            endpoint='/redfish/v1/Systems/System.Embedded.1',
            username=username,
            password=password,
            payload=payload,
            operation_name='Set One-Time Boot',
            job_id=job_id,
            server_id=server_id,
            user_id=user_id
        )
        
        return {'status': 'success', 'boot_device': boot_device, 'response': response}
    
    # Power Control Operations
    
    def graceful_shutdown(
        self,
        ip: str,
        username: str,
        password: str,
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Perform graceful shutdown.
        
        Dell pattern: POST /redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            job_id: Optional job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Operation status
            
        Raises:
            DellRedfishError: On API errors
        """
        return self._reset_system(
            ip, username, password, 'GracefulShutdown',
            job_id, server_id, user_id
        )
    
    def graceful_reboot(
        self,
        ip: str,
        username: str,
        password: str,
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Perform graceful reboot.
        
        Dell pattern: POST /redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            job_id: Optional job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Operation status
            
        Raises:
            DellRedfishError: On API errors
        """
        return self._reset_system(
            ip, username, password, 'GracefulRestart',
            job_id, server_id, user_id
        )
    
    def power_on(
        self,
        ip: str,
        username: str,
        password: str,
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Power on the system.
        
        Dell pattern: POST /redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            job_id: Optional job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Operation status
            
        Raises:
            DellRedfishError: On API errors
        """
        return self._reset_system(
            ip, username, password, 'On',
            job_id, server_id, user_id
        )
    
    def _reset_system(
        self,
        ip: str,
        username: str,
        password: str,
        reset_type: str,
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Internal method for system reset operations.
        
        Valid reset types: On, ForceOff, GracefulRestart, GracefulShutdown, ForceRestart
        """
        payload = {'ResetType': reset_type}
        
        response = self.adapter.make_request(
            method='POST',
            ip=ip,
            endpoint='/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset',
            username=username,
            password=password,
            payload=payload,
            operation_name=f'System Reset ({reset_type})',
            job_id=job_id,
            server_id=server_id,
            user_id=user_id
        )
        
        return {'status': 'success', 'reset_type': reset_type, 'response': response}
    
    # Health and Monitoring Operations
    
    def get_current_post_state(
        self,
        ip: str,
        username: str,
        password: str,
        server_id: str = None,
        user_id: str = None
    ) -> str:
        """
        Get current server POST (Power-On Self-Test) state.
        
        Dell pattern: GET /redfish/v1/Managers/iDRAC.Embedded.1/Attributes
        
        Important for firmware operations - must wait for POST to complete.
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            str: POST state (InPOST, OutOfPOST, etc.)
            
        Raises:
            DellRedfishError: On API errors
        """
        if not self.helpers.check_feature_support(ip, username, password, 'post_state_check', server_id, user_id):
            return 'UNSUPPORTED'
        
        response = self.adapter.make_request(
            method='GET',
            ip=ip,
            endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Attributes',
            username=username,
            password=password,
            operation_name='Get POST State',
            server_id=server_id,
            user_id=user_id
        )
        
        attributes = response.get('Attributes', {})
        # Different iDRAC versions use different attribute names
        post_state = (
            attributes.get('ServerPwr.1.ServerPwrState') or
            attributes.get('ServerBoot.1.BootOnce') or
            'Unknown'
        )
        
        return post_state
    
    def wait_for_post_complete(
        self,
        ip: str,
        username: str,
        password: str,
        timeout: int = 300,
        poll_interval: int = 10,
        server_id: str = None,
        user_id: str = None
    ) -> bool:
        """
        Wait for server POST to complete before proceeding with operations.
        
        Critical for firmware updates - cannot apply updates while in POST.
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            timeout: Maximum wait time in seconds
            poll_interval: Seconds between checks
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            bool: True if POST completed, False if timeout
            
        Raises:
            DellRedfishError: On API errors
        """
        start_time = time.time()
        
        while (time.time() - start_time) < timeout:
            post_state = self.get_current_post_state(ip, username, password, server_id, user_id)
            
            if post_state in ('OutOfPOST', 'UNSUPPORTED', 'Unknown'):
                self.adapter.logger.info(f"POST complete for {ip} (state: {post_state})")
                return True
            
            self.adapter.logger.info(f"Waiting for POST to complete on {ip} (current: {post_state})")
            time.sleep(poll_interval)
        
        self.adapter.logger.warning(f"POST wait timeout for {ip}")
        return False
    
    def get_health_status(
        self,
        ip: str,
        username: str,
        password: str,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Get comprehensive health status.
        
        Dell endpoints:
        - GET /redfish/v1/Systems/System.Embedded.1
        - GET /redfish/v1/Chassis/System.Embedded.1
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Health information (overall, CPU, memory, storage, etc.)
            
        Raises:
            DellRedfishError: On API errors
        """
        system_response = self.adapter.make_request(
            method='GET',
            ip=ip,
            endpoint='/redfish/v1/Systems/System.Embedded.1',
            username=username,
            password=password,
            operation_name='Get System Health',
            server_id=server_id,
            user_id=user_id
        )
        
        chassis_response = self.adapter.make_request(
            method='GET',
            ip=ip,
            endpoint='/redfish/v1/Chassis/System.Embedded.1',
            username=username,
            password=password,
            operation_name='Get Chassis Health',
            server_id=server_id,
            user_id=user_id
        )
        
        # Parse health data
        system_status = system_response.get('Status', {})
        processor_summary = system_response.get('ProcessorSummary', {})
        memory_summary = system_response.get('MemorySummary', {})
        
        return {
            'overall_health': system_status.get('Health'),
            'health_rollup': system_status.get('HealthRollup'),
            'power_state': system_response.get('PowerState'),
            'processor': {
                'health': processor_summary.get('Status', {}).get('Health'),
                'count': processor_summary.get('Count')
            },
            'memory': {
                'health': memory_summary.get('Status', {}).get('Health'),
                'total_gb': memory_summary.get('TotalSystemMemoryGiB')
            },
            'chassis_status': chassis_response.get('Status', {}).get('Health'),
            'chassis_power_state': chassis_response.get('PowerState')
        }
    
    # Session Management Operations
    
    def create_session(
        self,
        ip: str,
        username: str,
        password: str,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Create a Redfish session with iDRAC.
        
        Dell endpoint: POST /redfish/v1/SessionService/Sessions
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Session info with 'token', 'location', 'session_id'
            
        Raises:
            DellRedfishError: On session creation failure
        """
        payload = {
            'UserName': username,
            'Password': password
        }
        
        response = self.adapter.make_request(
            method='POST',
            ip=ip,
            endpoint='/redfish/v1/SessionService/Sessions',
            username=username,
            password=password,
            payload=payload,
            operation_name='Create Session',
            server_id=server_id,
            user_id=user_id,
            return_response=True  # Need headers
        )
        
        session_token = response.headers.get('X-Auth-Token')
        session_location = response.headers.get('Location')
        session_data = response.json()
        
        return {
            'token': session_token,
            'location': session_location,
            'session_id': session_data.get('Id'),
            'username': session_data.get('UserName')
        }
    
    def delete_session(
        self,
        ip: str,
        session_token: str,
        session_uri: str,
        username: str = None,
        password: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> bool:
        """
        Delete a Redfish session (logout).
        
        Dell endpoint: DELETE /redfish/v1/SessionService/Sessions/{sessionId}
        
        Args:
            ip: iDRAC IP address
            session_token: X-Auth-Token from session creation
            session_uri: Session location URI
            username: Optional fallback username
            password: Optional fallback password
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            bool: True if session deleted successfully
            
        Raises:
            DellRedfishError: On deletion failure
        """
        # Extract just the path from full URI if needed
        if session_uri.startswith('http'):
            from urllib.parse import urlparse
            session_uri = urlparse(session_uri).path
        
        try:
            self.adapter.make_request(
                method='DELETE',
                ip=ip,
                endpoint=session_uri,
                username=username,
                password=password,
                auth_token=session_token,
                operation_name='Delete Session',
                server_id=server_id,
                user_id=user_id
            )
            return True
        except Exception as e:
            # Session deletion is best-effort
            return False
    
    # Event Log Operations
    
    def get_sel_logs(
        self,
        ip: str,
        username: str,
        password: str,
        limit: int = 50,
        server_id: str = None,
        user_id: str = None
    ) -> List[Dict[str, Any]]:
        """
        Get System Event Log (SEL) entries from iDRAC.
        
        Dell endpoint: GET /redfish/v1/Managers/iDRAC.Embedded.1/Logs/Sel
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            limit: Maximum number of entries to return
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            list: SEL log entries with timestamp, severity, message
            
        Raises:
            DellRedfishError: On API errors
        """
        response = self.adapter.make_request(
            method='GET',
            ip=ip,
            endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Logs/Sel',
            username=username,
            password=password,
            operation_name='Get SEL Logs',
            server_id=server_id,
            user_id=user_id
        )
        
        members = response.get('Members', [])
        
        # Parse and return log entries
        logs = []
        for member in members[:limit]:
            logs.append({
                'id': member.get('Id'),
                'timestamp': member.get('Created'),
                'severity': member.get('Severity'),
                'message': member.get('Message'),
                'sensor_type': member.get('SensorType'),
                'sensor_number': member.get('SensorNumber'),
                'event_id': member.get('EventId'),
                'raw_data': member
            })
        
        return logs
    
    def get_lifecycle_logs(
        self,
        ip: str,
        username: str,
        password: str,
        limit: int = 50,
        server_id: str = None,
        user_id: str = None
    ) -> List[Dict[str, Any]]:
        """
        Get Lifecycle Controller logs from iDRAC.
        
        Dell endpoint: GET /redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Lclog/Entries
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            limit: Maximum number of entries to return
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            list: Lifecycle log entries with timestamp, severity, message
            
        Raises:
            DellRedfishError: On API errors
        """
        response = self.adapter.make_request(
            method='GET',
            ip=ip,
            endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Lclog/Entries',
            username=username,
            password=password,
            operation_name='Get Lifecycle Logs',
            server_id=server_id,
            user_id=user_id
        )
        
        members = response.get('Members', [])
        
        # Parse and return log entries
        logs = []
        for member in members[:limit]:
            logs.append({
                'id': member.get('Id'),
                'timestamp': member.get('Created'),
                'severity': member.get('Severity'),
                'message': member.get('Message'),
                'message_id': member.get('MessageId'),
                'category': member.get('Category'),
                'raw_data': member
            })
        
        return logs
    
    # Virtual Media Operations
    
    def get_virtual_media_status(
        self,
        ip: str,
        username: str,
        password: str,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Get virtual media status from iDRAC.
        
        Dell endpoint: GET /redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Virtual media status with CD and RemovableDisk info
            
        Raises:
            DellRedfishError: On API errors
        """
        response = self.adapter.make_request(
            method='GET',
            ip=ip,
            endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia',
            username=username,
            password=password,
            operation_name='Get Virtual Media Status',
            server_id=server_id,
            user_id=user_id
        )
        
        members = response.get('Members', [])
        
        result = {
            'cd': None,
            'removable_disk': None
        }
        
        for member_ref in members:
            # Get each virtual media device details
            device_uri = member_ref.get('@odata.id', '')
            if not device_uri:
                continue
            
            device_response = self.adapter.make_request(
                method='GET',
                ip=ip,
                endpoint=device_uri,
                username=username,
                password=password,
                operation_name='Get Virtual Media Device',
                server_id=server_id,
                user_id=user_id
            )
            
            media_type = device_response.get('MediaTypes', [None])[0]
            
            device_info = {
                'id': device_response.get('Id'),
                'name': device_response.get('Name'),
                'inserted': device_response.get('Inserted', False),
                'image': device_response.get('Image'),
                'write_protected': device_response.get('WriteProtected'),
                'media_types': device_response.get('MediaTypes', [])
            }
            
            if 'CD' in str(media_type):
                result['cd'] = device_info
            elif 'USBStick' in str(media_type):
                result['removable_disk'] = device_info
        
        return result
    
    def mount_virtual_media(
        self,
        ip: str,
        username: str,
        password: str,
        image_url: str,
        media_type: str = 'CD',
        write_protected: bool = True,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Mount virtual media on iDRAC.
        
        Dell endpoint: POST /redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{Id}/Actions/VirtualMedia.InsertMedia
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            image_url: URL to ISO/IMG file (HTTP/HTTPS/NFS/CIFS)
            media_type: 'CD' or 'USBStick'
            write_protected: Whether media is write-protected
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Mount operation result
            
        Raises:
            DellRedfishError: On mount failure
        """
        # Determine virtual media device ID
        device_id = 'CD' if media_type == 'CD' else 'RemovableDisk'
        
        payload = {
            'Image': image_url,
            'Inserted': True,
            'WriteProtected': write_protected
        }
        
        response = self.adapter.make_request(
            method='POST',
            ip=ip,
            endpoint=f'/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{device_id}/Actions/VirtualMedia.InsertMedia',
            username=username,
            password=password,
            payload=payload,
            operation_name='Mount Virtual Media',
            server_id=server_id,
            user_id=user_id
        )
        
        return {
            'success': True,
            'message': f'Virtual media mounted: {image_url}',
            'device_id': device_id,
            'image_url': image_url
        }
    
    def unmount_virtual_media(
        self,
        ip: str,
        username: str,
        password: str,
        media_type: str = 'CD',
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Unmount virtual media from iDRAC.
        
        Dell endpoint: POST /redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{Id}/Actions/VirtualMedia.EjectMedia
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            media_type: 'CD' or 'USBStick'
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Unmount operation result
            
        Raises:
            DellRedfishError: On unmount failure
        """
        # Determine virtual media device ID
        device_id = 'CD' if media_type == 'CD' else 'RemovableDisk'
        
        response = self.adapter.make_request(
            method='POST',
            ip=ip,
            endpoint=f'/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{device_id}/Actions/VirtualMedia.EjectMedia',
            username=username,
            password=password,
            payload={},
            operation_name='Unmount Virtual Media',
            server_id=server_id,
            user_id=user_id
        )
        
        return {
            'success': True,
            'message': f'Virtual media unmounted from {device_id}',
            'device_id': device_id
        }
    
    # Catalog-Based Firmware Update
    
    def get_bios_attributes(
        self,
        ip: str,
        username: str,
        password: str,
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Get current BIOS attributes from iDRAC.
        
        Dell pattern: GET /redfish/v1/Systems/System.Embedded.1/Bios
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            job_id: Optional job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: BIOS attributes with version info
        """
        response = self.adapter.make_request(
            method='GET',
            ip=ip,
            endpoint='/redfish/v1/Systems/System.Embedded.1/Bios',
            username=username,
            password=password,
            operation_name='Get BIOS Attributes',
            job_id=job_id,
            server_id=server_id,
            user_id=user_id
        )
        
        return {
            'attributes': response.get('Attributes', {}),
            'bios_version': response.get('BiosVersion'),
            'attribute_registry': response.get('AttributeRegistry'),
            '@odata.id': response.get('@odata.id')
        }
    
    def get_pending_bios_attributes(
        self,
        ip: str,
        username: str,
        password: str,
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Get pending (scheduled) BIOS attributes from iDRAC.
        
        Dell pattern: GET /redfish/v1/Systems/System.Embedded.1/Bios/Settings
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            job_id: Optional job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Pending BIOS attributes
        """
        response = self.adapter.make_request(
            method='GET',
            ip=ip,
            endpoint='/redfish/v1/Systems/System.Embedded.1/Bios/Settings',
            username=username,
            password=password,
            operation_name='Get Pending BIOS Attributes',
            job_id=job_id,
            server_id=server_id,
            user_id=user_id
        )
        
        return {
            'attributes': response.get('Attributes', {}),
            '@odata.id': response.get('@odata.id')
        }
    
    def delete_idrac_job(
        self,
        ip: str,
        username: str,
        password: str,
        idrac_job_id: str,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Delete a specific job from the iDRAC job queue.
        
        Dell Redfish endpoint: DELETE /redfish/v1/Managers/iDRAC.Embedded.1/Jobs/{JobId}
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            idrac_job_id: Dell job ID (e.g., JID_123456789012)
            server_id: Optional server UUID for logging
            user_id: Optional user UUID for logging
            
        Returns:
            Dict with success status and deleted job ID
        """
        response = self.adapter.make_request(
            method='DELETE',
            ip=ip,
            endpoint=f'/redfish/v1/Managers/iDRAC.Embedded.1/Jobs/{idrac_job_id}',
            username=username,
            password=password,
            operation_name='Delete iDRAC Job',
            server_id=server_id,
            user_id=user_id
        )
        return {'success': True, 'deleted_job_id': idrac_job_id}

    def clear_idrac_job_queue(
        self,
        ip: str,
        username: str,
        password: str,
        force: bool = False,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Clear the entire iDRAC job queue.
        
        Dell Redfish OEM endpoint: POST /redfish/v1/Dell/Managers/iDRAC.Embedded.1/DellJobService/Actions/DellJobService.DeleteJobQueue
        
        Use force=True to clear even running jobs (JID_CLEARALL_FORCE)
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            force: If True, clear all jobs including running ones
            server_id: Optional server UUID for logging
            user_id: Optional user UUID for logging
            
        Returns:
            Dict with success status
        """
        job_id = "JID_CLEARALL_FORCE" if force else "JID_CLEARALL"
        
        response = self.adapter.make_request(
            method='POST',
            ip=ip,
            endpoint='/redfish/v1/Dell/Managers/iDRAC.Embedded.1/DellJobService/Actions/DellJobService.DeleteJobQueue',
            username=username,
            password=password,
            payload={"JobID": job_id},
            operation_name='Clear iDRAC Job Queue',
            server_id=server_id,
            user_id=user_id
        )
        return {'success': True, 'cleared': True, 'force': force}

    def get_idrac_job_queue(
        self,
        ip: str,
        username: str,
        password: str,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Get all jobs in the iDRAC job queue.
        
        Dell Redfish endpoint: GET /redfish/v1/Managers/iDRAC.Embedded.1/Jobs
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            server_id: Optional server UUID for logging
            user_id: Optional user UUID for logging
            
        Returns:
            Dict with list of jobs and count
        """
        response = self.adapter.make_request(
            method='GET',
            ip=ip,
            endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Jobs',
            username=username,
            password=password,
            operation_name='Get iDRAC Job Queue',
            server_id=server_id,
            user_id=user_id
        )
        
        members = response.get('Members', [])
        return {
            'success': True,
            'jobs': members,
            'count': len(members)
        }

    def set_bios_attributes(
        self,
        ip: str,
        username: str,
        password: str,
        attributes: Dict[str, Any],
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Set BIOS attributes (changes take effect on next reboot).
        
        Dell pattern: PATCH /redfish/v1/Systems/System.Embedded.1/Bios/Settings
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            attributes: Dict of BIOS attribute key-value pairs
            job_id: Optional job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Response with success status
        """
        payload = {
            'Attributes': attributes
        }
        
        response = self.adapter.make_request(
            method='PATCH',
            ip=ip,
            endpoint='/redfish/v1/Systems/System.Embedded.1/Bios/Settings',
            username=username,
            password=password,
            payload=payload,
            operation_name='Set BIOS Attributes',
            timeout=(5, 60),  # BIOS operations can take longer
            job_id=job_id,
            server_id=server_id,
            user_id=user_id
        )
        
        return {
            'success': True,
            'message': 'BIOS attributes updated successfully. Changes will take effect after reboot.',
            'attributes_count': len(attributes)
        }

    def update_firmware_from_catalog(
        self,
        ip: str,
        username: str,
        password: str,
        catalog_url: str,
        apply_update: bool = True,
        reboot_needed: bool = True,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Update firmware from Dell catalog repository using official OEM API.
        
        Dell OEM endpoint: POST /redfish/v1/Dell/Systems/System.Embedded.1/
            DellSoftwareInstallationService/Actions/DellSoftwareInstallationService.InstallFromRepository
        
        Reference: https://github.com/dell/iDRAC-Redfish-Scripting
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            catalog_url: URL to Dell catalog (e.g., https://downloads.dell.com/catalog/Catalog.xml)
            apply_update: If True, apply updates immediately (default True)
            reboot_needed: If True, allow reboot for updates requiring it (default True)
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Update task information with task_uri and job_id
            
        Raises:
            DellRedfishError: On update initiation failure
        """
        # Parse catalog URL into components Dell API expects
        from urllib.parse import urlparse
        parsed = urlparse(catalog_url)
        
        # Build payload for Dell OEM InstallFromRepository
        payload = {
            'IPAddress': parsed.netloc,
            'ShareType': parsed.scheme.upper(),  # HTTP, HTTPS, NFS, CIFS
            'ShareName': parsed.path.rsplit('/', 1)[0] or '/',  # Directory path
            'CatalogFile': parsed.path.rsplit('/', 1)[-1] or 'Catalog.xml',
            'ApplyUpdate': 'True' if apply_update else 'False',  # Dell expects "True" or "False" (case-sensitive)
            'RebootNeeded': reboot_needed
        }
        
        response = self.adapter.make_request(
            method='POST',
            ip=ip,
            endpoint='/redfish/v1/Dell/Systems/System.Embedded.1/DellSoftwareInstallationService/Actions/DellSoftwareInstallationService.InstallFromRepository',
            username=username,
            password=password,
            payload=payload,
            operation_name='Repository Firmware Update',
            timeout=(10, 300),  # Longer timeout for catalog scan
            server_id=server_id,
            user_id=user_id
        )
        
        # Extract task/job information
        task_uri = response.get('_location_header') or response.get('@odata.id')
        job_id = response.get('Id') or response.get('JobID')
        
        return {
            'success': True,
            'task_uri': task_uri,
            'job_id': job_id,
            'status': 'initiated',
            'catalog_url': catalog_url,
            'apply_update': apply_update,
            'reboot_needed': reboot_needed
        }
    
    # Pre-Flight Check Operations for Updates
    
    def get_lifecycle_controller_status(
        self,
        ip: str,
        username: str,
        password: str,
        server_id: str = None,
        job_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Check if Lifecycle Controller is ready for updates.
        
        Dell pattern: GET /redfish/v1/Managers/iDRAC.Embedded.1/Attributes
        Look for: LifecycleController.1.LCStatus = "Ready"
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            server_id: Optional server ID for logging
            job_id: Optional job ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: LC status information with 'ready' boolean and 'status' string
        """
        response = self.adapter.make_request(
            method='GET',
            ip=ip,
            endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Attributes',
            username=username,
            password=password,
            operation_name='Get Lifecycle Controller Status',
            server_id=server_id,
            job_id=job_id,
            user_id=user_id
        )
        
        attributes = response.get('Attributes', {})
        lc_status = attributes.get('LifecycleController.1.LCStatus', 'Unknown')
        
        return {
            'ready': lc_status == 'Ready',
            'status': lc_status,
            'message': f"Lifecycle Controller is {lc_status}"
        }
    
    def get_pending_idrac_jobs(
        self,
        ip: str,
        username: str,
        password: str,
        server_id: str = None,
        job_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Get list of non-completed jobs that would block updates.
        
        Dell pattern: GET /redfish/v1/Managers/iDRAC.Embedded.1/Jobs
        Filter: Scheduled, Running, New status
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            server_id: Optional server ID for logging
            job_id: Optional job ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Contains 'count', 'jobs' list, and 'passed' boolean
        """
        response = self.adapter.make_request(
            method='GET',
            ip=ip,
            endpoint='/redfish/v1/Managers/iDRAC.Embedded.1/Jobs',
            username=username,
            password=password,
            operation_name='Get Pending iDRAC Jobs',
            server_id=server_id,
            job_id=job_id,
            user_id=user_id
        )
        
        members = response.get('Members', [])
        blocking_statuses = ['Scheduled', 'Running', 'New', 'Starting', 'Downloading']
        pending_jobs = []
        
        for member in members:
            job_uri = member.get('@odata.id', '')
            # Fetch individual job details
            try:
                job_detail = self.adapter.make_request(
                    method='GET',
                    ip=ip,
                    endpoint=job_uri,
                    username=username,
                    password=password,
                    operation_name='Get Job Detail',
                    server_id=server_id,
                    job_id=job_id,
                    user_id=user_id
                )
                
                job_status = job_detail.get('JobState', '')
                if job_status in blocking_statuses:
                    pending_jobs.append({
                        'id': job_detail.get('Id'),
                        'name': job_detail.get('Name'),
                        'status': job_status,
                        'message': job_detail.get('Message', '')
                    })
            except:
                # If individual job fetch fails, skip it
                continue
        
        return {
            'passed': len(pending_jobs) == 0,
            'count': len(pending_jobs),
            'jobs': pending_jobs,
            'message': f"{len(pending_jobs)} pending job(s) in queue" if pending_jobs else "Job queue is clear"
        }
    
    def check_storage_rebuild_status(
        self,
        ip: str,
        username: str,
        password: str,
        server_id: str = None,
        job_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Check for RAID rebuilds in progress.
        
        Dell pattern: GET /redfish/v1/Systems/System.Embedded.1/Storage
        Check each controller's volumes for rebuild operations
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            server_id: Optional server ID for logging
            job_id: Optional job ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Contains 'passed', 'rebuilding', and 'details' about rebuild status
        """
        try:
            response = self.adapter.make_request(
                method='GET',
                ip=ip,
                endpoint='/redfish/v1/Systems/System.Embedded.1/Storage',
                username=username,
                password=password,
                operation_name='Get Storage Status',
                server_id=server_id,
                job_id=job_id,
                user_id=user_id
            )
            
            members = response.get('Members', [])
            rebuild_in_progress = False
            rebuild_details = []
            
            for member in members:
                controller_uri = member.get('@odata.id', '')
                try:
                    controller = self.adapter.make_request(
                        method='GET',
                        ip=ip,
                        endpoint=controller_uri,
                        username=username,
                        password=password,
                        operation_name='Get Controller Details',
                        server_id=server_id,
                        job_id=job_id,
                        user_id=user_id
                    )
                    
                    # Check volumes for rebuild status
                    volumes_uri = controller.get('Volumes', {}).get('@odata.id', '')
                    if volumes_uri:
                        volumes = self.adapter.make_request(
                            method='GET',
                            ip=ip,
                            endpoint=volumes_uri,
                            username=username,
                            password=password,
                            operation_name='Get Volumes',
                            server_id=server_id,
                            job_id=job_id,
                            user_id=user_id
                        )
                        
                        for vol_member in volumes.get('Members', []):
                            vol_uri = vol_member.get('@odata.id', '')
                            try:
                                volume = self.adapter.make_request(
                                    method='GET',
                                    ip=ip,
                                    endpoint=vol_uri,
                                    username=username,
                                    password=password,
                                    operation_name='Get Volume Details',
                                    server_id=server_id,
                                    job_id=job_id,
                                    user_id=user_id
                                )
                                
                                # Check for rebuild operations
                                operations = volume.get('Operations', [])
                                for op in operations:
                                    if 'rebuild' in op.get('OperationName', '').lower():
                                        rebuild_in_progress = True
                                        rebuild_details.append({
                                            'volume': volume.get('Name', 'Unknown'),
                                            'operation': op.get('OperationName'),
                                            'progress': op.get('PercentageComplete', 0)
                                        })
                            except:
                                continue
                except:
                    continue
            
            return {
                'passed': not rebuild_in_progress,
                'rebuilding': rebuild_in_progress,
                'details': rebuild_details,
                'message': f"Rebuild in progress on {len(rebuild_details)} volume(s)" if rebuild_in_progress else "No RAID rebuilds in progress"
            }
        except Exception as e:
            # If storage check fails, assume it's safe but log the issue
            return {
                'passed': True,
                'rebuilding': False,
                'details': [],
                'message': f"Unable to check storage status: {str(e)}"
            }
    
    def get_thermal_status(
        self,
        ip: str,
        username: str,
        password: str,
        server_id: str = None,
        job_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Check for thermal warnings/alerts.
        
        Dell pattern: GET /redfish/v1/Chassis/System.Embedded.1/Thermal
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            server_id: Optional server ID for logging
            job_id: Optional job ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Contains 'passed', 'warnings' list, and temperature information
        """
        try:
            response = self.adapter.make_request(
                method='GET',
                ip=ip,
                endpoint='/redfish/v1/Chassis/System.Embedded.1/Thermal',
                username=username,
                password=password,
                operation_name='Get Thermal Status',
                server_id=server_id,
                job_id=job_id,
                user_id=user_id
            )
            
            warnings = []
            temperatures = response.get('Temperatures', [])
            fans = response.get('Fans', [])
            
            # Check temperatures
            for temp in temperatures:
                status = temp.get('Status', {})
                health = status.get('Health', 'OK')
                state = status.get('State', 'Enabled')
                
                if health != 'OK' or state != 'Enabled':
                    warnings.append({
                        'sensor': temp.get('Name', 'Unknown'),
                        'reading': temp.get('ReadingCelsius'),
                        'health': health,
                        'state': state
                    })
            
            # Check fans
            for fan in fans:
                status = fan.get('Status', {})
                health = status.get('Health', 'OK')
                state = status.get('State', 'Enabled')
                
                if health != 'OK' or state != 'Enabled':
                    warnings.append({
                        'sensor': fan.get('Name', 'Unknown'),
                        'reading': fan.get('Reading'),
                        'health': health,
                        'state': state
                    })
            
            return {
                'passed': len(warnings) == 0,
                'warnings': warnings,
                'message': f"{len(warnings)} thermal warning(s)" if warnings else "All thermal sensors OK"
            }
        except Exception as e:
            # If thermal check fails, return warning but don't block
            return {
                'passed': True,
                'warnings': [],
                'message': f"Unable to check thermal status: {str(e)}"
            }
