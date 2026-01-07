"""
Dell Redfish Adapter

Wraps Dell Redfish API calls with session management, logging, and error handling.

All calls to Dell's Redfish API go through this adapter to ensure:
- Session reuse via SessionManager
- Logging to idrac_commands table
- Consistent error handling
"""

import logging
import time
import requests
from typing import Callable, Any, Optional, Dict, Tuple
from .errors import DellRedfishError, map_dell_error


class DellRedfishAdapter:
    """
    Adapter that integrates Dell Redfish API calls with our infrastructure.
    
    This class provides a unified request method that wraps all Dell Redfish
    API calls with:
    - SessionManager for session reuse and legacy TLS support
    - Supabase logging for all API calls
    - Enhanced error handling with Dell error code mapping
    """
    
    def __init__(self, session_manager, logger: logging.Logger, log_command_fn: Callable, verify_ssl: bool = False):
        """
        Initialize the adapter with session manager, logger, and command logging function.
        
        Args:
            session_manager: SessionManager instance for session management
            logger: Logger instance for operation logging
            log_command_fn: Function to log commands to idrac_commands table
            verify_ssl: Whether to verify SSL certificates (default False for self-signed)
        """
        self.session_manager = session_manager
        self.logger = logger
        self.log_command = log_command_fn
        self.verify_ssl = verify_ssl
    
    def _log(self, message: str, level: str = "INFO"):
        """
        Wrapper to use self.logger (logging.Logger) with a callable signature.
        """
        level_map = {
            "DEBUG": self.logger.debug,
            "INFO": self.logger.info,
            "WARN": self.logger.warning,
            "WARNING": self.logger.warning,
            "ERROR": self.logger.error,
        }
        log_fn = level_map.get(level.upper(), self.logger.info)
        log_fn(message)
    
    def make_request(
        self,
        method: str,
        ip: str,
        endpoint: str,
        username: str,
        password: str,
        payload: Optional[Dict] = None,
        operation_name: str = None,
        timeout: Tuple[int, int] = (5, 30),
        job_id: str = None,
        server_id: str = None,
        user_id: str = None,
        return_response: bool = False,
        legacy_ssl: bool = False
    ):
        """
        Unified request method for all Dell Redfish API calls.
        Integrates session management, logging, and error mapping.
        
        Args:
            method: HTTP method (GET, POST, PATCH, DELETE)
            ip: iDRAC IP address
            endpoint: Redfish API endpoint (e.g., /redfish/v1/Systems/System.Embedded.1)
            username: iDRAC username
            password: iDRAC password
            payload: Optional JSON payload for POST/PATCH
            operation_name: Human-readable operation name for logging
            timeout: Tuple of (connect_timeout, read_timeout)
            job_id: Optional job ID for logging
            server_id: Optional server ID for logging
            user_id: Optional user ID for logging
            return_response: If True, return raw Response object instead of parsed JSON
            legacy_ssl: If True, use legacy TLS for iDRAC 8 compatibility
            
        Returns:
            Union[dict, requests.Response]: Response JSON data or raw Response if return_response=True
            
        Raises:
            DellRedfishError: On API errors with Dell error code mapping
        """
        url = f"https://{ip}{endpoint}"
        operation_name = operation_name or f"{method} {endpoint}"
        
        # Get session for this IP
        session = self.session_manager.get_session(ip, legacy_ssl=legacy_ssl)
        
        # Prepare request
        request_kwargs = {
            'auth': (username, password),
            'verify': self.verify_ssl,
            'timeout': timeout,
            'headers': {'Content-Type': 'application/json', 'Accept': 'application/json'}
        }
        
        if payload is not None:
            request_kwargs['json'] = payload
        
        start_time = time.time()
        response = None
        status_code = None
        
        try:
            # Make the request
            if method.upper() == 'GET':
                response = session.get(url, **request_kwargs)
            elif method.upper() == 'POST':
                response = session.post(url, **request_kwargs)
            elif method.upper() == 'PATCH':
                response = session.patch(url, **request_kwargs)
            elif method.upper() == 'DELETE':
                response = session.delete(url, **request_kwargs)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
            
            response_time_ms = int((time.time() - start_time) * 1000)
            status_code = response.status_code
            
            # Parse response
            content_type = response.headers.get('Content-Type', '') if response else ''
            try:
                response_data = response.json() if response.text else {}
            except ValueError:
                # Handle non-JSON responses (e.g., XML SCP exports)
                response_data = self._handle_non_json_response(response.text, content_type)
            
            # CRITICAL: Include Location header for async operations (202 responses)
            # Dell returns task URI in Location header, not body
            if response.status_code == 202:
                location = response.headers.get('Location')
                if location:
                    response_data['_location_header'] = location
                    # Also set common field names that helpers check
                    if '@odata.id' not in response_data:
                        response_data['@odata.id'] = location
            
            # Check for HTTP errors
            response.raise_for_status()
            
            # Log to idrac_commands
            self._log_operation(
                ip=ip,
                endpoint=endpoint,
                method=method,
                operation_name=operation_name,
                payload=payload,
                response_data=response_data,
                response_time_ms=response_time_ms,
                status_code=status_code,
                success=True,
                job_id=job_id,
                server_id=server_id,
                user_id=user_id
            )
            
            # Return raw response or parsed data
            if return_response:
                return response
            return response_data
            
        except requests.exceptions.RequestException as e:
            response_time_ms = int((time.time() - start_time) * 1000)
            status_code = getattr(response, 'status_code', None) if response else None
            
            # Try to extract Dell error info
            error_data = None
            if response is not None:
                try:
                    error_data = response.json()
                except:
                    error_data = {'error': str(e)}
            
            # Log failure
            self._log_operation(
                ip=ip,
                endpoint=endpoint,
                method=method,
                operation_name=operation_name,
                payload=payload,
                response_data=error_data,
                response_time_ms=response_time_ms,
                status_code=status_code,
                success=False,
                error_message=str(e),
                job_id=job_id,
                server_id=server_id,
                user_id=user_id
            )
            
            # Map Dell error if available
            if error_data:
                error_info = map_dell_error(error_data)
                raise DellRedfishError(
                    message=error_info['message'],
                    error_code=error_info['code'],
                    status_code=status_code
                )
            
            raise DellRedfishError(
                message=str(e),
                error_code=None,
                status_code=status_code
            )

    def _handle_non_json_response(self, raw_text: str, content_type: str) -> Dict[str, Any]:
        """
        Normalize non-JSON responses from iDRAC.

        Some iDRAC task endpoints (e.g., SCP exports) return XML payloads instead of
        JSON. These should be treated as successful task completions rather than
        parse errors.

        Args:
            raw_text: Raw response body
            content_type: Content-Type header value

        Returns:
            Dict[str, Any]: Parsed data with best-effort task status metadata
        """
        response_data: Dict[str, Any] = {
            'raw_response': raw_text,
            'parse_error': 'Not valid JSON',
            'content_type': content_type
        }

        stripped = raw_text.strip() if raw_text else ''

        # Treat SCP export XML payloads as completed tasks so polling can succeed
        if stripped.startswith('<SystemConfiguration'):
            response_data.update({
                'TaskState': 'Completed',
                'PercentComplete': 100,
                'Messages': [{'Message': stripped}]
            })

        return response_data
    
    def call_with_safety(
        self,
        func: Callable,
        ip: str,
        operation_name: str,
        *args,
        **kwargs
    ) -> Any:
        """
        Legacy method: Wrap any Dell function with logging and error handling.
        
        NOTE: This method is deprecated. Use make_request() for all new operations.
        Kept for backward compatibility with existing code.
        
        Args:
            func: Dell library function to call
            ip: iDRAC IP address
            operation_name: Human-readable operation name (for logging)
            *args: Positional arguments to pass to func
            **kwargs: Keyword arguments to pass to func
            
        Returns:
            Result from the Dell library function
            
        Raises:
            DellRedfishError: If Dell operation fails
        """
        start_time = time.time()
        
        try:
            # Call Dell library function
            self.logger.debug(f"Calling Dell operation: {operation_name} on {ip}")
            result = func(*args, **kwargs)
            return result
        
        except Exception as e:
            response_time_ms = int((time.time() - start_time) * 1000)
            status_code = getattr(e, "status_code", 500)
            
            self.logger.error(f"Dell operation failed: {operation_name} on {ip}: {str(e)}")
            
            raise DellRedfishError(
                message=f"Operation failed: {str(e)}",
                status_code=status_code,
            )
    
    def _log_operation(
        self,
        ip: str,
        endpoint: str,
        method: str,
        operation_name: str,
        success: bool,
        response_time_ms: int,
        status_code: Optional[int] = None,
        payload: Optional[Dict] = None,
        response_data: Optional[Dict] = None,
        error_message: Optional[str] = None,
        job_id: str = None,
        server_id: str = None,
        user_id: str = None
    ):
        """
        Log Dell operation to Supabase idrac_commands table.
        
        Args:
            ip: iDRAC IP address
            endpoint: Redfish API endpoint
            method: HTTP method
            operation_name: Human-readable operation name
            success: Whether operation succeeded
            response_time_ms: Response time in milliseconds
            status_code: HTTP status code
            payload: Request payload
            response_data: Response data
            error_message: Error message if operation failed
            job_id: Optional job ID for correlation
            server_id: Optional server ID for correlation
            user_id: Optional user ID who initiated the operation
        """
        try:
            # Prepare log entry
            log_entry = {
                "ip_address": ip,
                "command_type": operation_name,
                "endpoint": endpoint,
                "full_url": f"https://{ip}{endpoint}",
                "success": success,
                "status_code": status_code,
                "response_time_ms": response_time_ms,
                "source": "dell_redfish",
                "operation_type": "idrac_api",
            }
            
            if payload:
                log_entry["request_body"] = payload
            
            if response_data:
                log_entry["response_body"] = response_data
            
            if error_message:
                log_entry["error_message"] = error_message
            
            if job_id:
                log_entry["job_id"] = job_id
            
            if server_id:
                log_entry["server_id"] = server_id
            
            if user_id:
                log_entry["initiated_by"] = user_id
            
            # Call the logging function (injected from JobExecutor)
            self.log_command(log_entry)
        
        except Exception as e:
            # Don't let logging errors break the main operation
            self.logger.error(f"Failed to log Dell operation: {e}")
    
    def get_with_retry(
        self,
        func: Callable,
        ip: str,
        operation_name: str,
        max_retries: int = 3,
        *args,
        **kwargs
    ) -> Any:
        """
        Call a Dell function with automatic retry on transient errors.
        
        NOTE: This method is deprecated for new code. Use make_request() with retry logic instead.
        Kept for backward compatibility.
        
        Args:
            func: Dell library function to call
            ip: iDRAC IP address
            operation_name: Human-readable operation name
            max_retries: Maximum number of retry attempts
            *args: Positional arguments to pass to func
            **kwargs: Keyword arguments to pass to func
            
        Returns:
            Result from the Dell library function
            
        Raises:
            DellRedfishError: If all retries fail
        """
        last_error = None
        
        for attempt in range(max_retries + 1):
            try:
                return self.call_with_safety(func, ip, operation_name, *args, **kwargs)
            
            except DellRedfishError as e:
                last_error = e
                
                # Check if error is retryable
                error_info = map_dell_error({"error": {"message": str(e)}})
                
                if not error_info.get("retry", False):
                    # Not retryable, raise immediately
                    raise
                
                if attempt < max_retries:
                    wait_seconds = error_info.get("wait_seconds", 30)
                    self.logger.warning(
                        f"Retrying {operation_name} on {ip} in {wait_seconds}s "
                        f"(attempt {attempt + 1}/{max_retries})"
                    )
                    time.sleep(wait_seconds)
        
        # All retries exhausted
        raise last_error
