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
  Circle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

interface VCenterSyncLiveProgressProps {
  details: any;
  currentStep?: string;
  syncPhase: number;
}

interface SyncPhase {
  key: string;
  label: string;
  icon: React.ReactNode;
}

const SYNC_PHASES: SyncPhase[] = [
  { key: 'clusters', label: 'Clusters', icon: <Layers className="h-4 w-4" /> },
  { key: 'hosts', label: 'Hosts', icon: <Server className="h-4 w-4" /> },
  { key: 'datastores', label: 'Datastores', icon: <HardDrive className="h-4 w-4" /> },
  { key: 'networks', label: 'Networks', icon: <Network className="h-4 w-4" /> },
  { key: 'vms', label: 'VMs', icon: <Monitor className="h-4 w-4" /> },
  { key: 'alarms', label: 'Alarms', icon: <AlertTriangle className="h-4 w-4" /> },
];

/**
 * Map backend sync_phase (0-9) to UI phase index (0-5)
 * Backend phases:
 * 0 = Clusters, 1 = Hosts, 2 = Datastores, 3 = Networks
 * 4 = VMs, 5 = VM-Network links, 6 = VM-Datastore links
 * 7 = VM Snapshots, 8 = VM Custom Attributes
 * 9 = Complete
 */
const mapSyncPhaseToUiPhase = (syncPhase: number): number => {
  if (syncPhase < 0) return -1; // Still connecting
  if (syncPhase === 0) return 0; // Clusters
  if (syncPhase === 1) return 1; // Hosts
  if (syncPhase === 2) return 2; // Datastores
  if (syncPhase === 3) return 3; // Networks
  if (syncPhase >= 4 && syncPhase <= 8) return 4; // VMs (including sub-phases: relationships, snapshots, attributes)
  if (syncPhase >= 9) return 5; // Alarms / Complete
  return -1;
};

/**
 * Get detailed label for VM sub-phases
 */
const getVmSubPhaseLabel = (syncPhase: number): string | null => {
  if (syncPhase === 5) return "Linking VMs to Networks";
  if (syncPhase === 6) return "Linking VMs to Datastores";
  if (syncPhase === 7) return "Syncing VM Snapshots";
  if (syncPhase === 8) return "Syncing VM Custom Attributes";
  return null;
};

export const VCenterSyncLiveProgress = ({ details, currentStep, syncPhase }: VCenterSyncLiveProgressProps) => {
  // Monotonic phase tracking - never go backwards
  const highestPhaseRef = useRef<number>(-1);
  
  const rawPhaseIndex = mapSyncPhaseToUiPhase(syncPhase);
  
  // Update highest phase (monotonic - only increases)
  useEffect(() => {
    if (rawPhaseIndex > highestPhaseRef.current) {
      highestPhaseRef.current = rawPhaseIndex;
    }
  }, [rawPhaseIndex]);
  
  // Use the highest phase we've seen (prevents going backwards)
  const currentPhaseIndex = Math.max(rawPhaseIndex, highestPhaseRef.current);

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
    <div className="rounded-lg border bg-card p-4 space-y-4">
      {/* Phase Rail */}
      <div className="flex items-stretch gap-1">
        {SYNC_PHASES.map((phase, index) => {
          const isCompleted = index < currentPhaseIndex;
          const isActive = index === currentPhaseIndex;
          const isPending = index > currentPhaseIndex;
          const count = phaseCounts[phase.key];

          return (
            <div 
              key={phase.key}
              className={cn(
                "flex-1 flex flex-col items-center gap-2 p-3 rounded-lg transition-all duration-300",
                isActive && "bg-primary/10 ring-1 ring-primary/30",
                isCompleted && "bg-success/10",
                isPending && "opacity-40"
              )}
            >
              {/* Icon Circle */}
              <div className={cn(
                "flex items-center justify-center w-10 h-10 rounded-full transition-all duration-300",
                isCompleted && "bg-success text-success-foreground",
                isActive && "bg-primary text-primary-foreground",
                isPending && "bg-muted text-muted-foreground"
              )}>
                {isCompleted ? (
                  <CheckCircle className="h-5 w-5" />
                ) : isActive ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Circle className="h-5 w-5" />
                )}
              </div>
              
              {/* Label & Count */}
              <div className="text-center">
                <p className={cn(
                  "text-sm font-medium transition-colors",
                  isActive && "text-primary",
                  isCompleted && "text-success",
                  isPending && "text-muted-foreground"
                )}>
                  {phase.label}
                </p>
                {(isCompleted || isActive) && count > 0 && (
                  <p className={cn(
                    "text-lg font-bold tabular-nums",
                    isCompleted && "text-success",
                    isActive && "text-primary"
                  )}>
                    {count.toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Current Operation Panel */}
      {(currentStep || getVmSubPhaseLabel(syncPhase)) && (
        <div className="rounded-lg bg-muted/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Current Operation</span>
            {stepProgress && (
              <span className="text-sm text-muted-foreground font-mono">
                {stepProgress.current.toLocaleString()} / {stepProgress.total.toLocaleString()}
              </span>
            )}
          </div>
          
          {/* Show VM sub-phase label when in sub-phases 5-8 */}
          {getVmSubPhaseLabel(syncPhase) && (
            <p className="text-xs text-muted-foreground">
              {getVmSubPhaseLabel(syncPhase)}
            </p>
          )}
          
          {currentStep && (
            <p className="text-sm text-foreground font-mono truncate">
              {currentStep}
            </p>
          )}
          
          {stepProgress && (
            <Progress 
              value={(stepProgress.current / stepProgress.total) * 100} 
              className="h-2" 
            />
          )}
        </div>
      )}
    </div>
  );
};
