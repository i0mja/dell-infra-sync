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
  stageStats: {
    stage1Passed: number;
    stage1Filtered: number;
    stage2Passed: number;
    stage2Filtered: number;
    stage3Passed: number;
    stage3Failed: number;
  };
  ipsProcessed: number;
  ipsTotal: number;
}

export function DiscoveryScanLiveProgress({
  currentPhase,
  isRunning,
  progressPercent,
  currentIp,
  currentStage,
  stageStats,
  ipsProcessed,
  ipsTotal,
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
        };
      case 'detection':
        return {
          passed: stageStats.stage2Passed,
          filtered: stageStats.stage2Filtered,
          total: stageStats.stage1Passed,
        };
      case 'auth':
        return {
          passed: stageStats.stage3Passed,
          failed: stageStats.stage3Failed,
          total: stageStats.stage2Passed,
        };
      case 'sync':
        return {
          passed: stageStats.stage3Passed,
          total: stageStats.stage3Passed,
        };
      default:
        return {};
    }
  };

  const formatCurrentOperation = () => {
    if (!currentIp && !currentStage) return null;
    
    const stageLabels: Record<string, string> = {
      port_check: 'Checking port',
      detecting: 'Detecting iDRAC',
      authenticating: 'Authenticating',
      syncing: 'Syncing data',
      scp: 'Backing up config',
    };

    const label = currentStage ? stageLabels[currentStage] || currentStage : 'Processing';
    return currentIp ? `${label}: ${currentIp}` : label;
  };

  const currentOperation = formatCurrentOperation();

  return (
    <div className="space-y-4">
      {/* Overall progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {ipsProcessed} / {ipsTotal} IPs processed
          </span>
          <span className="font-medium">{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      {/* Phase rail */}
      <div className="flex items-center justify-between gap-2 py-3">
        {DISCOVERY_PHASES.map((phase, index) => {
          const isCompleted = index < currentPhaseIndex || !isRunning;
          const isCurrent = index === currentPhaseIndex && isRunning;
          const isPending = index > currentPhaseIndex;
          const stats = getPhaseStats(phase.id);

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
                    isCurrent && "text-primary",
                    isPending && "text-muted-foreground"
                  )}
                >
                  {phase.label}
                </span>

                {/* Phase stats */}
                {(isCompleted || isCurrent) && stats.passed !== undefined && (
                  <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                    <span className="text-success">{stats.passed}</span>
                    {stats.filtered !== undefined && stats.filtered > 0 && (
                      <span className="text-muted-foreground">/{stats.filtered}</span>
                    )}
                    {stats.failed !== undefined && stats.failed > 0 && (
                      <span className="text-destructive">/{stats.failed}</span>
                    )}
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
