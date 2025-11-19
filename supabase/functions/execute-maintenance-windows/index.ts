import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Maintenance type to job type mapping
const MAINTENANCE_TYPE_TO_JOB_TYPE: Record<string, string> = {
  'firmware_update': 'firmware_update',
  'host_maintenance': 'prepare_host_for_update',
  'cluster_update': 'rolling_cluster_update',
  'emergency_patch': 'firmware_update',
  'safety_check': 'cluster_safety_check',
  'full_update': 'full_server_update'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Checking for maintenance windows to execute...');

    const now = new Date();
    
    // Find windows that should execute NOW
    const { data: windows, error: windowsError } = await supabase
      .from('maintenance_windows')
      .select('*')
      .eq('status', 'planned')
      .eq('auto_execute', true)
      .lte('planned_start', now.toISOString())
      .gte('planned_end', now.toISOString());

    if (windowsError) {
      console.error('Error fetching maintenance windows:', windowsError);
      throw windowsError;
    }

    if (!windows || windows.length === 0) {
      console.log('No maintenance windows to execute');
      return new Response(
        JSON.stringify({ message: 'No windows to execute', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${windows.length} maintenance window(s) to execute`);

    const results = [];
    for (const window of windows) {
      try {
        console.log(`Processing window: ${window.id} - ${window.title}`);
        
        // Resolve target servers
        const serverIds = await resolveTargetServers(supabase, window);
        
        if (serverIds.length === 0) {
          console.warn(`No servers found for window ${window.id}`);
          await supabase
            .from('maintenance_windows')
            .update({ 
              status: 'failed',
              details: { 
                ...window.details,
                error: 'No valid servers found in selected clusters/groups' 
              }
            })
            .eq('id', window.id);
          
          results.push({ window_id: window.id, status: 'failed', reason: 'no_servers' });
          continue;
        }

        console.log(`Found ${serverIds.length} target servers`);

        // Detect if window targets clusters
        const hasClusterTargets = window.cluster_ids && window.cluster_ids.length > 0;

        let jobType;
        const jobDetails: any = {
          maintenance_window_id: window.id,
          maintenance_window_title: window.title,
          ...(window.details || {})
        };

        if (hasClusterTargets) {
          // ALWAYS use rolling cluster update for cluster targets
          console.log('Cluster targets detected - forcing rolling_cluster_update orchestration');
          jobType = 'rolling_cluster_update';
          
          // Set orchestration parameters
          jobDetails.cluster_name = window.cluster_ids[0];
          jobDetails.max_concurrent = 1; // One server at a time - CRITICAL SAFETY
          jobDetails.wait_between_servers = 300; // 5 minutes between servers
          jobDetails.update_scope = window.details?.update_scope || 'full_stack';
          
          console.log(`  Update scope: ${jobDetails.update_scope}`);
          console.log(`  Max concurrent: ${jobDetails.max_concurrent} (enforced for safety)`);
        } else {
          // Standalone servers - use direct job types from maintenance_type
          jobType = MAINTENANCE_TYPE_TO_JOB_TYPE[window.maintenance_type];
          console.log(`Standalone servers - using job type: ${jobType}`);
        }

        if (!jobType) {
          const supportedTypes = Object.keys(MAINTENANCE_TYPE_TO_JOB_TYPE).join(', ');
          throw new Error(
            `Unsupported maintenance type: ${window.maintenance_type}. ` +
            `Supported types: ${supportedTypes}`
          );
        }

        // Create the job
        const { data: job, error: jobError } = await supabase
          .from('jobs')
          .insert({
            job_type: jobType,
            created_by: window.created_by,
            status: 'pending',
            target_scope: {
              type: 'specific',
              server_ids: serverIds
            },
            details: jobDetails,
            credential_set_ids: window.credential_set_ids || []
          })
          .select()
          .single();

        if (jobError) {
          console.error('Error creating job:', jobError);
          throw jobError;
        }

        console.log(`Created job ${job.id} for window ${window.id}`);

        // Create job tasks for each server
        const tasks = serverIds.map(serverId => ({
          job_id: job.id,
          server_id: serverId,
          status: 'pending' as const
        }));

        const { error: tasksError } = await supabase
          .from('job_tasks')
          .insert(tasks);

        if (tasksError) {
          console.error('Error creating job tasks:', tasksError);
          throw tasksError;
        }

        console.log(`Created ${tasks.length} job tasks`);

        // Update maintenance window with job ID and status
        const { error: updateError } = await supabase
          .from('maintenance_windows')
          .update({
            job_ids: [job.id],
            status: 'in_progress',
            started_at: now.toISOString()
          })
          .eq('id', window.id);

        if (updateError) {
          console.error('Error updating maintenance window:', updateError);
          throw updateError;
        }

        console.log(`Updated maintenance window ${window.id} status to in_progress`);

        // Log audit entry
        await supabase
          .from('audit_logs')
          .insert({
            action: 'maintenance_window_executed',
            user_id: window.created_by,
            details: {
              window_id: window.id,
              job_id: job.id,
              server_count: serverIds.length,
              job_type: jobType
            }
          });

        // Send notification
        try {
          await supabase.functions.invoke('send-notification', {
            body: {
              notification_type: 'maintenance_window_started',
              maintenance_window: window,
              job_id: job.id,
              server_count: serverIds.length
            }
          });
        } catch (notifError) {
          console.warn('Failed to send notification:', notifError);
          // Don't fail the execution if notification fails
        }

        results.push({ 
          window_id: window.id, 
          job_id: job.id, 
          status: 'executed',
          servers: serverIds.length
        });

      } catch (error) {
        console.error(`Error executing window ${window.id}:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Mark window as failed
        await supabase
          .from('maintenance_windows')
          .update({ 
            status: 'failed',
            details: { 
              ...window.details,
              error: errorMessage 
            }
          })
          .eq('id', window.id);

        results.push({ 
          window_id: window.id, 
          status: 'failed', 
          error: errorMessage 
        });
      }
    }

    // Also check for in_progress windows and update their status
    await updateMaintenanceWindowStatuses(supabase);

    return new Response(
      JSON.stringify({ 
        message: 'Maintenance windows processed',
        processed: windows.length,
        results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in execute-maintenance-windows:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

async function resolveTargetServers(supabase: any, window: any): Promise<string[]> {
  const serverIds: string[] = [];

  // Get servers from clusters
  if (window.cluster_ids && window.cluster_ids.length > 0) {
    const { data: hosts, error } = await supabase
      .from('vcenter_hosts')
      .select('server_id')
      .in('cluster', window.cluster_ids)
      .not('server_id', 'is', null);

    if (error) {
      console.error('Error fetching cluster hosts:', error);
      throw error;
    }

    if (hosts) {
      serverIds.push(...hosts.map((h: any) => h.server_id));
    }
  }

  // Get servers from server groups
  if (window.server_group_ids && window.server_group_ids.length > 0) {
    const { data: members, error } = await supabase
      .from('server_group_members')
      .select('server_id')
      .in('server_group_id', window.server_group_ids);

    if (error) {
      console.error('Error fetching group members:', error);
      throw error;
    }

    if (members) {
      serverIds.push(...members.map((m: any) => m.server_id));
    }
  }

  // Remove duplicates and nulls
  return [...new Set(serverIds.filter(id => id !== null))];
}

async function updateMaintenanceWindowStatuses(supabase: any) {
  console.log('Checking in_progress windows for status updates...');

  const { data: windows, error } = await supabase
    .from('maintenance_windows')
    .select('id, job_ids')
    .eq('status', 'in_progress');

  if (error) {
    console.error('Error fetching in_progress windows:', error);
    return;
  }

  if (!windows || windows.length === 0) {
    console.log('No in_progress windows found');
    return;
  }

  for (const window of windows) {
    if (!window.job_ids || window.job_ids.length === 0) continue;

    const { data: jobs, error: jobsError } = await supabase
      .from('jobs')
      .select('status')
      .in('id', window.job_ids);

    if (jobsError) {
      console.error('Error fetching job statuses:', jobsError);
      continue;
    }

    const allCompleted = jobs.every((j: any) => j.status === 'completed');
    const anyFailed = jobs.some((j: any) => j.status === 'failed');

    if (allCompleted) {
      console.log(`All jobs completed for window ${window.id}`);
      await supabase
        .from('maintenance_windows')
        .update({ 
          status: 'completed', 
          completed_at: new Date().toISOString() 
        })
        .eq('id', window.id);

      // Send completion notification
      try {
        await supabase.functions.invoke('send-notification', {
          body: {
            notification_type: 'maintenance_window_completed',
            window_id: window.id
          }
        });
      } catch (error) {
        console.warn('Failed to send completion notification:', error);
      }
    } else if (anyFailed) {
      console.log(`Job failed for window ${window.id}`);
      await supabase
        .from('maintenance_windows')
        .update({ status: 'failed' })
        .eq('id', window.id);

      // Send failure notification
      try {
        await supabase.functions.invoke('send-notification', {
          body: {
            notification_type: 'maintenance_window_failed',
            window_id: window.id
          }
        });
      } catch (error) {
        console.warn('Failed to send failure notification:', error);
      }
    }
  }
}
