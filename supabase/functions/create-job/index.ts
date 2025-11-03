import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateJobRequest {
  job_type: 'firmware_update' | 'discovery_scan' | 'vcenter_sync';
  target_scope: any;
  details?: any;
  schedule_at?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Check permissions (admin or operator)
    const { data: roles, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (roleError) throw roleError;

    const hasPermission = roles?.some(r => r.role === 'admin' || r.role === 'operator');
    if (!hasPermission) {
      throw new Error('Insufficient permissions');
    }

    const jobRequest: CreateJobRequest = await req.json();

    // Validate request
    if (!jobRequest.job_type || !jobRequest.target_scope) {
      throw new Error('Missing required fields: job_type and target_scope');
    }

    // Create the job
    const { data: newJob, error: insertError } = await supabase
      .from('jobs')
      .insert([{
        job_type: jobRequest.job_type,
        status: jobRequest.schedule_at ? 'pending' : 'pending',
        target_scope: jobRequest.target_scope,
        details: jobRequest.details || {},
        created_by: user.id,
        schedule_at: jobRequest.schedule_at || null,
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    // Create job tasks based on target scope
    if (jobRequest.target_scope.server_ids && Array.isArray(jobRequest.target_scope.server_ids)) {
      const tasks = jobRequest.target_scope.server_ids.map((server_id: string) => ({
        job_id: newJob.id,
        server_id,
        status: 'pending',
      }));

      const { error: tasksError } = await supabase
        .from('job_tasks')
        .insert(tasks);

      if (tasksError) {
        console.error('Error creating job tasks:', tasksError);
      }
    }

    // Log the action
    await supabase.from('audit_logs').insert([{
      user_id: user.id,
      action: 'job_created',
      details: {
        job_id: newJob.id,
        job_type: jobRequest.job_type,
        target_scope: jobRequest.target_scope,
      },
    }]);

    console.log(`Job created: ${newJob.id} by user ${user.email}`);

    return new Response(JSON.stringify({ 
      success: true,
      job: newJob
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 201,
    });

  } catch (error) {
    console.error('Error in create-job function:', error);
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
