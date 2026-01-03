import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { DiscoveryScanHeader } from "./DiscoveryScanHeader";
import { DiscoveryScanLiveProgress } from "./DiscoveryScanLiveProgress";
import { DiscoveryScanServerList } from "./DiscoveryScanServerList";
import { DiscoveryScanTimeline } from "./DiscoveryScanTimeline";
import { DiscoveryScanResults } from "../results/DiscoveryScanResults";
import { useDiscoveryScanProgress } from "@/hooks/useDiscoveryScanProgress";

interface Job {
  id: string;
  job_type: string;
  status: string;
  target_scope: any;
  details: any;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface DiscoveryScanJobViewProps {
  job: Job;
}

export function DiscoveryScanJobView({ job }: DiscoveryScanJobViewProps) {
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const isRunning = job.status === 'running' || job.status === 'pending';
  const isCompleted = job.status === 'completed' || job.status === 'failed';

  // Get real-time progress updates
  const progress = useDiscoveryScanProgress(job.id, isRunning);

  // Parse console logs from job details
  useEffect(() => {
    // Parse logs from job details if available
    if (job.details?.log) {
      const logLines = typeof job.details.log === 'string' 
        ? job.details.log.split('\n').filter(Boolean)
        : Array.isArray(job.details.log) 
          ? job.details.log 
          : [];
      setConsoleLogs(logLines);
    }
  }, [job.details?.log]);

  // Parse target scope info
  const ipRanges = job.target_scope?.ip_range 
    ? [job.target_scope.ip_range]
    : job.target_scope?.ip_ranges;
  const ipList = job.target_scope?.ip_list;
  const ipCount = ipList?.length || job.details?.scanned_ips || progress.ipsTotal;

  return (
    <ScrollArea className="h-[calc(90vh-120px)]">
      <div className="space-y-6 pr-4">
        {/* Header with status and timing */}
        <DiscoveryScanHeader
          status={job.status}
          createdAt={job.created_at}
          startedAt={job.started_at}
          completedAt={job.completed_at}
          ipRanges={ipRanges}
          ipCount={ipCount}
        />

        {/* Live progress rail (only when running) */}
        {isRunning && (
          <DiscoveryScanLiveProgress
            currentPhase={progress.currentPhase}
            isRunning={isRunning}
            progressPercent={progress.progressPercent}
            currentIp={progress.currentIp}
            currentStage={progress.currentStage}
            currentStep={progress.currentStep}
            currentServerIp={progress.currentServerIp}
            scpProgress={progress.scpProgress}
            stageStats={{
              stage1Passed: progress.stage1Passed,
              stage1Filtered: progress.stage1Filtered,
              stage2Passed: progress.stage2Passed,
              stage2Filtered: progress.stage2Filtered,
              stage3Passed: progress.stage3Passed,
              stage3Failed: progress.stage3Failed,
            }}
            activeCounts={{
              inPortCheck: progress.inPortCheck,
              inDetecting: progress.inDetecting,
              inAuthenticating: progress.inAuthenticating,
              inSyncing: progress.inSyncing,
              inScp: progress.inScp,
            }}
            ipsProcessed={progress.ipsProcessed}
            ipsTotal={progress.ipsTotal}
            serversRefreshed={progress.serversRefreshed}
            serversTotal={progress.serversTotal}
            scpCompleted={progress.scpCompleted}
          />
        )}

        {/* Server status list (running or has results) */}
        {(isRunning || progress.serverResults.length > 0) && (
          <DiscoveryScanServerList
            serverResults={progress.serverResults}
            isRunning={isRunning}
            serversRefreshed={progress.serversRefreshed}
            serversTotal={progress.serversTotal}
            scpCompleted={progress.scpCompleted}
            currentServerIp={progress.currentServerIp}
            currentStage={progress.currentStage}
            currentStep={progress.currentStep}
          />
        )}

        {/* Final results summary (completed only) */}
        {isCompleted && (
          <DiscoveryScanResults details={job.details} />
        )}

        {/* Activity timeline / console logs */}
        <DiscoveryScanTimeline logs={consoleLogs} />
      </div>
    </ScrollArea>
  );
}
