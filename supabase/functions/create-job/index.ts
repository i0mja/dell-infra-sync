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
  credential_set_ids?: string[];
}

// Validation functions
function validateIPAddress(ip: string): boolean {
  const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const cidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\/(?:[0-9]|[12][0-9]|3[0-2])$/;
  return ipRegex.test(ip) || cidrRegex.test(ip);
}

function validateUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

function validateJobRequest(request: CreateJobRequest): { valid: boolean; error?: string } {
  // Validate job type
  const validTypes = ['firmware_update', 'discovery_scan', 'vcenter_sync', 'full_server_update'];
  if (!request.job_type || !validTypes.includes(request.job_type)) {
    return { valid: false, error: 'Invalid job_type. Must be one of: firmware_update, discovery_scan, vcenter_sync, full_server_update' };
  }

  // Validate target_scope
  if (!request.target_scope || typeof request.target_scope !== 'object') {
    return { valid: false, error: 'target_scope is required and must be an object' };
  }

  // Validate server_ids if present
  if (request.target_scope.server_ids && Array.isArray(request.target_scope.server_ids)) {
    for (const id of request.target_scope.server_ids) {
      if (!validateUUID(id)) {
        return { valid: false, error: `Invalid server UUID: ${id}` };
      }
    }
  }

  // Validate vcenter_host_ids if present
  if (request.target_scope.vcenter_host_ids && Array.isArray(request.target_scope.vcenter_host_ids)) {
    for (const id of request.target_scope.vcenter_host_ids) {
      if (!validateUUID(id)) {
        return { valid: false, error: `Invalid vCenter host UUID: ${id}` };
      }
    }
  }

  // Validate credential_set_ids if present
  if (request.credential_set_ids && Array.isArray(request.credential_set_ids)) {
    for (const id of request.credential_set_ids) {
      if (!validateUUID(id)) {
        return { valid: false, error: `Invalid credential set UUID: ${id}` };
      }
    }
  }

  // Validate details object size (prevent DoS)
  if (request.details) {
    const detailsStr = JSON.stringify(request.details);
    if (detailsStr.length > 10000) {
      return { valid: false, error: 'Job details object is too large (max 10KB)' };
    }
  }

  // Validate schedule_at if present
  if (request.schedule_at) {
    const scheduleDate = new Date(request.schedule_at);
    if (isNaN(scheduleDate.getTime())) {
      return { valid: false, error: 'Invalid schedule_at date format' };
    }
  }

  return { valid: true };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Use user-scoped client instead of service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      console.error('Authentication failed');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Check user role
    const { data: roleData } = await supabase.rpc('get_user_role', { _user_id: user.id });
    
    if (!roleData || !['admin', 'operator'].includes(roleData)) {
      console.error('Permission denied - insufficient role');
      return new Response(
        JSON.stringify({ error: 'Permission denied. Admin or operator role required.' }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const jobRequest: CreateJobRequest = await req.json();
    console.log('Job creation request received');

    // Validate request
    const validation = validateJobRequest(jobRequest);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: validation.error }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Create the job with RLS permissions
    const { data: newJob, error: insertError } = await supabase
      .from('jobs')
      .insert([{
        job_type: jobRequest.job_type,
        status: jobRequest.schedule_at ? 'pending' : 'pending',
        target_scope: jobRequest.target_scope,
        details: jobRequest.details || {},
        created_by: user.id,
        schedule_at: jobRequest.schedule_at || null,
        credential_set_ids: jobRequest.credential_set_ids || null,
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
