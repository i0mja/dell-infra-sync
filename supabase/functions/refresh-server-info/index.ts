import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logIdracCommand } from '../_shared/idrac-logger.ts';
import { createIdracSession, deleteIdracSession, makeAuthenticatedRequest, IdracSession } from '../_shared/idrac-session.ts';

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

  let session: IdracSession | null = null;

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

    // Create Redfish session
    session = await createIdracSession(
      ip_address,
      username,
      password,
      supabaseClient,
      user.id,
      server_id,
      10000
    );

    if (!session) {
      console.warn('[FALLBACK] Session creation failed, using Basic Auth');
    }

    // Query iDRAC Redfish API for root service info
    let rootData;
    let rootResponseTime = 0;
    const rootStartTime = Date.now();
    try {
      const response = await makeAuthenticatedRequest(
        ip_address,
        '/redfish/v1/',
        session,
        username,
        password
      );

      rootResponseTime = Date.now() - rootStartTime;
      const responseData = response.ok ? await response.json() : null;

      // Log the root command
      await logIdracCommand({
        supabase: supabaseClient,
        serverId: server_id,
        commandType: 'GET',
        endpoint: '/redfish/v1/',
        fullUrl: `https://${ip_address}/redfish/v1/`,
        requestHeaders: { 'Accept': 'application/json' },
        statusCode: response.status,
        responseTimeMs: rootResponseTime,
        responseBody: responseData,
        success: response.ok,
        errorMessage: !response.ok ? `iDRAC responded with status ${response.status}` : undefined,
        initiatedBy: user.id,
        source: 'edge_function',
        operationType: 'idrac_api',
      });

      if (!response.ok) {
        throw new Error(`iDRAC responded with status ${response.status}`);
      }

      rootData = responseData;
    } catch (error) {
      console.error('[ERROR] Failed to query root service:', error);
      return new Response(JSON.stringify({ 
        error: 'Failed to connect to iDRAC',
        details: error instanceof Error ? error.message : 'Unknown error' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Query system information
    let systemData;
    let systemResponseTime = 0;
    const systemStartTime = Date.now();
    try {
      const response = await makeAuthenticatedRequest(
        ip_address,
        '/redfish/v1/Systems/System.Embedded.1',
        session,
        username,
        password
      );

      systemResponseTime = Date.now() - systemStartTime;
      const responseData = response.ok ? await response.json() : null;

      // Log the system command
      await logIdracCommand({
        supabase: supabaseClient,
        serverId: server_id,
        commandType: 'GET',
        endpoint: '/redfish/v1/Systems/System.Embedded.1',
        fullUrl: `https://${ip_address}/redfish/v1/Systems/System.Embedded.1`,
        requestHeaders: { 'Accept': 'application/json' },
        statusCode: response.status,
        responseTimeMs: systemResponseTime,
        responseBody: responseData,
        success: response.ok,
        errorMessage: !response.ok ? `iDRAC responded with status ${response.status}` : undefined,
        initiatedBy: user.id,
        source: 'edge_function',
        operationType: 'idrac_api',
      });

      if (!response.ok) {
        throw new Error(`System info request failed with status ${response.status}`);
      }

      systemData = responseData;
    } catch (error) {
      console.error('[ERROR] Failed to query system info:', error);
      return new Response(JSON.stringify({ 
        error: 'Failed to retrieve system information',
        details: error instanceof Error ? error.message : 'Unknown error' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Query manager (iDRAC) information
    let managerData;
    let managerResponseTime = 0;
    const managerStartTime = Date.now();
    try {
      const response = await makeAuthenticatedRequest(
        ip_address,
        '/redfish/v1/Managers/iDRAC.Embedded.1',
        session,
        username,
        password
      );

      managerResponseTime = Date.now() - managerStartTime;
      const responseData = response.ok ? await response.json() : null;

      // Log the manager command
      await logIdracCommand({
        supabase: supabaseClient,
        serverId: server_id,
        commandType: 'GET',
        endpoint: '/redfish/v1/Managers/iDRAC.Embedded.1',
        fullUrl: `https://${ip_address}/redfish/v1/Managers/iDRAC.Embedded.1`,
        requestHeaders: { 'Accept': 'application/json' },
        statusCode: response.status,
        responseTimeMs: managerResponseTime,
        responseBody: responseData,
        success: response.ok,
        errorMessage: !response.ok ? `iDRAC responded with status ${response.status}` : undefined,
        initiatedBy: user.id,
        source: 'edge_function',
        operationType: 'idrac_api',
      });

      if (!response.ok) {
        throw new Error(`Manager info request failed with status ${response.status}`);
      }

      managerData = responseData;
    } catch (error) {
      console.error('[ERROR] Failed to query manager info:', error);
      // Manager info is optional, continue without it
      managerData = null;
    }

    // Extract relevant information for database update
    const updateData = {
      hostname: systemData?.HostName || null,
      manufacturer: systemData?.Manufacturer || null,
      model: systemData?.Model || null,
      service_tag: systemData?.SKU || null,
      bios_version: systemData?.BiosVersion || null,
      power_state: systemData?.PowerState || null,
      idrac_firmware: managerData?.FirmwareVersion || null,
      redfish_version: rootData?.RedfishVersion || null,
      cpu_count: systemData?.ProcessorSummary?.Count || null,
      memory_gb: systemData?.MemorySummary?.TotalSystemMemoryGiB || null,
      product_name: systemData?.Model || null,
      manager_mac_address: managerData?.EthernetInterfaces?.['@odata.id'] || null,
      supported_endpoints: {
        systems: rootData?.Systems?.['@odata.id'] || null,
        managers: rootData?.Managers?.['@odata.id'] || null,
        chassis: rootData?.Chassis?.['@odata.id'] || null,
        update_service: rootData?.UpdateService?.['@odata.id'] || null,
        task_service: rootData?.TaskService?.['@odata.id'] || null,
        session_service: rootData?.SessionService?.['@odata.id'] || null,
      },
      last_seen: new Date().toISOString(),
      connection_status: 'connected',
      connection_error: null,
    };

    // Update server record in database
    const { error: updateError } = await supabaseClient
      .from('servers')
      .update(updateData)
      .eq('id', server_id);

    if (updateError) {
      console.error('[ERROR] Failed to update server record:', updateError);
      return new Response(JSON.stringify({ 
        error: 'Failed to update server information',
        details: updateError.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create audit log entry
    const { error: auditError } = await supabaseClient
      .from('audit_logs')
      .insert({
        action: 'server_refresh',
        user_id: user.id,
        details: {
          server_id,
          ip_address,
          hostname: updateData.hostname,
          response_times: {
            root_ms: rootResponseTime,
            system_ms: systemResponseTime,
            manager_ms: managerResponseTime,
            total_ms: rootResponseTime + systemResponseTime + managerResponseTime,
          },
          auth_method: session ? 'session_token' : 'basic_auth',
        },
      });

    if (auditError) {
      console.warn('[WARN] Failed to create audit log:', auditError);
    }

    console.log(`[SUCCESS] Successfully refreshed server ${ip_address}`);

    return new Response(JSON.stringify({ 
      success: true,
      server: updateData,
      response_times: {
        root_ms: rootResponseTime,
        system_ms: systemResponseTime,
        manager_ms: managerResponseTime,
        total_ms: rootResponseTime + systemResponseTime + managerResponseTime,
      },
      auth_method: session ? 'session_token' : 'basic_auth',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[ERROR] Unexpected error in refresh-server-info:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } finally {
    // Always cleanup session after all operations complete
    if (session) {
      await deleteIdracSession(session).catch(err => 
        console.warn('[WARN] Session cleanup failed:', err)
      );
    }
  }
});
