// SLA Diagnostics Analyzer - Detects issues based on protection group state

import { SLA_ERROR_DEFINITIONS, SLAErrorDefinition } from './sla-error-definitions';

export interface DiagnosticResult {
  errorCode: string;
  definition: SLAErrorDefinition;
  detected: boolean;
  context: Record<string, any>;
}

export interface ProtectionGroupData {
  id: string;
  name: string;
  target_id: string | null;
  replication_schedule: string | null;
  last_replication_at: string | null;
  rpo_minutes: number | null;
  current_rpo_seconds: number | null;
  is_enabled: boolean | null;
  paused_at: string | null;
  pause_reason: string | null;
  status: string | null;
  sync_in_progress: boolean | null;
  last_test_at: string | null;
  test_reminder_days: number | null;
}

export interface ReplicationTarget {
  id: string;
  name: string;
  hostname: string;
  health_status: string | null;
  ssh_trust_established: boolean | null;
  partner_target_id: string | null;
  site_role: string | null;
  datastore_name: string | null;
}

export interface ProtectedVM {
  id: string;
  vm_name: string;
  dr_shell_vm_created: boolean | null;
  replication_status: string | null;
  failover_ready: boolean | null;
}

export interface ReplicationJob {
  id: string;
  job_type: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  details: Record<string, any> | null;
}

// Error patterns to match from job failure messages
const JOB_ERROR_PATTERNS: Array<{ pattern: RegExp; errorCode: string }> = [
  { pattern: /Cannot connect to Site B.*check SSH/i, errorCode: 'SSH_CONNECTION_FAILED' },
  { pattern: /SSH connection (failed|refused|timeout)/i, errorCode: 'SSH_CONNECTION_FAILED' },
  { pattern: /Datastore not found/i, errorCode: 'NFS_DATASTORE_NOT_MOUNTED' },
  { pattern: /NFS.*not (mounted|accessible)/i, errorCode: 'NFS_DATASTORE_NOT_MOUNTED' },
  { pattern: /Permission denied.*publickey/i, errorCode: 'SSH_TRUST_NOT_ESTABLISHED' },
  { pattern: /Host key verification failed/i, errorCode: 'SSH_TRUST_NOT_ESTABLISHED' },
  { pattern: /cannot receive.*dataset/i, errorCode: 'SNAPSHOT_CHAIN_BROKEN' },
  { pattern: /no space left/i, errorCode: 'INSUFFICIENT_STORAGE' },
  { pattern: /pool.*degraded|pool.*offline/i, errorCode: 'ZFS_POOL_OFFLINE' },
  { pattern: /vCenter.*connection.*failed/i, errorCode: 'VCENTER_DISCONNECTED' },
  { pattern: /host.*disconnected|host.*not responding/i, errorCode: 'ESXI_HOST_DISCONNECTED' },
  { pattern: /Connection timed out|Connection refused/i, errorCode: 'TARGET_UNREACHABLE' },
];

/**
 * Analyze a protection group and return all detected issues
 */
