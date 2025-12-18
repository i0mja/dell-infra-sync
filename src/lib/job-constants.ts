// Internal job types that should not appear in Activity Monitor or dashboard counts
// These are background/system jobs that users don't need to see
export const INTERNAL_JOB_TYPES = [
  'idm_authenticate',
  'idm_test_auth',
  'idm_test_connection',
  'idm_network_check',
  'idm_test_ad_connection',
  'idm_search_groups',
  'idm_search_ad_groups',
  'idm_search_ad_users',
  'idm_sync_users',
] as const;

// SLA monitoring job types - hidden by default but can be shown via settings
export const SLA_MONITORING_JOB_TYPES = [
  'scheduled_replication_check',
  'rpo_monitoring',
] as const;

export type SlaMonitoringJobType = typeof SLA_MONITORING_JOB_TYPES[number];

export type InternalJobType = typeof INTERNAL_JOB_TYPES[number];

/**
 * Check if a job type is an SLA monitoring job
 */
export function isSlaMonitoringJob(jobType: string): boolean {
  return SLA_MONITORING_JOB_TYPES.includes(jobType as SlaMonitoringJobType);
}
