import { getCurrentOperationMessage, calculateScanProgress } from "@/lib/firmware-scan-messages";
import { FirmwareScanProgressCard, type HostScanStatus } from "@/components/updates/FirmwareScanProgressCard";

interface FirmwareScanProgressProps {
  details: any;
  status: string;
  targetScope?: any;
}

export const FirmwareScanProgress = ({ details, status, targetScope }: FirmwareScanProgressProps) => {
  const hostsScanned = details?.hosts_scanned ?? 0;
  const hostsTotal = details?.hosts_total ?? targetScope?.vcenter_host_ids?.length ?? targetScope?.server_ids?.length ?? 0;
  const currentHost = details?.current_host;
  const currentStep = details?.current_step;
  const progressPercent = calculateScanProgress(details);
  const operationMessage = getCurrentOperationMessage(details);
  
  // Build host status list from available data
  const hostResults = details?.host_results || [];
  const scannedHosts = new Set(hostResults.map((r: any) => r.hostname || r.host_name));
  
  // Get host names if available
  const allHosts: HostScanStatus[] = [];
  
  // Add completed hosts from results
  hostResults.forEach((result: any) => {
    const hostname = result.hostname || result.host_name;
    allHosts.push({
      hostname,
      status: result.status === 'failed' ? 'failed' : 'completed',
      componentsChecked: result.components_checked ?? result.components?.length ?? 0,
      updatesAvailable: result.updates_available ?? 0,
      componentTypes: result.component_types || [],
      error: result.error
    });
  });
  
  // Add current host if scanning
  if (currentHost && !scannedHosts.has(currentHost)) {
    allHosts.push({
      hostname: currentHost,
      status: 'scanning'
    });
  }
  
  const isRunning = status === 'running' || status === 'pending';
  
  if (!isRunning) {
    return null; // Completed jobs should use UpdateAvailabilityScanResults
  }

  // Count totals from completed hosts
  const totalUpdatesFound = allHosts.reduce((sum, h) => sum + (h.updatesAvailable ?? 0), 0);

  return (
    <FirmwareScanProgressCard 
      scanProgress={{
        hostsScanned,
        hostsTotal,
        currentHost,
        currentStep: operationMessage,
        updatesFound: totalUpdatesFound,
        criticalFound: 0,
        hostResults: allHosts,
      }}
    />
  );
};
