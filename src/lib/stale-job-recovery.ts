import { supabase } from "@/integrations/supabase/client";

export interface ForceCompleteResult {
  success: boolean;
  error?: string;
  updatedDetails?: Record<string, any>;
}

/**
 * Force complete a stale replication sync job by updating its status and details.
 */
export async function forceCompleteReplicationJob(jobId: string): Promise<ForceCompleteResult> {
  try {
    // Fetch job details
    const { data: job, error: fetchError } = await supabase
      .from('jobs')
      .select('details, started_at, job_type')
      .eq('id', jobId)
      .single();

    if (fetchError || !job) {
      return { success: false, error: fetchError?.message || 'Job not found' };
    }

    // Fetch completed tasks to get accurate counts
    const { data: tasks } = await supabase
      .from('job_tasks')
      .select('status, log')
      .eq('job_id', jobId);

    const completedTasks = tasks?.filter(t => t.status === 'completed').length || 0;
    const details = (job.details as Record<string, any>) || {};

    // Build recovered details
    const updatedDetails: Record<string, any> = {
      ...details,
      progress_percent: 100,
      vms_synced: details.vms_synced || completedTasks,
      vms_completed: details.vms_completed || completedTasks,
      current_step: 'Complete (recovered from stale state)',
      recovered_at: new Date().toISOString(),
      recovery_reason: 'Manually marked complete - job tasks were finished but status update failed',
    };

    // Update job status
    const { error: updateError } = await supabase
      .from('jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        details: updatedDetails,
      })
      .eq('id', jobId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true, updatedDetails };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' };
  }
}

/**
 * Force fail a stale job that can't be recovered.
 */
export async function forceFailJob(jobId: string, reason: string): Promise<ForceCompleteResult> {
  try {
    const { data: job, error: fetchError } = await supabase
      .from('jobs')
      .select('details')
      .eq('id', jobId)
      .single();

    if (fetchError || !job) {
      return { success: false, error: fetchError?.message || 'Job not found' };
    }

    const details = (job.details as Record<string, any>) || {};
    const updatedDetails: Record<string, any> = {
      ...details,
      error: reason,
      force_failed_at: new Date().toISOString(),
      force_failed_reason: reason,
    };

    const { error: updateError } = await supabase
      .from('jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        details: updatedDetails,
      })
      .eq('id', jobId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true, updatedDetails };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' };
  }
}

/**
 * Cancel a stale job.
 */
export async function cancelStaleJob(jobId: string): Promise<ForceCompleteResult> {
  try {
    const { data: job, error: fetchError } = await supabase
      .from('jobs')
      .select('details')
      .eq('id', jobId)
      .single();

    if (fetchError || !job) {
      return { success: false, error: fetchError?.message || 'Job not found' };
    }

    const details = (job.details as Record<string, any>) || {};
    const updatedDetails: Record<string, any> = {
      ...details,
      cancelled_at: new Date().toISOString(),
      cancellation_reason: 'Cancelled by user - job was stale/unresponsive',
    };

    const { error: updateError } = await supabase
      .from('jobs')
      .update({
        status: 'cancelled',
        completed_at: new Date().toISOString(),
        details: updatedDetails,
      })
      .eq('id', jobId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true, updatedDetails };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' };
  }
}
