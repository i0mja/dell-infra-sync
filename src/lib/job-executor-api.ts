/**
 * Job Executor API Client
 * Direct HTTP calls to Job Executor for instant operations (no job queue)
 */

const API_BASE_URL = 'http://localhost:8081';

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

/**
 * Launch iDRAC console session
 */
export async function launchConsole(serverId: string): Promise<ConsoleSessionResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/console-launch`, {
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
    const response = await fetch(`${API_BASE_URL}/api/power-control`, {
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
    const response = await fetch(`${API_BASE_URL}/api/connectivity-test`, {
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
    const response = await fetch(`${API_BASE_URL}/api/browse-datastore`, {
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
 * Check if Job Executor API is reachable
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    await fetch(`${API_BASE_URL}/api/health`, {
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return true;
  } catch {
    return false;
  }
}
