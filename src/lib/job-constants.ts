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
  'scheduled_vcenter_sync', // Deprecated - replaced by pg_cron trigger-vcenter-syncs
  'idrac_network_read',  // Quick silent operation - should not show in notifications
  'idrac_network_write', // Quick silent operation - should not show in notifications
] as const;

// Scheduled background job types - shown in Background Task Manager, not Active Jobs popover
// These are recurring/scheduled jobs that run automatically
// Note: scheduled_vcenter_sync removed - replaced by pg_cron trigger-vcenter-syncs
export const SCHEDULED_BACKGROUND_JOB_TYPES = [
  'scheduled_replication_check',
  'rpo_monitoring',
] as const;

// SLA monitoring job types - hidden by default but can be shown via settings
// This is a subset of SCHEDULED_BACKGROUND_JOB_TYPES for backwards compatibility
export const SLA_MONITORING_JOB_TYPES = [
  'scheduled_replication_check',
  'rpo_monitoring',
] as const;

export type ScheduledBackgroundJobType = typeof SCHEDULED_BACKGROUND_JOB_TYPES[number];
export type SlaMonitoringJobType = typeof SLA_MONITORING_JOB_TYPES[number];
export type InternalJobType = typeof INTERNAL_JOB_TYPES[number];

/**
 * Check if a job type is a scheduled background job
 */
export function isScheduledBackgroundJob(jobType: string): boolean {
  return SCHEDULED_BACKGROUND_JOB_TYPES.includes(jobType as ScheduledBackgroundJobType);
}

/**
 * Check if a job type is an SLA monitoring job
 */
export function isSlaMonitoringJob(jobType: string): boolean {
  return SLA_MONITORING_JOB_TYPES.includes(jobType as SlaMonitoringJobType);
}
