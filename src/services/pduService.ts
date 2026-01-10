import { supabase } from '@/integrations/supabase/client';
import type { OutletAction, PduTestConnectionResponse, PduDiscoverResponse, PduOutletControlResponse, PduSyncStatusResponse } from '@/types/pdu';
import {
  testPduConnectionApi,
  discoverPduApi,
  controlPduOutletApi,
  syncPduStatusApi,
} from '@/lib/job-executor-api';

/**
 * Test PDU connection via instant API, fallback to job queue
 */
export async function testPduConnection(pduId: string): Promise<PduTestConnectionResponse | string> {
  try {
    const result = await testPduConnectionApi(pduId);
    return result;
  } catch (error) {
    console.log('PDU instant API unavailable, falling back to job queue');
    return createPduJob('pdu_test_connection', pduId);
  }
}

/**
 * Discover PDU details via instant API, fallback to job queue
 */
export async function discoverPdu(pduId: string): Promise<PduDiscoverResponse | string> {
  try {
    const result = await discoverPduApi(pduId);
    return result;
  } catch (error) {
    console.log('PDU instant API unavailable, falling back to job queue');
    return createPduJob('pdu_discover', pduId);
  }
}

/**
 * Control PDU outlet via instant API, fallback to job queue
 */
export async function controlPduOutlet(
  pduId: string,
  outletNumbers: number[],
  action: OutletAction
): Promise<PduOutletControlResponse | string> {
  try {
    const result = await controlPduOutletApi(pduId, outletNumbers, action);
    return result;
  } catch (error) {
    console.log('PDU instant API unavailable, falling back to job queue');
    return createPduOutletJob(pduId, outletNumbers, action);
  }
}

/**
 * Sync PDU outlet status via instant API, fallback to job queue
 */
export async function syncPduStatus(pduId: string): Promise<PduSyncStatusResponse | string> {
  try {
    const result = await syncPduStatusApi(pduId);
    return result;
  } catch (error) {
    console.log('PDU instant API unavailable, falling back to job queue');
    return createPduJob('pdu_sync_status', pduId);
  }
}

/**
 * Create a PDU job (fallback when instant API unavailable)
 */
async function createPduJob(jobType: string, pduId: string): Promise<string> {
  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      // Cast to any since PDU job types are handled by executor but may not be in enum
      job_type: jobType as any,
      status: 'pending',
      details: { pdu_id: pduId },
    })
    .select('id')
    .single();
  
  if (error) throw error;
  return job.id;
}

/**
 * Create a PDU outlet control job (fallback when instant API unavailable)
 */
async function createPduOutletJob(
  pduId: string,
  outletNumbers: number[],
  action: OutletAction
): Promise<string> {
  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      // Cast to any since PDU job types are handled by executor but may not be in enum
      job_type: 'pdu_outlet_control' as any,
      status: 'pending',
      details: {
        pdu_id: pduId,
        outlet_numbers: outletNumbers,
        action,
      },
    })
    .select('id')
    .single();
  
  if (error) throw error;
  return job.id;
}

/**
 * Control server power via PDU mappings
 */
export async function controlServerPduPower(
  serverId: string,
  action: OutletAction,
  feedLabel?: 'A' | 'B'
): Promise<Array<PduOutletControlResponse | string>> {
  // Get server PDU mappings
  const { data: mappings, error: mappingsError } = await supabase
    .from('server_pdu_mappings')
    .select('pdu_id, outlet_number, feed_label')
    .eq('server_id', serverId);
  
  if (mappingsError) throw mappingsError;
  if (!mappings || mappings.length === 0) {
    throw new Error('No PDU mappings found for this server');
  }

  // Filter by feed label if specified
  const targetMappings = feedLabel 
    ? mappings.filter(m => m.feed_label === feedLabel)
    : mappings;

  if (targetMappings.length === 0) {
    throw new Error(`No PDU mappings found for feed ${feedLabel}`);
  }

  // Group by PDU
  const pduOutlets = new Map<string, number[]>();
  for (const mapping of targetMappings) {
    const outlets = pduOutlets.get(mapping.pdu_id) || [];
    outlets.push(mapping.outlet_number);
    pduOutlets.set(mapping.pdu_id, outlets);
  }

  // Control outlets for each PDU
  const results: Array<PduOutletControlResponse | string> = [];
  for (const [pduId, outletNumbers] of pduOutlets) {
    const result = await controlPduOutlet(pduId, outletNumbers, action);
    results.push(result);
  }

  return results;
}
