import { cn } from "@/lib/utils";
import { Check, Loader2, Circle } from "lucide-react";
import { DISCOVERY_PHASES, type DiscoveryPhase } from "@/lib/discovery-scan-messages";
import { Progress } from "@/components/ui/progress";

interface DiscoveryScanLiveProgressProps {
  currentPhase: DiscoveryPhase;
  isRunning: boolean;
  progressPercent: number;
  currentIp?: string;
  currentStage?: string;
  currentStep?: string;
  currentServerIp?: string;
  scpProgress?: number;
  stageStats: {
    stage1Passed: number;
    stage1Filtered: number;
    stage2Passed: number;
    stage2Filtered: number;
    stage3Passed: number;
    stage3Failed: number;
  };
  activeCounts: {
    inPortCheck: number;
    inDetecting: number;
    inAuthenticating: number;
    inSyncing: number;
    inScp: number;
  };
  ipsProcessed: number;
  ipsTotal: number;
  serversRefreshed: number;
  serversTotal: number;
  scpCompleted: number;
}

export function DiscoveryScanLiveProgress({
  currentPhase,
  isRunning,
  progressPercent,
  currentIp,
  currentStage,
  currentStep,
  currentServerIp,
  scpProgress,
  stageStats,
  activeCounts,
  ipsProcessed,
  ipsTotal,
  serversRefreshed,
  serversTotal,
  scpCompleted,
}: DiscoveryScanLiveProgressProps) {
  const getPhaseIndex = (phaseId: DiscoveryPhase) => {
    return DISCOVERY_PHASES.findIndex(p => p.id === phaseId);
  };

  const currentPhaseIndex = getPhaseIndex(currentPhase);

  const getPhaseStats = (phaseId: DiscoveryPhase) => {
    switch (phaseId) {
      case 'port_scan':
        return {
          passed: stageStats.stage1Passed,
          filtered: stageStats.stage1Filtered,
          total: ipsTotal,
          active: activeCounts.inPortCheck,
        };
      case 'detection':
        return {
          passed: stageStats.stage2Passed,
          filtered: stageStats.stage2Filtered,
          total: stageStats.stage1Passed,
          active: activeCounts.inDetecting,
        };
      case 'auth':
        return {
          passed: stageStats.stage3Passed,
          failed: stageStats.stage3Failed,
          total: stageStats.stage2Passed,
          active: activeCounts.inAuthenticating,
        };
      case 'sync':
        return {
          passed: serversRefreshed,
          total: serversTotal,
          active: activeCounts.inSyncing,
        };
      case 'scp':
        return {
          passed: scpCompleted,
          total: serversTotal,
          active: activeCounts.inScp,
        };
      default:
        return { active: 0 };
    }
  };

  const formatCurrentOperation = () => {
    // Use currentStep if available (more descriptive from backend)
    if (currentStep) return currentStep;
    
    // During SCP phase, show server IP and progress
    if (currentStage === 'scp' && currentServerIp) {
      const progressStr = scpProgress ? ` (${scpProgress}%)` : '';
      return `Backing up config: ${currentServerIp}${progressStr}`;
    }
    
    // During sync phase, show server IP
    if (currentStage === 'sync' && currentServerIp) {
      return `Syncing data: ${currentServerIp}`;
    }
    
    if (!currentIp && !currentStage) return null;
    
    const stageLabels: Record<string, string> = {
      port_check: 'Checking port',
      detecting: 'Detecting iDRAC',
      authenticating: 'Authenticating',
      sync: 'Syncing data',
      syncing: 'Syncing data',
      scp: 'Backing up config',
      scp_backup: 'Backing up config',
    };

    const label = currentStage ? stageLabels[currentStage] || currentStage : 'Processing';
    return currentIp ? `${label}: ${currentIp}` : label;
  };

  const currentOperation = formatCurrentOperation();

  // Determine what to show in the progress header based on current phase
  const getProgressLabel = () => {
    const inSyncOrScp = currentStage === 'sync' || currentStage === 'scp';
    
    if (inSyncOrScp && serversTotal > 0) {
      // In sync/scp phase - show server progress
      return `${serversTotal} servers discovered`;
    } else if (ipsTotal > 0) {
      // In discovery phase - show IP progress  
      return `${ipsProcessed} / ${ipsTotal} IPs processed`;
    }
    return 'Initializing...';
  };

  return (
    <div className="space-y-4">
      {/* Overall progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {getProgressLabel()}
          </span>
          <span className="font-medium">{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      {/* Phase rail */}
      <div className="flex items-center justify-between gap-2 py-3">
        {DISCOVERY_PHASES.map((phase, index) => {
          const stats = getPhaseStats(phase.id);
          const hasActiveWork = (stats.active ?? 0) > 0;
          
          // Sync phase is complete only when ALL servers have been synced
          const isSyncPhaseComplete = phase.id === 'sync' && 
            serversRefreshed >= serversTotal && 
            serversTotal > 0;
          
          // SCP phase is complete when ALL backups are done
          const isScpPhaseComplete = phase.id === 'scp' && 
            scpCompleted >= serversTotal && 
            serversTotal > 0;
          
          const isCompleted = (index < currentPhaseIndex && !hasActiveWork) || isSyncPhaseComplete || isScpPhaseComplete;
          const isCurrent = !isCompleted && ((index === currentPhaseIndex && isRunning) || hasActiveWork);
          const isPending = index > currentPhaseIndex && !hasActiveWork && !isCompleted;

          return (
            <div key={phase.id} className="flex-1 relative">
              {/* Connector line */}
              {index > 0 && (
                <div 
                  className={cn(
                    "absolute left-0 top-4 -translate-x-1/2 w-full h-0.5",
                    isCompleted || isCurrent ? "bg-primary" : "bg-muted"
                  )}
                  style={{ width: 'calc(100% - 2rem)', left: '-50%', marginLeft: '1rem' }}
                />
              )}
              
              <div className="flex flex-col items-center relative z-10">
                {/* Phase icon */}
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center border-2 bg-background",
                    isCompleted && "bg-primary border-primary text-primary-foreground",
                    isCurrent && "border-primary",
                    isPending && "border-muted"
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" />
                  ) : hasActiveWork ? (
                    <Loader2 className="h-4 w-4 text-primary animate-spin" />
                  ) : isCurrent ? (
                    <Loader2 className="h-4 w-4 text-primary animate-spin" />
                  ) : (
                    <Circle className="h-3 w-3 text-muted-foreground" />
                  )}
                </div>

                {/* Phase label */}
                <span
                  className={cn(
                    "text-xs mt-2 font-medium text-center",
                    (isCurrent || hasActiveWork) && "text-primary",
                    isPending && "text-muted-foreground"
                  )}
                >
                  {phase.label}
                </span>

                {/* Phase stats - show active count or passed/filtered */}
                {(isCompleted || isCurrent || hasActiveWork) && (
                  <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                    {hasActiveWork ? (
                      <>
                        {/* For sync/scp, show X/Y with active indicator */}
                        {(phase.id === 'sync' || phase.id === 'scp') && stats.total !== undefined && stats.total > 0 ? (
                          <span className="text-primary font-medium">
                            {stats.passed ?? 0}/{stats.total}
                          </span>
                        ) : (
                          <span className="text-primary font-medium">{stats.active} active</span>
                        )}
                      </>
                    ) : stats.passed !== undefined && (stats.passed > 0 || stats.total !== undefined) ? (
                      <>
                        {/* For sync/scp phases, show X/Y format */}
                        {(phase.id === 'sync' || phase.id === 'scp') && stats.total !== undefined && stats.total > 0 ? (
                          <span className="text-success">{stats.passed}/{stats.total}</span>
                        ) : stats.passed > 0 ? (
                          <>
                            <span className="text-success">{stats.passed}</span>
                            {stats.filtered !== undefined && stats.filtered > 0 && (
                              <span className="text-muted-foreground">/{stats.filtered}</span>
                            )}
                            {stats.failed !== undefined && stats.failed > 0 && (
                              <span className="text-destructive">/{stats.failed}</span>
                            )}
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Current operation panel */}
      {isRunning && currentOperation && (
        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border">
          <Loader2 className="h-4 w-4 text-primary animate-spin flex-shrink-0" />
          <span className="text-sm font-medium">{currentOperation}</span>
        </div>
      )}
    </div>
  );
}
