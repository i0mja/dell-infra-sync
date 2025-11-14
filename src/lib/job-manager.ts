import { supabase } from "@/integrations/supabase/client";
import { sendNotification } from "./notification-client";

export interface CreateJobParams {
  job_type: "firmware_update" | "discovery_scan" | "vcenter_sync" | "full_server_update";
  target_scope: any;
  details: any;
  schedule_at?: string | null;
  credential_set_ids?: string[] | null;
}

export interface CreateJobResult {
  success: boolean;
  job_id?: string;
  sub_jobs?: string[];
  error?: string;
}

export interface UpdateJobParams {
  job_id: string;
  status?: "pending" | "running" | "completed" | "failed" | "cancelled";
  started_at?: string;
  completed_at?: string;
  details?: any;
}

export interface UpdateJobResult {
  success: boolean;
  error?: string;
}

const FULL_SERVER_UPDATE_COMPONENTS = [
  { name: "iDRAC", order: 1 },
  { name: "BIOS", order: 2 },
  { name: "CPLD", order: 3 },
  { name: "RAID", order: 4 },
  { name: "NIC", order: 5 },
  { name: "Backplane", order: 6 }
];

export async function createJob(params: CreateJobParams): Promise<CreateJobResult> {
  try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    // Check user permissions
    const { data: userRole } = await supabase.rpc('get_user_role', { _user_id: user.id });
    if (userRole !== 'admin' && userRole !== 'operator') {
      throw new Error("Insufficient permissions to create jobs");
    }

    // Handle full_server_update by creating parent job and sub-jobs
    if (params.job_type === "full_server_update") {
      // Create parent job
      const { data: parentJob, error: parentError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'full_server_update',
          status: 'pending',
          target_scope: params.target_scope,
          details: params.details,
          created_by: user.id,
          schedule_at: params.schedule_at,
          credential_set_ids: params.credential_set_ids
        })
        .select()
        .single();

      if (parentError) throw parentError;

      // Create sub-jobs for each component
      const subJobPromises = FULL_SERVER_UPDATE_COMPONENTS.map(component => 
        supabase
          .from('jobs')
          .insert({
            job_type: 'firmware_update',
            status: 'pending',
            parent_job_id: parentJob.id,
            component_order: component.order,
            target_scope: params.target_scope,
            details: {
              ...params.details,
              component: component.name
            },
            created_by: user.id,
            credential_set_ids: params.credential_set_ids
          })
          .select()
          .single()
      );

      const subJobResults = await Promise.all(subJobPromises);
      const subJobErrors = subJobResults.filter(r => r.error);
      
      if (subJobErrors.length > 0) {
        throw new Error(`Failed to create ${subJobErrors.length} sub-job(s)`);
      }

      const subJobIds = subJobResults.map(r => r.data?.id).filter(Boolean);

      // Log audit entry
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        action: 'create_full_server_update_job',
        details: {
          parent_job_id: parentJob.id,
          sub_job_count: subJobIds.length,
          target_scope: params.target_scope
        }
      });

      // Send notification if enabled
      await sendNotification({
        job_id: parentJob.id,
        event_type: 'job_started',
        job_type: 'full_server_update',
        details: params.details
      }).catch(console.error); // Don't fail job creation if notification fails

      return {
        success: true,
        job_id: parentJob.id,
        sub_jobs: subJobIds as string[]
      };
    }

    // Handle other job types (firmware_update, discovery_scan, vcenter_sync)
    const { data: job, error } = await supabase
      .from('jobs')
      .insert({
        job_type: params.job_type,
        status: 'pending',
        target_scope: params.target_scope,
        details: params.details,
        created_by: user.id,
        schedule_at: params.schedule_at,
        credential_set_ids: params.credential_set_ids
      })
      .select()
      .single();

    if (error) throw error;

    // Log audit entry
    await supabase.from('audit_logs').insert({
      user_id: user.id,
      action: `create_${params.job_type}_job`,
      details: {
        job_id: job.id,
        target_scope: params.target_scope
      }
    });

    // Send notification if enabled
    await sendNotification({
      job_id: job.id,
      event_type: 'job_started',
      job_type: params.job_type,
      details: params.details
    }).catch(console.error);

    return {
      success: true,
      job_id: job.id
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}

export async function updateJob(params: UpdateJobParams): Promise<UpdateJobResult> {
  try {
    const updateData: any = {};
    
    if (params.status) updateData.status = params.status;
    if (params.started_at) updateData.started_at = params.started_at;
    if (params.completed_at) updateData.completed_at = params.completed_at;
    if (params.details) updateData.details = params.details;

    const { error } = await supabase
      .from('jobs')
      .update(updateData)
      .eq('id', params.job_id);

    if (error) throw error;

    // If job is cancelled, cascade to child jobs
    if (params.status === 'cancelled') {
      await supabase
        .from('jobs')
        .update({ 
          status: 'cancelled', 
          completed_at: new Date().toISOString(),
          details: {
            cancellation_reason: 'Parent job cancelled'
          }
        })
        .eq('parent_job_id', params.job_id)
        .in('status', ['pending', 'running']);
    }

    // Send notification on status change
    if (params.status === 'completed' || params.status === 'failed') {
      const { data: job } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', params.job_id)
        .single();

      if (job) {
        await sendNotification({
          job_id: params.job_id,
          event_type: params.status === 'completed' ? 'job_completed' : 'job_failed',
          job_type: job.job_type,
          details: params.details || job.details
        }).catch(console.error);
      }
    }

    // Log audit entry
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        action: 'update_job_status',
        details: {
          job_id: params.job_id,
          new_status: params.status
        }
      });
    }

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}

export async function cancelJob(job_id: string): Promise<UpdateJobResult> {
  return updateJob({
    job_id,
    status: 'cancelled',
    completed_at: new Date().toISOString(),
    details: {
      cancellation_reason: 'Cancelled by user'
    }
  });
}
