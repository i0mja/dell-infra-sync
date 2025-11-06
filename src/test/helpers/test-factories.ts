import type { Database } from '@/integrations/supabase/types';

type Server = Database['public']['Tables']['servers']['Insert'];
type Job = Database['public']['Tables']['jobs']['Insert'];
type JobTask = Database['public']['Tables']['job_tasks']['Insert'];

/**
 * Factory function to create test server data
 */
export const createTestServer = (overrides?: Partial<Server>): Server => {
  const timestamp = Date.now();
  return {
    hostname: `test-server-${timestamp}`,
    ip_address: `192.168.1.${Math.floor(Math.random() * 254) + 1}`,
    model: 'PowerEdge R750',
    service_tag: `SVC${timestamp}`,
    connection_status: 'online',
    notes: 'Test server for integration tests',
    ...overrides,
  };
};

/**
 * Factory function to create test job data
 */
export const createTestJob = (
  userId: string,
  overrides?: Partial<Job>
): Job => {
  return {
    created_by: userId,
    job_type: 'firmware_update',
    status: 'pending',
    target_scope: {
      server_ids: [],
    },
    ...overrides,
  };
};

/**
 * Factory function to create test job task data
 */
export const createTestJobTask = (
  jobId: string,
  serverId: string,
  overrides?: Partial<JobTask>
): JobTask => {
  return {
    job_id: jobId,
    server_id: serverId,
    status: 'pending',
    ...overrides,
  };
};

/**
 * Generate random IP address for testing
 */
export const generateRandomIP = (): string => {
  return `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
};

/**
 * Generate random service tag
 */
export const generateServiceTag = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let tag = '';
  for (let i = 0; i < 7; i++) {
    tag += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return tag;
};
