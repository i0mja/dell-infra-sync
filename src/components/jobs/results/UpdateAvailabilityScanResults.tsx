import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, 
  AlertTriangle, 
  Server, 
  RefreshCw, 
  ExternalLink,
  Loader2,
  Package
} from "lucide-react";
import { useNavigate } from "react-router-dom";

interface UpdateAvailabilityScanResultsProps {
  details: any;
  status: string;
}

export const UpdateAvailabilityScanResults = ({ details, status }: UpdateAvailabilityScanResultsProps) => {
  const navigate = useNavigate();
  
  // Check direct properties first (new format), then nested summary (legacy)
  const hostsScanned = details?.hostsScanned ?? details?.hosts_scanned ?? details?.summary?.hostsScanned ?? 0;
  const hostsTotal = details?.hostsTotal ?? details?.hosts_total ?? details?.summary?.hostsTotal ?? hostsScanned;
  const hostsSuccessful = details?.hostsSuccessful ?? details?.hostsScanned ?? details?.summary?.hostsSuccessful ?? hostsScanned;
  const hostsFailed = details?.hostsFailed ?? details?.summary?.hostsFailed ?? 0;
  const updatesAvailable = details?.updatesAvailable ?? details?.summary?.updatesAvailable ?? 0;
  const criticalUpdates = details?.criticalUpdates ?? details?.summary?.criticalUpdates ?? 0;
  const upToDate = details?.upToDate ?? details?.summary?.upToDate ?? 0;
  const scanId = details?.scan_id;
  const currentHost = details?.current_host;

  const hostResults = details?.host_results || [];

  // Show progress for running jobs
  if (status === 'running') {
    const progressPercent = hostsTotal > 0 ? Math.round((hostsScanned / hostsTotal) * 100) : 0;
    const currentStep = details?.current_step;
    
    // Count running totals
    const runningUpdatesFound = hostResults.reduce((sum: number, r: any) => sum + (r.updates_available ?? 0), 0);
    
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="font-medium">Scanning for available updates...</span>
            </div>
            
            {currentHost && (
              <div className="text-sm bg-muted/30 rounded-md p-2">
                <span className="text-muted-foreground">Currently scanning:</span>{' '}
                <span className="font-mono font-medium">{currentHost}</span>
                {currentStep && (
                  <span className="text-muted-foreground ml-2">({currentStep})</span>
                )}
              </div>
            )}
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">{hostsScanned} / {hostsTotal} hosts</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </div>

            {/* Show completed hosts with their results */}
            {hostResults.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground font-medium">Completed hosts:</div>
                <div className="space-y-1">
                  {hostResults.slice(-4).map((result: any, idx: number) => {
                    const hostname = result.hostname || result.host_name;
                    const updates = result.updates_available ?? 0;
                    const components = result.components_checked ?? 0;
                    const failed = result.status === 'failed';
                    
                    return (
                      <div key={idx} className="flex items-center gap-2 text-xs p-1.5 rounded bg-background/50">
                        {failed ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                        ) : updates > 0 ? (
                          <Package className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                        )}
                        <span className="font-mono flex-1 truncate">{hostname}</span>
                        {failed ? (
                          <span className="text-destructive">{result.error || 'Failed'}</span>
                        ) : updates > 0 ? (
                          <span className="text-amber-600 font-medium">{updates} update{updates !== 1 ? 's' : ''}</span>
                        ) : (
                          <span className="text-green-600">Up-to-date ({components} checked)</span>
                        )}
                      </div>
                    );
                  })}
                  {hostResults.length > 4 && (
                    <div className="text-xs text-muted-foreground text-center">
                      ...and {hostResults.length - 4} more
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Running totals */}
            {runningUpdatesFound > 0 && (
              <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-500/10 rounded p-2">
                <Package className="h-4 w-4" />
                <span>{runningUpdatesFound} update{runningUpdatesFound !== 1 ? 's' : ''} found so far</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Completed results view
  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <Server className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Hosts Scanned</span>
            </div>
            <div className="text-2xl font-bold">{hostsSuccessful}</div>
            {hostsFailed > 0 && (
              <Badge variant="destructive" className="mt-1 text-xs">
                {hostsFailed} failed
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Updates Available</span>
            </div>
            <div className="text-2xl font-bold">{updatesAvailable}</div>
            {updatesAvailable > 0 ? (
              <Badge variant="secondary" className="mt-1 text-xs">
                <Package className="h-3 w-3 mr-1" />
                {updatesAvailable} package{updatesAvailable !== 1 ? 's' : ''}
              </Badge>
            ) : (
              <Badge variant="outline" className="mt-1 text-xs text-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                All current
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Critical Updates</span>
            </div>
            <div className="text-2xl font-bold">{criticalUpdates}</div>
            {criticalUpdates > 0 ? (
              <Badge variant="destructive" className="mt-1 text-xs">
                Action needed
              </Badge>
            ) : (
              <Badge variant="outline" className="mt-1 text-xs text-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                None
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Up to Date</span>
            </div>
            <div className="text-2xl font-bold">{upToDate}</div>
            <span className="text-xs text-muted-foreground">
              components
            </span>
          </CardContent>
        </Card>
      </div>

      {/* View Full Report Button */}
      {scanId && status === 'completed' && (
        <Button 
          variant="outline" 
          onClick={() => navigate(`/reports/updates/${scanId}`)}
          className="w-full"
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          View Full Update Report
        </Button>
      )}

      {/* Error message if failed */}
      {status === 'failed' && details?.error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">{details.error}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
