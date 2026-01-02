import { ScrollArea } from "@/components/ui/scroll-area";
import { VCenterSyncHeader } from "./VCenterSyncHeader";
import { VCenterSyncLiveProgress } from "./VCenterSyncLiveProgress";
import { VCenterSyncTimeline } from "./VCenterSyncTimeline";
import { VCenterSyncEntityCards } from "./VCenterSyncEntityCards";
import { VCenterSyncWarningsPanel } from "./VCenterSyncWarningsPanel";
import { VCenterSyncPerformanceInsights } from "./VCenterSyncPerformanceInsights";
import { MultiVCenterAccordion } from "./MultiVCenterAccordion";
import { useVCenterSyncProgress } from "@/hooks/useVCenterSyncProgress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { XCircle } from "lucide-react";

interface VCenterSyncJobViewProps {
  job: {
    id: string;
    status: string;
    details: any;
    started_at: string | null;
    completed_at: string | null;
  };
}

export const VCenterSyncJobView = ({ job }: VCenterSyncJobViewProps) => {
  const isRunning = job.status === 'running';
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';
  
  // Use the progress hook for real-time updates
  const { data: progress } = useVCenterSyncProgress(
    job.id, 
    isRunning,
    job.status
  );
  
  // Merge progress data with job details
  const details = progress?.details || job.details || {};
  const consoleLogs = details.console_log || [];
  const syncPhase = progress?.syncPhase ?? details.sync_phase ?? 0;
  const currentStep = progress?.currentStep ?? details.current_step;
  const elapsedMs = progress?.elapsedMs;
  
  // Check for multi-vCenter results
  const vcenterResults = details.vcenter_results as any[] | undefined;
  const totalVcenters = details.total_vcenters || 1;
  const isMultiVCenter = vcenterResults && vcenterResults.length > 1;

  return (
    <ScrollArea className="h-[calc(90vh-140px)]">
      <div className="space-y-4 pr-4">
        {/* Header - always visible */}
        <VCenterSyncHeader 
          job={{ ...job, details }} 
          elapsedMs={elapsedMs}
        />
        
        {/* Running: Show live progress */}
        {isRunning && (
          <VCenterSyncLiveProgress 
            details={details}
            currentStep={currentStep}
            syncPhase={syncPhase}
          />
        )}
        
        {/* Console Timeline - always visible */}
        {consoleLogs.length > 0 && (
          <VCenterSyncTimeline 
            consoleLogs={consoleLogs}
            isRunning={isRunning}
          />
        )}
        
        {/* Completed/Failed: Show results */}
        {(isCompleted || isFailed) && (
          <>
            {/* Warnings Panel */}
            <VCenterSyncWarningsPanel 
              details={details}
              consoleLogs={consoleLogs}
            />
            
            {/* Error Alert for Failed Jobs */}
            {isFailed && details.error && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Sync Failed</AlertTitle>
                <AlertDescription className="font-mono text-sm">
                  {details.error}
                </AlertDescription>
              </Alert>
            )}
            
            {/* Multi-vCenter Accordion or Single vCenter Cards */}
            {isMultiVCenter ? (
              <MultiVCenterAccordion 
                vcenterResults={vcenterResults}
                totalVcenters={totalVcenters}
                isRunning={isRunning}
                currentVcenterIndex={details.current_vcenter_index}
              />
            ) : (
              <VCenterSyncEntityCards details={details} />
            )}
            
            {/* Performance Insights - only for completed jobs */}
            {isCompleted && (
              <VCenterSyncPerformanceInsights 
                details={details}
                startedAt={job.started_at}
                completedAt={job.completed_at}
              />
            )}
          </>
        )}
      </div>
    </ScrollArea>
  );
};
