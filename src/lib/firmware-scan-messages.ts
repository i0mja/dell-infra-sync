// Human-readable message translation for firmware inventory scans

// Map API command types to friendly operation names
const COMMAND_TYPE_MAP: Record<string, string> = {
  'Check Available Catalog Updates': 'Checking for available updates',
  'InstallFromRepository': 'Checking update catalog',
  'GetRepoBasedUpdateList': 'Retrieving available updates',
  'GetSoftwareInventory': 'Reading current firmware versions',
  'Get Firmware Inventory': 'Collecting firmware inventory',
  'GetSystemInfo': 'Getting system information',
  'CheckUpdateCompliance': 'Comparing versions',
  'Get Job Status': 'Waiting for iDRAC response',
  'Poll Job Status': 'Waiting for iDRAC response',
};

// Map endpoint patterns to friendly descriptions
const ENDPOINT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /UpdateService\/Actions\/.*InstallFromRepository/i, label: 'Checking for available updates' },
  { pattern: /UpdateService\/FirmwareInventory/i, label: 'Reading firmware inventory' },
  { pattern: /UpdateService/i, label: 'Checking update service' },
  { pattern: /SoftwareInventory/i, label: 'Reading software versions' },
  { pattern: /DellJobService/i, label: 'Waiting for iDRAC' },
  { pattern: /Jobs\/JID_/i, label: 'Checking job status' },
  { pattern: /Managers\/iDRAC/i, label: 'Connecting to iDRAC' },
  { pattern: /Systems\/System\.Embedded/i, label: 'Reading system info' },
];

// Map phase names to friendly status messages
const PHASE_MAP: Record<string, string> = {
  'Scanning': 'Checking firmware status',
  'Pending scan': 'Waiting to start',
  'Connecting': 'Connecting to server',
  'Initializing': 'Preparing scan',
  'Querying firmware': 'Reading firmware versions',
  'Comparing versions': 'Checking for updates',
  'Completed': 'Scan complete',
  'Failed': 'Scan failed',
};

/**
 * Get a human-friendly description for an API command type
 */
export function getFriendlyCommandType(commandType: string): string {
  return COMMAND_TYPE_MAP[commandType] || commandType;
}

/**
 * Get a human-friendly description for an API endpoint
 */
export function getFriendlyEndpoint(endpoint: string): string {
  for (const { pattern, label } of ENDPOINT_PATTERNS) {
    if (pattern.test(endpoint)) {
      return label;
    }
  }
  // Fallback: extract the last meaningful path segment
  const parts = endpoint.split('/').filter(Boolean);
  const lastPart = parts[parts.length - 1] || endpoint;
  return lastPart.replace(/([A-Z])/g, ' $1').trim();
}

/**
 * Get a human-friendly description for a scan phase
 */
export function getFriendlyPhase(phase: string): string {
  return PHASE_MAP[phase] || phase;
}

/**
 * Format a full activity message (command_type + endpoint) for display
 */
export function formatActivityMessage(commandType: string, endpoint: string) {
  const friendlyCommand = getFriendlyCommandType(commandType);
  // If we got a custom mapping, use just that
  if (COMMAND_TYPE_MAP[commandType]) {
    return friendlyCommand;
  }
  // Otherwise, try to get context from endpoint
  return getFriendlyEndpoint(endpoint);
}

/**
 * Get the current operation message for a firmware scan
 */
export function getCurrentOperationMessage(details: any): string {
  const currentHost = details?.current_host;
  const currentStep = details?.current_step;
  const hostsScanned = details?.hosts_scanned ?? 0;
  const hostsTotal = details?.hosts_total ?? 0;
  
  if (currentHost) {
    if (currentStep) {
      const friendlyStep = getFriendlyPhase(currentStep);
      return `${friendlyStep} on ${currentHost}`;
    }
    return `Scanning ${currentHost}`;
  }
  
  if (hostsTotal > 0 && hostsScanned < hostsTotal) {
    return `Scanning hosts (${hostsScanned}/${hostsTotal})`;
  }
  
  if (currentStep) {
    return getFriendlyPhase(currentStep);
  }
  
  return 'Checking for updates...';
}

/**
 * Calculate progress percentage for firmware scan
 */
export function calculateScanProgress(details: any): number {
  const hostsScanned = details?.hosts_scanned ?? 0;
  const hostsTotal = details?.hosts_total ?? 0;
  const progressPercent = details?.progress_percent;
  
  // Prefer explicit progress percent if available
  if (typeof progressPercent === 'number' && progressPercent > 0) {
    return progressPercent;
  }
  
  // Calculate from host counts
  if (hostsTotal > 0) {
    return Math.round((hostsScanned / hostsTotal) * 100);
  }
  
  return 0;
}
