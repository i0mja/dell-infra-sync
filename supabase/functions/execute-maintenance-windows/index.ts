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
  'full_update': 'full_server_update',
  'firmware_only': 'rolling_cluster_update',
  'esxi_only': 'esxi_upgrade',
  'esxi_upgrade': 'esxi_upgrade',
  'esxi_then_firmware': 'esxi_then_firmware',
  'firmware_then_esxi': 'firmware_then_esxi'
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
    
    // Find one-time windows that should execute NOW
    const { data: windows, error: windowsError } = await supabase
      .from('maintenance_windows')
      .select('*')
      .eq('status', 'planned')
      .eq('auto_execute', true)
      .or('recurrence_enabled.is.null,recurrence_enabled.eq.false')
      .lte('planned_start', now.toISOString())
      .gte('planned_end', now.toISOString());

    if (windowsError) {
      console.error('Error fetching one-time maintenance windows:', windowsError);
      throw windowsError;
    }

    // Find recurring window templates
    const { data: recurringWindows, error: recurringError } = await supabase
      .from('maintenance_windows')
      .select('*')
      .eq('recurrence_enabled', true)
      .in('status', ['planned', 'completed']);

    if (recurringError) {
      console.error('Error fetching recurring maintenance windows:', recurringError);
      throw recurringError;
    }

    console.log(`Found ${windows?.length || 0} one-time window(s) ready for execution`);
    console.log(`Found ${recurringWindows?.length || 0} recurring window template(s)`);

    // Process recurring windows to create new instances if needed
    const newInstances: any[] = [];
    if (recurringWindows && recurringWindows.length > 0) {
      for (const template of recurringWindows) {
        // Check if config exists in details for interval-based recurrence
        const recurrenceConfig = template.details?.recurrence_config;
        
        let nextExecution: Date | null = null;
        
        if (recurrenceConfig && recurrenceConfig.enabled) {
          // Use interval-based calculation
          nextExecution = calculateNextExecutionFromConfig(
            recurrenceConfig,
            template.last_executed_at || template.created_at,
            now.toISOString()
          );
        } else if (template.recurrence_pattern) {
          // Fallback to cron pattern
          nextExecution = calculateNextExecution(
            template.recurrence_pattern,
            template.last_executed_at || template.created_at,
            now.toISOString()
          );
        }

        if (nextExecution && nextExecution <= now) {
          console.log(`Creating new instance for recurring window: ${template.title}`);

          // Calculate window duration from original template
          const templateStart = new Date(template.planned_start);
          const templateEnd = new Date(template.planned_end);
          const durationMs = templateEnd.getTime() - templateStart.getTime();

          const instanceStart = new Date(nextExecution);
          const instanceEnd = new Date(nextExecution.getTime() + durationMs);

          // Create new one-time instance
          const { data: newInstance, error: createError } = await supabase
            .from('maintenance_windows')
            .insert({
              title: `${template.title} (Auto-scheduled)`,
              description: template.description,
              cluster_ids: template.cluster_ids,
              server_group_ids: template.server_group_ids,
              maintenance_type: template.maintenance_type,
              planned_start: instanceStart.toISOString(),
              planned_end: instanceEnd.toISOString(),
              auto_execute: true,
              recurrence_enabled: false, // Instance is one-time
              credential_set_ids: template.credential_set_ids,
              details: {
                ...template.details,
                created_from_recurring_template: template.id,
                recurrence_pattern: template.recurrence_pattern
              },
              status: 'planned',
              created_by: template.created_by
            })
            .select()
            .single();

          if (createError) {
            console.error(`Failed to create instance for ${template.title}:`, createError);
            continue;
          }

          // Update last_executed_at on template
          await supabase
            .from('maintenance_windows')
            .update({ last_executed_at: nextExecution.toISOString() })
            .eq('id', template.id);

          console.log(`Created instance ${newInstance.id} for ${template.title}`);

          // Add to execution queue if it's time to run now
          if (instanceStart <= now && instanceEnd >= now) {
            newInstances.push(newInstance);
          }
        }
      }
    }

    // Combine one-time windows with newly created instances
    const allWindows = [...(windows || []), ...newInstances];

    if (allWindows.length === 0) {
      console.log('No maintenance windows to execute');
      return new Response(
        JSON.stringify({ 
          message: 'No windows to execute', 
          processed: 0,
          recurring_instances_created: newInstances.length
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${allWindows.length} total maintenance window(s) to execute`);

    const results = [];
    for (const window of allWindows) {
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
            auth_source: 'system',
            auth_method: 'scheduled_task',
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
        processed: allWindows.length,
        recurring_instances_created: newInstances.length,
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

/**
 * Calculate next execution from recurrence config
 */
function calculateNextExecutionFromConfig(
  config: any,
  lastExecution: string,
  currentTime: string
): Date | null {
  try {
    if (!config || !config.enabled) return null;
    
    const last = new Date(lastExecution);
    const now = new Date(currentTime);
    let next = new Date(last);
    
    switch (config.unit) {
      case 'hours':
        next.setHours(next.getHours() + config.interval);
        next.setMinutes(config.minute);
        break;
        
      case 'days':
        next.setDate(next.getDate() + config.interval);
        next.setHours(config.hour);
        next.setMinutes(config.minute);
        break;
        
      case 'weeks':
        next.setDate(next.getDate() + (config.interval * 7));
        if (config.dayOfWeek !== undefined) {
          const currentDay = next.getDay();
          const daysToAdd = (config.dayOfWeek - currentDay + 7) % 7;
          next.setDate(next.getDate() + daysToAdd);
        }
        next.setHours(config.hour);
        next.setMinutes(config.minute);
        break;
        
      case 'months':
        next.setMonth(next.getMonth() + config.interval);
        if (config.dayOfMonth !== undefined) {
          next.setDate(Math.min(config.dayOfMonth, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
        }
        next.setHours(config.hour);
        next.setMinutes(config.minute);
        break;
        
      case 'years':
        next.setFullYear(next.getFullYear() + config.interval);
        if (config.dayOfMonth !== undefined) {
          next.setDate(Math.min(config.dayOfMonth, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
        }
        next.setHours(config.hour);
        next.setMinutes(config.minute);
        break;
    }
    
    next.setSeconds(0);
    next.setMilliseconds(0);
    
    return next <= now ? next : null;
  } catch (error) {
    console.error('Error calculating next execution from config:', error);
    return null;
  }
}

/**
 * Calculate next execution time based on cron pattern
 */
function calculateNextExecution(
  cronPattern: string,
  lastExecution: string,
  currentTime: string
): Date | null {
  try {
    const last = new Date(lastExecution);
    const now = new Date(currentTime);
    
    const parts = cronPattern.split(' ');
    if (parts.length !== 5) {
      console.error('Invalid cron pattern:', cronPattern);
      return null;
    }
    
    const [minute, hour, day, month, weekday] = parts;
    
    let candidate = new Date(last);
    candidate.setMinutes(candidate.getMinutes() + 15);
    
    for (let i = 0; i < 100; i++) {
      if (matchesCronPattern(candidate, minute, hour, day, month, weekday)) {
        if (candidate <= now) {
          return candidate;
        }
        break;
      }
      candidate.setMinutes(candidate.getMinutes() + 15);
    }
    
    return null;
  } catch (error) {
    console.error('Error calculating next execution:', error);
    return null;
  }
}

/**
 * Check if a date matches a cron pattern
 */
function matchesCronPattern(
  date: Date,
  minute: string,
  hour: string,
  day: string,
  month: string,
  weekday: string
): boolean {
  const m = date.getMinutes();
  const h = date.getHours();
  const d = date.getDate();
  const mon = date.getMonth() + 1;
  const w = date.getDay();
  
  return (
    matchesCronValue(m, minute, 0, 59) &&
    matchesCronValue(h, hour, 0, 23) &&
    matchesCronValue(d, day, 1, 31) &&
    matchesCronValue(mon, month, 1, 12) &&
    matchesCronValue(w, weekday, 0, 6)
  );
}

/**
 * Check if a value matches a cron field
 */
function matchesCronValue(
  value: number,
  pattern: string,
  min: number,
  max: number
): boolean {
  if (pattern === '*') return true;
  
  if (pattern.startsWith('*/')) {
    const step = parseInt(pattern.slice(2));
    return value % step === 0;
  }
  
  if (pattern.includes(',')) {
    return pattern.split(',').some(p => matchesCronValue(value, p.trim(), min, max));
  }
  
  if (pattern.includes('-')) {
    const [start, end] = pattern.split('-').map(n => parseInt(n));
    return value >= start && value <= end;
  }
  
  return value === parseInt(pattern);
}

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
