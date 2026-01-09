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
  originalError?: string;
}

interface ErrorPattern {
  pattern: RegExp | string;
  info: Omit<IdracErrorInfo, 'originalError'>;
}

const IDRAC_ERROR_PATTERNS: ErrorPattern[] = [
  {
    pattern: /Base\.1\.\d+\.InternalError/i,
    info: {
      title: 'iDRAC Internal Error',
      message: 'The iDRAC service is experiencing an internal issue.',
      severity: 'error',
      isRecoverable: true,
      suggestedAction: 'Reboot the iDRAC and wait 2-3 minutes before retrying. You can reboot via the web UI, SSH, or the physical reset button.',
    },
  },
  {
    pattern: /Base\.1\.\d+\.GeneralError/i,
    info: {
      title: 'iDRAC General Error',
      message: 'The iDRAC returned a general error response.',
      severity: 'error',
      isRecoverable: true,
      suggestedAction: 'Reboot the iDRAC via the web UI or SSH. If the issue persists, check the iDRAC logs for more details.',
    },
  },
  {
    pattern: /ServiceTemporarilyUnavailable/i,
    info: {
      title: 'iDRAC Busy',
      message: 'The Redfish service is temporarily unavailable.',
      severity: 'warning',
      isRecoverable: true,
      suggestedAction: 'Wait 1-2 minutes and retry. The iDRAC may be starting up or processing another request.',
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
      suggestedAction: 'Verify the username and password are correct. Ensure the user has Redfish API permissions.',
    },
  },
  {
    pattern: /AccessDenied|403|Forbidden/i,
    info: {
      title: 'Access Denied',
      message: 'The credentials do not have permission for this operation.',
      severity: 'error',
      isRecoverable: false,
      suggestedAction: 'Check that the iDRAC user has Administrator or Operator privileges.',
    },
  },
  {
    pattern: /WinError 10061|Connection refused|ECONNREFUSED/i,
    info: {
      title: 'Connection Refused',
      message: 'The iDRAC is not accepting connections on the HTTPS port.',
      severity: 'error',
      isRecoverable: true,
      suggestedAction: 'Verify the IP address is correct and the iDRAC is powered on. Check if HTTPS is enabled on port 443.',
    },
  },
  {
    pattern: /timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i,
    info: {
      title: 'Connection Timeout',
      message: 'Unable to reach the iDRAC within the timeout period.',
      severity: 'error',
      isRecoverable: true,
      suggestedAction: 'Check network connectivity and firewall rules. Ensure the iDRAC IP is reachable from the Job Executor.',
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
      suggestedAction: 'The system will attempt legacy TLS mode automatically. If this persists, the iDRAC certificate may be invalid.',
    },
  },
  {
    pattern: /ECONNRESET|connection reset/i,
    info: {
      title: 'Connection Reset',
      message: 'The connection was unexpectedly closed by the iDRAC.',
      severity: 'error',
      isRecoverable: true,
      suggestedAction: 'The iDRAC may be overloaded. Wait a few seconds and retry.',
    },
  },
  {
    pattern: /MaxConcurrentSessions|session limit/i,
    info: {
      title: 'Session Limit Reached',
      message: 'The iDRAC has reached its maximum number of concurrent sessions.',
      severity: 'warning',
      isRecoverable: true,
    suggestedAction: 'Wait for existing sessions to expire (typically 30 minutes) or reboot the iDRAC to clear sessions.',
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
      suggestedAction: 'Check network path and credentials in Settings.',
    },
  },
  {
    pattern: /firmware.*inventory.*failed|get.*firmware.*error|failed to get firmware/i,
    info: {
      title: 'Firmware Inventory Failed',
      message: 'Could not retrieve the firmware inventory from iDRAC.',
      severity: 'error',
      isRecoverable: true,
      suggestedAction: 'The iDRAC may be busy. Wait a moment and retry.',
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
