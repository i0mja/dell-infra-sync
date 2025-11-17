import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { logIdracCommand } from '../_shared/idrac-logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VCenterSettings {
  host: string;
  username: string;
  password: string;
  port: number;
  verify_ssl: boolean;
}

interface VCenterHost {
  name: string;
  cluster?: string;
  host_id: string;
  serial_number?: string;
  version?: string;
  power_state: string;
  connection_state: string;
  in_maintenance_mode: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('vCenter direct sync request received');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';

    // Extract JWT token and decode to get user ID
    let userId: string;
    try {
      const token = authHeader.replace('Bearer ', '');
      if (!token) throw new Error('No token provided');
      
      const payload = JSON.parse(atob(token.split('.')[1]));
      userId = payload.sub;
      
      if (!userId) throw new Error('Invalid token payload');
    } catch (error) {
      console.error('Token extraction failed:', error);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create admin client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if user has admin role
    const { data: hasAdminRole } = await supabase.rpc('has_role', {
      _user_id: userId,
      _role: 'admin'
    });

    if (!hasAdminRole) {
      throw new Error('Insufficient permissions - admin role required');
    }

    // Fetch vCenter settings
    const { data: settings, error: settingsError } = await supabase
      .from('vcenter_settings')
      .select('*')
      .maybeSingle();

    if (settingsError) throw settingsError;
    if (!settings) {
      throw new Error('vCenter settings not configured');
    }

    const vcenterSettings: VCenterSettings = settings;

    // Connect to vCenter and authenticate
    console.log(`Connecting to vCenter at ${vcenterSettings.host}:${vcenterSettings.port}`);
    
    const baseUrl = `https://${vcenterSettings.host}:${vcenterSettings.port}`;
    const syncStartTime = Date.now();
    
    // Create session with vCenter
    const authStartTime = Date.now();
    const authResponse = await fetch(`${baseUrl}/api/session`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${vcenterSettings.username}:${vcenterSettings.password}`),
        'Content-Type': 'application/json',
      },
      // @ts-ignore - Deno supports this
      ...(vcenterSettings.verify_ssl ? {} : { rejectUnauthorized: false })
    });

    const authTime = Date.now() - authStartTime;
    
    if (!authResponse.ok) {
      // Log failed authentication
      await logIdracCommand({
        supabase: supabase as any,
        jobId: undefined,
        serverId: undefined,
        taskId: undefined,
        commandType: 'VCENTER_AUTH',
        endpoint: '/api/session',
        fullUrl: `${baseUrl}/api/session`,
        requestBody: { host: vcenterSettings.host, port: vcenterSettings.port },
        statusCode: authResponse.status,
        responseTimeMs: authTime,
        responseBody: undefined,
        success: false,
        errorMessage: `Authentication failed: ${authResponse.status} ${authResponse.statusText}`,
        initiatedBy: userId,
        source: 'sync_vcenter_direct',
        operationType: 'vcenter_api',
      });
      throw new Error(`vCenter authentication failed: ${authResponse.status} ${authResponse.statusText}`);
    }

    const sessionToken = await authResponse.text();
    const sessionId = sessionToken.replace(/"/g, ''); // Remove quotes from session ID

    console.log('vCenter authentication successful');
    
    // Log successful authentication
    await logIdracCommand({
      supabase: supabase as any,
      jobId: undefined,
      serverId: undefined,
      taskId: undefined,
      commandType: 'VCENTER_AUTH',
      endpoint: '/api/session',
      fullUrl: `${baseUrl}/api/session`,
      requestBody: { host: vcenterSettings.host, port: vcenterSettings.port },
      statusCode: authResponse.status,
      responseTimeMs: authTime,
      responseBody: { authenticated: true },
      success: true,
      initiatedBy: userId,
      source: 'sync_vcenter_direct',
      operationType: 'vcenter_api',
    });

    const vcenterHeaders = {
      'vmware-api-session-id': sessionId,
      'Content-Type': 'application/json',
    };

    // Track statistics
    let newHosts = 0;
    let updatedHosts = 0;
    let linkedServers = 0;
    const errors: string[] = [];

    try {
      // Fetch all clusters
      const clustersResponse = await fetch(`${baseUrl}/api/vcenter/cluster`, {
        headers: vcenterHeaders,
        // @ts-ignore
        ...(vcenterSettings.verify_ssl ? {} : { rejectUnauthorized: false })
      });

      if (!clustersResponse.ok) {
        throw new Error(`Failed to fetch clusters: ${clustersResponse.status}`);
      }

      const clustersData = await clustersResponse.json();
      const clusters = clustersData.value || [];
      
      console.log(`Found ${clusters.length} clusters`);

      // Fetch all hosts
      const hostsResponse = await fetch(`${baseUrl}/api/vcenter/host`, {
        headers: vcenterHeaders,
        // @ts-ignore
        ...(vcenterSettings.verify_ssl ? {} : { rejectUnauthorized: false })
      });

      if (!hostsResponse.ok) {
        throw new Error(`Failed to fetch hosts: ${hostsResponse.status}`);
      }

      const hostsData = await hostsResponse.json();
      const hosts = hostsData.value || [];

      console.log(`Found ${hosts.length} ESXi hosts`);

      // Process each host
      for (const host of hosts) {
        try {
          // Fetch detailed host information
          const hostDetailResponse = await fetch(`${baseUrl}/api/vcenter/host/${host.host}`, {
            headers: vcenterHeaders,
            // @ts-ignore
            ...(vcenterSettings.verify_ssl ? {} : { rejectUnauthorized: false })
          });

          if (!hostDetailResponse.ok) {
            console.error(`Failed to fetch details for host ${host.name}: ${hostDetailResponse.status}`);
            errors.push(`${host.name}: Failed to fetch details`);
            continue;
          }

          const hostDetail = await hostDetailResponse.json();
          const hostInfo = hostDetail.value || hostDetail;

          // Find cluster name
          const clusterName = clusters.find((c: any) => c.cluster === host.cluster)?.name || 'Unknown';

          // Check if host already exists
          const { data: existingHost, error: fetchError } = await supabase
            .from('vcenter_hosts')
            .select('id, server_id')
            .eq('vcenter_id', host.host)
            .maybeSingle();

          if (fetchError) throw fetchError;

          const hostData = {
            name: host.name,
            cluster: clusterName,
            vcenter_id: host.host,
            serial_number: hostInfo.hardware?.serial_number || null,
            esxi_version: hostInfo.product?.version || null,
            status: host.connection_state === 'CONNECTED' ? 'connected' : 'disconnected',
            maintenance_mode: host.power_state === 'MAINTENANCE' || false,
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
          if (hostData.serial_number && !existingHost?.server_id) {
            const { data: matchingServer, error: serverError } = await supabase
              .from('servers')
              .select('id, vcenter_host_id')
              .eq('service_tag', hostData.serial_number)
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
                user_id: userId,
                action: 'auto_link_server',
                details: {
                  vcenter_host: host.name,
                  server_id: matchingServer.id,
                  service_tag: hostData.serial_number,
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

      // Update last_sync timestamp in settings
      await supabase
        .from('vcenter_settings')
        .update({ last_sync: new Date().toISOString() })
        .eq('id', settings.id);

    } finally {
      // Delete vCenter session
      try {
        await fetch(`${baseUrl}/api/session`, {
          method: 'DELETE',
          headers: vcenterHeaders,
          // @ts-ignore
          ...(vcenterSettings.verify_ssl ? {} : { rejectUnauthorized: false })
        });
        console.log('vCenter session closed');
      } catch (err) {
        console.error('Error closing vCenter session:', err);
      }
    }

    // Log the sync event
    await supabase.from('audit_logs').insert([{
      user_id: userId,
      action: 'vcenter_direct_sync',
      details: {
        new_hosts: newHosts,
        updated_hosts: updatedHosts,
        linked_servers: linkedServers,
        errors: errors.length,
      },
    }]);

    const result = {
      success: true,
      summary: {
        new: newHosts,
        updated: updatedHosts,
        auto_linked: linkedServers,
        errors: errors.length,
      },
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    };

    console.log('vCenter direct sync completed:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error in sync-vcenter-direct function:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isAuthError = errorMessage.includes('Unauthorized') || errorMessage.includes('Insufficient permissions');
    
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
