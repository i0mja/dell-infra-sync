/**
 * iDRAC Error Parser Utility
 * 
 * Parses raw iDRAC Redfish API errors into user-friendly messages
 * with actionable suggestions for recovery.
 */

export interface IdracErrorInfo {
  title: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  isRecoverable: boolean;
  suggestedAction?: string;
  docLink?: string;
  originalError?: string;
}

interface ErrorPattern {
  pattern: RegExp | string;
  info: Omit<IdracErrorInfo, 'originalError'>;
}

const IDRAC_ERROR_PATTERNS: ErrorPattern[] = [
  // ========== iDRAC Core Errors (with Dell KB-backed resolutions) ==========
  {
    pattern: /Base\.1\.\d+\.InternalError/i,
    info: {
      title: 'iDRAC Internal Error',
      message: 'The iDRAC service encountered an internal issue and is not responding properly.',
      severity: 'error',
      isRecoverable: true,
      suggestedAction: 
        'Reset the iDRAC using one of these methods:\n' +
        '• Web UI: Maintenance → Diagnostics → Reset iDRAC\n' +
        '• SSH: Run "racadm racreset"\n' +
        '• Physical: Hold the front panel "i" button for 16 seconds\n\n' +
        'Wait 2-3 minutes for the iDRAC to restart, then retry.',
      docLink: 'https://www.dell.com/support/kbdoc/en-us/000126703',
    },
  },
  {
    pattern: /Base\.1\.\d+\.GeneralError/i,
    info: {
      title: 'iDRAC General Error',
      message: 'The iDRAC returned a general error response.',
      severity: 'error',
      isRecoverable: true,
      suggestedAction: 
        'Reset the iDRAC to clear the error state:\n' +
        '• Web UI: Maintenance → Diagnostics → Reset iDRAC\n' +
        '• SSH: Run "racadm racreset"\n\n' +
        'If the issue persists, check iDRAC logs under Maintenance → Lifecycle Controller Log.',
      docLink: 'https://www.dell.com/support/kbdoc/en-us/000126703',
    },
  },
  {
    pattern: /ServiceTemporarilyUnavailable|service.*unavailable/i,
    info: {
      title: 'iDRAC Service Busy',
      message: 'The Redfish API service is temporarily unavailable.',
      severity: 'warning',
      isRecoverable: true,
      suggestedAction: 
        'The iDRAC may be starting up or processing another operation.\n\n' +
        'Wait 1-2 minutes and retry. If this persists, reset the iDRAC via:\n' +
        '• Web UI: Maintenance → Diagnostics → Reset iDRAC\n' +
        '• SSH: Run "racadm racreset"',
    },
  },
  {
    pattern: /ResourceNotFound|404/i,
    info: {
      title: 'Resource Not Found',
      message: 'The requested Redfish endpoint was not found.',
      severity: 'error',
      isRecoverable: false,
      suggestedAction: 'Check the iDRAC firmware version. This endpoint may not be supported on older firmware.',
    },
  },
  {
    pattern: /NoValidSession|401|Unauthorized/i,
    info: {
      title: 'Authentication Failed',
      message: 'Unable to authenticate with the iDRAC.',
      severity: 'error',
      isRecoverable: true,
      suggestedAction: 
        'Verify the username and password are correct.\n\n' +
        'Ensure the user account:\n' +
        '• Has Redfish API permissions enabled\n' +
        '• Is not locked due to failed login attempts\n' +
        '• Has not expired',
    },
  },
  {
    pattern: /AccessDenied|403|Forbidden/i,
    info: {
      title: 'Access Denied',
      message: 'The credentials do not have permission for this operation.',
      severity: 'error',
      isRecoverable: false,
      suggestedAction: 
        'Check that the iDRAC user has sufficient privileges:\n' +
        '• Administrator role for full access\n' +
        '• Operator role for basic operations\n\n' +
        'Verify in: iDRAC Settings → User Authentication → Users',
    },
  },
  {
    pattern: /WinError 10061|Connection refused|ECONNREFUSED/i,
    info: {
      title: 'Connection Refused',
      message: 'The iDRAC is not accepting connections on the HTTPS port.',
      severity: 'error',
      isRecoverable: true,
      suggestedAction: 
        'Verify the following:\n' +
        '• IP address is correct\n' +
        '• iDRAC is powered on and responsive\n' +
        '• HTTPS is enabled on port 443\n' +
        '• No firewall is blocking the connection',
    },
  },
  {
    pattern: /timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i,
    info: {
      title: 'Connection Timeout',
      message: 'Unable to reach the iDRAC within the timeout period.',
      severity: 'error',
      isRecoverable: true,
      suggestedAction: 
        'Check the following:\n' +
        '• Network connectivity to the iDRAC IP\n' +
        '• Firewall rules allow HTTPS (port 443)\n' +
        '• iDRAC is reachable from the Job Executor host\n\n' +
        'Try pinging the iDRAC IP to verify basic connectivity.',
    },
  },
  {
    pattern: /ENOTFOUND|DNS|name resolution|getaddrinfo/i,
    info: {
      title: 'DNS Resolution Failed',
      message: 'Unable to resolve the hostname to an IP address.',
      severity: 'error',
      isRecoverable: false,
      suggestedAction: 'Use an IP address instead of a hostname, or verify DNS configuration.',
    },
  },
  {
    pattern: /SSL|TLS|certificate|CERT_|ERR_CERT/i,
    info: {
      title: 'SSL/TLS Error',
      message: 'There was a problem with the SSL/TLS connection.',
      severity: 'warning',
      isRecoverable: true,
      suggestedAction: 
        'The system will attempt legacy TLS mode automatically.\n\n' +
        'If this persists:\n' +
        '• The iDRAC certificate may be expired or invalid\n' +
        '• Try updating the iDRAC firmware\n' +
        '• Check iDRAC Settings → Network → SSL for certificate status',
    },
  },
  {
    pattern: /ECONNRESET|connection reset/i,
    info: {
      title: 'Connection Reset',
      message: 'The connection was unexpectedly closed by the iDRAC.',
      severity: 'error',
      isRecoverable: true,
      suggestedAction: 
        'The iDRAC may be overloaded or restarting.\n\n' +
        'Wait 30 seconds and retry. If this persists, reset the iDRAC.',
    },
  },
  {
    pattern: /MaxConcurrentSessions|session limit|too many sessions/i,
    info: {
      title: 'Session Limit Reached',
      message: 'The iDRAC has reached its maximum number of concurrent Redfish sessions.',
      severity: 'warning',
      isRecoverable: true,
      suggestedAction: 
        'Sessions typically expire after 30 minutes of inactivity.\n\n' +
        'To clear sessions immediately:\n' +
        '• Web UI: Maintenance → Diagnostics → Reset iDRAC\n' +
        '• SSH: Run "racadm racreset"',
      docLink: 'https://www.dell.com/support/kbdoc/en-us/000126703',
    },
  },
  // ========== Lifecycle Controller / Job Queue Errors ==========
  {
    pattern: /job.*pending|task.*stuck|LC.*busy|lifecycle.*running|lifecycle.*controller.*busy/i,
    info: {
      title: 'Lifecycle Controller Busy',
      message: 'A previous job or task is still running on the Lifecycle Controller.',
      severity: 'warning',
      isRecoverable: true,
      suggestedAction: 
        'Check the iDRAC job queue for pending tasks.\n\n' +
        'Wait for the existing job to complete, or cancel it via:\n' +
        '• Web UI: Maintenance → Job Queue → Delete\n' +
        '• SSH: "racadm jobqueue delete -i JID_xxxxx"',
    },
  },
  {
    pattern: /firmware.*update.*progress|update.*in.*progress|iDRAC.*updating/i,
    info: {
      title: 'Firmware Update in Progress',
      message: 'The iDRAC is currently being updated and is temporarily unavailable.',
      severity: 'info',
      isRecoverable: true,
      suggestedAction: 
        'Wait for the firmware update to complete (typically 5-10 minutes).\n\n' +
        'The iDRAC will automatically reboot after the update.',
    },
  },
  // ========== License Errors ==========
  {
    pattern: /license.*required|LIC\d+|feature.*not.*licensed/i,
    info: {
      title: 'License Required',
      message: 'This feature requires an iDRAC Enterprise or Datacenter license.',
      severity: 'error',
      isRecoverable: false,
      suggestedAction: 
        'Check the iDRAC license level under Overview → Server → Licenses.\n\n' +
        'Some Redfish operations require iDRAC Enterprise or Datacenter edition.',
    },
  },
  // ========== Power Operation Errors ==========
  {
    pattern: /unable.*reboot|power.*failed|GracefulRestart.*failed|power.*state.*error/i,
    info: {
      title: 'Power Operation Failed',
      message: 'The requested power operation could not be completed.',
      severity: 'error',
      isRecoverable: true,
      suggestedAction: 
        'Possible causes:\n' +
        '• The server OS is in sleep/hibernation mode\n' +
        '• Windows Server requires an active session for graceful restart\n' +
        '• Another power operation is in progress\n\n' +
        'Alternative: Use ForceRestart instead of GracefulRestart.',
    },
  },
  // Firmware scan specific errors
  {
    pattern: /SUP029|already up-to-date|firmware versions.*match/i,
    info: {
      title: 'Server Up-to-Date',
      message: 'No updates available - server firmware matches the catalog.',
      severity: 'info',
      isRecoverable: false,
      suggestedAction: undefined,
    },
  },
  {
    pattern: /SUP030|unsupported.*model|catalog.*does not contain/i,
    info: {
      title: 'Unsupported Server Model',
      message: 'The catalog does not contain firmware for this server model.',
      severity: 'warning',
      isRecoverable: false,
      suggestedAction: 'Verify the server model is supported by Dell Repository Manager.',
    },
  },
  {
    pattern: /SUP031|unable to parse|invalid catalog/i,
    info: {
      title: 'Invalid Catalog',
      message: 'Unable to parse the firmware catalog file.',
      severity: 'error',
      isRecoverable: false,
      suggestedAction: 'Verify the catalog URL and format in Settings.',
    },
  },
  {
    pattern: /repository.*not accessible|share.*unreachable|REP001/i,
    info: {
      title: 'Repository Unreachable',
      message: 'Cannot access the firmware repository.',
      severity: 'error',
      isRecoverable: true,
      suggestedAction: 
        'Verify the following:\n' +
        '• Network share path is correct and accessible\n' +
        '• Share credentials have read permissions\n' +
        '• Firewall allows SMB/CIFS traffic\n\n' +
        'Check Settings → Firmware Repository for configuration.',
    },
  },
  {
    pattern: /firmware.*inventory.*failed|get.*firmware.*error|failed to get firmware/i,
    info: {
      title: 'Firmware Inventory Failed',
      message: 'Could not retrieve the firmware inventory from iDRAC.',
      severity: 'error',
      isRecoverable: true,
      suggestedAction: 
        'The iDRAC may be busy processing another request.\n\n' +
        'Wait 1-2 minutes and retry. If this persists:\n' +
        '• Check iDRAC connectivity\n' +
        '• Reset the iDRAC via Web UI or SSH',
    },
  },
  {
    pattern: /scan.*failed|scan.*error|firmware scan/i,
    info: {
      title: 'Scan Failed',
      message: 'The firmware scan could not be completed.',
      severity: 'error',
      isRecoverable: true,
      suggestedAction: 'Check iDRAC connectivity and try again.',
    },
  },
];

