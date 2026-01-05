import { getCurrentOperationMessage, calculateScanProgress } from "@/lib/firmware-scan-messages";
import { FirmwareScanProgressCard, type HostScanStatus } from "@/components/updates/FirmwareScanProgressCard";
import type { UpdateAvailabilityResult } from "@/hooks/useUpdateAvailabilityScan";

interface FirmwareScanProgressProps {
  details: any;
  status: string;
  targetScope?: any;
  scanResults?: UpdateAvailabilityResult[];
}

export const FirmwareScanProgress = ({ details, status, targetScope, scanResults }: FirmwareScanProgressProps) => {
  // Check camelCase (new format) first, then snake_case (legacy)
  const hostsScanned = details?.hostsScanned ?? details?.hosts_scanned ?? 0;
  const hostsTotal = details?.hostsTotal ?? details?.hosts_total ?? targetScope?.vcenter_host_ids?.length ?? targetScope?.server_ids?.length ?? 0;
  const currentHost = details?.currentHost ?? details?.current_host;
  const progressPercent = calculateScanProgress(details);
  const operationMessage = getCurrentOperationMessage(details);
  
  const isRunning = status === 'running' || status === 'pending';
  
  if (!isRunning) {
    return null; // Completed jobs should use UpdateAvailabilityScanResults
  }

  // Build host status list from scan results (from update_availability_results table)
  const allHosts: HostScanStatus[] = [];
  
  if (scanResults && scanResults.length > 0) {
    // Use real scan results when available
    scanResults.forEach(result => {
      allHosts.push({
        hostname: result.hostname || 'Unknown',
        status: result.scan_status === 'failed' ? 'failed' : 
                result.scan_status === 'completed' ? 'completed' : 
                result.scan_status === 'scanning' ? 'scanning' : 'pending',
        componentsChecked: result.total_components,
        updatesAvailable: result.updates_available,
        error: result.blockers?.[0]?.message,
      });
    });
  } else {
    // Fall back to host_results from job details
    const hostResults = details?.host_results || [];
    const scannedHosts = new Set(hostResults.map((r: any) => r.hostname || r.host_name));
    
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
  }
  
  // Count totals - prefer from scan results, fall back to details
  const totalUpdatesFound = scanResults 
    ? scanResults.reduce((sum, r) => sum + r.updates_available, 0)
    : allHosts.reduce((sum, h) => sum + (h.updatesAvailable ?? 0), 0);
  
  const totalCriticalFound = scanResults
    ? scanResults.reduce((sum, r) => sum + r.critical_updates, 0)
    : 0;

  return (
    <FirmwareScanProgressCard 
      scanProgress={{
        hostsScanned: scanResults?.length ?? hostsScanned,
        hostsTotal,
        currentHost,
        currentStep: operationMessage,
        updatesFound: totalUpdatesFound,
        criticalFound: totalCriticalFound,
        hostResults: allHosts,
      }}
    />
  );
};