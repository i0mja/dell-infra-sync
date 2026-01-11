/**
 * Datastore Service
 * 
 * Centralized datastore operations with instant API support and job queue fallback.
 * Uses the same pattern as pduService.ts for consistency.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  manageDatastoreApi,
  scanDatastoreStatusApi,
  getJobExecutorUrl,
  type DatastoreOperation,
  type ManageDatastoreResponse,
  type ScanDatastoreStatusResponse,
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
    `Datastore ${operation}: Mixed content detected (HTTPS page calling HTTP API). ` +
    'Using job queue fallback. To enable instant API, either:\n' +
    '1. Access the app via HTTP, or\n' +
    '2. Configure the Job Executor with HTTPS (recommended for production)'
  );
}

/**
 * Manage datastore mounts via instant API, fallback to job queue
 */
export async function manageDatastore(
  targetId: string,
  operation: DatastoreOperation,
  hostNames?: string[]
): Promise<ManageDatastoreResponse | string> {
  // Check for mixed content - skip instant API if blocked
  if (isMixedContentBlocked()) {
    logMixedContentWarning(operation);
    return createManageDatastoreJob(targetId, operation, hostNames);
  }

  try {
    const result = await manageDatastoreApi(targetId, operation, hostNames);
    return result;
  } catch (error) {
    console.log('Datastore instant API unavailable, falling back to job queue:', 
      error instanceof Error ? error.message : 'Unknown error');
    return createManageDatastoreJob(targetId, operation, hostNames);
  }
}

/**
 * Scan datastore status via instant API, fallback to job queue
 */
export async function scanDatastoreStatus(
  targetId: string
): Promise<ScanDatastoreStatusResponse | string> {
  // Check for mixed content - skip instant API if blocked
  if (isMixedContentBlocked()) {
    logMixedContentWarning('scan status');
    return createScanDatastoreJob(targetId);
  }

  try {
    const result = await scanDatastoreStatusApi(targetId);
    return result;
  } catch (error) {
    console.log('Datastore instant API unavailable, falling back to job queue:', 
      error instanceof Error ? error.message : 'Unknown error');
    return createScanDatastoreJob(targetId);
  }
}

/**
 * Create a manage datastore job (fallback when instant API unavailable)
 */
async function createManageDatastoreJob(
  targetId: string,
  operation: DatastoreOperation,
  hostNames?: string[]
): Promise<string> {
  const { data: user } = await supabase.auth.getUser();
  
  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      job_type: 'manage_datastore' as const,
      status: 'pending',
      created_by: user?.user?.id,
      details: {
        target_id: targetId,
        operation,
        host_names: hostNames || [],
      },
      target_scope: {},
    })
    .select('id')
    .single();
  
  if (error) throw error;
  return job.id;
}

/**
 * Create a scan datastore status job (fallback when instant API unavailable)
 */
async function createScanDatastoreJob(targetId: string): Promise<string> {
  const { data: user } = await supabase.auth.getUser();
  
  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      job_type: 'scan_datastore_status' as const,
      status: 'pending',
      created_by: user?.user?.id,
      details: {
        target_id: targetId,
        auto_detect: true,
      },
      target_scope: {},
    })
    .select('id')
    .single();
  
  if (error) throw error;
  return job.id;
}

// Re-export the DatastoreOperation type for convenience
export type { DatastoreOperation };
