"""
Helper utilities for Dell Redfish operations.
Includes task monitoring, job polling, and iDRAC version detection.
"""

import time
import logging
from typing import Dict, Optional, Tuple, Any
from .errors import DellRedfishError


class DellRedfishHelpers:
    """Helper functions for Dell Redfish operations"""
    
    def __init__(self, adapter):
        """
        Initialize helpers with adapter for making requests.
        
        Args:
            adapter: DellRedfishAdapter instance
        """
        self.adapter = adapter
    
    def wait_for_task(
        self,
        ip: str,
        username: str,
        password: str,
        task_uri: str,
        timeout: int = 600,
        poll_interval: int = 10,
        operation_name: str = "Task",
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Poll a Redfish task until completion, failure, or timeout.
        
        Dell task pattern:
        - POST operation returns Location header with task URI
        - Poll task URI until TaskState is Completed, Exception, or Killed
        - Extract results from task response
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            task_uri: Task URI to poll (e.g., /redfish/v1/TaskService/Tasks/JID_123)
            timeout: Maximum wait time in seconds
            poll_interval: Seconds between polls
            operation_name: Operation name for logging
            job_id: Optional job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Final task response with status and results
            
        Raises:
            DellRedfishError: If task fails or times out
        """
        start_time = time.time()
        last_percent = -1
        
        while (time.time() - start_time) < timeout:
            task_response = self.adapter.make_request(
                method='GET',
                ip=ip,
                endpoint=task_uri,
                username=username,
                password=password,
                operation_name=f"{operation_name} - Poll Task",
                job_id=job_id,
                server_id=server_id,
                user_id=user_id
            )

            task_response = self._normalize_task_response(task_response)
            
            task_state = task_response.get('TaskState', 'Unknown')
            percent_complete = task_response.get('PercentComplete', 0)
            messages = task_response.get('Messages', [])
            
            # Log progress if changed
            if percent_complete != last_percent:
                message_text = messages[0].get('Message', '') if messages else ''
                self.adapter.logger.info(
                    f"{operation_name} progress: {percent_complete}% - {task_state} - {message_text}"
                )
                last_percent = percent_complete
            
            # Check terminal states
            if task_state == 'Completed':
                self.adapter.logger.info(f"{operation_name} completed successfully")
                return task_response
            
            elif task_state in ('Exception', 'Killed', 'Cancelled'):
                error_message = messages[0].get('Message', 'Task failed') if messages else 'Task failed'
                raise DellRedfishError(
                    message=f"{operation_name} failed: {error_message}",
                    error_code=task_state
                )
            
            # Sleep before next poll
            time.sleep(poll_interval)
        
        # Timeout
        raise DellRedfishError(
            message=f"{operation_name} timed out after {timeout} seconds",
            error_code='TIMEOUT'
        )
    
    def wait_for_job(
        self,
        ip: str,
        username: str,
        password: str,
        job_id_str: str,
        timeout: int = 1800,
        poll_interval: int = 10,
        stall_timeout: int = 600,
        operation_name: str = "Job",
        parent_job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ) -> Dict[str, Any]:
        """
        Poll a Dell Job (JID_xxx) until completion or timeout.
        
        Dell Job pattern (different from Redfish tasks):
        - Some operations create iDRAC Jobs instead of Redfish tasks
        - Jobs tracked at /redfish/v1/Managers/iDRAC.Embedded.1/Jobs/{job_id}
        - Monitor JobState: New, Scheduled, Running, Completed, Failed
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            job_id_str: Dell job ID (e.g., JID_123456789)
            timeout: Maximum wait time in seconds
            poll_interval: Seconds between polls
            stall_timeout: Maximum time job can stay in New/Scheduled state before 
                          raising JOB_STALLED error (default 10 minutes)
            operation_name: Operation name for logging
            parent_job_id: Optional parent job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            dict: Final job response
            
        Raises:
            DellRedfishError: If job fails, times out, or stalls
        """
        job_uri = f"/redfish/v1/Managers/iDRAC.Embedded.1/Jobs/{job_id_str}"
        start_time = time.time()
        last_percent = -1
        stall_start = None  # Track when job entered stalled state
        
        while (time.time() - start_time) < timeout:
            job_response = self.adapter.make_request(
                method='GET',
                ip=ip,
                endpoint=job_uri,
                username=username,
                password=password,
                operation_name=f"{operation_name} - Poll Job",
                job_id=parent_job_id,
                server_id=server_id,
                user_id=user_id
            )
            
            job_state = job_response.get('JobState', 'Unknown')
            percent_complete = job_response.get('PercentComplete', 0)
            message = job_response.get('Message', '')
            
            # Log progress
            if percent_complete != last_percent:
                self.adapter.logger.info(
                    f"{operation_name} progress: {percent_complete}% - {job_state} - {message}"
                )
                last_percent = percent_complete
            
            # Check completion
            if job_state == 'Completed':
                self.adapter.logger.info(f"{operation_name} completed successfully")
                return job_response
            
            elif job_state in ('Failed', 'CompletedWithErrors'):
                raise DellRedfishError(
                    message=f"{operation_name} failed: {message}",
                    error_code=job_state
                )
            
            # Detect stalled jobs (stuck in New/Scheduled at 0% progress)
            if job_state in ('New', 'Scheduled', 'Starting') and percent_complete == 0:
                if stall_start is None:
                    stall_start = time.time()
                    self.adapter.logger.info(
                        f"{operation_name}: Job in '{job_state}' state, monitoring for stall..."
                    )
                elif (time.time() - stall_start) > stall_timeout:
                    stall_duration = int(time.time() - stall_start)
                    raise DellRedfishError(
                        message=f"Job {job_id_str} stalled in '{job_state}' state for {stall_duration}s. "
                                f"May need reboot to trigger execution.",
                        error_code='JOB_STALLED'
                    )
            else:
                # Job is progressing, reset stall timer
                stall_start = None
            
            # Sleep before next poll
            time.sleep(poll_interval)
        
        # Timeout
        raise DellRedfishError(
            message=f"{operation_name} timed out after {timeout} seconds",
            error_code='TIMEOUT'
        )
    
    def get_idrac_version(
        self,
        ip: str,
        username: str,
        password: str,
        server_id: str = None,
        user_id: str = None
    ) -> Tuple[int, str]:
        """
        Get iDRAC version for capability detection.
        
        Returns major version (7, 8, 9) and full version string.
        Different iDRAC versions support different features:
        - iDRAC 7/8: Older generation, limited Redfish support
        - iDRAC 9: Full Redfish support, local SCP export (3.30+)
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            tuple: (major_version, full_version_string)
            
        Raises:
            DellRedfishError: If version cannot be determined
        """
        try:
            response = self.adapter.make_request(
                method='GET',
                ip=ip,
                endpoint='/redfish/v1/Managers/iDRAC.Embedded.1',
                username=username,
                password=password,
                operation_name='Get iDRAC Version',
                server_id=server_id,
                user_id=user_id
            )
            
            # Extract version from FirmwareVersion field
            firmware_version = response.get('FirmwareVersion', '')
            
            # Parse major version (e.g., "5.10.10.00" -> 9, "2.82.82.82" -> 8)
            # iDRAC 9 versions start with 3.x, 4.x, 5.x, 6.x
            # iDRAC 8 versions are 2.x
            # iDRAC 7 versions are 1.x or lower
            if firmware_version:
                major = int(firmware_version.split('.')[0])
                if major >= 3:
                    return (9, firmware_version)
                elif major == 2:
                    return (8, firmware_version)
                else:
                    return (7, firmware_version)
            
            # Fallback: try to detect from model
            model = response.get('Model', '')
            if 'iDRAC9' in model or 'iDRAC 9' in model:
                return (9, firmware_version or 'Unknown')
            elif 'iDRAC8' in model or 'iDRAC 8' in model:
                return (8, firmware_version or 'Unknown')
            else:
                return (7, firmware_version or 'Unknown')
                
        except Exception as e:
            raise DellRedfishError(
                message=f"Failed to determine iDRAC version: {str(e)}",
                error_code='VERSION_DETECTION_FAILED'
            )
    
    def check_feature_support(
        self,
        ip: str,
        username: str,
        password: str,
        feature: str,
        server_id: str = None,
        user_id: str = None
    ) -> bool:
        """
        Check if iDRAC supports a specific feature.
        
        Args:
            ip: iDRAC IP address
            username: iDRAC username
            password: iDRAC password
            feature: Feature to check ('local_scp_export', 'simple_update', 'virtual_media')
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            
        Returns:
            bool: True if feature is supported
        """
        major_version, full_version = self.get_idrac_version(
            ip, username, password, server_id, user_id
        )
        
        # Feature support matrix
        if feature == 'local_scp_export':
            # iDRAC 9 3.30+ supports local SCP export without network share
            return major_version >= 9
        
        elif feature == 'simple_update':
            # SimpleUpdate available on iDRAC 8+
            return major_version >= 8
        
        elif feature == 'virtual_media':
            # Virtual media available on all versions
            return True
        
        elif feature == 'post_state_check':
            # POST state checking on iDRAC 9
            return major_version >= 9
        
        return False
    
    def get_task_uri_from_response(self, response: Dict[str, Any]) -> Optional[str]:
        """
        Extract task URI from response headers or body.
        
        Dell pattern: Task URI returned in Location header or @odata.id field.
        For 202 responses, adapter injects Location header as _location_header.
        
        Args:
            response: Response dict from make_request
            
        Returns:
            str: Task URI if found, None otherwise
        """
        # Check for Location header injected by adapter (highest priority)
        if '_location_header' in response:
            return response['_location_header']
        
        # Check @odata.id in response body (common for task responses)
        if '@odata.id' in response:
            return response['@odata.id']
        
        # Check for task in nested structure
        if 'Task' in response and '@odata.id' in response['Task']:
            return response['Task']['@odata.id']
        
        # Check other common fields Dell might use
        for field in ('TaskUri', 'Location', 'task', 'JobUri'):
            if field in response and response[field]:
                return response[field]

        return None

    def _normalize_task_response(self, task_response: Dict[str, Any]) -> Dict[str, Any]:
        """
        Normalize task responses that may return non-JSON payloads.

        Some iDRAC task endpoints (notably SCP exports) respond with XML payloads
        instead of JSON. When this happens, treat the raw XML as a successful task
        completion so polling can terminate and return the exported content.
        """
        if task_response.get('TaskState'):
            return task_response

        raw_text = task_response.get('raw_response') or task_response.get('_raw_response')
        stripped = raw_text.strip() if isinstance(raw_text, str) else ''

        if stripped.startswith('<SystemConfiguration'):
            return {
                **task_response,
                'TaskState': 'Completed',
                'PercentComplete': 100,
                'Messages': task_response.get('Messages')
                or [{'Message': stripped}]
            }

        return task_response
