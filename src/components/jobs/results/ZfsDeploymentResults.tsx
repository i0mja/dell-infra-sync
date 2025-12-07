import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  CheckCircle, 
  XCircle, 
  Circle, 
  HardDrive, 
  Server, 
  Network, 
  Terminal,
  Database,
  Clock,
  AlertCircle
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface ZfsDeploymentResultsProps {
  details: any;
  status: string;
}

// Phase definitions matching the Python handler
const PHASES = [
  { key: 'clone', label: 'Clone Template', icon: Server },
  { key: 'power_on', label: 'Power On VM', icon: Server },
  { key: 'wait_tools', label: 'Wait for VM Tools', icon: Clock },
  { key: 'wait_ip', label: 'Wait for IP Address', icon: Network },
  { key: 'ssh_connect', label: 'SSH Connection', icon: Terminal },
  { key: 'zfs_create', label: 'Create ZFS Pool', icon: HardDrive },
  { key: 'nfs_setup', label: 'Configure NFS', icon: Database },
  { key: 'register_target', label: 'Register Target', icon: Database },
  { key: 'register_datastore', label: 'Register Datastore', icon: HardDrive },
];

export const ZfsDeploymentResults = ({ details, status }: ZfsDeploymentResultsProps) => {
  if (!details) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">
          No deployment details available.
        </CardContent>
      </Card>
    );
  }

  const currentPhase = details.current_phase || 'unknown';
  const progressPercent = details.progress_percent || 0;
  const consoleLog = details.console_log || [];
  const error = details.error;

  // Determine phase statuses
  const getPhaseStatus = (phaseKey: string) => {
    const phaseIndex = PHASES.findIndex(p => p.key === phaseKey);
    const currentIndex = PHASES.findIndex(p => p.key === currentPhase);
    
    if (status === 'completed') return 'completed';
    if (status === 'failed' && phaseKey === currentPhase) return 'failed';
    if (phaseIndex < currentIndex) return 'completed';
    if (phaseIndex === currentIndex) return status === 'running' ? 'running' : 'pending';
    return 'pending';
  };

  const getPhaseIcon = (phaseStatus: string) => {
    switch (phaseStatus) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'running':
        return <Circle className="h-4 w-4 text-blue-500 animate-pulse" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Configuration Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Server className="h-4 w-4" />
            Deployment Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">VM Name:</span>
              <span className="ml-2 font-medium">{details.vm_name || 'N/A'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Template:</span>
              <span className="ml-2 font-medium">{details.template_name || 'N/A'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Hostname:</span>
              <span className="ml-2 font-medium">{details.hostname || 'N/A'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Network:</span>
              <span className="ml-2 font-medium">{details.network_name || 'DHCP'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">ZFS Pool:</span>
              <span className="ml-2 font-medium">{details.zfs_pool_name || 'datapool'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">ZFS Disk:</span>
              <span className="ml-2 font-medium">{details.zfs_disk_gb || 500} GB</span>
            </div>
            <div>
              <span className="text-muted-foreground">NFS Network:</span>
              <span className="ml-2 font-medium">{details.nfs_network || 'N/A'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">IP Address:</span>
              <span className="ml-2 font-medium">
                {details.detected_ip || details.ip_address || (details.use_dhcp ? 'DHCP' : 'N/A')}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Alert */}
      {status === 'failed' && error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Deployment Failed</AlertTitle>
          <AlertDescription className="mt-2">
            <div className="font-mono text-sm whitespace-pre-wrap">{error}</div>
            {currentPhase && currentPhase !== 'unknown' && (
              <p className="mt-2 text-sm">
                Failed during phase: <Badge variant="destructive">{PHASES.find(p => p.key === currentPhase)?.label || currentPhase}</Badge>
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Phase Progress */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Deployment Phases
            </CardTitle>
            <Badge variant={status === 'completed' ? 'default' : status === 'failed' ? 'destructive' : 'secondary'}>
              {progressPercent}%
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {PHASES.map((phase) => {
              const phaseStatus = getPhaseStatus(phase.key);
              const PhaseIcon = phase.icon;
              
              return (
                <div 
                  key={phase.key}
                  className={`flex items-center gap-3 p-2 rounded-md ${
                    phaseStatus === 'running' ? 'bg-blue-500/10 border border-blue-500/20' :
                    phaseStatus === 'failed' ? 'bg-destructive/10 border border-destructive/20' :
                    phaseStatus === 'completed' ? 'bg-green-500/5' :
                    'bg-muted/30'
                  }`}
                >
                  {getPhaseIcon(phaseStatus)}
                  <PhaseIcon className="h-4 w-4 text-muted-foreground" />
                  <span className={`text-sm ${
                    phaseStatus === 'pending' ? 'text-muted-foreground' : ''
                  }`}>
                    {phase.label}
                  </span>
                  {phaseStatus === 'running' && (
                    <Badge variant="secondary" className="ml-auto text-xs">
                      In Progress
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Console Output */}
      {consoleLog.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              Console Output ({consoleLog.length} entries)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px] rounded border bg-muted/30 p-3">
              <div className="space-y-1 font-mono text-xs">
                {consoleLog.map((entry: any, idx: number) => (
                  <div 
                    key={idx}
                    className={`${
                      entry.level === 'ERROR' ? 'text-destructive' :
                      entry.level === 'WARN' ? 'text-yellow-500' :
                      entry.level === 'ssh' ? 'text-emerald-400' :
                      'text-foreground/80'
                    }`}
                  >
                    <span className="text-muted-foreground">
                      [{entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '...'}]
                    </span>{' '}
                    <span className={`font-semibold ${
                      entry.level === 'ERROR' ? 'text-destructive' :
                      entry.level === 'WARN' ? 'text-yellow-500' :
                      'text-blue-400'
                    }`}>
                      [{entry.level || 'INFO'}]
                    </span>{' '}
                    {entry.message}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Created Resources */}
      {status === 'completed' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              Created Resources
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {details.cloned_vm_moref && (
                <div>
                  <span className="text-muted-foreground">VM MoRef:</span>
                  <span className="ml-2 font-mono">{details.cloned_vm_moref}</span>
                </div>
              )}
              {details.replication_target_id && (
                <div>
                  <span className="text-muted-foreground">Replication Target:</span>
                  <span className="ml-2 font-mono text-xs">{details.replication_target_id}</span>
                </div>
              )}
              {details.detected_ip && (
                <div>
                  <span className="text-muted-foreground">IP Address:</span>
                  <span className="ml-2 font-medium">{details.detected_ip}</span>
                </div>
              )}
              {details.datastore_name && (
                <div>
                  <span className="text-muted-foreground">Datastore:</span>
                  <span className="ml-2 font-medium">{details.datastore_name}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};