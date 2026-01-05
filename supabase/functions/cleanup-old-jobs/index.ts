import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Background job types to track
const backgroundJobTypes = [
  'scheduled_vcenter_sync',
  'scheduled_replication_check',
  'rpo_monitoring',
  'vcenter_sync',
  'partial_vcenter_sync',
  'cluster_health_check'
];

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request body for options
    let preview = false;
    let overrideRetentionDays: number | null = null;
    let includeBackgroundJobs = true;
    
    try {
      const body = await req.json();
      preview = body.preview === true;
      if (typeof body.retentionDays === 'number' && body.retentionDays > 0) {
        overrideRetentionDays = body.retentionDays;
      }
      if (typeof body.includeBackgroundJobs === 'boolean') {
        includeBackgroundJobs = body.includeBackgroundJobs;
      }
    } catch {
      // No body or invalid JSON - use defaults
    }

    console.log(`[cleanup-old-jobs] Starting - preview: ${preview}, overrideRetentionDays: ${overrideRetentionDays}, includeBackgroundJobs: ${includeBackgroundJobs}`);

    // Fetch settings
    const { data: settings, error: settingsError } = await supabase
      .from('activity_settings')
      .select('*')
      .maybeSingle();

    if (settingsError) {
      console.error('[cleanup-old-jobs] Error fetching settings:', settingsError);
      throw settingsError;
    }

    // Use override if provided, otherwise use settings
    const retentionDays = overrideRetentionDays || settings?.job_retention_days || 90;
    const jobAutoCleanupEnabled = settings?.job_auto_cleanup_enabled ?? true;
    const autoCancelStaleJobs = settings?.auto_cancel_stale_jobs ?? true;
    const stalePendingHours = settings?.stale_pending_hours || 24;
    const staleRunningHours = settings?.stale_running_hours || 48;

    // If not preview and auto-cleanup is disabled (and no override), skip
    if (!preview && !jobAutoCleanupEnabled && !overrideRetentionDays) {
      console.log('[cleanup-old-jobs] Auto-cleanup disabled and no override, skipping');
      return new Response(JSON.stringify({
        success: true,
        message: 'Auto-cleanup is disabled',
        preview: false,
        deleted: { jobs: 0, tasks: 0 },
        cancelled: { pending: 0, running: 0, orphaned: 0 }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Calculate cutoff dates
    const jobCutoffDate = new Date();
    jobCutoffDate.setDate(jobCutoffDate.getDate() - retentionDays);
    const jobCutoffIso = jobCutoffDate.toISOString();

    const pendingCutoff = new Date(Date.now() - stalePendingHours * 60 * 60 * 1000).toISOString();
    const runningCutoff = new Date(Date.now() - staleRunningHours * 60 * 60 * 1000).toISOString();

    console.log(`[cleanup-old-jobs] Retention: ${retentionDays} days, cutoff: ${jobCutoffIso}`);

    if (preview) {
      // Preview mode - count records that would be deleted
      const results: { jobType: string; count: number }[] = [];

      // Get all terminal jobs older than cutoff
      const { data: jobTypeCounts, error: countError } = await supabase
        .from('jobs')
        .select('job_type')
        .in('status', ['completed', 'failed', 'cancelled'])
        .lt('created_at', jobCutoffIso);

      if (countError) {
        console.error('[cleanup-old-jobs] Error counting jobs:', countError);
        throw countError;
      }

      // Aggregate counts by job type
      const typeCounts: Record<string, number> = {};
      let totalCount = 0;
      let backgroundCount = 0;
      let userCount = 0;

      for (const job of jobTypeCounts || []) {
        const jobType = job.job_type;
        typeCounts[jobType] = (typeCounts[jobType] || 0) + 1;
        totalCount++;
        
        if (backgroundJobTypes.includes(jobType)) {
          backgroundCount++;
        } else {
          userCount++;
        }
      }

      // Convert to array and sort by count
      for (const [jobType, count] of Object.entries(typeCounts)) {
        results.push({ jobType, count });
      }
      results.sort((a, b) => b.count - a.count);

      // Count stale jobs
      const { count: stalePendingCount } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lt('created_at', pendingCutoff);

      const { count: staleRunningCount } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'running')
        .lt('started_at', runningCutoff);

      // Get actual task count
      const { data: jobIds } = await supabase
        .from('jobs')
        .select('id')
        .in('status', ['completed', 'failed', 'cancelled'])
        .lt('created_at', jobCutoffIso)
        .limit(10000);

      let actualTaskCount = 0;
      if (jobIds && jobIds.length > 0) {
        const { count } = await supabase
          .from('job_tasks')
          .select('*', { count: 'exact', head: true })
          .in('job_id', jobIds.map(j => j.id));
        actualTaskCount = count || 0;
      }

      console.log(`[cleanup-old-jobs] Preview: ${totalCount} jobs (${backgroundCount} background, ${userCount} user), ${actualTaskCount} tasks would be deleted`);

      return new Response(JSON.stringify({
        success: true,
        preview: true,
        retentionDays,
        cutoffDate: jobCutoffIso,
        counts: {
          total: totalCount,
          background: backgroundCount,
          user: userCount,
          tasks: actualTaskCount,
          byType: results,
          stale: {
            pending: stalePendingCount || 0,
            running: staleRunningCount || 0
          }
        }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Execute cleanup
    let cancelledPending = 0;
    let cancelledRunning = 0;
    let cancelledOrphaned = 0;

    // Cancel stale jobs first if enabled
    if (autoCancelStaleJobs) {
      // Cancel stale pending jobs
      const { data: stalePending } = await supabase
        .from('jobs')
        .update({ 
          status: 'cancelled', 
          completed_at: new Date().toISOString(),
          notes: 'Auto-cancelled: exceeded stale pending threshold'
        })
        .eq('status', 'pending')
        .lt('created_at', pendingCutoff)
        .select('id');
      
      cancelledPending = stalePending?.length || 0;
      console.log(`[cleanup-old-jobs] Cancelled ${cancelledPending} stale pending jobs`);

      // Cancel stale running jobs
      const { data: staleRunning } = await supabase
        .from('jobs')
        .update({ 
          status: 'cancelled', 
          completed_at: new Date().toISOString(),
          notes: 'Auto-cancelled: exceeded stale running threshold'
        })
        .eq('status', 'running')
        .lt('started_at', runningCutoff)
        .select('id');
      
      cancelledRunning = staleRunning?.length || 0;
      console.log(`[cleanup-old-jobs] Cancelled ${cancelledRunning} stale running jobs`);

      // Cancel orphaned sub-jobs
      const { data: activeParentIds } = await supabase
        .from('jobs')
        .select('id')
        .in('status', ['pending', 'running']);

      const activeIds = activeParentIds?.map(j => j.id) || [];

      if (activeIds.length > 0) {
        const { data: orphaned } = await supabase
          .from('jobs')
          .update({ 
            status: 'cancelled', 
            completed_at: new Date().toISOString(),
            notes: 'Auto-cancelled: parent job no longer active'
          })
          .in('status', ['pending', 'running'])
          .not('parent_job_id', 'is', null)
          .not('parent_job_id', 'in', `(${activeIds.join(',')})`)
          .select('id');
        
        cancelledOrphaned = orphaned?.length || 0;
        console.log(`[cleanup-old-jobs] Cancelled ${cancelledOrphaned} orphaned sub-jobs`);
      }
    }

    // Delete jobs and tasks in batches to avoid statement timeout
    // Use smaller batch size (100) to keep URL length within PostgREST limits
    const BATCH_SIZE = 100;
    let deletedTasks = 0;
    let deletedJobs = 0;
    let batchCount = 0;

    do {
      // Get a batch of job IDs to delete
      const { data: jobsToDelete, error: selectError } = await supabase
        .from('jobs')
        .select('id')
        .in('status', ['completed', 'failed', 'cancelled'])
        .lt('created_at', jobCutoffIso)
        .limit(BATCH_SIZE);

      if (selectError) {
        console.error('[cleanup-old-jobs] Error selecting jobs:', selectError);
        throw selectError;
      }

      if (!jobsToDelete || jobsToDelete.length === 0) break;

      const jobIds = jobsToDelete.map(j => j.id);

      // Delete tasks for these jobs first
      const { data: deletedTaskBatch, error: taskDeleteError } = await supabase
        .from('job_tasks')
        .delete()
        .in('job_id', jobIds)
        .select('id');

      if (taskDeleteError) {
        console.error('[cleanup-old-jobs] Error deleting tasks:', taskDeleteError);
        throw taskDeleteError;
      }

      deletedTasks += deletedTaskBatch?.length || 0;

      // Delete the jobs
      const { error: jobDeleteError } = await supabase
        .from('jobs')
        .delete()
        .in('id', jobIds);

      if (jobDeleteError) {
        console.error('[cleanup-old-jobs] Error deleting jobs:', jobDeleteError);
        throw jobDeleteError;
      }

      deletedJobs += jobIds.length;
      batchCount++;

      console.log(`[cleanup-old-jobs] Batch ${batchCount}: deleted ${jobIds.length} jobs, ${deletedTaskBatch?.length || 0} tasks. Total: ${deletedJobs} jobs, ${deletedTasks} tasks`);

      // Small delay between batches to prevent overwhelming the database
      await new Promise(r => setTimeout(r, 100));

    } while (true); // Loop exits via break when no more jobs to delete

    console.log(`[cleanup-old-jobs] Completed - deleted ${deletedJobs} jobs and ${deletedTasks} tasks`);

    // Update last cleanup timestamp
    if (settings?.id) {
      await supabase
        .from('activity_settings')
        .update({ job_last_cleanup_at: new Date().toISOString() })
        .eq('id', settings.id);
    }

    return new Response(JSON.stringify({
      success: true,
      preview: false,
      retentionDays,
      cutoffDate: jobCutoffIso,
      deleted: {
        jobs: deletedJobs,
        tasks: deletedTasks
      },
      cancelled: {
        pending: cancelledPending,
        running: cancelledRunning,
        orphaned: cancelledOrphaned
      }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: unknown) {
    console.error('[cleanup-old-jobs] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
