/**
 * Host Priority Calculator
 * Calculates optimal host update order based on maintenance blockers
 */

export interface HostBlockerSummary {
  hasVCSA: boolean;
  hasUSBPassthrough: boolean;
  hasPCIPassthrough: boolean;
  hasLocalStorage: boolean;
  hasAffinity: boolean;
  hasFaultTolerance: boolean;
  hasVGPU: boolean;
  hasCriticalInfra: boolean;
  powerOffRequired: number;
  acknowledgedBlockers: number;
}

export interface HostPriorityScore {
  hostId: string;
  hostName: string;
  priority: number; // Lower = update first
  reasons: string[];
  blockerSummary: HostBlockerSummary;
  canProceed: boolean;
  requiresUserAction: boolean;
}

export interface MaintenanceBlocker {
  vm_name: string;
  vm_id: string;
  reason: string;
  severity: 'critical' | 'warning';
  details: string;
  remediation: string;
  auto_fixable: boolean;
}

export interface HostBlockerAnalysis {
  host_id: string;
  host_name: string;
  can_enter_maintenance: boolean;
  blockers: MaintenanceBlocker[];
  warnings: string[];
  total_powered_on_vms: number;
  migratable_vms: number;
  blocked_vms: number;
  estimated_evacuation_time: number;
}

/**
 * Priority scoring constants
 * Lower score = higher priority (update first)
 */
const PRIORITY_SCORES = {
  NO_BLOCKERS: 10,           // Update first - clean hosts
  AUTO_FIXABLE_ONLY: 30,     // Minor issues that can be auto-fixed
  POWER_OFF_ELIGIBLE: 50,    // VMs that user agreed to power off
  ACKNOWLEDGED_BLOCKERS: 70, // User acknowledged but didn't resolve
  CRITICAL_INFRA: 90,        // NSX, vROps, etc.
  VCSA_HOST: 100,            // Always update last
};

/**
 * Calculate priority scores for all hosts
 */
export function calculateHostPriorities(
  hostBlockers: Record<string, HostBlockerAnalysis>,
  resolutions?: Record<string, { vms_to_power_off: string[]; vms_acknowledged: string[]; skip_host: boolean }>
): HostPriorityScore[] {
  const scores: HostPriorityScore[] = [];

  for (const [hostId, analysis] of Object.entries(hostBlockers)) {
    const resolution = resolutions?.[hostId];
    const score = calculateSingleHostPriority(analysis, resolution);
    scores.push(score);
  }

  // Sort by priority (ascending - lower = update first)
  return scores.sort((a, b) => a.priority - b.priority);
}

/**
 * Calculate priority for a single host
 */
