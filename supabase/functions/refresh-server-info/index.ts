import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

    // Query iDRAC Redfish API
    const redfishUrl = `https://${ip_address}/redfish/v1/Systems/System.Embedded.1`;
    const authHeader = `Basic ${btoa(`${username}:${password}`)}`;

    let redfishData;
    try {
      const response = await fetch(redfishUrl, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`iDRAC responded with status ${response.status}`);
      }

      redfishData = await response.json();
      console.log('[REDFISH] Successfully fetched system data');
    } catch (error) {
      console.error('[REDFISH] Failed to query iDRAC:', error);
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
    try {
      const managerResponse = await fetch(managerUrl, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
      });

      if (managerResponse.ok) {
        const managerData = await managerResponse.json();
        idracFirmware = managerData.FirmwareVersion || null;
      }
    } catch (error) {
      console.warn('[REDFISH] Failed to fetch iDRAC firmware version:', error);
    }

    // Extract server information
    const hostname = redfishData.HostName || null;
    const model = redfishData.Model || null;
    const service_tag = redfishData.SKU || redfishData.SerialNumber || null;
    const bios_version = redfishData.BiosVersion || null;

    // Update server record
    const { error: updateError } = await supabaseClient
      .from('servers')
      .update({
        hostname,
        model,
        service_tag,
        bios_version,
        idrac_firmware: idracFirmware,
        last_seen: new Date().toISOString(),
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
        idrac_firmware,
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
