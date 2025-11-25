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
