import { supabase } from '@/integrations/supabase/client';
import type { OutletAction } from '@/types/pdu';

/**
 * Create a job to test PDU connection
 */
export async function testPduConnection(pduId: string): Promise<string> {
  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      job_type: 'pdu_test_connection',
      status: 'pending',
      details: { pdu_id: pduId },
    })
    .select('id')
    .single();
  
  if (error) throw error;
  return job.id;
}

/**
 * Create a job to discover PDU details
 */
export async function discoverPdu(pduId: string): Promise<string> {
  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      job_type: 'pdu_discover',
      status: 'pending',
      details: { pdu_id: pduId },
    })
    .select('id')
    .single();
  
  if (error) throw error;
  return job.id;
}

/**
 * Create a job to control PDU outlet
 */
export async function controlPduOutlet(
  pduId: string,
  outletNumbers: number[],
  action: OutletAction
): Promise<string> {
  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      job_type: 'pdu_outlet_control',
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
 * Create a job to sync PDU outlet status
 */
export async function syncPduStatus(pduId: string): Promise<string> {
  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      job_type: 'pdu_sync_status',
      status: 'pending',
      details: { pdu_id: pduId },
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
): Promise<string[]> {
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

  // Create jobs for each PDU
  const jobIds: string[] = [];
  for (const [pduId, outletNumbers] of pduOutlets) {
    const jobId = await controlPduOutlet(pduId, outletNumbers, action);
    jobIds.push(jobId);
  }

  return jobIds;
}
