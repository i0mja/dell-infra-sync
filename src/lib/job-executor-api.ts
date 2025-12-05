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
