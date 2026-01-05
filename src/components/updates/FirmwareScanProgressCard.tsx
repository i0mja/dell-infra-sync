import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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

export interface HostScanStatus {
  hostname: string;
  status: 'pending' | 'scanning' | 'completed' | 'failed';
  componentsChecked?: number;
  updatesAvailable?: number;
  componentTypes?: string[];
  error?: string;
}

export interface FirmwareScanProgressData {
  hostsScanned: number;
  hostsTotal: number;
  currentHost?: string;
  currentStep?: string;
  updatesFound: number;
  criticalFound?: number;
  hostResults?: HostScanStatus[];
}

interface FirmwareScanProgressCardProps {
  scanProgress: FirmwareScanProgressData;
  /** If true, renders without the Card wrapper (for embedding in dialogs) */
  inline?: boolean;
}

export function FirmwareScanProgressCard({ scanProgress, inline = false }: FirmwareScanProgressCardProps) {
  const {
    hostsScanned,
    hostsTotal,
    currentHost,
    currentStep,
    updatesFound,
    criticalFound = 0,
    hostResults = [],
  } = scanProgress;

  const progressPercent = hostsTotal > 0
    ? Math.round((hostsScanned / hostsTotal) * 100)
    : 0;

  // Count hosts with updates
  const hostsWithUpdates = hostResults.filter(h => (h.updatesAvailable ?? 0) > 0).length;

  const content = (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-center gap-2 text-primary">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="font-medium">Scanning in progress...</span>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <Progress value={progressPercent} className="h-2" />
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{hostsScanned} of {hostsTotal} hosts</span>
          <span>{progressPercent}%</span>
        </div>
      </div>

      {/* Current host */}
      {currentHost && (
        <p className="text-sm text-center text-muted-foreground">
          Currently scanning: <span className="font-medium font-mono">{currentHost}</span>
          {currentStep && (
            <span className="block text-xs mt-0.5">{currentStep}</span>
          )}
        </p>
      )}

      <Separator />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 text-center">
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className="text-2xl font-bold text-primary">{updatesFound}</p>
          <p className="text-xs text-muted-foreground">Updates Found</p>
        </div>
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className={`text-2xl font-bold ${criticalFound > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {criticalFound}
          </p>
          <p className="text-xs text-muted-foreground">Critical Updates</p>
        </div>
      </div>

      {/* Host Status List (when we have host-level details) */}
      {hostResults.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Server className="h-4 w-4" />
            <span>Host status</span>
          </div>
          <div className="grid gap-2">
            {hostResults.slice(-5).map((host) => (
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
                  <span className="text-xs text-muted-foreground">Scanning...</span>
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
                  </>
                )}
                {host.status === 'failed' && (
                  <Badge variant="destructive" className="text-xs">
                    {host.error || 'Failed'}
                  </Badge>
                )}
              </div>
            ))}
            {hostResults.length > 5 && (
              <div className="text-xs text-muted-foreground text-center">
                Showing last 5 of {hostResults.length} hosts
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (inline) {
    return <div className="py-2">{content}</div>;
  }

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="pt-6">
        {content}
      </CardContent>
    </Card>
  );
}
