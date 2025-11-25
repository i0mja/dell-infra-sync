"""
Dell iDRAC Error Code Mapping

Maps Dell-specific error codes to user-friendly messages and provides
error classification for better handling.
"""

from typing import Optional


class DellRedfishError(Exception):
    """Base exception for Dell Redfish operations"""
    
    def __init__(self, message: str, error_code: Optional[str] = None, status_code: Optional[int] = None):
        self.message = message
        self.error_code = error_code
        self.status_code = status_code
        super().__init__(self.message)


class CircuitBreakerOpenError(DellRedfishError):
    """Raised when circuit breaker is open for an iDRAC IP"""
    
    def __init__(self, ip: str):
        message = f"Circuit breaker open for {ip}. iDRAC may be unresponsive or rate-limited."
        super().__init__(message, error_code="CIRCUIT_BREAKER_OPEN")
        self.ip = ip


class DellErrorCodes:
    """
    Common Dell iDRAC error codes and their meanings.
    Reference: Dell iDRAC Redfish documentation
    """
    
    # Configuration errors
    RAC0508 = {
        "code": "RAC0508",
        "message": "iDRAC is performing another configuration export. Wait and retry.",
        "retry": True,
        "wait_seconds": 30,
    }
    
    RAC0509 = {
        "code": "RAC0509",
        "message": "iDRAC is performing another configuration import. Wait and retry.",
        "retry": True,
        "wait_seconds": 30,
    }
    
    # System state errors
    SYS403 = {
        "code": "SYS403",
        "message": "Server is in POST. Cannot perform configuration changes until POST completes.",
        "retry": True,
        "wait_seconds": 60,
    }
    
    SYS424 = {
        "code": "SYS424",
        "message": "Server is rebooting. Wait for reboot to complete.",
        "retry": True,
        "wait_seconds": 120,
    }
    
    # Firmware update errors
    FWU001 = {
        "code": "FWU001",
        "message": "Firmware update already in progress. Only one update can run at a time.",
        "retry": True,
        "wait_seconds": 300,
    }
    
    FWU002 = {
        "code": "FWU002",
        "message": "Firmware image is invalid or corrupted.",
        "retry": False,
    }
    
    # Job queue errors
    JOB001 = {
        "code": "JOB001",
        "message": "Job queue is full. Clear completed jobs or wait for current jobs to finish.",
        "retry": True,
        "wait_seconds": 60,
    }
    
    # Authentication errors
    AUTH001 = {
        "code": "AUTH001",
        "message": "Authentication failed. Check username and password.",
        "retry": False,
    }
    
    AUTH002 = {
        "code": "AUTH002",
        "message": "Session expired. Re-authenticate and retry.",
        "retry": True,
        "wait_seconds": 5,
    }
    
    # Resource errors
    RES001 = {
        "code": "RES001",
        "message": "Requested resource not found. Check iDRAC firmware version and endpoint support.",
        "retry": False,
    }
    
    # Timeout errors
    TIMEOUT = {
        "code": "TIMEOUT",
        "message": "Operation timed out. iDRAC may be busy or unresponsive.",
        "retry": True,
        "wait_seconds": 30,
    }


def map_dell_error(error_response: dict) -> dict:
    """
    Map Dell error response to error info with retry guidance.
    
    Args:
        error_response: Error response from Dell iDRAC (typically from @Message.ExtendedInfo)
        
    Returns:
        dict with keys: code, message, retry, wait_seconds
    """
    # Extract error code from various Dell response formats
    error_code = None
    error_message = ""
    
    # Format 1: @Message.ExtendedInfo array
    if isinstance(error_response, dict):
        extended_info = error_response.get("error", {}).get("@Message.ExtendedInfo", [])
        if extended_info and isinstance(extended_info, list):
            first_error = extended_info[0]
            error_code = first_error.get("MessageId", "").split(".")[-1]  # e.g., "Base.1.0.GeneralError" -> "GeneralError"
            error_message = first_error.get("Message", "")
    
    # Format 2: Direct error object
    if not error_code and "error" in error_response:
        error_obj = error_response["error"]
        error_code = error_obj.get("code", "")
        error_message = error_obj.get("message", "")
    
    # Map to known Dell error codes
    if error_code:
        for attr_name in dir(DellErrorCodes):
            if not attr_name.startswith("_"):
                error_info = getattr(DellErrorCodes, attr_name)
                if isinstance(error_info, dict) and error_info.get("code") == error_code:
                    return error_info
    
    # Check message content for known patterns
    error_message_lower = error_message.lower()
    
    if "export" in error_message_lower and "in progress" in error_message_lower:
        return DellErrorCodes.RAC0508
    
    if "import" in error_message_lower and "in progress" in error_message_lower:
        return DellErrorCodes.RAC0509
    
    if "post" in error_message_lower or "bios" in error_message_lower:
        return DellErrorCodes.SYS403
    
    if "reboot" in error_message_lower or "restart" in error_message_lower:
        return DellErrorCodes.SYS424
    
    if "firmware" in error_message_lower and "progress" in error_message_lower:
        return DellErrorCodes.FWU001
    
    if "job queue" in error_message_lower or "queue full" in error_message_lower:
        return DellErrorCodes.JOB001
    
    if "authentication" in error_message_lower or "unauthorized" in error_message_lower:
        return DellErrorCodes.AUTH001
    
    if "session" in error_message_lower and "expired" in error_message_lower:
        return DellErrorCodes.AUTH002
    
    if "not found" in error_message_lower or "404" in error_message_lower:
        return DellErrorCodes.RES001
    
    if "timeout" in error_message_lower or "timed out" in error_message_lower:
        return DellErrorCodes.TIMEOUT
    
    # Unknown error - return as-is with conservative retry
    return {
        "code": error_code or "UNKNOWN",
        "message": error_message or "Unknown error occurred",
        "retry": False,
        "wait_seconds": 0,
    }


def get_user_friendly_message(error_code: str) -> str:
    """
    Get user-friendly error message for a Dell error code.
    
    Args:
        error_code: Dell error code (e.g., "RAC0508")
        
    Returns:
        User-friendly error message
    """
    for attr_name in dir(DellErrorCodes):
        if not attr_name.startswith("_"):
            error_info = getattr(DellErrorCodes, attr_name)
            if isinstance(error_info, dict) and error_info.get("code") == error_code:
                return error_info.get("message", "Unknown error")
    
    return f"Dell iDRAC error: {error_code}"