/**
 * Parse a raw error string and return structured error info
 */
export function parseIdracError(errorString: string | undefined | null): IdracErrorInfo | null {
  if (!errorString) {
    return null;
  }

  const errorStr = typeof errorString === 'string' ? errorString : JSON.stringify(errorString);

  for (const { pattern, info } of IDRAC_ERROR_PATTERNS) {
    const matches = typeof pattern === 'string' 
      ? errorStr.includes(pattern)
      : pattern.test(errorStr);
    
    if (matches) {
      return {
        ...info,
        originalError: errorStr,
      };
    }
  }

  // Return a generic error if no pattern matched
  return {
    title: 'Connection Error',
    message: errorStr.length > 200 ? errorStr.substring(0, 200) + '...' : errorStr,
    severity: 'error',
    isRecoverable: true,
    suggestedAction: 'Check the iDRAC is reachable and credentials are correct.',
    originalError: errorStr,
  };
}

/**
 * Format an error string into a user-friendly message
 */
export function formatIdracError(errorString: string | undefined | null): string {
  const parsed = parseIdracError(errorString);
  if (!parsed) {
    return 'Unknown error';
  }
  return `${parsed.title}: ${parsed.message}`;
}

/**
 * Check if an error indicates the iDRAC needs to be rebooted
 */
export function isIdracInternalError(errorString: string | undefined | null): boolean {
  if (!errorString) return false;
  const errorStr = typeof errorString === 'string' ? errorString : JSON.stringify(errorString);
  return /Base\.1\.\d+\.(InternalError|GeneralError)/i.test(errorStr);
}
