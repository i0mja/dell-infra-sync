export interface HostResolutionSelection {
  vms_to_power_off: string[];
  vms_acknowledged: string[];
  skip_host: boolean;
}

export interface MaintenanceBlocker {
  vm_id: string;
  vm_name: string;
  reason?: string;
  details?: string;
  severity?: string;
  remediation?: string;
}

export interface HostBlockerAnalysis {
  host_id?: string;
  host_name?: string;
  server_id?: string;
  blockers?: MaintenanceBlocker[];
}

type ResolutionEntry = {
  vm_id: string;
  vm_name: string;
  reason?: string;
  details?: string;
  severity?: string;
  remediation?: string;
};

export interface HostResolutionPayload {
  host_id: string;
  host_name: string;
  server_id?: string;
  vms_to_power_off: ResolutionEntry[];
  vms_acknowledged: ResolutionEntry[];
  skip_host: boolean;
}

/**
 * Build maintenance blocker resolutions payload for the job executor.
 * Stores resolutions under MULTIPLE keys for reliable lookup:
 * - hostId (vcenter_host_id)
 * - host_name
 * - server_id (if available)
 * 
 * This ensures the executor can find resolutions regardless of which key it uses.
 */
export const buildMaintenanceBlockerResolutions = (
  resolutions: Record<string, HostResolutionSelection>,
  hostBlockers: Record<string, HostBlockerAnalysis>
): Record<string, HostResolutionPayload> => {
  const payload: Record<string, HostResolutionPayload> = {};

  Object.entries(resolutions).forEach(([hostId, selection]) => {
    const analysis = hostBlockers[hostId];
    const blockers = analysis?.blockers ?? [];

    const mapVm = (vmId: string): ResolutionEntry => {
      const blocker = blockers.find((item) => item.vm_id === vmId);
      return {
        vm_id: vmId,
        vm_name: blocker?.vm_name ?? vmId,
        reason: blocker?.reason,
        details: blocker?.details,
        severity: blocker?.severity,
        remediation: blocker?.remediation
      };
    };

    const resolutionData: HostResolutionPayload = {
      host_id: analysis?.host_id ?? hostId,
      host_name: analysis?.host_name ?? hostId,
      server_id: analysis?.server_id,
      vms_to_power_off: (selection.vms_to_power_off ?? []).map(mapVm),
      vms_acknowledged: (selection.vms_acknowledged ?? []).map(mapVm),
      skip_host: selection.skip_host ?? false
    };

    // Store under primary key (hostId / vcenter_host_id)
    payload[hostId] = resolutionData;

    // Also store under host_name for alternative lookup
    if (analysis?.host_name && analysis.host_name !== hostId) {
      payload[analysis.host_name] = resolutionData;
    }

    // Also store under server_id for alternative lookup
    if (analysis?.server_id && analysis.server_id !== hostId) {
      payload[analysis.server_id] = resolutionData;
    }
  });

  return payload;
};
