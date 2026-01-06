import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CancellationResult {
  cancelled_jobs: {
    id: string;
    job_type: string;
    status: string;
    reason: string;
  }[];
  total_cancelled: number;
  executed_at: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('[cancel-stale-jobs] Starting stale job detection...');

    // Fetch settings
    const { data: settings, error: settingsError } = await supabase
      .from('activity_settings')
      .select('stale_pending_hours, stale_running_hours, auto_cancel_stale_jobs')
      .maybeSingle();

    if (settingsError) {
      console.error('[cancel-stale-jobs] Error fetching settings:', settingsError);
      throw settingsError;
    }

    // Check if auto-cancel is enabled
    if (!settings?.auto_cancel_stale_jobs) {
      console.log('[cancel-stale-jobs] Auto-cancel is disabled, skipping');
      return new Response(
        JSON.stringify({ 
          message: 'Auto-cancel stale jobs is disabled',
          cancelled_jobs: [],
          total_cancelled: 0,
          executed_at: new Date().toISOString()
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const stalePendingHours = settings?.stale_pending_hours || 24;
    const staleRunningHours = settings?.stale_running_hours || 48;

    console.log(`[cancel-stale-jobs] Thresholds - Pending: ${stalePendingHours}h, Running: ${staleRunningHours}h`);

    const result: CancellationResult = {
      cancelled_jobs: [],
      total_cancelled: 0,
      executed_at: new Date().toISOString(),
    };

    // Calculate cutoff times
    const pendingCutoff = new Date(Date.now() - stalePendingHours * 60 * 60 * 1000).toISOString();
    const runningCutoff = new Date(Date.now() - staleRunningHours * 60 * 60 * 1000).toISOString();

    // Find stale pending jobs
    const { data: stalePendingJobs, error: pendingError } = await supabase
      .from('jobs')
      .select('id, job_type, status, created_at')
      .eq('status', 'pending')
      .lt('created_at', pendingCutoff);

    if (pendingError) {
      console.error('[cancel-stale-jobs] Error fetching pending jobs:', pendingError);
      throw pendingError;
    }

    // Find stale running jobs
    const { data: staleRunningJobs, error: runningError } = await supabase
      .from('jobs')
      .select('id, job_type, status, started_at')
      .eq('status', 'running')
      .not('started_at', 'is', null)
      .lt('started_at', runningCutoff);

    if (runningError) {
      console.error('[cancel-stale-jobs] Error fetching running jobs:', runningError);
      throw runningError;
    }

    console.log(`[cancel-stale-jobs] Found ${stalePendingJobs?.length || 0} stale pending, ${staleRunningJobs?.length || 0} stale running jobs`);

    // Cancel stale pending jobs
    for (const job of stalePendingJobs || []) {
      const reason = `Auto-cancelled: stuck in pending state for >${stalePendingHours} hours`;
      
      const { error: updateError } = await supabase
        .from('jobs')
        .update({
          status: 'cancelled',
          completed_at: new Date().toISOString(),
          details: {
            cancellation_reason: reason,
            cancelled_by: 'system',
            cancelled_at: new Date().toISOString(),
          }
        })
        .eq('id', job.id);

      if (updateError) {
        console.error(`[cancel-stale-jobs] Error cancelling job ${job.id}:`, updateError);
        continue;
      }

      result.cancelled_jobs.push({
        id: job.id,
        job_type: job.job_type,
        status: 'pending',
        reason,
      });

      console.log(`[cancel-stale-jobs] Cancelled pending job ${job.id} (${job.job_type})`);
    }

    // Cancel stale running jobs
    for (const job of staleRunningJobs || []) {
      const reason = `Auto-cancelled: stuck in running state for >${staleRunningHours} hours`;
      
      // Get existing details to preserve them
      const { data: existingJob } = await supabase
        .from('jobs')
        .select('details')
        .eq('id', job.id)
        .single();

      const existingDetails = (existingJob?.details as Record<string, unknown>) || {};
      
      const { error: updateError } = await supabase
        .from('jobs')
        .update({
          status: 'cancelled',
          completed_at: new Date().toISOString(),
          details: {
            ...existingDetails,
            cancellation_reason: reason,
            cancelled_by: 'system',
            cancelled_at: new Date().toISOString(),
          }
        })
        .eq('id', job.id);

      if (updateError) {
        console.error(`[cancel-stale-jobs] Error cancelling job ${job.id}:`, updateError);
        continue;
      }

      // Also cancel any associated tasks
      await supabase
        .from('job_tasks')
        .update({
          status: 'cancelled',
          completed_at: new Date().toISOString(),
        })
        .eq('job_id', job.id)
        .in('status', ['pending', 'running']);

      result.cancelled_jobs.push({
        id: job.id,
        job_type: job.job_type,
        status: 'running',
        reason,
      });

      console.log(`[cancel-stale-jobs] Cancelled running job ${job.id} (${job.job_type})`);
    }

    result.total_cancelled = result.cancelled_jobs.length;
    console.log(`[cancel-stale-jobs] Complete. Cancelled ${result.total_cancelled} jobs.`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[cancel-stale-jobs] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