export function analyzeProtectionGroup(
  group: ProtectionGroupData,
  target: ReplicationTarget | null,
  partnerTarget: ReplicationTarget | null,
  vms: ProtectedVM[],
  recentJobs: ReplicationJob[]
): DiagnosticResult[] {
  const results: DiagnosticResult[] = [];

  // ============================================
  // CONFIGURATION CHECKS
  // ============================================

  // Check: No target configured
  if (!group.target_id || !target) {
    results.push({
      errorCode: 'NO_TARGET_CONFIGURED',
      definition: SLA_ERROR_DEFINITIONS.NO_TARGET_CONFIGURED,
      detected: true,
      context: { groupName: group.name },
    });
  }

  // Check: No schedule configured
  if (!group.replication_schedule) {
    results.push({
      errorCode: 'NO_SCHEDULE_CONFIGURED',
      definition: SLA_ERROR_DEFINITIONS.NO_SCHEDULE_CONFIGURED,
      detected: true,
      context: { groupName: group.name },
    });
  }

  // Check: No VMs in group
  if (vms.length === 0) {
    results.push({
      errorCode: 'NO_VMS_IN_GROUP',
      definition: SLA_ERROR_DEFINITIONS.NO_VMS_IN_GROUP,
      detected: true,
      context: { groupName: group.name },
    });
  }

  // ============================================
  // INFRASTRUCTURE CHECKS
  // ============================================

  // Check: Target health
  if (target && target.health_status && target.health_status !== 'healthy') {
    if (target.health_status === 'degraded' || target.health_status === 'error') {
      results.push({
        errorCode: 'ZFS_POOL_OFFLINE',
        definition: SLA_ERROR_DEFINITIONS.ZFS_POOL_OFFLINE,
        detected: true,
        context: { 
          targetName: target.name, 
          healthStatus: target.health_status,
        },
      });
    }
  }

  // Check: No DR site paired (if this is primary)
  if (target && target.site_role === 'primary' && !target.partner_target_id) {
    results.push({
      errorCode: 'DR_SITE_TARGET_MISSING',
      definition: SLA_ERROR_DEFINITIONS.DR_SITE_TARGET_MISSING,
      detected: true,
      context: { targetName: target.name },
    });
  }

  // Check: DR shell VMs not created
  const vmsWithoutShells = vms.filter(vm => !vm.dr_shell_vm_created);
  if (vmsWithoutShells.length > 0 && target) {
    results.push({
      errorCode: 'DR_SHELL_VM_MISSING',
      definition: SLA_ERROR_DEFINITIONS.DR_SHELL_VM_MISSING,
      detected: true,
      context: {
        count: vmsWithoutShells.length,
        total: vms.length,
        vmNames: vmsWithoutShells.slice(0, 3).map(v => v.vm_name),
      },
    });
  }

  // ============================================
  // CONNECTIVITY CHECKS
  // ============================================

  // Check: SSH trust not established
  if (target && target.ssh_trust_established === false) {
    results.push({
      errorCode: 'SSH_TRUST_NOT_ESTABLISHED',
      definition: SLA_ERROR_DEFINITIONS.SSH_TRUST_NOT_ESTABLISHED,
      detected: true,
      context: { targetName: target.name, hostname: target.hostname },
    });
  }

  // ============================================
  // DATA CHECKS
  // ============================================

  // Check: Never synced
  if (!group.last_replication_at && group.target_id) {
    results.push({
      errorCode: 'NEVER_SYNCED',
      definition: SLA_ERROR_DEFINITIONS.NEVER_SYNCED,
      detected: true,
      context: { groupName: group.name },
    });
  }

  // Check: Last sync too old (RPO breach)
  if (group.last_replication_at && group.rpo_minutes) {
    const lastSync = new Date(group.last_replication_at);
    const minutesSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60);
    if (minutesSinceSync > group.rpo_minutes) {
      results.push({
        errorCode: 'LAST_SYNC_TOO_OLD',
        definition: SLA_ERROR_DEFINITIONS.LAST_SYNC_TOO_OLD,
        detected: true,
        context: {
          currentRpoMinutes: Math.round(minutesSinceSync),
          targetRpoMinutes: group.rpo_minutes,
          overdueMinutes: Math.round(minutesSinceSync - group.rpo_minutes),
          lastSync: group.last_replication_at,
        },
      });
    }
  }

  // ============================================
  // OPERATIONAL CHECKS
  // ============================================

  // Check: Group paused
  if (group.paused_at) {
    results.push({
      errorCode: 'GROUP_PAUSED',
      definition: SLA_ERROR_DEFINITIONS.GROUP_PAUSED,
      detected: true,
      context: {
        pausedAt: group.paused_at,
        reason: group.pause_reason || 'No reason provided',
      },
    });
  }

  // Check: Sync stuck in progress
  if (group.sync_in_progress) {
    const runningJobs = recentJobs.filter(
      j => j.status === 'running' && j.job_type === 'run_replication_sync'
    );
    const oldestRunning = runningJobs[0];
    if (oldestRunning) {
      const runningMinutes = (Date.now() - new Date(oldestRunning.created_at).getTime()) / (1000 * 60);
      if (runningMinutes > 60) { // Stuck if running over an hour
        results.push({
          errorCode: 'SYNC_STUCK_IN_PROGRESS',
          definition: SLA_ERROR_DEFINITIONS.SYNC_STUCK_IN_PROGRESS,
          detected: true,
          context: {
            jobId: oldestRunning.id,
            runningMinutes: Math.round(runningMinutes),
          },
        });
      }
    }
  }

  // Check: Failover test overdue
  if (group.test_reminder_days) {
    const lastTest = group.last_test_at ? new Date(group.last_test_at) : null;
    const daysSinceTest = lastTest 
      ? (Date.now() - lastTest.getTime()) / (1000 * 60 * 60 * 24)
      : Infinity;
    
    if (daysSinceTest > group.test_reminder_days) {
      results.push({
        errorCode: 'FAILOVER_TEST_OVERDUE',
        definition: SLA_ERROR_DEFINITIONS.FAILOVER_TEST_OVERDUE,
        detected: true,
        context: {
          daysSinceTest: lastTest ? Math.round(daysSinceTest) : 'Never tested',
          reminderDays: group.test_reminder_days,
        },
      });
    }
  }

  // ============================================
  // JOB ERROR PATTERN MATCHING
  // ============================================
  const failedJobs = recentJobs.filter(j => j.status === 'failed');
  for (const job of failedJobs.slice(0, 5)) { // Check last 5 failed jobs
    const errorText = JSON.stringify(job.details || {});
    
    for (const { pattern, errorCode } of JOB_ERROR_PATTERNS) {
      if (pattern.test(errorText)) {
        // Only add if not already detected
        if (!results.find(r => r.errorCode === errorCode)) {
          const definition = SLA_ERROR_DEFINITIONS[errorCode];
          if (definition) {
            results.push({
              errorCode,
              definition,
              detected: true,
              context: {
                jobId: job.id,
                errorMessage: job.details?.error || job.details?.message,
                jobCreatedAt: job.created_at,
              },
            });
          }
        }
        break; // Only match first pattern per job
      }
    }
  }

  // Sort by severity: critical first, then warning, then info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  results.sort((a, b) => 
    severityOrder[a.definition.severity] - severityOrder[b.definition.severity]
  );

  return results;
}

/**
 * Calculate RPO status for display
 */
export function calculateRPOStatus(
  currentMinutes: number,
  targetMinutes: number
): { status: 'ok' | 'warning' | 'critical'; percentage: number; overdueMinutes: number } {
  const percentage = (currentMinutes / targetMinutes) * 100;
  const overdueMinutes = Math.max(0, currentMinutes - targetMinutes);

  if (percentage <= 100) {
    return { status: 'ok', percentage, overdueMinutes: 0 };
  } else if (percentage <= 150) {
    return { status: 'warning', percentage, overdueMinutes };
  } else {
    return { status: 'critical', percentage, overdueMinutes };
  }
}

/**
 * Format minutes to human readable duration
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  } else if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  } else {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
}
