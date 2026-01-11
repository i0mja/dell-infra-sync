/**
 * Replication Service
 * 
 * Centralized replication operations with instant API support and job queue fallback.
 * Uses the same pattern as vcenterService.ts for consistency.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  syncProtectionConfigApi,
  getJobExecutorUrl,
  type SyncProtectionConfigResponse,
} from '@/lib/job-executor-api';

/**
 * Check if we're in a mixed content scenario (HTTPS page calling HTTP API)
 * Browsers block these requests for security
 */
function isMixedContentBlocked(): boolean {
  const isHttpsPage = window.location.protocol === 'https:';
  const apiUrl = getJobExecutorUrl();
  const isHttpApi = apiUrl.startsWith('http://') && !apiUrl.startsWith('http://localhost');
  return isHttpsPage && isHttpApi;
}

/**
 * Log a warning about mixed content and suggest solutions
 */
function logMixedContentWarning(operation: string): void {
  console.warn(
    `Replication ${operation}: Mixed content detected (HTTPS page calling HTTP API). ` +
    'Using job queue fallback. To enable instant API, either:\n' +
    '1. Access the app via HTTP, or\n' +
    '2. Configure the Job Executor with HTTPS (recommended for production)'
  );
}

/**
 * Sync protection group config to ZFS appliances via instant API, fallback to job queue
 */
export async function syncProtectionConfig(
  protectionGroupId: string,
  changes?: Record<string, any>
): Promise<SyncProtectionConfigResponse | string> {
  // Check for mixed content - skip instant API if blocked
  if (isMixedContentBlocked()) {
    logMixedContentWarning('sync protection config');
    return createSyncProtectionConfigJob(protectionGroupId, changes);
  }

  try {
    const result = await syncProtectionConfigApi(protectionGroupId, changes);
    return result;
  } catch (error) {
    console.log('Replication instant API unavailable, falling back to job queue:', 
      error instanceof Error ? error.message : 'Unknown error');
    return createSyncProtectionConfigJob(protectionGroupId, changes);
  }
}

/**
 * Create a sync protection config job (fallback when instant API unavailable)
 */
async function createSyncProtectionConfigJob(
  protectionGroupId: string,
  changes?: Record<string, any>
): Promise<string> {
  const { data: user } = await supabase.auth.getUser();
  
  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      job_type: 'sync_protection_config' as any,
      status: 'pending',
      created_by: user?.user?.id,
      target_scope: { protection_group_id: protectionGroupId },
      details: {
        protection_group_id: protectionGroupId,
        changes: changes || {},
      },
    })
    .select('id')
    .single();
  
  if (error) throw error;
  return job.id;
}
