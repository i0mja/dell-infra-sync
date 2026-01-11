/**
 * vCenter Service
 * 
 * Centralized vCenter operations with instant API support and job queue fallback.
 * Uses the same pattern as pduService.ts for consistency.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  triggerVCenterSyncApi,
  triggerPartialSyncApi,
  getJobExecutorUrl,
  type VCenterSyncResponse,
  type PartialSyncResponse,
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
    `vCenter ${operation}: Mixed content detected (HTTPS page calling HTTP API). ` +
    'Using job queue fallback. To enable instant API, either:\n' +
    '1. Access the app via HTTP, or\n' +
    '2. Configure the Job Executor with HTTPS (recommended for production)'
  );
}

/**
 * Trigger vCenter sync via instant API, fallback to job queue
 */
export async function triggerVCenterSync(
  vcenterId?: string
): Promise<VCenterSyncResponse | string> {
  // Check for mixed content - skip instant API if blocked
  if (isMixedContentBlocked()) {
    logMixedContentWarning('sync');
    return createVCenterSyncJob(vcenterId);
  }

  try {
    const result = await triggerVCenterSyncApi(vcenterId);
    return result;
  } catch (error) {
    console.log('vCenter instant API unavailable, falling back to job queue:', 
      error instanceof Error ? error.message : 'Unknown error');
    return createVCenterSyncJob(vcenterId);
  }
}

/**
 * Trigger partial vCenter sync via instant API, fallback to job queue
 */
export async function triggerPartialSync(
  syncScope: 'vms' | 'hosts' | 'clusters' | 'datastores' | 'networks',
  vcenterId?: string
): Promise<PartialSyncResponse | string> {
  // Check for mixed content - skip instant API if blocked
  if (isMixedContentBlocked()) {
    logMixedContentWarning(`partial sync (${syncScope})`);
    return createPartialSyncJob(syncScope, vcenterId);
  }

  try {
    const result = await triggerPartialSyncApi(syncScope, vcenterId);
    return result;
  } catch (error) {
    console.log('vCenter instant API unavailable, falling back to job queue:', 
      error instanceof Error ? error.message : 'Unknown error');
    return createPartialSyncJob(syncScope, vcenterId);
  }
}

/**
 * Create a vCenter sync job (fallback when instant API unavailable)
 */
async function createVCenterSyncJob(vcenterId?: string): Promise<string> {
  const { data: user } = await supabase.auth.getUser();
  
  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      job_type: 'vcenter_sync' as const,
      status: 'pending',
      created_by: user?.user?.id,
      details: vcenterId ? { vcenter_id: vcenterId } : {},
      target_scope: vcenterId ? { vcenter_ids: [vcenterId] } : {},
    })
    .select('id')
    .single();
  
  if (error) throw error;
  return job.id;
}

/**
 * Create a partial vCenter sync job (fallback when instant API unavailable)
 */
async function createPartialSyncJob(
  syncScope: 'vms' | 'hosts' | 'clusters' | 'datastores' | 'networks',
  vcenterId?: string
): Promise<string> {
  const { data: user } = await supabase.auth.getUser();
  
  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      job_type: 'partial_vcenter_sync' as const,
      status: 'pending',
      created_by: user?.user?.id,
      details: {
        sync_scope: syncScope,
        vcenter_id: vcenterId,
        quick_refresh: true,
      },
    })
    .select('id')
    .single();
  
  if (error) throw error;
  return job.id;
}
