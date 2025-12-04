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

export type InternalJobType = typeof INTERNAL_JOB_TYPES[number];
