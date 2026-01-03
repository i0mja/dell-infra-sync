/**
 * Discovery Scan Message Translation
 * Converts backend log messages to friendly, human-readable text
 */

// Map of backend log patterns to friendly messages
const MESSAGE_PATTERNS: Array<{ pattern: RegExp; message: string | ((match: RegExpMatchArray) => string) }> = [
  // Stage indicators
  { pattern: /Stage 1: TCP port check/i, message: 'Checking network connectivity' },
  { pattern: /Stage 2: iDRAC detection/i, message: 'Detecting Dell iDRAC interfaces' },
  { pattern: /Stage 3: Full authentication/i, message: 'Testing credentials' },
  
  // Scanning progress
  { pattern: /Scanning (\d+) IPs/i, message: (m) => `Scanning ${m[1]} IP addresses` },
  { pattern: /Scanning CIDR range ([^\s:]+)/i, message: (m) => `Scanning network range ${m[1]}` },
  { pattern: /Scanning IP range ([^\s:]+)/i, message: (m) => `Scanning IP range ${m[1]}` },
  { pattern: /Scanning single IP: (.+)/i, message: (m) => `Scanning ${m[1]}` },
  
  // Discovery results
  { pattern: /✓ Found iDRAC at ([^\s:]+): ([^\s]+) \(using ([^)]+)\)/i, message: (m) => `Found ${m[2]} at ${m[1]}` },
  { pattern: /✓ (\d+) servers authenticated/i, message: (m) => `${m[1]} servers authenticated successfully` },
  { pattern: /⚠ (\d+) iDRACs require credentials/i, message: (m) => `${m[1]} servers need valid credentials` },
  { pattern: /⊗ (\d+) IPs filtered \(port closed\)/i, message: (m) => `${m[1]} IPs skipped (no response)` },
  { pattern: /⊗ (\d+) IPs filtered \(not iDRAC\)/i, message: (m) => `${m[1]} IPs skipped (not Dell iDRAC)` },
  
  // Server refresh
  { pattern: /Auto-triggering full refresh/i, message: 'Starting server data sync...' },
  { pattern: /✓ Auto-refresh completed/i, message: 'Server data synchronized' },
  { pattern: /Refreshing (\d+) servers with full info/i, message: (m) => `Syncing data from ${m[1]} servers` },
  { pattern: /Server (\d+)\/(\d+): (.+?) \((.+?)\)/i, message: (m) => `Server ${m[1]}/${m[2]}: ${m[3]}` },
  
  // SCP backup
  { pattern: /Starting SCP export for (.+)/i, message: (m) => `Backing up ${m[1]} configuration` },
  { pattern: /SCP Export complete for (.+)/i, message: (m) => `Backup complete: ${m[1]}` },
  { pattern: /SCP backup.*created/i, message: 'Configuration backup saved' },
  
  // Data collection
  { pattern: /Fetching comprehensive server info/i, message: 'Reading server hardware data' },
  { pattern: /GET \/redfish\/v1\/Systems/i, message: 'Reading system information' },
  { pattern: /GET \/redfish\/v1\/Chassis/i, message: 'Reading chassis information' },
  { pattern: /✓ Discovered (\d+) storage drives/i, message: (m) => `Found ${m[1]} storage drives` },
  { pattern: /✓ Discovered (\d+) NIC ports/i, message: (m) => `Found ${m[1]} network interfaces` },
  
  // Completion
  { pattern: /Discovery complete/i, message: 'Discovery scan complete' },
  { pattern: /Optimization: Skipped/i, message: 'Scan optimized for faster completion' },
  
  // Thread management
  { pattern: /Using (\d+) concurrent threads/i, message: (m) => `Using ${m[1]} parallel scanners` },
  { pattern: /Using (\d+) credential set\(s\)/i, message: (m) => `Testing ${m[1]} credential sets` },
];

