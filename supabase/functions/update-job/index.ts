import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  started_at?: string;
  completed_at?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // For job executor, we allow updates without JWT (uses service role)
    // This endpoint is called by the local job executor script
    const { job, task } = await req.json();

    if (job) {
      const updateData: any = {};
      if (job.status) updateData.status = job.status;
      if (job.started_at) updateData.started_at = job.started_at;
      if (job.completed_at) updateData.completed_at = job.completed_at;
      if (job.details) updateData.details = job.details;

      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .update(updateData)
        .eq('id', job.job_id)
        .select()
        .single();

      if (jobError) throw jobError;

      console.log(`Job updated: ${job.job_id} - status: ${job.status}`);

      // If job is cancelled or failed, cascade to child jobs
      if (job.status && ['cancelled', 'failed'].includes(job.status)) {
        const { error: childError } = await supabase
          .from('jobs')
          .update({
            status: 'cancelled',
            completed_at: new Date().toISOString(),
            details: {
              cancellation_reason: `Auto-cancelled: parent job ${job.status}`
            }
          })
          .eq('parent_job_id', job.job_id)
          .in('status', ['pending', 'running']);

        if (childError) {
          console.error('Error cascading cancellation to child jobs:', childError);
        } else {
          console.log(`Cascaded ${job.status} status to child jobs of ${job.job_id}`);
        }
      }

      // Trigger notification if status changed to completed, failed, or running
      if (job.status && ['completed', 'failed', 'running'].includes(job.status)) {
        try {
          const notificationResponse = await supabase.functions.invoke('send-notification', {
            body: {
              jobId: job.job_id,
              jobType: jobData.job_type,
              status: job.status,
              details: job.details,
            },
          });
          
          if (notificationResponse.error) {
            console.error('Notification error:', notificationResponse.error);
          } else {
            console.log('Notification sent:', notificationResponse.data);
          }
        } catch (notifError) {
          // Don't fail the job update if notification fails
          console.error('Failed to send notification:', notifError);
        }
      }
    }

    if (task) {
      const updateData: any = {};
      if (task.status) updateData.status = task.status;
      if (task.log) updateData.log = task.log;
      if (task.started_at) updateData.started_at = task.started_at;
      if (task.completed_at) updateData.completed_at = task.completed_at;

      const { error: taskError } = await supabase
        .from('job_tasks')
        .update(updateData)
        .eq('id', task.task_id);

      if (taskError) throw taskError;

      console.log(`Task updated: ${task.task_id} - status: ${task.status}`);
    }

    return new Response(JSON.stringify({ 
      success: true 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error in update-job function:', error);
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
