import { supabase } from "@/integrations/supabase/client";

export type ActivityType = 
  | 'datastore_browse'
  | 'connectivity_test'
  | 'console_launch'
  | 'health_check'
  | 'power_action'
  | 'virtual_media_mount'
  | 'virtual_media_unmount'
  | 'event_log_fetch'
  | 'credential_test'
  | 'idm_login'
  | 'scp_preview'
  | 'bios_fetch';

export type TargetType = 'server' | 'vcenter' | 'datastore' | 'idm' | 'cluster';

interface LogActivityOptions {
  targetId?: string;
  success?: boolean;
  durationMs?: number;
  error?: string;
}

export function useActivityLog() {
  const logActivity = async (
    activityType: ActivityType,
    targetType: TargetType,
    targetName: string,
    details?: Record<string, unknown>,
    options?: LogActivityOptions
  ) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase.from('user_activity').insert({
        activity_type: activityType,
        target_type: targetType,
        target_name: targetName,
        target_id: options?.targetId,
        details: details as any,
        success: options?.success ?? true,
        duration_ms: options?.durationMs,
        error_message: options?.error,
        user_id: user?.id
      });
      
      if (error) console.error('Failed to log activity:', error);
    } catch (err) {
      console.error('Failed to log activity:', err);
    }
  };

  return { logActivity };
}

// Standalone function for use outside React components
export async function logActivityDirect(
  activityType: ActivityType,
  targetType: TargetType,
  targetName: string,
  details?: Record<string, unknown>,
  options?: LogActivityOptions
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    // Skip logging when there is no authenticated session to avoid RLS errors
    if (!user?.id) {
      console.warn('Skipping activity log: no authenticated user session');
      return;
    }

    const { error } = await supabase.from('user_activity').insert({
      activity_type: activityType,
      target_type: targetType,
      target_name: targetName,
      target_id: options?.targetId,
      details: details as any,
      success: options?.success ?? true,
      duration_ms: options?.durationMs,
      error_message: options?.error,
      user_id: user?.id
    });
    
    if (error) console.error('Failed to log activity:', error);
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}
