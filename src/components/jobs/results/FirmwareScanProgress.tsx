import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  Search, 
  Server, 
  CheckCircle2, 
  Loader2, 
  AlertCircle,
  Clock,
  Package,
  AlertTriangle
} from "lucide-react";
import { getCurrentOperationMessage, calculateScanProgress, formatHostScanResult } from "@/lib/firmware-scan-messages";

interface HostScanStatus {
  hostname: string;
  status: 'pending' | 'scanning' | 'completed' | 'failed';
  componentsChecked?: number;
  updatesAvailable?: number;
  componentTypes?: string[];
  error?: string;
}

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
  const hostsWithUpdates = allHosts.filter(h => (h.updatesAvailable ?? 0) > 0).length;

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="pt-6 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Search className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold">Checking for Updates</h3>
            <p className="text-sm text-muted-foreground">{operationMessage}</p>
          </div>
          <Badge variant="default" className="animate-pulse">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Scanning
          </Badge>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Host scan progress</span>
            <span className="font-medium">
              {hostsScanned} of {hostsTotal} hosts ({progressPercent}%)
            </span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>

        {/* Running totals */}
        {allHosts.length > 0 && (
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Updates found:</span>
              <span className="font-medium">{totalUpdatesFound}</span>
            </div>
            {hostsWithUpdates > 0 && (
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span className="text-muted-foreground">Hosts with updates:</span>
                <span className="font-medium">{hostsWithUpdates}</span>
              </div>
            )}
          </div>
        )}

        {/* Host Status List */}
        {allHosts.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Server className="h-4 w-4" />
              <span>Host status</span>
            </div>
            <div className="grid gap-2">
              {allHosts.slice(-5).map((host) => (
                <div 
                  key={host.hostname}
                  className="flex items-center gap-2 text-sm p-2 rounded-md bg-background/50"
                >
                  {host.status === 'scanning' && (
                    <Loader2 className="h-4 w-4 text-primary animate-spin flex-shrink-0" />
                  )}
                  {host.status === 'completed' && (
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  )}
                  {host.status === 'failed' && (
                    <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                  )}
                  {host.status === 'pending' && (
                    <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <span className="font-mono flex-1 truncate">{host.hostname}</span>
                  {host.status === 'scanning' && (
                    <span className="text-xs text-muted-foreground">
                      {currentStep ? `${currentStep}...` : 'Scanning...'}
                    </span>
                  )}
                  {host.status === 'completed' && (
                    <>
                      {host.updatesAvailable !== undefined && host.updatesAvailable > 0 ? (
                        <Badge variant="secondary" className="text-xs">
                          <Package className="h-3 w-3 mr-1" />
                          {host.updatesAvailable} update{host.updatesAvailable !== 1 ? 's' : ''}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-green-600">
                          Up-to-date
                        </Badge>
                      )}
                      {host.componentsChecked !== undefined && host.componentsChecked > 0 && (
                        <span className="text-xs text-muted-foreground">
                          ({host.componentsChecked} checked)
                        </span>
                      )}
                    </>
                  )}
                  {host.status === 'failed' && (
                    <Badge variant="destructive" className="text-xs">
                      {host.error || 'Failed'}
                    </Badge>
                  )}
                </div>
              ))}
              {allHosts.length > 5 && (
                <div className="text-xs text-muted-foreground text-center">
                  Showing last 5 of {allHosts.length} hosts
                </div>
              )}
            </div>
          </div>
        )}

        {/* Current operation detail */}
        {currentHost && currentStep && (
          <div className="text-xs text-muted-foreground bg-background/30 rounded p-2">
            <span className="font-medium">Current operation:</span>{' '}
            {currentStep} on {currentHost}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
