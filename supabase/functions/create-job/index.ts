import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateJobRequest {
  job_type: 'firmware_update' | 'discovery_scan' | 'vcenter_sync' | 'full_server_update';
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

    // Handle full_server_update: create sub-jobs for each component
    if (jobRequest.job_type === 'full_server_update') {
      // Define component update order (Dell best practice)
      const updateSequence = [
        { component: 'iDRAC', order: 1 },
        { component: 'BIOS', order: 2 },
        { component: 'CPLD', order: 3 },
        { component: 'RAID', order: 4 },
        { component: 'NIC', order: 5 },
        { component: 'Backplane', order: 6 }
      ];

      // Create sub-jobs for each component
      // Note: firmware_uri is intentionally omitted to allow auto-construction per component
      const subJobs = updateSequence.map(({ component, order }) => ({
        job_type: 'firmware_update',
        status: 'pending',
        target_scope: jobRequest.target_scope,
        details: {
          component: component,
          version: 'latest',
          apply_time: 'OnReset',
          // firmware_uri omitted - each sub-job will auto-construct its own URI
          // e.g., {FIRMWARE_REPO_URL}/iDRAC_latest.exe, {FIRMWARE_REPO_URL}/BIOS_latest.exe
        },
        created_by: user.id,
        parent_job_id: newJob.id,
        component_order: order
      }));

      const { error: subJobsError } = await supabase
        .from('jobs')
        .insert(subJobs);

      if (subJobsError) {
        console.error('Error creating sub-jobs:', subJobsError);
        throw new Error('Failed to create component update sub-jobs');
      }

      console.log(`Created ${subJobs.length} sub-jobs for full server update ${newJob.id}`);
    }

    // Create job tasks based on target scope (for non-full_server_update jobs)
    if (jobRequest.job_type !== 'full_server_update' && 
        jobRequest.target_scope.server_ids && 
        Array.isArray(jobRequest.target_scope.server_ids)) {
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
