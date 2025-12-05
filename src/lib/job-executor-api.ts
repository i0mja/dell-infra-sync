/**
 * Job Executor API Client
 * Direct HTTP calls to Job Executor for instant operations (no job queue)
 */

const DEFAULT_URL = 'http://localhost:8081';
let apiBaseUrl = localStorage.getItem('job_executor_url') || DEFAULT_URL;

/**
 * Set the Job Executor URL dynamically
 */
export function setJobExecutorUrl(url: string) {
  apiBaseUrl = url;
  localStorage.setItem('job_executor_url', url);
}

/**
 * Get the current Job Executor URL
 */
export function getJobExecutorUrl(): string {
  return apiBaseUrl;
}

/**
 * Initialize URL from database settings (call on app load)
 */
export function initializeJobExecutorUrl(dbUrl: string | null) {
  if (dbUrl) {
    apiBaseUrl = dbUrl;
    localStorage.setItem('job_executor_url', dbUrl);
  }
}

export interface ConsoleSessionResponse {
  success: boolean;
  console_url?: string;
  server_id?: string;
  ip_address?: string;
  session_type?: string;
  requires_login?: boolean;
  message?: string;
  error?: string;
}

export interface PowerControlResponse {
  success: boolean;
  action?: string;
  server_id?: string;
  message?: string;
  error?: string;
}

export interface ConnectivityTestResponse {
  success: boolean;
  server_id?: string;
  ip_address?: string;
  reachable?: boolean;
  response_time_ms?: number;
  message?: string;
  error?: string;
}

export interface DatastoreBrowseResponse {
  success: boolean;
  datastore_name?: string;
  files?: Array<{
    name: string;
    size: number;
    modified: string | null;
    folder: string;
    full_path: string;
    is_directory: boolean;
  }>;
  total_files?: number;
  error?: string;
}

export interface IdmAuthenticateResponse {
  success: boolean;
  user_id?: string;
  email?: string;
  idm_uid?: string;
  canonical_principal?: string;
  realm?: string;
  is_ad_trust_user?: boolean;
  role?: string;
  idm_groups?: string[];
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  error?: string;
  remaining_attempts?: number;
  lockout_remaining_seconds?: number;
}

export interface NetworkConfigResponse {
  success: boolean;
  ipv4?: {
    enabled: boolean;
    dhcp_enabled: boolean;
    address: string;
    gateway: string;
    netmask: string;
    dns1: string;
    dns2: string;
    dns_from_dhcp: boolean;
  };
  nic?: {
    selection: string;
    speed: string;
    duplex: string;
    mtu: number;
    vlan_enabled: boolean;
    vlan_id: number;
    vlan_priority: number;
  };
  ntp?: {
    enabled: boolean;
    server1: string;
    server2: string;
    server3: string;
    timezone: string;
  };
  error?: string;
}

export interface HealthCheckResponse {
  success: boolean;
  server_id?: string;
  ip_address?: string;
  power_state?: string;
  overall_health?: string;
  health_rollup?: string;
  processor?: { health?: string; count?: number };
  memory?: { health?: string; total_gb?: number };
  chassis_status?: string;
  temperature_celsius?: number;
  fan_health?: string;
  psu_health?: string;
  storage_health?: string;
  network_health?: string;
  sensors?: Record<string, any>;
  error?: string;
}

export interface EventLogsResponse {
  success: boolean;
  server_id?: string;
  events?: Array<{
    id: string;
    timestamp: string;
    severity: string;
    message: string;
    sensor_type?: string;
    event_id?: string;
    category?: string;
  }>;
  count?: number;
  error?: string;
}

export interface BootConfigResponse {
  success: boolean;
  server_id?: string;
  boot_order?: string[];
  boot_mode?: string;
  boot_source_override_enabled?: string;
  boot_source_override_target?: string;
  uefi_target?: string;
  error?: string;
}

export interface BiosConfigResponse {
  success: boolean;
  server_id?: string;
  config_id?: string;
  attributes?: Record<string, any>;
  bios_version?: string;
  attribute_registry?: string;
  error?: string;
}

export interface FirmwareInventoryResponse {
  success: boolean;
  server_id?: string;
  firmware?: Array<{
    name: string;
    version: string;
    updateable: boolean;
    status?: any;
    id: string;
  }>;
  count?: number;
  error?: string;
}

export interface IdracJobsResponse {
  success: boolean;
  server_id?: string;
  jobs?: Array<{
    id: string;
    name: string;
    job_state: string;
    percent_complete: number;
    message?: string;
    job_type?: string;
    start_time?: string;
    end_time?: string;
  }>;
  count?: number;
  error?: string;
}

/**
 * Launch iDRAC console session
 */
export async function launchConsole(serverId: string): Promise<ConsoleSessionResponse> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/console-launch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ server_id: serverId }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to launch console');
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error('Job Executor is not running or not reachable. Please ensure it is started on your local network.');
      }
      throw error;
    }
    throw new Error('Unknown error launching console');
  }
}

/**
 * Control server power
 */
