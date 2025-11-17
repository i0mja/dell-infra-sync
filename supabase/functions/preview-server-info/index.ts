import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logIdracCommand } from '../_shared/idrac-logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PreviewRequest {
  ip_address: string;
  username?: string;
  password?: string;
  credential_set_id?: string;
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

    const { ip_address, username, password, credential_set_id }: PreviewRequest = await req.json();

    if (!ip_address) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Missing ip_address' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[INFO] Previewing server info for ${ip_address}`);

    // Determine credentials to use
    let idracUsername = username;
    let idracPassword = password;

    if (credential_set_id && !username && !password) {
      // Fetch credentials from credential set
      const { data: credSet, error: credError } = await supabaseClient
        .from('credential_sets')
        .select('username, password_encrypted')
        .eq('id', credential_set_id)
        .single();

      if (credError || !credSet) {
        console.error('[ERROR] Failed to fetch credential set:', credError);
        return new Response(JSON.stringify({ 
          success: false,
          error: 'Invalid credential set',
          details: credError?.message 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      idracUsername = credSet.username;
      idracPassword = credSet.password_encrypted; // Assuming it's stored encrypted
    }

    // Use defaults if still not set
    idracUsername = idracUsername || 'root';
    idracPassword = idracPassword || 'calvin';

    // Query iDRAC Redfish API for root service info first
    const rootUrl = `https://${ip_address}/redfish/v1/`;
    const authHeader = `Basic ${btoa(`${idracUsername}:${idracPassword}`)}`;

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
        serverId: undefined,
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
        operationType: 'idrac_api',
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

    // Query system info
    const systemUrl = `https://${ip_address}/redfish/v1/Systems/System.Embedded.1`;
    let systemData;
    let systemResponseTime = 0;
    const systemStartTime = Date.now();
    try {
      const response = await fetch(systemUrl, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
        // @ts-ignore - Deno-specific option to bypass SSL verification for self-signed certs
        insecure: true,
      });

      systemResponseTime = Date.now() - systemStartTime;
      const responseData = response.ok ? await response.json() : null;

      // Log the command (without server_id since we're previewing)
      await logIdracCommand({
        supabase: supabaseClient,
        serverId: undefined, // No server ID yet for preview
        commandType: 'GET',
        endpoint: '/redfish/v1/Systems/System.Embedded.1',
        fullUrl: systemUrl,
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
        throw new Error(`iDRAC responded with status ${response.status}`);
      }

      systemData = responseData;
    } catch (error: any) {
      console.error('[ERROR] Failed to fetch system info:', error);
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Failed to connect to iDRAC',
        details: error.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Query iDRAC manager info for firmware version
    const managerUrl = `https://${ip_address}/redfish/v1/Managers/iDRAC.Embedded.1`;
    let idracFirmware = null;

    const managerStartTime = Date.now();
    try {
      const response = await fetch(managerUrl, {
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
      const responseData = response.ok ? await response.json() : null;

      // Log the manager command
      await logIdracCommand({
        supabase: supabaseClient,
        serverId: undefined,
        commandType: 'GET',
        endpoint: '/redfish/v1/Managers/iDRAC.Embedded.1',
        fullUrl: managerUrl,
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

      if (response.ok && responseData?.FirmwareVersion) {
        idracFirmware = responseData.FirmwareVersion;
      }
    } catch (error: any) {
      console.warn('[WARN] Failed to fetch iDRAC firmware version:', error.message);
      // Continue without firmware info
    }

    // Extract comprehensive server details
    const serverInfo = {
      success: true,
      hostname: systemData?.HostName || null,
      model: systemData?.Model || null,
      service_tag: rootData?.Oem?.Dell?.ServiceTag || systemData?.SKU || null,
      manager_mac_address: rootData?.Oem?.Dell?.ManagerMACAddress || null,
      product_name: rootData?.Product || null,
      manufacturer: 'Dell',
      redfish_version: rootData?.RedfishVersion || null,
      idrac_firmware: idracFirmware,
      bios_version: systemData?.BiosVersion || null,
      cpu_count: systemData?.ProcessorSummary?.Count || null,
      memory_gb: systemData?.MemorySummary?.TotalSystemMemoryGiB || null,
      supported_endpoints: {
        systems: rootData?.Systems?.['@odata.id'] || null,
        chassis: rootData?.Chassis?.['@odata.id'] || null,
        managers: rootData?.Managers?.['@odata.id'] || null,
        updateService: rootData?.UpdateService?.['@odata.id'] || null,
        taskService: rootData?.Tasks?.['@odata.id'] || null,
        eventService: rootData?.EventService?.['@odata.id'] || null,
      },
      response_time: systemResponseTime,
    };

    console.log('[INFO] Successfully previewed server info:', serverInfo);

    return new Response(JSON.stringify(serverInfo), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[ERROR] Unexpected error in preview-server-info:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: 'Internal server error',
      details: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