export function calculateSingleHostPriority(
  analysis: HostBlockerAnalysis,
  resolution?: { vms_to_power_off: string[]; vms_acknowledged: string[]; skip_host: boolean }
): HostPriorityScore {
  const blockerSummary: HostBlockerSummary = {
    hasVCSA: false,
    hasUSBPassthrough: false,
    hasPCIPassthrough: false,
    hasLocalStorage: false,
    hasAffinity: false,
    hasFaultTolerance: false,
    hasVGPU: false,
    hasCriticalInfra: false,
    powerOffRequired: 0,
    acknowledgedBlockers: 0,
  };

  const reasons: string[] = [];
  let priority = PRIORITY_SCORES.NO_BLOCKERS;
  let canProceed = analysis.can_enter_maintenance;
  let requiresUserAction = false;

  // Analyze each blocker
  for (const blocker of analysis.blockers) {
    const vmId = blocker.vm_id;
    const isResolved = resolution?.vms_to_power_off?.includes(vmId) || 
                       resolution?.vms_acknowledged?.includes(vmId);

    switch (blocker.reason) {
      case 'vcsa':
        blockerSummary.hasVCSA = true;
        priority = Math.max(priority, PRIORITY_SCORES.VCSA_HOST);
        reasons.push('VCSA host - update last');
        break;

      case 'passthrough':
        if (blocker.details?.toLowerCase().includes('usb')) {
          blockerSummary.hasUSBPassthrough = true;
        } else {
          blockerSummary.hasPCIPassthrough = true;
        }
        if (isResolved) {
          blockerSummary.powerOffRequired++;
          priority = Math.max(priority, PRIORITY_SCORES.POWER_OFF_ELIGIBLE);
          reasons.push(`${blocker.vm_name}: will power off`);
          canProceed = true;
        } else {
          requiresUserAction = true;
          reasons.push(`${blocker.vm_name}: passthrough device blocks migration`);
        }
        break;

      case 'local_storage':
        blockerSummary.hasLocalStorage = true;
        if (isResolved) {
          blockerSummary.powerOffRequired++;
          priority = Math.max(priority, PRIORITY_SCORES.POWER_OFF_ELIGIBLE);
          reasons.push(`${blocker.vm_name}: will power off (local storage)`);
          canProceed = true;
        } else {
          requiresUserAction = true;
          reasons.push(`${blocker.vm_name}: local storage blocks migration`);
        }
        break;

      case 'fault_tolerance':
        blockerSummary.hasFaultTolerance = true;
        if (isResolved) {
          blockerSummary.acknowledgedBlockers++;
          priority = Math.max(priority, PRIORITY_SCORES.ACKNOWLEDGED_BLOCKERS);
          reasons.push(`${blocker.vm_name}: FT acknowledged`);
        } else {
          requiresUserAction = true;
          reasons.push(`${blocker.vm_name}: Fault Tolerance enabled`);
        }
        break;

      case 'vgpu':
        blockerSummary.hasVGPU = true;
        if (isResolved) {
          blockerSummary.powerOffRequired++;
          priority = Math.max(priority, PRIORITY_SCORES.POWER_OFF_ELIGIBLE);
          reasons.push(`${blocker.vm_name}: will power off (vGPU)`);
          canProceed = true;
        } else {
          requiresUserAction = true;
          reasons.push(`${blocker.vm_name}: vGPU attached`);
        }
        break;

      case 'affinity':
        blockerSummary.hasAffinity = true;
        if (isResolved) {
          blockerSummary.acknowledgedBlockers++;
          priority = Math.max(priority, PRIORITY_SCORES.ACKNOWLEDGED_BLOCKERS);
          reasons.push(`${blocker.vm_name}: affinity acknowledged`);
        } else {
          reasons.push(`${blocker.vm_name}: has affinity rules`);
        }
        break;

      case 'critical_infra':
        blockerSummary.hasCriticalInfra = true;
        priority = Math.max(priority, PRIORITY_SCORES.CRITICAL_INFRA);
        reasons.push(`${blocker.vm_name}: critical infrastructure`);
        break;

      case 'connected_media':
        if (blocker.auto_fixable) {
          priority = Math.max(priority, PRIORITY_SCORES.AUTO_FIXABLE_ONLY);
          reasons.push(`${blocker.vm_name}: connected media (auto-fixable)`);
        }
        break;
    }
  }

  // If no blockers, this is a clean host
  if (analysis.blockers.length === 0) {
    reasons.push('No blockers - can update immediately');
  }

  // If host is skipped
  if (resolution?.skip_host) {
    priority = 999; // Effectively remove from update order
    reasons.push('Host skipped by user');
    canProceed = false;
  }

  return {
    hostId: analysis.host_id,
    hostName: analysis.host_name,
    priority,
    reasons,
    blockerSummary,
    canProceed,
    requiresUserAction,
  };
}

/**
 * Get recommended host update order
 */
export function getRecommendedUpdateOrder(
  hostBlockers: Record<string, HostBlockerAnalysis>,
  resolutions?: Record<string, { vms_to_power_off: string[]; vms_acknowledged: string[]; skip_host: boolean }>
): string[] {
  const priorities = calculateHostPriorities(hostBlockers, resolutions);
  return priorities
    .filter(p => p.priority < 999) // Exclude skipped hosts
    .map(p => p.hostId);
}

/**
 * Get summary of all blockers across hosts
 */
export function getBlockersSummary(hostBlockers: Record<string, HostBlockerAnalysis>): {
  totalHosts: number;
  hostsWithBlockers: number;
  cleanHosts: number;
  criticalBlockers: number;
  warningBlockers: number;
  vcsaHost: string | null;
  blockerTypes: Record<string, number>;
} {
  const summary = {
    totalHosts: 0,
    hostsWithBlockers: 0,
    cleanHosts: 0,
    criticalBlockers: 0,
    warningBlockers: 0,
    vcsaHost: null as string | null,
    blockerTypes: {} as Record<string, number>,
  };

  for (const [hostId, analysis] of Object.entries(hostBlockers)) {
    summary.totalHosts++;

    if (analysis.blockers.length === 0) {
      summary.cleanHosts++;
    } else {
      summary.hostsWithBlockers++;

      for (const blocker of analysis.blockers) {
        if (blocker.severity === 'critical') {
          summary.criticalBlockers++;
        } else {
          summary.warningBlockers++;
        }

        summary.blockerTypes[blocker.reason] = (summary.blockerTypes[blocker.reason] || 0) + 1;

        if (blocker.reason === 'vcsa') {
          summary.vcsaHost = hostId;
        }
      }
    }
  }

  return summary;
}
