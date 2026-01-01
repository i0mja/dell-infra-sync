import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  XCircle, 
  WifiOff, 
  KeyRound, 
  Clock, 
  AlertCircle,
  RefreshCcw 
} from 'lucide-react';
import type { UpdateAvailabilityResult, ScanBlocker } from '@/hooks/useUpdateAvailabilityScan';

interface UpdateBlockersCardProps {
  results: UpdateAvailabilityResult[];
  onRetryHost?: (serverId: string) => void;
}

function getBlockerIcon(type: ScanBlocker['type']) {
  switch (type) {
    case 'connectivity':
      return WifiOff;
    case 'authentication':
      return KeyRound;
    case 'timeout':
      return Clock;
    case 'unsupported':
      return AlertCircle;
    default:
      return XCircle;
  }
}

function getBlockerLabel(type: ScanBlocker['type']) {
  switch (type) {
    case 'connectivity':
      return 'Connection Failed';
    case 'authentication':
      return 'Auth Failed';
    case 'timeout':
      return 'Timeout';
    case 'unsupported':
      return 'Unsupported';
    default:
      return 'Error';
  }
}

export function UpdateBlockersCard({ results, onRetryHost }: UpdateBlockersCardProps) {
  // Get all failed or skipped results with blockers
  const failedHosts = results.filter(
    r => (r.scan_status === 'failed' || r.scan_status === 'skipped') && r.blockers && r.blockers.length > 0
  );

  if (failedHosts.length === 0) {
    return null;
  }

  return (
    <Card className="border-destructive/20 bg-destructive/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <XCircle className="h-5 w-5 text-destructive" />
          Scan Issues
          <Badge variant="destructive" className="ml-auto">
            {failedHosts.length} host{failedHosts.length !== 1 ? 's' : ''} affected
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {failedHosts.map((host) => (
            <div 
              key={host.id} 
              className="flex items-start gap-3 p-3 bg-background rounded-lg border"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium truncate">{host.hostname || 'Unknown Host'}</span>
                  {host.service_tag && (
                    <Badge variant="outline" className="text-xs font-mono">
                      {host.service_tag}
                    </Badge>
                  )}
                </div>
                <div className="space-y-1">
                  {host.blockers.map((blocker, idx) => {
                    const Icon = getBlockerIcon(blocker.type);
                    return (
                      <div key={idx} className="flex items-start gap-2 text-sm">
                        <Badge variant="secondary" className="text-xs shrink-0">
                          <Icon className="h-3 w-3 mr-1" />
                          {getBlockerLabel(blocker.type)}
                        </Badge>
                        <span className="text-muted-foreground">{blocker.message}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {onRetryHost && host.server_id && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRetryHost(host.server_id!)}
                >
                  <RefreshCcw className="h-3 w-3 mr-1" />
                  Retry
                </Button>
              )}
            </div>
          ))}
        </div>
        
        {failedHosts.length > 3 && (
          <p className="text-sm text-muted-foreground mt-3">
            Consider checking network connectivity and credentials before re-scanning.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