export async function controlPower(
  serverId: string,
  action: 'on' | 'off' | 'graceful_shutdown' | 'reset' | 'graceful_restart'
): Promise<PowerControlResponse> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/power-control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ server_id: serverId, action }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to control power');
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error('Job Executor is not running or not reachable. Please ensure it is started on your local network.');
      }
      throw error;
    }
    throw new Error('Unknown error controlling power');
  }
}

/**
 * Test server connectivity
 */
export async function testConnectivity(serverId: string): Promise<ConnectivityTestResponse> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/connectivity-test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ server_id: serverId }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to test connectivity');
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error('Job Executor is not running or not reachable. Please ensure it is started on your local network.');
      }
      throw error;
    }
    throw new Error('Unknown error testing connectivity');
  }
}

/**
 * Browse vCenter datastore
 */
export async function browseDatastore(
  vcenterId: string,
  datastoreName: string,
  folderPath: string = '',
  filePatterns: string[] = ['*.zip', '*.iso']
): Promise<DatastoreBrowseResponse> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/browse-datastore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vcenter_id: vcenterId,
        datastore_name: datastoreName,
        folder_path: folderPath,
        file_patterns: filePatterns,
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to browse datastore');
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error('Job Executor is not running or not reachable. Please ensure it is started on your local network.');
      }
      throw error;
    }
    throw new Error('Unknown error browsing datastore');
  }
}

/**
 * Authenticate via IDM (Job Executor)
 */
export async function authenticateIdm(
  username: string,
  password: string
): Promise<IdmAuthenticateResponse> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/idm-authenticate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json();
    
    if (!response.ok && !data.success) {
      return data; // Return the error response with remaining_attempts etc.
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error('JOB_EXECUTOR_UNREACHABLE');
      }
      throw error;
    }
    throw new Error('Unknown error during IDM authentication');
  }
}

/**
 * Check if Job Executor API is reachable
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    await fetch(`${apiBaseUrl}/api/health`, {
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Test connection to a specific Job Executor URL
 */
export async function testJobExecutorConnection(url: string): Promise<{ success: boolean; message: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${url}/api/health`, {
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      return { success: true, message: 'Connection successful' };
    }
    return { success: false, message: `HTTP ${response.status}: ${response.statusText}` };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return { success: false, message: 'Connection timed out after 5 seconds' };
      }
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        return { success: false, message: 'Cannot reach Job Executor - check URL and ensure service is running' };
      }
      return { success: false, message: error.message };
    }
    return { success: false, message: 'Unknown error' };
  }
}

/**
 * Read iDRAC network configuration (instant, no job queue)
 */
export async function readNetworkConfig(serverId: string): Promise<NetworkConfigResponse> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/network-config-read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ server_id: serverId }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to read network config');
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error('Job Executor is not running or not reachable. Please ensure it is started on your local network.');
      }
      throw error;
    }
    throw new Error('Unknown error reading network config');
  }
}

/**
 * Get server health status (instant, no job queue)
 */
export async function getServerHealth(serverId: string): Promise<HealthCheckResponse> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/health-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ server_id: serverId }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get health status');
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error('Job Executor is not running or not reachable. Please ensure it is started on your local network.');
      }
      throw error;
    }
    throw new Error('Unknown error getting health status');
  }
}

/**
 * Get system event logs (instant, no job queue)
 */
export async function getEventLogs(serverId: string, limit: number = 50): Promise<EventLogsResponse> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/event-logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ server_id: serverId, limit }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get event logs');
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error('Job Executor is not running or not reachable. Please ensure it is started on your local network.');
      }
      throw error;
    }
    throw new Error('Unknown error getting event logs');
  }
}

/**
 * Get boot configuration (instant, no job queue)
 */
export async function getBootConfig(serverId: string): Promise<BootConfigResponse> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/boot-config-read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ server_id: serverId }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get boot config');
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error('Job Executor is not running or not reachable. Please ensure it is started on your local network.');
      }
      throw error;
    }
    throw new Error('Unknown error getting boot config');
  }
}

/**
 * Get BIOS configuration (instant, no job queue)
 */
export async function getBiosConfig(serverId: string, notes?: string): Promise<BiosConfigResponse> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/bios-config-read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ server_id: serverId, notes }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get BIOS config');
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error('Job Executor is not running or not reachable. Please ensure it is started on your local network.');
      }
      throw error;
    }
    throw new Error('Unknown error getting BIOS config');
  }
}

/**
 * Get firmware inventory (instant, no job queue)
 */
export async function getFirmwareInventory(serverId: string): Promise<FirmwareInventoryResponse> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/firmware-inventory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ server_id: serverId }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get firmware inventory');
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error('Job Executor is not running or not reachable. Please ensure it is started on your local network.');
      }
      throw error;
    }
    throw new Error('Unknown error getting firmware inventory');
  }
}

/**
 * Get iDRAC job queue (instant, no job queue)
 */
export async function getIdracJobs(serverId: string, includeDetails: boolean = true): Promise<IdracJobsResponse> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/idrac-jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ server_id: serverId, include_details: includeDetails }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get iDRAC jobs');
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error('Job Executor is not running or not reachable. Please ensure it is started on your local network.');
      }
      throw error;
    }
    throw new Error('Unknown error getting iDRAC jobs');
  }
}
