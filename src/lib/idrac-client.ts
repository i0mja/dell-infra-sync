import { supabase } from "@/integrations/supabase/client";

interface IdracCredentials {
  username: string;
  password: string;
}

interface TestConnectionResult {
  success: boolean;
  responseTime: number;
  version?: string;
  error?: string;
}

interface RefreshInfoResult {
  success: boolean;
  message: string;
  error?: string;
}

async function logIdracCommand(params: {
  serverId?: string;
  commandType: string;
  endpoint: string;
  fullUrl: string;
  requestHeaders?: any;
  requestBody?: any;
  statusCode?: number;
  responseTime: number;
  responseBody?: any;
  success: boolean;
  errorMessage?: string;
  initiatedBy?: string;
  source?: string;
}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    await supabase.from('idrac_commands').insert({
      server_id: params.serverId,
      command_type: params.commandType,
      endpoint: params.endpoint,
      full_url: params.fullUrl,
      request_headers: params.requestHeaders || null,
      request_body: params.requestBody || null,
      status_code: params.statusCode || null,
      response_time_ms: params.responseTime,
      response_body: params.responseBody || null,
      success: params.success,
      error_message: params.errorMessage || null,
      initiated_by: params.initiatedBy || user?.id,
      source: params.source || 'frontend',
    });
  } catch (error) {
    console.error('Failed to log iDRAC command:', error);
  }
}

