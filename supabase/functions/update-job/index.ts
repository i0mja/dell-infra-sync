import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { verifyRequestDualAuth } from "../_shared/hmac-verify.ts";
import { logger } from "../_shared/logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-executor-signature, x-executor-timestamp',
};

interface UpdateJobRequest {
  job_id: string;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  started_at?: string;
  completed_at?: string;
  details?: any;
}

interface UpdateTaskRequest {
  task_id: string;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  log?: string;
  progress?: number;
  started_at?: string;
  completed_at?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse request body first for authentication verification
    const payload = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Create client with request's auth header for JWT verification
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } }
    });
    
    // Verify request using dual auth: HMAC (Job Executor) or JWT (frontend)
    const authResult = await verifyRequestDualAuth(req, payload, authClient);
    if (!authResult.authenticated) {
      logger.security('Request authentication failed', false);
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized: Invalid request signature or token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    logger.debug(`Request authenticated via ${authResult.method}`);

    // Use service role client for actual database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { job, task } = payload;

    if (job) {
      // Accept either job_id or id
      const jobId = job.job_id || job.id;
      
      if (!jobId) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'job_id (or id) is required' 
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const updateData: any = {};
      if (job.status) updateData.status = job.status;
      if (job.started_at) updateData.started_at = job.started_at;
      if (job.completed_at) updateData.completed_at = job.completed_at;
      if (job.details) updateData.details = job.details;

      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .update(updateData)
        .eq('id', jobId)
        .select()
        .single();

      if (jobError) throw jobError;

      // Log without sensitive details
      logger.info(`Job status updated`);

      // If job is cancelled or failed, cascade to child jobs and cancel pending tasks
      if (job.status && ['cancelled', 'failed'].includes(job.status)) {
        // Cancel child jobs
        const { error: childError } = await supabase
          .from('jobs')
          .update({
            status: 'cancelled',
            completed_at: new Date().toISOString(),
            details: {
              cancellation_reason: `Auto-cancelled: parent job ${job.status}`
            }
          })
          .eq('parent_job_id', jobId)
          .in('status', ['pending', 'running']);

        if (childError) {
          logger.error('Error cascading cancellation to child jobs');
        } else {
          logger.debug('Cascaded status to child jobs');
        }

        // Cancel pending tasks for this job
        const { error: taskError } = await supabase
          .from('job_tasks')
          .update({
            status: 'cancelled',
            completed_at: new Date().toISOString(),
            log: job.status === 'failed' ? 'Cancelled - parent job failed' : 'Cancelled by user'
          })
          .eq('job_id', jobId)
          .eq('status', 'pending');

        if (taskError) {
          logger.error('Error cancelling pending tasks');
        } else {
          logger.debug('Cancelled pending tasks');
        }

        // Cascade status to ALL non-terminal workflow execution steps (running AND pending)
        const { error: workflowError } = await supabase
          .from('workflow_executions')
          .update({
            step_status: job.status === 'cancelled' ? 'cancelled' : 'failed',
            step_completed_at: new Date().toISOString(),
            step_error: job.status === 'cancelled' 
              ? 'Cancelled by user' 
              : `Auto-failed: parent job ${job.status}`
          })
          .eq('job_id', jobId)
          .in('step_status', ['running', 'pending']);

        if (workflowError) {
          logger.error('Error cascading status to workflow steps');
        } else {
          logger.debug('Cascaded status to workflow steps');
        }
      }

      // Trigger notification if status changed to completed, failed, or running
      if (job.status && ['completed', 'failed', 'running'].includes(job.status)) {
        try {
          const notificationResponse = await supabase.functions.invoke('send-notification', {
            body: {
              jobId: jobId,
              jobType: jobData.job_type,
              status: job.status,
              details: job.details,
            },
          });
          
          if (notificationResponse.error) {
            logger.warn('Notification delivery failed');
          } else {
            logger.debug('Notification sent');
          }
        } catch (notifError) {
          // Don't fail the job update if notification fails
          logger.warn('Failed to trigger notification');
        }
      }
    }

    if (task) {
      const updateData: any = {};
      if (task.status) updateData.status = task.status;
      if (task.log) updateData.log = task.log;
      if (task.progress !== undefined) updateData.progress = task.progress;
      if (task.started_at) updateData.started_at = task.started_at;
      if (task.completed_at) updateData.completed_at = task.completed_at;

      const { error: taskError } = await supabase
        .from('job_tasks')
        .update(updateData)
        .eq('id', task.task_id);

      if (taskError) throw taskError;

      logger.info('Task status updated');
    }

    return new Response(JSON.stringify({ 
      success: true 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    logger.error('Error in update-job function');
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
