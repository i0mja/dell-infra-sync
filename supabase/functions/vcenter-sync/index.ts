import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VCenterHost {
  name: string;
  cluster: string;
  vcenter_id: string;
  serial_number: string | null;
  esxi_version: string;
  status: string;
  maintenance_mode: boolean;
}

interface SyncRequest {
  hosts: VCenterHost[];
  sync_token?: string; // Optional authentication token for the sync script
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('vCenter sync request received');

    // Initialize Supabase client with service role for admin access
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify JWT from authenticated user (admin/operator only)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Check if user has admin or operator role
    const { data: roles, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (roleError) throw roleError;

    const hasPermission = roles?.some(r => r.role === 'admin' || r.role === 'operator');
    if (!hasPermission) {
      throw new Error('Insufficient permissions');
    }

    const { hosts }: SyncRequest = await req.json();

    if (!hosts || !Array.isArray(hosts)) {
      throw new Error('Invalid request: hosts array required');
    }

    console.log(`Processing ${hosts.length} vCenter hosts`);

    // Track statistics
    let newHosts = 0;
    let updatedHosts = 0;
    let linkedServers = 0;
    const errors: string[] = [];

    // Process each host
    for (const host of hosts) {
      try {
        // Check if host already exists
        const { data: existingHost, error: fetchError } = await supabase
          .from('vcenter_hosts')
          .select('id, server_id')
          .eq('vcenter_id', host.vcenter_id)
          .maybeSingle();

        if (fetchError) throw fetchError;

        const hostData = {
          name: host.name,
          cluster: host.cluster,
          vcenter_id: host.vcenter_id,
          serial_number: host.serial_number,
          esxi_version: host.esxi_version,
          status: host.status,
          maintenance_mode: host.maintenance_mode,
          last_sync: new Date().toISOString(),
        };

        let hostId: string;

        if (existingHost) {
          // Update existing host
          const { error: updateError } = await supabase
            .from('vcenter_hosts')
            .update(hostData)
            .eq('id', existingHost.id);

          if (updateError) throw updateError;

          hostId = existingHost.id;
          updatedHosts++;
          console.log(`Updated host: ${host.name}`);
        } else {
          // Insert new host
          const { data: newHost, error: insertError } = await supabase
            .from('vcenter_hosts')
            .insert([hostData])
            .select()
            .single();

          if (insertError) throw insertError;

          hostId = newHost.id;
          newHosts++;
          console.log(`Created new host: ${host.name}`);
        }

        // Auto-link: Try to find a matching server by serial number (Service Tag)
        if (host.serial_number && !existingHost?.server_id) {
          const { data: matchingServer, error: serverError } = await supabase
            .from('servers')
            .select('id, vcenter_host_id')
            .eq('service_tag', host.serial_number)
            .maybeSingle();

          if (serverError) throw serverError;

          if (matchingServer && !matchingServer.vcenter_host_id) {
            // Link the server to this vCenter host
            const { error: linkError } = await supabase
              .from('servers')
              .update({ vcenter_host_id: hostId })
              .eq('id', matchingServer.id);

            if (linkError) throw linkError;

            // Also update the vcenter_host with server_id
            const { error: reverseLinkError } = await supabase
              .from('vcenter_hosts')
              .update({ server_id: matchingServer.id })
              .eq('id', hostId);

            if (reverseLinkError) throw reverseLinkError;

            linkedServers++;
            console.log(`Auto-linked: ${host.name} <-> Server ${matchingServer.id}`);

            // Log the auto-link event
            await supabase.from('audit_logs').insert([{
              user_id: user.id,
              action: 'auto_link_server',
              details: {
                vcenter_host: host.name,
                server_id: matchingServer.id,
                service_tag: host.serial_number,
              },
            }]);
          }
        }
      } catch (err) {
        console.error(`Error processing host ${host.name}:`, err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        errors.push(`${host.name}: ${errorMessage}`);
      }
    }

    // Log the sync event
    await supabase.from('audit_logs').insert([{
      user_id: user.id,
      action: 'vcenter_sync',
      details: {
        total_hosts: hosts.length,
        new_hosts: newHosts,
        updated_hosts: updatedHosts,
        linked_servers: linkedServers,
        errors: errors.length,
      },
    }]);

    const result = {
      success: true,
      summary: {
        total: hosts.length,
        new: newHosts,
        updated: updatedHosts,
        auto_linked: linkedServers,
        errors: errors.length,
      },
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    };

    console.log('vCenter sync completed:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error in vcenter-sync function:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isAuthError = errorMessage === 'Unauthorized' || errorMessage === 'Insufficient permissions';
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage
      }),
      {
        status: isAuthError ? 403 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
