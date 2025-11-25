"""
Dell Redfish Adapter

Wraps Dell's official iDRAC Redfish library functions with our custom
throttling, logging, and error handling infrastructure.

All calls to Dell's library go through this adapter to ensure:
- Rate limiting via IdracThrottler
- Circuit breaker protection
- Logging to idrac_commands table
- Consistent error handling
"""

import time
import logging
from typing import Any, Callable, Optional
from datetime import datetime

from .errors import DellRedfishError, CircuitBreakerOpenError, map_dell_error


class DellRedfishAdapter:
    """
    Adapter that integrates Dell's Redfish library with our infrastructure.
    
    This class wraps Dell library calls with:
    - IdracThrottler for rate limiting and circuit breakers
    - Supabase logging for all API calls
    - Enhanced error handling with Dell error code mapping
    """
    
    def __init__(self, throttler, logger: logging.Logger, log_command_fn: Callable):
        """
        Initialize the adapter.
        
        Args:
            throttler: IdracThrottler instance for rate limiting
            logger: Python logger for console output
            log_command_fn: Function to log commands to Supabase (idrac_commands table)
        """
        self.throttler = throttler
        self.logger = logger
        self.log_command = log_command_fn
    
    def call_with_safety(
        self,
        func: Callable,
        ip: str,
        operation_name: str,
        *args,
        **kwargs
    ) -> Any:
        """
        Wrap any Dell function with throttling, logging, and error handling.
        
        This is the core method that ensures all Dell library calls go through
        our safety mechanisms.
        
        Args:
            func: Dell library function to call
            ip: iDRAC IP address
            operation_name: Human-readable operation name (for logging)
            *args: Positional arguments to pass to func
            **kwargs: Keyword arguments to pass to func
            
        Returns:
            Result from the Dell library function
            
        Raises:
            CircuitBreakerOpenError: If circuit breaker is open for this IP
            DellRedfishError: If Dell operation fails
            Exception: Other unexpected errors
        """
        # Check circuit breaker
        if self.throttler.is_circuit_open(ip):
            error_msg = f"Circuit breaker open for {ip}. iDRAC may be unresponsive."
            self.logger.error(error_msg)
            raise CircuitBreakerOpenError(ip)
        
        # Acquire per-IP lock and wait for rate limit
        with self.throttler.locks[ip]:
            self.throttler.wait_for_rate_limit(ip, self.logger)
            
            # Acquire global concurrency semaphore
            with self.throttler.global_semaphore:
                start_time = time.time()
                response_time_ms = None
                status_code = None
                success = False
                error_message = None
                response_data = None
                
                try:
                    # Call Dell library function
                    self.logger.debug(f"Calling Dell operation: {operation_name} on {ip}")
                    result = func(*args, **kwargs)
                    
                    # Calculate response time
                    response_time_ms = int((time.time() - start_time) * 1000)
                    
                    # Parse result (Dell functions may return different formats)
                    if isinstance(result, dict):
                        # Check for error indicators in response
                        if "error" in result or "Error" in result:
                            status_code = result.get("status_code", 400)
                            error_message = result.get("error", result.get("Error", "Unknown error"))
                            success = False
                        else:
                            status_code = result.get("status_code", 200)
                            response_data = result
                            success = True
                    elif isinstance(result, tuple):
                        # Some Dell functions return (success, data) tuples
                        success = result[0] if len(result) > 0 else False
                        response_data = result[1] if len(result) > 1 else None
                        status_code = 200 if success else 400
                    else:
                        # Assume success if we got a result back
                        success = True
                        response_data = result
                        status_code = 200
                    
                    # Record success with throttler
                    if success:
                        self.throttler.record_success(ip)
                    else:
                        self.throttler.record_failure(ip, status_code, self.logger)
                    
                    # Log to Supabase
                    self._log_operation(
                        ip=ip,
                        operation_name=operation_name,
                        success=success,
                        status_code=status_code,
                        response_time_ms=response_time_ms,
                        response_data=response_data,
                        error_message=error_message,
                    )
                    
                    if not success:
                        # Map Dell error code to user-friendly message
                        error_info = map_dell_error({"error": {"message": error_message}})
                        raise DellRedfishError(
                            message=error_info.get("message", error_message),
                            error_code=error_info.get("code"),
                            status_code=status_code,
                        )
                    
                    return result
                
                except CircuitBreakerOpenError:
                    # Re-raise circuit breaker errors without logging
                    raise
                
                except DellRedfishError:
                    # Re-raise Dell errors (already logged)
                    raise
                
                except Exception as e:
                    # Unexpected error
                    response_time_ms = int((time.time() - start_time) * 1000)
                    status_code = getattr(e, "status_code", 500)
                    error_message = str(e)
                    
                    # Record failure with throttler
                    self.throttler.record_failure(ip, status_code, self.logger)
                    
                    # Log to Supabase
                    self._log_operation(
                        ip=ip,
                        operation_name=operation_name,
                        success=False,
                        status_code=status_code,
                        response_time_ms=response_time_ms,
                        error_message=error_message,
                    )
                    
                    self.logger.error(f"Dell operation failed: {operation_name} on {ip}: {error_message}")
                    raise DellRedfishError(
                        message=f"Operation failed: {error_message}",
                        status_code=status_code,
                    )
    
    def _log_operation(
        self,
        ip: str,
        operation_name: str,
        success: bool,
        status_code: Optional[int] = None,
        response_time_ms: Optional[int] = None,
        response_data: Optional[dict] = None,
        error_message: Optional[str] = None,
    ):
        """
        Log Dell operation to Supabase idrac_commands table.
        
        Args:
            ip: iDRAC IP address
            operation_name: Human-readable operation name
            success: Whether operation succeeded
            status_code: HTTP-like status code
            response_time_ms: Response time in milliseconds
            response_data: Response data from Dell function
            error_message: Error message if operation failed
        """
        try:
            # Prepare log entry
            log_entry = {
                "ip_address": ip,
                "command_type": operation_name,
                "endpoint": f"/redfish/v1/Dell/{operation_name}",  # Approximate endpoint
                "full_url": f"https://{ip}/redfish/v1/Dell/{operation_name}",
                "success": success,
                "status_code": status_code,
                "response_time_ms": response_time_ms,
                "timestamp": datetime.utcnow().isoformat(),
                "source": "dell_library",
                "operation_type": "idrac_api",
            }
            
            if response_data:
                log_entry["response_body"] = response_data
            
            if error_message:
                log_entry["error_message"] = error_message
            
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
        
        This wraps call_with_safety with retry logic for errors that
        Dell indicates are retryable (e.g., "operation in progress").
        
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
                        f"Dell operation {operation_name} failed (attempt {attempt + 1}/{max_retries + 1}). "
                        f"Retrying in {wait_seconds} seconds. Error: {e.message}"
                    )
                    time.sleep(wait_seconds)
                else:
                    # Max retries exceeded
                    self.logger.error(
                        f"Dell operation {operation_name} failed after {max_retries + 1} attempts. "
                        f"Last error: {e.message}"
                    )
                    raise
        
        # Should never reach here, but just in case
        if last_error:
            raise last_error
