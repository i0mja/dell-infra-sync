import { supabase } from "@/integrations/supabase/client";

export async function cleanupActivityLogs() {
  try {
    // Call the database function that handles the cleanup
    const { error } = await supabase.rpc('cleanup_activity_logs');
    
    if (error) throw error;
    
    return { success: true };
  } catch (error: any) {
    throw new Error(`Failed to cleanup activity logs: ${error.message}`);
  }
}

export async function cleanupOldJobs() {
  try {
    // Call the database function that handles the cleanup
    const { error } = await supabase.rpc('cleanup_old_jobs');
    
    if (error) throw error;
    
    return { success: true };
  } catch (error: any) {
    throw new Error(`Failed to cleanup old jobs: ${error.message}`);
  }
}
