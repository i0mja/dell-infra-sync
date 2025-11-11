import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get settings
    const { data: settings, error: settingsError } = await supabase
      .from('activity_settings')
      .select('*')
      .single()

    if (settingsError) throw settingsError

    if (!settings?.job_auto_cleanup_enabled) {
      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'Job auto cleanup is disabled',
          deleted_count: 0,
          stale_cancelled_count: 0
        }), 
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

    // Calculate stale job cutoff times
    const stalePendingCutoff = new Date()
    stalePendingCutoff.setHours(stalePendingCutoff.getHours() - settings.stale_pending_hours)
    
    const staleRunningCutoff = new Date()
    staleRunningCutoff.setHours(staleRunningCutoff.getHours() - settings.stale_running_hours)

    // Cancel stale pending jobs
    let staleCancelledCount = 0
    if (settings.auto_cancel_stale_jobs) {
      console.log(`[JOB-CLEANUP] Cancelling pending jobs older than ${stalePendingCutoff.toISOString()}`)
      
      const { data: stalePendingJobs, error: stalePendingError } = await supabase
        .from('jobs')
        .select('id')
        .eq('status', 'pending')
        .lt('created_at', stalePendingCutoff.toISOString())

      if (!stalePendingError && stalePendingJobs && stalePendingJobs.length > 0) {
        const { error: cancelPendingError } = await supabase
          .from('jobs')
          .update({
            status: 'cancelled',
            completed_at: new Date().toISOString(),
            details: {
              cancellation_reason: `Auto-cancelled: stuck in pending state for >${settings.stale_pending_hours} hours`
            }
          })
          .in('id', stalePendingJobs.map(j => j.id))

        if (!cancelPendingError) {
          staleCancelledCount += stalePendingJobs.length
          console.log(`[JOB-CLEANUP] Cancelled ${stalePendingJobs.length} stale pending jobs`)
        }
      }

      // Cancel stale running jobs
      console.log(`[JOB-CLEANUP] Cancelling running jobs older than ${staleRunningCutoff.toISOString()}`)
      
      const { data: staleRunningJobs, error: staleRunningError } = await supabase
        .from('jobs')
        .select('id')
        .eq('status', 'running')
        .lt('started_at', staleRunningCutoff.toISOString())

      if (!staleRunningError && staleRunningJobs && staleRunningJobs.length > 0) {
        const { error: cancelRunningError } = await supabase
          .from('jobs')
          .update({
            status: 'cancelled',
            completed_at: new Date().toISOString(),
            details: {
              cancellation_reason: `Auto-cancelled: stuck in running state for >${settings.stale_running_hours} hours`
            }
          })
          .in('id', staleRunningJobs.map(j => j.id))

        if (!cancelRunningError) {
          staleCancelledCount += staleRunningJobs.length
          console.log(`[JOB-CLEANUP] Cancelled ${staleRunningJobs.length} stale running jobs`)
        }
      }
    }

    // Delete old completed/failed/cancelled jobs
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - settings.job_retention_days)

    console.log(`[JOB-CLEANUP] Deleting jobs older than ${cutoffDate.toISOString()}`)

    // First, get the IDs of jobs to delete
    const { data: jobsToDelete, error: jobsQueryError } = await supabase
      .from('jobs')
      .select('id')
      .in('status', ['completed', 'failed', 'cancelled'])
      .lt('completed_at', cutoffDate.toISOString())

    if (jobsQueryError) throw jobsQueryError

    const jobIds = jobsToDelete?.map(job => job.id) || []
    
    let deletedCount = 0
    if (jobIds.length > 0) {
      // Delete old job tasks first (foreign key constraint)
      const { error: tasksDeleteError } = await supabase
        .from('job_tasks')
        .delete()
        .in('job_id', jobIds)

      if (tasksDeleteError) {
        console.error('[JOB-CLEANUP] Error deleting tasks:', tasksDeleteError)
      }

      // Delete old jobs
      const { error: jobsDeleteError, count } = await supabase
        .from('jobs')
        .delete({ count: 'exact' })
        .in('id', jobIds)

      if (jobsDeleteError) throw jobsDeleteError

      deletedCount = count || 0
      console.log(`[JOB-CLEANUP] Deleted ${deletedCount} old jobs`)
    } else {
      console.log('[JOB-CLEANUP] No old jobs to delete')
    }

    // Update last cleanup timestamp
    const { error: updateError } = await supabase
      .from('activity_settings')
      .update({ job_last_cleanup_at: new Date().toISOString() })
      .eq('id', settings.id)

    if (updateError) throw updateError

    return new Response(
      JSON.stringify({ 
        success: true,
        deleted_count: deletedCount,
        stale_cancelled_count: staleCancelledCount,
        cutoff_date: cutoffDate.toISOString(),
        retention_days: settings.job_retention_days,
        stale_pending_hours: settings.stale_pending_hours,
        stale_running_hours: settings.stale_running_hours
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    console.error('[JOB-CLEANUP] Error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage 
      }), 
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})
