/**
 * vCenter Error Message Parser
 * 
 * Parses raw vCenter/vModl fault messages into user-friendly format.
 * Mirrors the backend vcenter_errors.py logic for consistency.
 */

export interface VCenterErrorInfo {
  title: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  isRecoverable: boolean;
  isCancelled: boolean;
  originalMessage?: string;
  faultType?: string;
}

const VCENTER_ERROR_PATTERNS: Record<string, Omit<VCenterErrorInfo, 'originalMessage' | 'faultType'>> = {
  'vmodl.fault.RequestCanceled': {
    title: 'Task Cancelled',
    message: 'The task was cancelled by a user in vCenter.',
    severity: 'warning',
    isRecoverable: true,
    isCancelled: true,
  },
  'vim.fault.InvalidState': {
    title: 'Invalid Host State',
    message: 'The host is in an invalid state for this operation.',
    severity: 'error',
    isRecoverable: true,
    isCancelled: false,
  },
  'vim.fault.VmConfigFault': {
    title: 'VM Configuration Issue',
    message: 'A VM configuration prevents this operation. Check for passthrough devices or local storage.',
    severity: 'error',
    isRecoverable: true,
    isCancelled: false,
  },
  'vim.fault.Timedout': {
    title: 'Operation Timeout',
    message: 'The vCenter operation timed out. DRS may be busy or resources constrained.',
    severity: 'warning',
    isRecoverable: true,
    isCancelled: false,
  },
  'vim.fault.NotEnoughLicenses': {
    title: 'License Issue',
    message: 'Insufficient vCenter/ESXi licenses for this operation.',
    severity: 'error',
    isRecoverable: false,
    isCancelled: false,
  },
  'vim.fault.HostIncompatibleForRecordReplay': {
    title: 'Incompatible Host',
    message: 'The host is incompatible for this operation.',
    severity: 'error',
    isRecoverable: false,
    isCancelled: false,
  },
  'vim.fault.DisallowedOperationOnFailoverHost': {
    title: 'Failover Host Restriction',
    message: 'This operation is not allowed on a failover host.',
    severity: 'error',
    isRecoverable: false,
    isCancelled: false,
  },
  'vim.fault.NoPermission': {
    title: 'Permission Denied',
    message: 'Insufficient permissions to perform this operation.',
    severity: 'error',
    isRecoverable: false,
    isCancelled: false,
  },
  'vim.fault.NotFound': {
    title: 'Object Not Found',
    message: 'The requested vCenter object was not found.',
    severity: 'error',
    isRecoverable: false,
    isCancelled: false,
  },
  'vim.fault.AlreadyExists': {
    title: 'Already Exists',
    message: 'The requested resource already exists.',
    severity: 'warning',
    isRecoverable: true,
    isCancelled: false,
  },
};

/**
 * Parse a vCenter error string and return structured error information.
 */
export function parseVCenterError(errorString: string | null | undefined): VCenterErrorInfo | null {
  if (!errorString) return null;
  
  // Check for known fault patterns
  for (const [pattern, info] of Object.entries(VCENTER_ERROR_PATTERNS)) {
    if (errorString.includes(pattern)) {
      // Extract original message from the raw error
      const msgMatch = errorString.match(/msg\s*=\s*'([^']+)'/);
      return {
        ...info,
        originalMessage: msgMatch?.[1],
        faultType: pattern,
      };
    }
  }
  
  // Fallback: try to extract just the 'msg' field from raw vModl/vim error format
  const msgMatch = errorString.match(/msg\s*=\s*'([^']+)'/);
  if (msgMatch) {
    return {
      title: 'vCenter Error',
      message: msgMatch[1],
      severity: 'error',
      isRecoverable: true,
      isCancelled: false,
      originalMessage: msgMatch[1],
    };
  }
  
  return null; // Not a vCenter error format
}

/**
 * Format a vCenter error string to a user-friendly message.
 * Returns the original string if it's not a recognized vCenter error format.
 */
export function formatVCenterError(errorString: string | null | undefined): string {
  if (!errorString) return 'Unknown error';
  
  const parsed = parseVCenterError(errorString);
  if (parsed) {
    return parsed.message;
  }
  
  return errorString;
}

/**
 * Check if an error string indicates a user-cancelled operation.
 */
export function isUserCancelledError(errorString: string | null | undefined): boolean {
  if (!errorString) return false;
  const parsed = parseVCenterError(errorString);
  return parsed?.isCancelled ?? false;
}
