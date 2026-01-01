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

// Component type friendly names
const COMPONENT_TYPE_MAP: Record<string, string> = {
  'BIOS': 'BIOS',
  'iDRAC': 'iDRAC Controller',
  'CPLD': 'System CPLD',
  'NIC': 'Network Adapter',
  'RAID': 'RAID Controller',
  'PSU': 'Power Supply',
  'Backplane': 'Storage Backplane',
  'Enclosure': 'Disk Enclosure',
  'FC': 'Fibre Channel',
  'Diagnostics': 'Diagnostics',
  'DriverPack': 'Driver Pack',
  'OSCollector': 'OS Collector',
  'BOSS': 'BOSS Controller',
  'PCIeSSD': 'PCIe SSD',
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
 * Get a human-friendly component type name
 */
export function getFriendlyComponentType(componentType: string): string {
  return COMPONENT_TYPE_MAP[componentType] || componentType;
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

/**
 * Format a host scan completion message with component details
 */
export function formatHostScanResult(result: {
  hostname?: string;
  host_name?: string;
  status?: string;
  updates_available?: number;
  components_checked?: number;
  component_types?: string[];
  error?: string;
}): string {
  const hostname = result.hostname || result.host_name || 'Unknown host';
  
  if (result.status === 'failed' || result.error) {
    return `✗ ${hostname}: Scan failed${result.error ? ` - ${result.error}` : ''}`;
  }
  
  const updatesAvailable = result.updates_available ?? 0;
  const componentsChecked = result.components_checked ?? 0;
  
  if (updatesAvailable > 0) {
    const types = result.component_types?.slice(0, 3).join(', ') || '';
    const typesSuffix = types ? ` (${types}${(result.component_types?.length ?? 0) > 3 ? '...' : ''})` : '';
    return `✓ ${hostname}: ${updatesAvailable} update${updatesAvailable !== 1 ? 's' : ''} available${typesSuffix}`;
  }
  
  return `✓ ${hostname}: Up-to-date (${componentsChecked} components checked)`;
}

/**
 * Get a summary message for a completed scan
 */
export function getScanSummaryMessage(details: any): string {
  const hostsScanned = details?.hosts_scanned ?? 0;
  const summary = details?.summary || {};
  const updatesAvailable = summary.updatesAvailable ?? 0;
  const criticalUpdates = summary.criticalUpdates ?? 0;
  const hostsFailed = summary.hostsFailed ?? 0;
  
  const parts: string[] = [`${hostsScanned} host${hostsScanned !== 1 ? 's' : ''} scanned`];
  
  if (updatesAvailable > 0) {
    parts.push(`${updatesAvailable} update${updatesAvailable !== 1 ? 's' : ''} available`);
  }
  
  if (criticalUpdates > 0) {
    parts.push(`${criticalUpdates} critical`);
  }
  
  if (hostsFailed > 0) {
    parts.push(`${hostsFailed} failed`);
  }
  
  if (updatesAvailable === 0 && hostsFailed === 0) {
    parts.push('all up-to-date');
  }
  
  return parts.join(', ');
}
