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

    let newCount = 0;
    let updatedCount = 0;
    let autoLinkedCount = 0;
    const errors: string[] = [];

    // Process each device
    for (const device of devices) {
      try {
        if (!device.service_tag || !device.ip_address) {
          errors.push(`Device missing required fields: ${JSON.stringify(device)}`);
          continue;
        }

        // Check if server already exists
        const { data: existingServer } = await supabase
          .from('servers')
          .select('id, vcenter_host_id')
          .eq('service_tag', device.service_tag)
          .maybeSingle();

        const serverData = {
          ip_address: device.ip_address,
          hostname: device.hostname || null,
          model: device.model || null,
          service_tag: device.service_tag,
          idrac_firmware: device.idrac_firmware || null,
          bios_version: device.bios_version || null,
          cpu_count: device.cpu_count || null,
          memory_gb: device.memory_gb || null,
          openmanage_device_id: device.device_id,
          last_openmanage_sync: new Date().toISOString(),
          last_seen: new Date().toISOString(),
        };

        let serverId: string;

        if (existingServer) {
          // Update existing server
          const { error: updateError } = await supabase
            .from('servers')
            .update(serverData)
            .eq('id', existingServer.id);

          if (updateError) throw updateError;
          
          serverId = existingServer.id;
          updatedCount++;
          console.log(`Updated server: ${device.service_tag}`);
        } else {
          // Insert new server
          const { data: insertData, error: insertError } = await supabase
            .from('servers')
            .insert(serverData)
            .select('id')
            .single();

          if (insertError) throw insertError;
          
          serverId = insertData.id;
          newCount++;
          console.log(`Created new server: ${device.service_tag}`);
        }

        // Try to auto-link with vCenter host based on serial number
        const { data: vcenterHost } = await supabase
          .from('vcenter_hosts')
          .select('id, server_id')
          .eq('serial_number', device.service_tag)
          .maybeSingle();

        if (vcenterHost && !vcenterHost.server_id) {
          // Link server to vCenter host
          const { error: linkError1 } = await supabase
            .from('servers')
            .update({ vcenter_host_id: vcenterHost.id })
            .eq('id', serverId);

          const { error: linkError2 } = await supabase
            .from('vcenter_hosts')
            .update({ server_id: serverId })
            .eq('id', vcenterHost.id);

          if (!linkError1 && !linkError2) {
            autoLinkedCount++;
            console.log(`Auto-linked server ${device.service_tag} with vCenter host`);
          }
        }

      } catch (error: any) {
        console.error(`Error processing device ${device.service_tag}:`, error);
        errors.push(`${device.service_tag}: ${error.message}`);
      }
    }

    // Update last_sync timestamp in openmanage_settings
    await supabase
      .from('openmanage_settings')
      .update({ last_sync: new Date().toISOString() })
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
      timestamp: new Date().toISOString(),
    };

    console.log('OpenManage sync completed:', response.summary);

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
