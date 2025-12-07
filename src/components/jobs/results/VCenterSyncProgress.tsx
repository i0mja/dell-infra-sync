import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Layers, 
  HardDrive, 
  Network, 
  Monitor, 
  AlertTriangle, 
  Server,
  CheckCircle,
  Loader2,
  Circle,
  Database
} from "lucide-react";
import { cn } from "@/lib/utils";

interface VCenterSyncProgressProps {
  details: any;
  currentStep?: string;
}

interface SyncPhase {
  key: string;
  label: string;
  icon: React.ReactNode;
  count?: number;
}

const SYNC_PHASES: SyncPhase[] = [
  { key: 'clusters', label: 'Clusters', icon: <Layers className="h-4 w-4" /> },
  { key: 'datastores', label: 'Datastores', icon: <HardDrive className="h-4 w-4" /> },
  { key: 'networks', label: 'Networks', icon: <Network className="h-4 w-4" /> },
  { key: 'vms', label: 'VMs', icon: <Monitor className="h-4 w-4" /> },
  { key: 'alarms', label: 'Alarms', icon: <AlertTriangle className="h-4 w-4" /> },
  { key: 'hosts', label: 'Hosts', icon: <Server className="h-4 w-4" /> },
];

export const VCenterSyncProgress = ({ details, currentStep }: VCenterSyncProgressProps) => {
  // Multi-vCenter support
  const totalVcenters = details?.total_vcenters || 1;
  const currentVcenterIndex = details?.current_vcenter_index ?? 0;
  const currentVcenterName = details?.current_vcenter_name || details?.vcenter_name || details?.vcenter_host;
  
  // Parse current step to determine which phase we're in
  const getCurrentPhaseIndex = (): number => {
    if (!currentStep) return -1;
    
    const stepLower = currentStep.toLowerCase();
    
    if (stepLower.includes('cluster')) return 0;
    if (stepLower.includes('datastore')) return 1;
    if (stepLower.includes('network')) return 2;
    if (stepLower.includes('vm') || stepLower.includes('virtual machine')) return 3;
    if (stepLower.includes('alarm')) return 4;
    if (stepLower.includes('host')) return 5;
    
    // Check for completion
    if (stepLower.includes('complete') || stepLower.includes('finish')) return SYNC_PHASES.length;
    
    return -1;
  };

  // Parse progress from step messages like "Synced 3/6 hosts"
  const parseProgressFromStep = (): { current: number; total: number } | null => {
    if (!currentStep) return null;
    
    const match = currentStep.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      return {
        current: parseInt(match[1], 10),
        total: parseInt(match[2], 10)
      };
    }
    return null;
  };

  const currentPhaseIndex = getCurrentPhaseIndex();
  const stepProgress = parseProgressFromStep();
  
  // Get counts from details for completed phases
  const getPhaseCounts = (): Record<string, number> => {
    return {
      clusters: details?.clusters_synced || details?.clusters || 0,
      datastores: details?.datastores_synced || details?.datastores || 0,
      networks: details?.networks_synced || details?.networks || 0,
      vms: details?.vms_synced || details?.vms_processed || details?.vms || 0,
      alarms: details?.alarms_synced || details?.alarms || 0,
      hosts: details?.hosts_synced || details?.updated_hosts || details?.hosts || 0,
    };
  };

  const phaseCounts = getPhaseCounts();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Database className="h-4 w-4" />
            Sync Progress
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Multi-vCenter indicator */}
            {totalVcenters > 1 && (
              <Badge variant="outline" className="font-mono text-xs">
                vCenter {currentVcenterIndex + 1}/{totalVcenters}
              </Badge>
            )}
            {currentVcenterName && (
              <Badge variant="secondary" className="font-normal max-w-[200px] truncate">
                {currentVcenterName}
              </Badge>
            )}
          </div>
        </div>
        
        {/* Multi-vCenter overall progress */}
        {totalVcenters > 1 && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Overall Progress</span>
              <span>{currentVcenterIndex + 1} of {totalVcenters} vCenters</span>
            </div>
            <Progress 
              value={((currentVcenterIndex) / totalVcenters) * 100} 
              className="h-1.5" 
            />
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Phase Stepper */}
        <div className="flex items-center justify-between gap-1">
          {SYNC_PHASES.map((phase, index) => {
            const isCompleted = index < currentPhaseIndex;
            const isActive = index === currentPhaseIndex;
            const isPending = index > currentPhaseIndex;
            const count = phaseCounts[phase.key];

            return (
              <div 
                key={phase.key}
                className={cn(
                  "flex-1 flex flex-col items-center gap-1 p-2 rounded-lg transition-colors",
                  isActive && "bg-primary/10",
                  isCompleted && "bg-success/10",
                  isPending && "opacity-50"
                )}
              >
                <div className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-full",
                  isCompleted && "bg-success text-success-foreground",
                  isActive && "bg-primary text-primary-foreground",
                  isPending && "bg-muted text-muted-foreground"
                )}>
                  {isCompleted ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : isActive ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Circle className="h-4 w-4" />
                  )}
                </div>
                <div className="text-center">
                  <p className={cn(
                    "text-xs font-medium",
                    isActive && "text-primary",
                    isCompleted && "text-success",
                    isPending && "text-muted-foreground"
                  )}>
                    {phase.label}
                  </p>
                  {(isCompleted || isActive) && count > 0 && (
                    <p className="text-xs text-muted-foreground">{count}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Current Step Detail */}
        {currentStep && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Current operation:</span>
              <span className="font-mono text-xs max-w-[300px] truncate">{currentStep}</span>
            </div>
            
            {/* Progress bar for current phase if we can parse it */}
            {stepProgress && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Processing</span>
                  <span>{stepProgress.current} / {stepProgress.total}</span>
                </div>
                <Progress 
                  value={(stepProgress.current / stepProgress.total) * 100} 
                  className="h-1.5" 
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
