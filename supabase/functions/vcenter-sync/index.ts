import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { logIdracCommand } from '../_shared/idrac-logger.ts';
import { verifyRequestDualAuth } from '../_shared/hmac-verify.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-executor-signature, x-executor-timestamp',
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

    // Initialize Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Auth client with request's auth header for JWT verification
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } }
    });

    // Parse request body first for authentication verification
    const body = await req.json();
    
    // Verify request using dual auth: HMAC (Job Executor) or JWT (frontend)
    const authResult = await verifyRequestDualAuth(req, body, supabase);
    
    if (!authResult.authenticated) {
      console.log('Authentication failed:', authResult.method);
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized: Invalid request signature or token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Request authenticated via ${authResult.method}`);
    
    // For JWT auth, verify user has permission
    let userId = authResult.userId;
    
    if (authResult.method === 'jwt' && userId) {
      // Check if user has admin or operator role
      const { data: roles, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      if (roleError) throw roleError;

      const hasPermission = roles?.some(r => r.role === 'admin' || r.role === 'operator');
      if (!hasPermission) {
        throw new Error('Insufficient permissions');
      }
    } else if (authResult.method === 'hmac') {
      // HMAC auth from Job Executor - use a system user or null for audit
      // Try to get a system admin user for audit logging
      const { data: adminUser } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'admin')
        .limit(1)
        .maybeSingle();
      
      userId = adminUser?.user_id || null;
    }

    const hosts = body.hosts || [];
    const jobId = body.job_id; // Accept job_id from request
    const vcenterId = body.vcenter_id; // Accept vcenter_id for logging

    if (!hosts || !Array.isArray(hosts)) {
      throw new Error('Invalid request: hosts array required');
    }

    console.log(`Processing ${hosts.length} vCenter hosts (Job: ${jobId || 'N/A'})`);
    
    const startTime = Date.now();

    // Track statistics
    let newHosts = 0;
    let updatedHosts = 0;
    let linkedServers = 0;
    const errors: string[] = [];
    let hostIndex = 0;

    // Create job tasks if job_id provided
    const hostTasks: string[] = [];
    if (jobId) {
      for (const host of hosts) {
        const { data: task } = await supabase
          .from('job_tasks')
          .insert({
            job_id: jobId,
            status: 'pending',
            progress: 0,
            log: `Waiting to process ${host.name}`,
          })
          .select('id')
          .single();
        
        if (task) {
          hostTasks.push(task.id);
        }
      }
    }

    // Process each host
    for (const host of hosts) {
      hostIndex++;
      const taskId = hostTasks[hostIndex - 1];
      
      // Update job details with progress
      if (jobId) {
        await supabase
          .from('jobs')
          .update({
            details: {
              current_step: `Processing host ${hostIndex}/${hosts.length}: ${host.name}`,
              hosts_processed: hostIndex,
              hosts_total: hosts.length,
              new_hosts: newHosts,
              updated_hosts: updatedHosts,
              linked_servers: linkedServers,
            }
          })
          .eq('id', jobId);

        // Update task to running
        if (taskId) {
          await supabase
            .from('job_tasks')
            .update({
              status: 'running',
              started_at: new Date().toISOString(),
              progress: 0,
              log: `Processing ${host.name}`,
            })
            .eq('id', taskId);
        }
      }
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
          
          // Update task progress
          if (taskId) {
            await supabase
              .from('job_tasks')
              .update({
                progress: 50,
                log: `Updated existing host: ${host.name}`,
              })
              .eq('id', taskId);
          }
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
          
          // Update task progress
          if (taskId) {
            await supabase
              .from('job_tasks')
              .update({
                progress: 50,
                log: `Created new host: ${host.name}`,
              })
              .eq('id', taskId);
          }
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
              if (userId) {
                await supabase.from('audit_logs').insert([{
                  user_id: userId,
                  action: 'auto_link_server',
                  details: {
                    vcenter_host: host.name,
                    server_id: matchingServer.id,
                    service_tag: host.serial_number,
                  },
                }]);
              }
              
              // Update task progress
              if (taskId) {
                await supabase
                  .from('job_tasks')
                  .update({
                    progress: 75,
                    log: `Auto-linked to server ${matchingServer.id}`,
                  })
                  .eq('id', taskId);
              }
            }
          }
          
          // Mark task as completed
          if (taskId) {
            await supabase
              .from('job_tasks')
              .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
                progress: 100,
                log: `Completed processing ${host.name}`,
              })
              .eq('id', taskId);
          }
        } catch (err) {
          console.error(`Error processing host ${host.name}:`, err);
          const errorMessage = err instanceof Error ? err.message : String(err);
          errors.push(`${host.name}: ${errorMessage}`);
          
          // Mark task as failed
          if (taskId) {
            await supabase
              .from('job_tasks')
              .update({
                status: 'failed',
                completed_at: new Date().toISOString(),
                progress: 0,
                log: `Failed: ${errorMessage}`,
              })
              .eq('id', taskId);
          }
        }
      }

    // Update job with final status
    if (jobId) {
      const finalStatus = errors.length === 0 ? 'completed' : 'failed';
      await supabase
        .from('jobs')
        .update({
          status: finalStatus,
          completed_at: new Date().toISOString(),
          details: {
            hosts_synced: updatedHosts,
            hosts_new: newHosts,
            auto_linked: linkedServers,
            errors: errors.length,
            error_messages: errors.length > 0 ? errors : undefined,
          }
        })
        .eq('id', jobId);
    }

    // Log the sync event
    if (userId) {
      await supabase.from('audit_logs').insert([{
        user_id: userId,
        action: 'vcenter_sync',
        details: {
          total_hosts: hosts.length,
          new_hosts: newHosts,
          updated_hosts: updatedHosts,
          linked_servers: linkedServers,
          errors: errors.length,
          job_id: jobId,
        },
      }]);
    }
    
    // Log to Activity Monitor
    const syncTime = Date.now() - startTime;
    await logIdracCommand({
      supabase: supabase as any,
      jobId: jobId,
      serverId: undefined,
      taskId: undefined,
      commandType: 'VCENTER_SYNC',
      endpoint: '/vcenter-sync',
      fullUrl: 'vcenter-sync-edge-function',
      requestBody: { host_count: hosts.length, vcenter_id: vcenterId },
      statusCode: 200,
      responseTimeMs: syncTime,
      responseBody: { new: newHosts, updated: updatedHosts, linked: linkedServers, errors: errors.length },
      success: errors.length === 0,
      errorMessage: errors.length > 0 ? errors.slice(0, 3).join('; ') : undefined,
      initiatedBy: userId || undefined,
      source: 'vcenter_sync_edge',
      operationType: 'vcenter_api',
    });

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
