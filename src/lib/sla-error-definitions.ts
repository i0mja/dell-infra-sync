// SLA Error Definitions - Comprehensive error sheet for SLA diagnostics

export type ErrorSeverity = 'critical' | 'warning' | 'info';
export type ErrorCategory = 'configuration' | 'infrastructure' | 'connectivity' | 'data' | 'operational';

export interface SLAErrorDefinition {
  code: string;
  title: string;
  description: string;
  impact: string;
  howToFix: string[];
  severity: ErrorSeverity;
  category: ErrorCategory;
  quickActionLabel?: string;
  quickActionRoute?: string;
}

export const SLA_ERROR_DEFINITIONS: Record<string, SLAErrorDefinition> = {
  // ============================================
  // CONFIGURATION ISSUES (5)
  // ============================================
  NO_TARGET_CONFIGURED: {
    code: 'NO_TARGET_CONFIGURED',
    title: 'No ZFS Target Configured',
    description: 'This protection group has no storage target assigned. Without a target, replication cannot run.',
    impact: 'Replication is completely blocked. No data is being protected.',
    howToFix: [
      'Navigate to the ZFS Infrastructure tab',
      'Deploy a new paired ZFS target or select an existing one',
      'Edit this protection group and assign the target',
    ],
    severity: 'critical',
    category: 'configuration',
    quickActionLabel: 'Configure Target',
    quickActionRoute: '/vcenter?tab=zfs-infrastructure',
  },

  NO_SCHEDULE_CONFIGURED: {
    code: 'NO_SCHEDULE_CONFIGURED',
    title: 'No Replication Schedule',
    description: 'No replication schedule is configured. Automatic syncs will not run.',
    impact: 'Data protection relies on manual syncs only, risking extended RPO gaps.',
    howToFix: [
      'Edit this protection group',
      'Set a replication schedule (e.g., "Every 15 minutes")',
      'Save the configuration',
    ],
    severity: 'critical',
    category: 'configuration',
    quickActionLabel: 'Set Schedule',
  },

  NO_VMS_IN_GROUP: {
    code: 'NO_VMS_IN_GROUP',
    title: 'No VMs in Protection Group',
    description: 'This protection group has no virtual machines added.',
    impact: 'Nothing is being protected by this group.',
    howToFix: [
      'Edit this protection group',
      'Add VMs that need DR protection',
      'Ensure VMs are on a datastore accessible by the ZFS target',
    ],
    severity: 'warning',
    category: 'configuration',
    quickActionLabel: 'Add VMs',
  },

  MISMATCHED_DATASTORES: {
    code: 'MISMATCHED_DATASTORES',
    title: 'Datastore Mismatch',
    description: 'Some VMs are on different datastores than the protection group\'s configured datastore.',
    impact: 'These VMs may not be replicated correctly or at all.',
    howToFix: [
      'Review which VMs are on which datastores',
      'Either migrate VMs to the protected datastore',
      'Or update the protection group configuration',
    ],
    severity: 'warning',
    category: 'configuration',
  },

  INVALID_SCHEDULE_FORMAT: {
    code: 'INVALID_SCHEDULE_FORMAT',
    title: 'Invalid Schedule Format',
    description: 'The replication schedule couldn\'t be parsed. Automatic syncs won\'t run.',
    impact: 'Scheduled replication is broken until the format is corrected.',
    howToFix: [
      'Edit the protection group',
      'Use a valid schedule format (e.g., "*/15 * * * *" or "every 15 minutes")',
      'Save and verify the schedule is recognized',
    ],
    severity: 'critical',
    category: 'configuration',
  },

  // ============================================
  // INFRASTRUCTURE ISSUES (5)
  // ============================================
  NFS_DATASTORE_NOT_MOUNTED: {
    code: 'NFS_DATASTORE_NOT_MOUNTED',
    title: 'NFS Datastore Not Mounted',
    description: 'The NFS datastore from the ZFS target is not accessible on the ESXi hosts.',
    impact: 'VMs cannot be replicated to or restored from this target.',
    howToFix: [
      'Check that the ZFS appliance is online and healthy',
      'Verify NFS exports are configured correctly on the ZFS target',
      'Rescan datastores in vCenter to mount the NFS share',
      'Check network connectivity between ESXi hosts and ZFS target',
    ],
    severity: 'critical',
    category: 'infrastructure',
    quickActionLabel: 'Check Target Health',
  },

  ZFS_POOL_OFFLINE: {
    code: 'ZFS_POOL_OFFLINE',
    title: 'ZFS Pool Degraded or Offline',
    description: 'The ZFS storage pool is not healthy. This could indicate disk failures.',
    impact: 'Replication may fail or data may be at risk.',
    howToFix: [
      'SSH into the ZFS appliance',
      'Run "zpool status" to check pool health',
      'Replace any failed disks',
      'Run "zpool scrub" if needed',
    ],
    severity: 'critical',
    category: 'infrastructure',
  },

  DR_SITE_TARGET_MISSING: {
    code: 'DR_SITE_TARGET_MISSING',
    title: 'No DR Site Target Paired',
    description: 'The primary ZFS target doesn\'t have a paired DR site target for replication.',
    impact: 'Data is only stored locally. No off-site DR capability.',
    howToFix: [
      'Deploy a ZFS target at the DR site',
      'Pair the primary and DR targets',
      'Configure SSH trust between the targets',
    ],
    severity: 'warning',
    category: 'infrastructure',
    quickActionLabel: 'Deploy DR Target',
  },

  TEMPLATE_VM_NOT_PREPARED: {
    code: 'TEMPLATE_VM_NOT_PREPARED',
    title: 'ZFS Template Not Prepared',
    description: 'The ZFS appliance template VM hasn\'t been prepared in vCenter.',
    impact: 'Cannot deploy new ZFS targets automatically.',
    howToFix: [
      'Upload the ZFS appliance OVA template to vCenter',
      'Configure the template with required settings',
      'Mark it as a template in the inventory',
    ],
    severity: 'info',
    category: 'infrastructure',
  },

  DR_SHELL_VM_MISSING: {
    code: 'DR_SHELL_VM_MISSING',
    title: 'DR Shell VMs Not Created',
    description: 'One or more protected VMs don\'t have DR shell VMs created at the recovery site.',
    impact: 'Failover will take longer as shells need to be created during recovery.',
    howToFix: [
      'Run "Create DR Shell VMs" for this protection group',
      'Verify the shells are created in the DR vCenter',
      'Check that the DR datastore has enough space',
    ],
    severity: 'warning',
    category: 'infrastructure',
    quickActionLabel: 'Create DR Shells',
  },

  // ============================================
  // CONNECTIVITY ISSUES (5)
  // ============================================
  SSH_CONNECTION_FAILED: {
    code: 'SSH_CONNECTION_FAILED',
    title: 'SSH Connection Failed',
    description: 'Cannot establish SSH connection to the ZFS appliance.',
    impact: 'Replication commands cannot be executed.',
    howToFix: [
      'Verify the ZFS appliance is powered on and accessible',
      'Check SSH service is running on the appliance',
      'Verify firewall rules allow SSH (port 22)',
      'Test connectivity: ssh root@<appliance-ip>',
    ],
    severity: 'critical',
    category: 'connectivity',
    quickActionLabel: 'Test Connection',
  },

  SSH_TRUST_NOT_ESTABLISHED: {
    code: 'SSH_TRUST_NOT_ESTABLISHED',
    title: 'SSH Trust Not Established',
    description: 'SSH keys haven\'t been exchanged between paired ZFS targets.',
    impact: 'ZFS send/receive between sites will fail.',
    howToFix: [
      'Generate SSH keys on both ZFS appliances if not done',
      'Copy the public key from primary to DR target',
      'Copy the public key from DR to primary target',
      'Test passwordless SSH between the appliances',
    ],
    severity: 'critical',
    category: 'connectivity',
    quickActionLabel: 'Configure SSH Trust',
  },

  TARGET_UNREACHABLE: {
    code: 'TARGET_UNREACHABLE',
    title: 'ZFS Target Unreachable',
    description: 'The ZFS target hostname or IP doesn\'t respond to network requests.',
    impact: 'All replication operations to this target will fail.',
    howToFix: [
      'Check if the ZFS appliance VM is powered on',
      'Verify network connectivity to the target IP',
      'Check for network segmentation or firewall issues',
      'Try pinging the target from the Job Executor host',
    ],
    severity: 'critical',
    category: 'connectivity',
  },

  VCENTER_DISCONNECTED: {
    code: 'VCENTER_DISCONNECTED',
    title: 'vCenter Connection Lost',
    description: 'Cannot connect to the vCenter server managing this environment.',
    impact: 'VM discovery, snapshots, and storage operations will fail.',
    howToFix: [
      'Verify vCenter is online and accessible',
      'Check vCenter credentials haven\'t expired',
      'Test connectivity to vCenter from the management network',
      'Review vCenter logs for service issues',
    ],
    severity: 'critical',
    category: 'connectivity',
  },

  ESXI_HOST_DISCONNECTED: {
    code: 'ESXI_HOST_DISCONNECTED',
    title: 'ESXi Hosts Not Responding',
    description: 'One or more ESXi hosts in the cluster are disconnected.',
    impact: 'VMs on affected hosts cannot be protected.',
    howToFix: [
      'Check ESXi host status in vCenter',
      'Verify network connectivity to the hosts',
      'Review host logs for hardware or software issues',
      'Reconnect hosts in vCenter if needed',
    ],
    severity: 'warning',
    category: 'connectivity',
  },

  // ============================================
  // DATA ISSUES (5)
  // ============================================
  NEVER_SYNCED: {
    code: 'NEVER_SYNCED',
    title: 'Never Successfully Synced',
    description: 'This protection group has never had a successful replication sync.',
    impact: 'No recovery point exists. VMs are not protected.',
    howToFix: [
      'Verify all configuration is complete (target, schedule, VMs)',
      'Run a manual sync to test the configuration',
      'Check job logs for any errors',
      'Ensure sufficient storage space on the target',
    ],
    severity: 'critical',
    category: 'data',
    quickActionLabel: 'Run Manual Sync',
  },

  LAST_SYNC_TOO_OLD: {
    code: 'LAST_SYNC_TOO_OLD',
    title: 'Last Sync Too Old',
    description: 'The last successful sync exceeds the configured RPO threshold.',
    impact: 'Recovery would result in significant data loss.',
    howToFix: [
      'Check if scheduled syncs are running',
      'Review recent job failures for errors',
      'Run a manual sync to catch up',
      'Investigate and resolve any blocking issues',
    ],
    severity: 'critical',
    category: 'data',
    quickActionLabel: 'Run Manual Sync',
  },

  SNAPSHOT_CHAIN_BROKEN: {
    code: 'SNAPSHOT_CHAIN_BROKEN',
    title: 'Snapshot Chain Broken',
    description: 'The ZFS snapshot chain is corrupted or incomplete.',
    impact: 'Incremental syncs will fail. Full sync required.',
    howToFix: [
      'Review ZFS snapshot status on both sites',
      'Delete orphaned snapshots if safe',
      'Run a full (non-incremental) sync',
      'Monitor subsequent incremental syncs',
    ],
    severity: 'warning',
    category: 'data',
  },

  INSUFFICIENT_STORAGE: {
    code: 'INSUFFICIENT_STORAGE',
    title: 'Insufficient Storage Space',
    description: 'The ZFS target is running low on storage space.',
    impact: 'New syncs may fail when space runs out.',
    howToFix: [
      'Review current storage usage on the ZFS pool',
      'Delete old snapshots according to retention policy',
      'Add more storage to the ZFS pool if needed',
      'Consider adjusting snapshot retention settings',
    ],
    severity: 'warning',
    category: 'data',
  },

  REPLICATION_LAG_HIGH: {
    code: 'REPLICATION_LAG_HIGH',
    title: 'High Replication Lag',
    description: 'Data transfer between sites is slower than expected.',
    impact: 'RPO may be at risk during high-change periods.',
    howToFix: [
      'Check network bandwidth between sites',
      'Review if large VMs are causing bottlenecks',
      'Consider enabling compression for transfers',
      'Evaluate network infrastructure capacity',
    ],
    severity: 'warning',
    category: 'data',
  },

  // ============================================
  // OPERATIONAL ISSUES (5)
  // ============================================
  GROUP_PAUSED: {
    code: 'GROUP_PAUSED',
    title: 'Protection Group Paused',
    description: 'This protection group has been manually paused.',
    impact: 'No automatic syncs will run until resumed.',
    howToFix: [
      'Review why the group was paused',
      'Resolve any underlying issues',
      'Resume the protection group',
    ],
    severity: 'warning',
    category: 'operational',
    quickActionLabel: 'Resume Group',
  },

  SYNC_STUCK_IN_PROGRESS: {
    code: 'SYNC_STUCK_IN_PROGRESS',
    title: 'Sync Stuck In Progress',
    description: 'A sync job has been running for an unusually long time.',
    impact: 'New syncs are blocked. RPO may exceed targets.',
    howToFix: [
      'Check the job logs for the stuck sync',
      'Verify network connectivity and ZFS target health',
      'Cancel the stuck job if necessary',
      'Run a new sync after resolving issues',
    ],
    severity: 'warning',
    category: 'operational',
  },

  FAILOVER_TEST_OVERDUE: {
    code: 'FAILOVER_TEST_OVERDUE',
    title: 'Failover Test Overdue',
    description: 'It\'s been too long since the last failover test was performed.',
    impact: 'DR readiness is unverified. Issues may go undetected.',
    howToFix: [
      'Schedule a non-disruptive failover test',
      'Execute the test during a maintenance window',
      'Document results and any issues found',
      'Update the test schedule if needed',
    ],
    severity: 'warning',
    category: 'operational',
    quickActionLabel: 'Schedule Test',
  },

  JOB_EXECUTOR_OFFLINE: {
    code: 'JOB_EXECUTOR_OFFLINE',
    title: 'Job Executor Offline',
    description: 'The Job Executor service hasn\'t been seen recently.',
    impact: 'No replication jobs will be processed.',
    howToFix: [
      'Check if the Job Executor Python script is running',
      'Review executor logs for errors',
      'Verify database connectivity from the executor host',
      'Restart the executor if needed',
    ],
    severity: 'critical',
    category: 'operational',
  },

  CONCURRENT_SYNC_LIMIT: {
    code: 'CONCURRENT_SYNC_LIMIT',
    title: 'Concurrent Sync Limit Reached',
    description: 'Maximum number of concurrent syncs has been reached.',
    impact: 'New syncs are queued and may be delayed.',
    howToFix: [
      'Wait for current syncs to complete',
      'Review if sync schedules need to be staggered',
      'Consider increasing the concurrency limit if resources allow',
    ],
    severity: 'info',
    category: 'operational',
  },
};

// Helper to get error by code
export function getErrorDefinition(code: string): SLAErrorDefinition | undefined {
  return SLA_ERROR_DEFINITIONS[code];
}

// Get all errors by category
export function getErrorsByCategory(category: ErrorCategory): SLAErrorDefinition[] {
  return Object.values(SLA_ERROR_DEFINITIONS).filter(e => e.category === category);
}

// Get all errors by severity
export function getErrorsBySeverity(severity: ErrorSeverity): SLAErrorDefinition[] {
  return Object.values(SLA_ERROR_DEFINITIONS).filter(e => e.severity === severity);
}
