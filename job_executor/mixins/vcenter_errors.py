"""
vCenter Error Code Mapping

Maps vCenter/vModl fault types to user-friendly messages
for better operator experience.
"""

from typing import Optional, Dict, Tuple, Any
import re

# Mapping of vCenter fault patterns to user-friendly messages
VCENTER_ERROR_MESSAGES: Dict[str, Dict[str, Any]] = {
    'vmodl.fault.RequestCanceled': {
        'title': 'Task Cancelled',
        'message': 'The task was cancelled by a user in vCenter.',
        'severity': 'warning',
        'is_recoverable': True,
    },
    'vim.fault.InvalidState': {
        'title': 'Invalid Host State',
        'message': 'The host is in an invalid state for this operation.',
        'severity': 'error',
        'is_recoverable': True,
    },
    'vim.fault.VmConfigFault': {
        'title': 'VM Configuration Issue',
        'message': 'A VM configuration prevents this operation. Check for passthrough devices or local storage.',
        'severity': 'error',
        'is_recoverable': True,
    },
    'vim.fault.Timedout': {
        'title': 'Operation Timeout',
        'message': 'The vCenter operation timed out. DRS may be busy or resources constrained.',
        'severity': 'warning',
        'is_recoverable': True,
    },
    'vim.fault.NotEnoughLicenses': {
        'title': 'License Issue',
        'message': 'Insufficient vCenter/ESXi licenses for this operation.',
        'severity': 'error',
        'is_recoverable': False,
    },
    'vim.fault.DisallowedOperationOnFailoverHost': {
        'title': 'Failover Host Restriction',
        'message': 'This operation is not allowed on a designated HA failover host.',
        'severity': 'error',
        'is_recoverable': True,
    },
    'vim.fault.HostInDomain': {
        'title': 'Host Domain Conflict',
        'message': 'The host is part of a cluster or domain that prevents this operation.',
        'severity': 'error',
        'is_recoverable': True,
    },
    'vim.fault.MaintenanceModeFileMove': {
        'title': 'File Move Required',
        'message': 'Cannot enter maintenance mode because VMs have files that need to be moved.',
        'severity': 'error',
        'is_recoverable': True,
    },
    'vim.fault.InvalidLogin': {
        'title': 'Authentication Failed',
        'message': 'Invalid credentials for vCenter connection.',
        'severity': 'error',
        'is_recoverable': False,
    },
    'vim.fault.NoPermission': {
        'title': 'Permission Denied',
        'message': 'Insufficient permissions to perform this operation.',
        'severity': 'error',
        'is_recoverable': False,
    },
    'vim.fault.NotSupported': {
        'title': 'Operation Not Supported',
        'message': 'This operation is not supported on the target host or cluster.',
        'severity': 'error',
        'is_recoverable': False,
    },
}


def parse_vcenter_error(error: Exception) -> Tuple[str, Optional[Dict[str, Any]]]:
    """
    Parse a vCenter exception and return a user-friendly message.
    
    Returns:
        Tuple of (friendly_message, error_info_dict or None)
    """
    error_str = str(error)
    error_type = type(error).__name__
    
    # Try to match by exception type name or fault pattern in error string
    for fault_pattern, info in VCENTER_ERROR_MESSAGES.items():
        if fault_pattern in error_type or fault_pattern in error_str:
            # Extract the actual message if present
            msg_match = re.search(r"msg\s*=\s*'([^']+)'", error_str)
            actual_msg = msg_match.group(1) if msg_match else None
            
            return info['message'], {
                'title': info['title'],
                'severity': info['severity'],
                'is_recoverable': info['is_recoverable'],
                'original_message': actual_msg,
                'fault_type': fault_pattern,
            }
    
    # For unknown errors, try to extract the msg field
    msg_match = re.search(r"msg\s*=\s*'([^']+)'", error_str)
    if msg_match:
        return msg_match.group(1), None
    
    # Return original error string
    return error_str, None


def format_maintenance_mode_error(error: Exception, host_name: str = "") -> str:
    """
    Format a maintenance mode error for user display.
    """
    friendly_msg, info = parse_vcenter_error(error)
    
    if info:
        return f"{info['title']}: {friendly_msg}"
    
    return friendly_msg
