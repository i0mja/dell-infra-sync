import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logIdracCommand } from './idrac-logger.ts';

export interface IdracSession {
  token: string;
  location: string;
  ip_address: string;
  username: string;
}

export interface IdracError {
  code: string;
  message: string;
  details?: any;
  remediation?: string;
}

/**
 * Creates a Redfish session with the iDRAC
 * Returns session object with token, or null if session creation fails
 */
export async function createIdracSession(
  ip_address: string,
  username: string,
  password: string,
  supabase?: SupabaseClient,
  userId?: string,
  serverId?: string,
  timeout: number = 10000
): Promise<IdracSession | null> {
  const sessionUrl = `https://${ip_address}/redfish/v1/SessionService/Sessions`;
  const startTime = Date.now();
  
  try {
    console.log(`[SESSION] Creating session for ${ip_address}`);
    
    const response = await fetch(sessionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        UserName: username,
        Password: password,
      }),
      signal: AbortSignal.timeout(timeout),
      // @ts-ignore - Deno-specific option to bypass SSL verification
      insecure: true,
    });

    const responseTime = Date.now() - startTime;
    const responseData = response.ok ? await response.json() : null;

    // Log session creation attempt
    if (supabase) {
      await logIdracCommand({
        supabase,
        serverId,
        commandType: 'POST',
        endpoint: '/SessionService/Sessions',
        fullUrl: sessionUrl,
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { UserName: username, Password: '[REDACTED]' },
        statusCode: response.status,
        responseTimeMs: responseTime,
        responseBody: responseData,
        success: response.ok,
        errorMessage: !response.ok ? `Session creation failed with status ${response.status}` : undefined,
        initiatedBy: userId,
        source: 'edge_function',
        operationType: 'idrac_api',
      });
    }

    if (!response.ok) {
      console.warn(`[SESSION] Failed to create session for ${ip_address}: ${response.status} ${response.statusText}`);
      return null;
    }

    // Extract session token from headers
    const token = response.headers.get('X-Auth-Token');
    const location = response.headers.get('Location');

    if (!token || !location) {
      console.warn(`[SESSION] Missing token or location headers for ${ip_address}`);
      return null;
    }

    console.log(`[SESSION] Session created successfully for ${ip_address}`);
    
    return {
      token,
      location,
      ip_address,
      username,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error(`[SESSION] Exception creating session for ${ip_address}:`, error);
    
    // Log the error
    if (supabase) {
      await logIdracCommand({
        supabase,
        serverId,
        commandType: 'POST',
        endpoint: '/SessionService/Sessions',
        fullUrl: sessionUrl,
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { UserName: username, Password: '[REDACTED]' },
        statusCode: 0,
        responseTimeMs: responseTime,
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Session creation exception',
        initiatedBy: userId,
        source: 'edge_function',
        operationType: 'idrac_api',
      });
    }
    
    return null;
  }
}

/**
 * Deletes a Redfish session (logout)
 */
export async function deleteIdracSession(
  session: IdracSession,
  supabase?: SupabaseClient,
  userId?: string,
  serverId?: string
): Promise<void> {
  const deleteUrl = `https://${session.ip_address}${session.location}`;
  const startTime = Date.now();
  
  try {
    console.log(`[SESSION] Deleting session for ${session.ip_address}`);
    
    const response = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'X-Auth-Token': session.token,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
      // @ts-ignore - Deno-specific option
      insecure: true,
    });

    const responseTime = Date.now() - startTime;

    // Log session deletion
    if (supabase) {
      await logIdracCommand({
        supabase,
        serverId,
        commandType: 'DELETE',
        endpoint: session.location,
        fullUrl: deleteUrl,
        requestHeaders: { 'X-Auth-Token': '[REDACTED]' },
        statusCode: response.status,
        responseTimeMs: responseTime,
        success: response.ok,
        errorMessage: !response.ok ? `Session deletion failed with status ${response.status}` : undefined,
        initiatedBy: userId,
        source: 'edge_function',
        operationType: 'idrac_api',
      });
    }

    if (response.ok) {
      console.log(`[SESSION] Session deleted successfully for ${session.ip_address}`);
    } else {
      console.warn(`[SESSION] Failed to delete session for ${session.ip_address}: ${response.status}`);
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.warn(`[SESSION] Exception deleting session for ${session.ip_address}:`, error);
    
    // Log the error but don't throw - session cleanup is best-effort
    if (supabase) {
      await logIdracCommand({
        supabase,
        serverId,
        commandType: 'DELETE',
        endpoint: session.location,
        fullUrl: deleteUrl,
        requestHeaders: { 'X-Auth-Token': '[REDACTED]' },
        statusCode: 0,
        responseTimeMs: responseTime,
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Session deletion exception',
        initiatedBy: userId,
        source: 'edge_function',
        operationType: 'idrac_api',
      });
    }
  }
}

/**
 * Makes an authenticated request using session token
 * Falls back to Basic Auth if session is not provided
 */
export async function makeAuthenticatedRequest(
  ip_address: string,
  endpoint: string,
  session: IdracSession | null,
  username?: string,
  password?: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `https://${ip_address}${endpoint}`;
  
  // Prepare headers
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  // Use session token if available, otherwise fall back to Basic Auth
  if (session) {
    headers['X-Auth-Token'] = session.token;
  } else if (username && password) {
    headers['Authorization'] = `Basic ${btoa(`${username}:${password}`)}`;
  } else {
    throw new Error('No authentication credentials provided');
  }

  return fetch(url, {
    ...options,
    headers,
    signal: options.signal || AbortSignal.timeout(10000),
    // @ts-ignore - Deno-specific option
    insecure: true,
  });
}
