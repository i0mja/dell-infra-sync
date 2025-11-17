import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logIdracCommand } from '../_shared/idrac-logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RefreshRequest {
  server_id: string;
  ip_address: string;
  idrac_username?: string;
  idrac_password?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Verify user authentication
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      console.error('[AUTH] Authentication failed:', userError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user has operator or admin role
    const { data: roleData } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (!roleData || !['admin', 'operator'].includes(roleData.role)) {
      console.error('[AUTH] Insufficient permissions:', roleData?.role);
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { server_id, ip_address, idrac_username, idrac_password }: RefreshRequest = await req.json();

    if (!server_id || !ip_address) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[INFO] Refreshing server info for ${ip_address}`);

    // Use provided credentials or defaults
    const username = idrac_username || 'root';
    const password = idrac_password || 'calvin';

    // Query iDRAC Redfish API for root service info first
    const rootUrl = `https://${ip_address}/redfish/v1/`;
    const authHeader = `Basic ${btoa(`${username}:${password}`)}`;

    let rootData;
    let rootResponseTime = 0;
    const rootStartTime = Date.now();
    try {
      const response = await fetch(rootUrl, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
        // @ts-ignore - Deno-specific option to bypass SSL verification for self-signed certs
        insecure: true,
      });

      rootResponseTime = Date.now() - rootStartTime;
      const responseData = response.ok ? await response.json() : null;

      // Log the root command
      await logIdracCommand({
        supabase: supabaseClient,
        serverId: server_id,
        commandType: 'GET',
        endpoint: '/redfish/v1/',
        fullUrl: rootUrl,
        requestHeaders: { 'Accept': 'application/json' },
        statusCode: response.status,
        responseTimeMs: rootResponseTime,
        responseBody: responseData,
        success: response.ok,
        errorMessage: !response.ok ? `iDRAC responded with status ${response.status}` : undefined,
        initiatedBy: user.id,
        source: 'edge_function',
      });

      if (!response.ok) {
        throw new Error(`iDRAC responded with status ${response.status}`);
      }

      rootData = responseData;
    } catch (error: any) {
      console.error('[ERROR] Failed to fetch root service info:', error);
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Failed to connect to iDRAC',
        details: error.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Query iDRAC Redfish API for system info
    const redfishUrl = `https://${ip_address}/redfish/v1/Systems/System.Embedded.1`;

    let redfishData;
    const systemStartTime = Date.now();
    try {
      const response = await fetch(redfishUrl, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
        // @ts-ignore - Deno-specific option to bypass SSL verification for self-signed certs
        insecure: true,
      });

      const systemResponseTime = Date.now() - systemStartTime;
      const responseData = response.ok ? await response.json() : null;

      // Log the command
      await logIdracCommand({
        supabase: supabaseClient,
        serverId: server_id,
        commandType: 'GET',
        endpoint: '/redfish/v1/Systems/System.Embedded.1',
        fullUrl: redfishUrl,
        requestHeaders: { 'Accept': 'application/json' },
        statusCode: response.status,
        responseTimeMs: systemResponseTime,
        responseBody: responseData,
        success: response.ok,
        errorMessage: !response.ok ? `iDRAC responded with status ${response.status}` : undefined,
        initiatedBy: user.id,
        source: 'edge_function',
      });

      if (!response.ok) {
        throw new Error(`iDRAC responded with status ${response.status}`);
      }

      redfishData = responseData;
      console.log('[REDFISH] Successfully fetched system data');
    } catch (error) {
      console.error('[REDFISH] Failed to query iDRAC:', error);
      
      // Log the failed attempt
      await logIdracCommand({
        supabase: supabaseClient,
        serverId: server_id,
        commandType: 'GET',
        endpoint: '/redfish/v1/Systems/System.Embedded.1',
        fullUrl: redfishUrl,
        requestHeaders: { 'Accept': 'application/json' },
        responseTimeMs: Date.now() - systemStartTime,
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        initiatedBy: user.id,
        source: 'edge_function',
      });

      return new Response(JSON.stringify({ 
        error: 'Failed to connect to iDRAC',
        details: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Query manager info for iDRAC version
    const managerUrl = `https://${ip_address}/redfish/v1/Managers/iDRAC.Embedded.1`;
    let idracFirmware = null;
    const managerStartTime = Date.now();
    try {
      const managerResponse = await fetch(managerUrl, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
        // @ts-ignore - Deno-specific option to bypass SSL verification for self-signed certs
        insecure: true,
      });

      const managerResponseTime = Date.now() - managerStartTime;
      const managerData = managerResponse.ok ? await managerResponse.json() : null;

      // Log the command
      await logIdracCommand({
        supabase: supabaseClient,
        serverId: server_id,
        commandType: 'GET',
        endpoint: '/redfish/v1/Managers/iDRAC.Embedded.1',
        fullUrl: managerUrl,
        requestHeaders: { 'Accept': 'application/json' },
        statusCode: managerResponse.status,
        responseTimeMs: managerResponseTime,
        responseBody: managerData,
        success: managerResponse.ok,
        errorMessage: !managerResponse.ok ? `Manager query failed: ${managerResponse.status}` : undefined,
        initiatedBy: user.id,
        source: 'edge_function',
      });

      if (managerResponse.ok && managerData) {
        idracFirmware = managerData.FirmwareVersion || null;
      }
    } catch (error) {
      console.warn('[REDFISH] Failed to fetch iDRAC firmware version:', error);
      
      // Log the failed attempt
      await logIdracCommand({
        supabase: supabaseClient,
        serverId: server_id,
        commandType: 'GET',
        endpoint: '/redfish/v1/Managers/iDRAC.Embedded.1',
        fullUrl: managerUrl,
        requestHeaders: { 'Accept': 'application/json' },
        responseTimeMs: Date.now() - managerStartTime,
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        initiatedBy: user.id,
        source: 'edge_function',
      });
    }

    // Extract comprehensive server information
    const hostname = redfishData.HostName || null;
    const model = redfishData.Model || null;
    const service_tag = redfishData.SKU || rootData?.Oem?.Dell?.ServiceTag || redfishData.SerialNumber || null;
    const bios_version = redfishData.BiosVersion || null;
    const manager_mac_address = rootData?.Oem?.Dell?.ManagerMACAddress || null;
    const product_name = rootData?.Product || null;
    const manufacturer = 'Dell';
    const redfish_version = rootData?.RedfishVersion || null;
    const supported_endpoints = {
      systems: rootData?.Systems?.['@odata.id'] || null,
      chassis: rootData?.Chassis?.['@odata.id'] || null,
      managers: rootData?.Managers?.['@odata.id'] || null,
      updateService: rootData?.UpdateService?.['@odata.id'] || null,
      taskService: rootData?.Tasks?.['@odata.id'] || null,
      eventService: rootData?.EventService?.['@odata.id'] || null,
    };
    const cpu_count = redfishData.ProcessorSummary?.Count || null;
    const memory_gb = redfishData.MemorySummary?.TotalSystemMemoryGiB || null;

    // Update server record with all comprehensive details
    const { error: updateError } = await supabaseClient
      .from('servers')
      .update({
        hostname,
        model,
        service_tag,
        manager_mac_address,
        product_name,
        manufacturer,
        redfish_version,
        supported_endpoints,
        bios_version,
        cpu_count,
        memory_gb,
        idrac_firmware: idracFirmware,
        last_seen: new Date().toISOString(),
        connection_status: 'online',
        last_connection_test: new Date().toISOString(),
        connection_error: null,
      })
      .eq('id', server_id);

    if (updateError) {
      console.error('[DB] Failed to update server:', updateError);
      throw updateError;
    }

    // Create audit log
    await supabaseClient.from('audit_logs').insert({
      user_id: user.id,
      action: 'server_refreshed',
      details: {
        server_id,
        ip_address,
        hostname,
        model,
        service_tag,
      },
    });

    console.log('[SUCCESS] Server information refreshed successfully');

    return new Response(JSON.stringify({ 
      success: true,
      data: {
        hostname,
        model,
        service_tag,
        bios_version,
        idrac_firmware: idracFirmware,
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[ERROR] Unexpected error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
