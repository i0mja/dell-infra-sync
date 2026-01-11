/**
 * Cluster Service
 * 
 * Centralized cluster operations with instant API support and job queue fallback.
 * Uses the same pattern as vcenterService.ts for consistency.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  clusterSafetyCheckApi,
  getJobExecutorUrl,
  type ClusterSafetyCheckResponse,
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
    `Cluster ${operation}: Mixed content detected (HTTPS page calling HTTP API). ` +
    'Using job queue fallback. To enable instant API, either:\n' +
    '1. Access the app via HTTP, or\n' +
    '2. Configure the Job Executor with HTTPS (recommended for production)'
  );
}

/**
 * Run cluster safety check via instant API, fallback to job queue
 */
export async function runClusterSafetyCheck(
  clusterName: string,
  vcenterId?: string,
  options?: { minRequiredHosts?: number }
): Promise<ClusterSafetyCheckResponse | string> {
  // Check for mixed content - skip instant API if blocked
  if (isMixedContentBlocked()) {
    logMixedContentWarning('safety check');
    return createClusterSafetyCheckJob(clusterName, vcenterId, options);
  }

  try {
    const result = await clusterSafetyCheckApi(clusterName, vcenterId, options);
    return result;
  } catch (error) {
    console.log('Cluster instant API unavailable, falling back to job queue:', 
      error instanceof Error ? error.message : 'Unknown error');
    return createClusterSafetyCheckJob(clusterName, vcenterId, options);
  }
}

/**
 * Create a cluster safety check job (fallback when instant API unavailable)
 */
async function createClusterSafetyCheckJob(
  clusterName: string,
  vcenterId?: string,
  options?: { minRequiredHosts?: number }
): Promise<string> {
  const { data: user } = await supabase.auth.getUser();
  
  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      job_type: 'cluster_safety_check' as const,
      status: 'pending',
      created_by: user?.user?.id,
      details: {
        cluster_name: clusterName,
        vcenter_id: vcenterId,
        min_required_hosts: options?.minRequiredHosts || 2,
      },
      target_scope: vcenterId ? { vcenter_ids: [vcenterId] } : {},
    })
    .select('id')
    .single();
  
  if (error) throw error;
  return job.id;
}
