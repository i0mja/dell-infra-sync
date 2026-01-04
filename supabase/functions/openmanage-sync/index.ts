import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-token',
};

interface OpenManageDevice {
  device_id: string;
  service_tag: string;
  model: string;
  hostname?: string;
  ip_address: string;
  bios_version?: string;
  idrac_firmware?: string;
  cpu_count?: number;
  memory_gb?: number;
}

interface SyncRequest {
  devices: OpenManageDevice[];
  manual?: boolean;
  scheduled?: boolean;
}

interface SyncResponse {
  success: boolean;
  summary: {
    total: number;
    new: number;
    updated: number;
    auto_linked: number;
    errors: number;
  };
  errors: string[];
  timestamp: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let userId: string;

    // Check for API token first (for script authentication)
    const apiToken = req.headers.get('X-API-Token');
    
    if (apiToken) {
      console.log('Authenticating with API token');
      
      // Validate API token using database function
      const { data: tokenUserId, error: tokenError } = await supabase.rpc('validate_api_token', {
        token_input: apiToken
      });

      if (tokenError || !tokenUserId) {
        console.error('Invalid API token:', tokenError);
        return new Response(
          JSON.stringify({ error: 'Invalid or expired API token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      userId = tokenUserId;
      console.log(`API token authenticated for user: ${userId}`);
    } else {
      // Fall back to JWT authentication (for UI calls)
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        console.error('Missing authorization header');
        return new Response(
          JSON.stringify({ error: 'Missing authorization header or API token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);

      if (authError || !user) {
        console.error('Invalid token:', authError);
        return new Response(
          JSON.stringify({ error: 'Invalid or expired token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      userId = user.id;
      console.log(`JWT authenticated for user: ${userId}`);
    }

    // Check user role
    const { data: roleData, error: roleError } = await supabase.rpc('get_user_role', {
      _user_id: userId
    });

    if (roleError || !roleData || !['admin', 'operator'].includes(roleData)) {
      console.error(`Unauthorized role: ${roleData}`);
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions. Admin or operator role required.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: SyncRequest = await req.json();
    const devices = body.devices || [];

    if (!Array.isArray(devices) || devices.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No devices provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Starting OpenManage sync for ${devices.length} devices`);

    const errors: string[] = [];
    const now = new Date().toISOString();

    // OPTIMIZED: Build all server records for bulk upsert
    const validDevices = devices.filter(device => {
      if (!device.service_tag || !device.ip_address) {
        errors.push(`Device missing required fields: ${JSON.stringify(device)}`);
        return false;
      }
      return true;
    });

    const serverRecords = validDevices.map(device => ({
      ip_address: device.ip_address,
      hostname: device.hostname || null,
      model: device.model || null,
      service_tag: device.service_tag,
      idrac_firmware: device.idrac_firmware || null,
      bios_version: device.bios_version || null,
      cpu_count: device.cpu_count || null,
      memory_gb: device.memory_gb || null,
      openmanage_device_id: device.device_id,
      last_openmanage_sync: now,
      last_seen: now,
    }));

    // Get existing servers to determine new vs updated counts
    const serviceTags = validDevices.map(d => d.service_tag);
    const { data: existingServers } = await supabase
      .from('servers')
      .select('id, service_tag, vcenter_host_id')
      .in('service_tag', serviceTags);

    const existingServiceTags = new Set((existingServers || []).map(s => s.service_tag));
    const newCount = validDevices.filter(d => !existingServiceTags.has(d.service_tag)).length;
    const updatedCount = validDevices.filter(d => existingServiceTags.has(d.service_tag)).length;

    // OPTIMIZED: Single bulk upsert instead of per-device calls
    const { data: upsertedServers, error: upsertError } = await supabase
      .from('servers')
      .upsert(serverRecords, { 
        onConflict: 'service_tag',
        ignoreDuplicates: false 
      })
      .select('id, service_tag');

    if (upsertError) {
      console.error('Bulk upsert failed:', upsertError);
      errors.push(`Bulk upsert failed: ${upsertError.message}`);
    } else {
      console.log(`Bulk upserted ${upsertedServers?.length || 0} servers`);
    }

    // OPTIMIZED: Batch vCenter auto-linking
    let autoLinkedCount = 0;
    
    // Get all vCenter hosts that could be linked (have matching serial and no current server_id)
    const { data: vcenterHosts } = await supabase
      .from('vcenter_hosts')
      .select('id, serial_number, server_id')
      .in('serial_number', serviceTags)
      .is('server_id', null);

    if (vcenterHosts && vcenterHosts.length > 0 && upsertedServers) {
      // Create mapping of service_tag -> server_id
      const serverIdByTag = new Map(
        upsertedServers.map(s => [s.service_tag, s.id])
      );

      // Link each vCenter host to its corresponding server
      for (const vcHost of vcenterHosts) {
        const serverId = serverIdByTag.get(vcHost.serial_number);
        if (serverId) {
          try {
            // Update both tables atomically
            const { error: linkError1 } = await supabase
              .from('servers')
              .update({ vcenter_host_id: vcHost.id })
              .eq('id', serverId);

            const { error: linkError2 } = await supabase
              .from('vcenter_hosts')
              .update({ server_id: serverId })
              .eq('id', vcHost.id);

            if (!linkError1 && !linkError2) {
              autoLinkedCount++;
              console.log(`Auto-linked server ${vcHost.serial_number} with vCenter host`);
            }
          } catch (linkErr) {
            console.error(`Failed to link ${vcHost.serial_number}:`, linkErr);
          }
        }
      }
    }

    // Update last_sync timestamp in openmanage_settings
    await supabase
      .from('openmanage_settings')
      .update({ last_sync: now })
      .limit(1);

    // Log audit trail
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action: 'openmanage_sync',
      details: {
        total_devices: devices.length,
        new_servers: newCount,
        updated_servers: updatedCount,
        auto_linked: autoLinkedCount,
        errors: errors.length,
        manual: body.manual || false,
        scheduled: body.scheduled || false,
        optimization: 'bulk_upsert',
      }
    });

    const response: SyncResponse = {
      success: true,
      summary: {
        total: devices.length,
        new: newCount,
        updated: updatedCount,
        auto_linked: autoLinkedCount,
        errors: errors.length,
      },
      errors,
      timestamp: now,
    };

    console.log('OpenManage sync completed:', response.summary);

    // Log sync operation activity
    await supabase.from('idrac_commands').insert({
      operation_type: 'openmanage_api',
      endpoint: '/sync',
      command_type: 'EDGE_FUNCTION_SYNC',
      full_url: supabaseUrl,
      success: true,
      response_body: {
        devices_received: devices.length,
        new_count: newCount,
        updated_count: updatedCount,
        auto_linked_count: autoLinkedCount,
        errors_count: errors.length,
        optimization: 'bulk_upsert'
      },
      source: 'edge_function'
    });

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('OpenManage sync error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Internal server error',
        success: false 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