export interface TranslatedMessage {
  original: string;
  friendly: string;
  timestamp?: string;
  level?: 'info' | 'success' | 'warn' | 'error';
}

/**
 * Translate a backend log message to a friendly format
 */
export function translateDiscoveryMessage(message: string): TranslatedMessage {
  // Determine message level from indicators
  let level: TranslatedMessage['level'] = 'info';
  if (message.includes('✓') || message.toLowerCase().includes('success') || message.toLowerCase().includes('complete')) {
    level = 'success';
  } else if (message.includes('⚠') || message.toLowerCase().includes('warn')) {
    level = 'warn';
  } else if (message.includes('✗') || message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')) {
    level = 'error';
  }

  // Try to match and translate the message
  for (const { pattern, message: translation } of MESSAGE_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      const friendly = typeof translation === 'function' ? translation(match) : translation;
      return { original: message, friendly, level };
    }
  }

  // Return original if no translation found (clean up common prefixes)
  const cleaned = message
    .replace(/^\s*[✓⚠⊗✗]\s*/, '')
    .replace(/^\s*\[[\w]+\]\s*/, '')
    .trim();
  
  return { original: message, friendly: cleaned || message, level };
}

export interface GroupedDiscoveryLog {
  ip?: string;
  hostname?: string;
  messages: TranslatedMessage[];
  status?: 'scanning' | 'synced' | 'auth_failed' | 'filtered' | 'pending';
}

/**
 * Group console logs by server/IP for timeline display
 */
export function groupDiscoveryLogs(logs: string[]): GroupedDiscoveryLog[] {
  const groups: GroupedDiscoveryLog[] = [];
  let currentGroup: GroupedDiscoveryLog | null = null;

  // Pattern to detect IP-specific messages
  const ipPattern = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;

  for (const log of logs) {
    const translated = translateDiscoveryMessage(log);
    const ipMatch = log.match(ipPattern);

    if (ipMatch) {
      const ip = ipMatch[1];
      // Find or create group for this IP
      let group = groups.find(g => g.ip === ip);
      if (!group) {
        group = { ip, messages: [] };
        groups.push(group);
      }
      group.messages.push(translated);
      
      // Update status based on message
      if (log.includes('Found iDRAC') || log.includes('synced')) {
        group.status = 'synced';
      } else if (log.includes('auth') && log.includes('fail')) {
        group.status = 'auth_failed';
      } else if (log.includes('filtered')) {
        group.status = 'filtered';
      } else if (!group.status) {
        group.status = 'scanning';
      }
    } else {
      // Global message - add to a "general" group
      let generalGroup = groups.find(g => !g.ip);
      if (!generalGroup) {
        generalGroup = { messages: [] };
        groups.unshift(generalGroup);
      }
      generalGroup.messages.push(translated);
    }
  }

  return groups;
}

/**
 * Discovery scan phases for the progress rail
 */
export const DISCOVERY_PHASES = [
  { id: 'port_scan', label: 'Port Scan', description: 'Testing TCP 443 connectivity' },
  { id: 'detection', label: 'Detection', description: 'Checking for iDRAC endpoints' },
  { id: 'auth', label: 'Authentication', description: 'Testing credentials' },
  { id: 'sync', label: 'Data Sync', description: 'Collecting server information' },
] as const;

export type DiscoveryPhase = typeof DISCOVERY_PHASES[number]['id'];

/**
 * Map backend stage to phase ID
 */
export function mapStageToPhase(stage?: string): DiscoveryPhase {
  switch (stage?.toLowerCase()) {
    case 'port_check':
    case 'port_scan':
    case 'tcp_check':
      return 'port_scan';
    case 'detecting':
    case 'detection':
    case 'idrac_check':
      return 'detection';
    case 'authenticating':
    case 'auth':
    case 'credential_test':
      return 'auth';
    case 'syncing':
    case 'sync':
    case 'refresh':
    case 'data_sync':
      return 'sync';
    default:
      return 'port_scan';
  }
}
