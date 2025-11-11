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
          deleted_count: 0
        }), 
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

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
    
    if (jobIds.length === 0) {
      console.log('[JOB-CLEANUP] No old jobs to delete')
      return new Response(
        JSON.stringify({ 
          success: true,
          deleted_count: 0,
          cutoff_date: cutoffDate.toISOString(),
          retention_days: settings.job_retention_days
        }), 
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

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

    console.log(`[JOB-CLEANUP] Deleted ${count} old jobs`)

    // Update last cleanup timestamp
    const { error: updateError } = await supabase
      .from('activity_settings')
      .update({ job_last_cleanup_at: new Date().toISOString() })
      .eq('id', settings.id)

    if (updateError) throw updateError

    return new Response(
      JSON.stringify({ 
        success: true,
        deleted_count: count || 0,
        cutoff_date: cutoffDate.toISOString(),
        retention_days: settings.job_retention_days
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
