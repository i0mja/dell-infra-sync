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
}

export interface HostBlockerAnalysis {
  host_id?: string;
  host_name?: string;
  blockers?: MaintenanceBlocker[];
}

type ResolutionEntry = {
  vm_id: string;
  vm_name: string;
  reason?: string;
  details?: string;
};

export const buildMaintenanceBlockerResolutions = (
  resolutions: Record<string, HostResolutionSelection>,
  hostBlockers: Record<string, HostBlockerAnalysis>
) => {
  const payload: Record<string, {
    host_id: string;
    host_name: string;
    vms_to_power_off: ResolutionEntry[];
    vms_acknowledged: ResolutionEntry[];
    skip_host: boolean;
  }> = {};

  Object.entries(resolutions).forEach(([hostId, selection]) => {
    const analysis = hostBlockers[hostId];
    const blockers = analysis?.blockers ?? [];

    const mapVm = (vmId: string): ResolutionEntry => {
      const blocker = blockers.find((item) => item.vm_id === vmId);
      return {
        vm_id: vmId,
        vm_name: blocker?.vm_name ?? vmId,
        reason: blocker?.reason,
        details: blocker?.details
      };
    };

    payload[hostId] = {
      host_id: analysis?.host_id ?? hostId,
      host_name: analysis?.host_name ?? hostId,
      vms_to_power_off: (selection.vms_to_power_off ?? []).map(mapVm),
      vms_acknowledged: (selection.vms_acknowledged ?? []).map(mapVm),
      skip_host: selection.skip_host ?? false
    };
  });

  return payload;
};