export async function testIdracConnection(
  ipAddress: string,
  credentials?: { username?: string; password?: string; credential_set_id?: string }
): Promise<TestConnectionResult> {
  const startTime = Date.now();
  const fullUrl = `https://${ipAddress}/redfish/v1/`;
  
  try {
    let username = credentials?.username;
    let password = credentials?.password;
    
    // If credential_set_id provided, fetch credentials
    if (credentials?.credential_set_id) {
      const { data: credSet } = await supabase
        .from('credential_sets')
        .select('username, password_encrypted')
        .eq('id', credentials.credential_set_id)
        .single();
      
      if (credSet) {
        username = credSet.username;
        password = credSet.password_encrypted;
      }
    }
    
    // If no credentials provided, try to get from server record
    if (!username || !password) {
      const { data: server } = await supabase
        .from('servers')
        .select('idrac_username, idrac_password_encrypted')
        .eq('ip_address', ipAddress)
        .single();
      
      if (server?.idrac_username && server?.idrac_password_encrypted) {
        username = server.idrac_username;
        password = server.idrac_password_encrypted;
      }
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        ...(username && password ? {
          'Authorization': `Basic ${btoa(`${username}:${password}`)}`
        } : {})
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;
    
    if (!response.ok) {
      const error = `HTTP ${response.status}: ${response.statusText}`;
      
      await logIdracCommand({
        commandType: 'GET',
        endpoint: '/redfish/v1/',
        fullUrl,
        requestHeaders: { Accept: 'application/json' },
        statusCode: response.status,
        responseTime,
        success: false,
        errorMessage: error,
      });
      
      return { success: false, responseTime, error };
    }
    
    const data = await response.json();
    const version = data.RedfishVersion || 'Unknown';
    
    await logIdracCommand({
      commandType: 'GET',
      endpoint: '/redfish/v1/',
      fullUrl,
      requestHeaders: { Accept: 'application/json' },
      statusCode: response.status,
      responseTime,
      responseBody: data,
      success: true,
    });
    
    // Update server connection status
    const { data: server } = await supabase
      .from('servers')
      .select('id')
      .eq('ip_address', ipAddress)
      .maybeSingle();
    
    if (server) {
      await supabase
        .from('servers')
        .update({
          connection_status: 'online',
          last_connection_test: new Date().toISOString(),
          connection_error: null,
        })
        .eq('id', server.id);
    }
    
    return { success: true, responseTime, version };
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error.name === 'AbortError' 
      ? 'Connection timeout - iDRAC not responding'
      : error.message;
    
    await logIdracCommand({
      commandType: 'GET',
      endpoint: '/redfish/v1/',
      fullUrl,
      requestHeaders: { Accept: 'application/json' },
      responseTime,
      success: false,
      errorMessage,
    });
    
    // Update server connection status to offline
    const { data: server } = await supabase
      .from('servers')
      .select('id')
      .eq('ip_address', ipAddress)
      .maybeSingle();
    
    if (server) {
      await supabase
        .from('servers')
        .update({
          connection_status: 'offline',
          last_connection_test: new Date().toISOString(),
          connection_error: errorMessage,
        })
        .eq('id', server.id);
    }
    
    return { success: false, responseTime, error: errorMessage };
  }
}

export async function refreshServerInfo(
  serverId: string,
  ipAddress: string,
  credentials?: { username?: string; password?: string; credential_set_id?: string }
): Promise<RefreshInfoResult> {
  const startTime = Date.now();
  
  try {
    let username = credentials?.username;
    let password = credentials?.password;
    
    // If credential_set_id provided, fetch credentials
    if (credentials?.credential_set_id) {
      const { data: credSet } = await supabase
        .from('credential_sets')
        .select('username, password_encrypted')
        .eq('id', credentials.credential_set_id)
        .single();
      
      if (credSet) {
        username = credSet.username;
        password = credSet.password_encrypted;
      }
    }
    
    // If no credentials provided, try to get from server record
    if (!username || !password) {
      const { data: server } = await supabase
        .from('servers')
        .select('idrac_username, idrac_password_encrypted')
        .eq('id', serverId)
        .single();
      
      if (server?.idrac_username && server?.idrac_password_encrypted) {
        username = server.idrac_username;
        password = server.idrac_password_encrypted;
      }
    }
    
    if (!username || !password) {
      return { success: false, message: 'No credentials available', error: 'Missing credentials' };
    }
    
    const authHeader = `Basic ${btoa(`${username}:${password}`)}`;
    
    // Fetch system info
    const systemUrl = `https://${ipAddress}/redfish/v1/Systems/System.Embedded.1`;
    const systemResponse = await fetch(systemUrl, {
      headers: {
        'Accept': 'application/json',
        'Authorization': authHeader,
      },
    });
    
    if (!systemResponse.ok) {
      throw new Error(`Failed to fetch system info: ${systemResponse.status}`);
    }
    
    const systemData = await systemResponse.json();
    
    // Fetch iDRAC firmware info
    const idracUrl = `https://${ipAddress}/redfish/v1/Managers/iDRAC.Embedded.1`;
    const idracResponse = await fetch(idracUrl, {
      headers: {
        'Accept': 'application/json',
        'Authorization': authHeader,
      },
    });
    
    const idracData = idracResponse.ok ? await idracResponse.json() : null;
    
    // Parse and update server info
    const updateData: any = {
      hostname: systemData.HostName || null,
      model: systemData.Model || null,
      service_tag: systemData.SKU || null,
      bios_version: systemData.BiosVersion || null,
      cpu_count: systemData.ProcessorSummary?.Count || null,
      memory_gb: systemData.MemorySummary?.TotalSystemMemoryGiB || null,
      connection_status: 'online',
      last_seen: new Date().toISOString(),
    };
    
    if (idracData?.FirmwareVersion) {
      updateData.idrac_firmware = idracData.FirmwareVersion;
    }
    
    const { error: updateError } = await supabase
      .from('servers')
      .update(updateData)
      .eq('id', serverId);
    
    if (updateError) throw updateError;
    
    // Log successful refresh
    await logIdracCommand({
      serverId,
      commandType: 'GET',
      endpoint: '/redfish/v1/Systems/System.Embedded.1',
      fullUrl: systemUrl,
      statusCode: 200,
      responseTime: Date.now() - startTime,
      success: true,
    });
    
    // Insert audit log
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        action: 'refresh_server_info',
        details: { server_id: serverId, ip_address: ipAddress },
      });
    }
    
    return { success: true, message: 'Server information refreshed successfully' };
  } catch (error: any) {
    await logIdracCommand({
      serverId,
      commandType: 'GET',
      endpoint: '/redfish/v1/Systems/System.Embedded.1',
      fullUrl: `https://${ipAddress}/redfish/v1/Systems/System.Embedded.1`,
      responseTime: Date.now() - startTime,
      success: false,
      errorMessage: error.message,
    });
    
    return { success: false, message: 'Failed to refresh server info', error: error.message };
  }
}
