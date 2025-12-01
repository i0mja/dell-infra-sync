import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, Maximize2, X, CheckCircle2, XCircle } from "lucide-react";
import { useJobProgress } from "@/hooks/useJobProgress";
import { useEffect, useState } from "react";
import { useMinimizedJobs } from "@/contexts/MinimizedJobsContext";
import { supabase } from "@/integrations/supabase/client";

interface MinimizedJobMonitorProps {
  jobId: string;
  jobType: string;
  onMaximize: () => void;
  onClose: () => void;
}

export const MinimizedJobMonitor = ({ 
  jobId, 
  jobType,
  onMaximize, 
  onClose 
}: MinimizedJobMonitorProps) => {
  const { data: progress } = useJobProgress(jobId, true);
  const { removeJob } = useMinimizedJobs();
  const [jobStatus, setJobStatus] = useState<string | null>(null);

  // Subscribe to job status changes
  useEffect(() => {
    const fetchStatus = async () => {
      const { data } = await supabase
        .from('jobs')
        .select('status')
        .eq('id', jobId)
        .single();
      
      if (data) {
        setJobStatus(data.status);
      }
    };

    fetchStatus();

    const channel = supabase
      .channel(`job-status-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `id=eq.${jobId}`
        },
        (payload) => {
          const newStatus = (payload.new as any).status;
          setJobStatus(newStatus);
          
          // Auto-remove from minimized when completed or failed
          if (newStatus === 'completed' || newStatus === 'failed') {
            setTimeout(() => {
              removeJob(jobId);
            }, 5000); // Keep visible for 5 seconds after completion
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, removeJob]);

  const getJobTypeLabel = (type: string) => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getStatusIcon = () => {
    if (jobStatus === 'completed') {
      return <CheckCircle2 className="h-4 w-4 text-success" />;
    } else if (jobStatus === 'failed') {
      return <XCircle className="h-4 w-4 text-destructive" />;
    }
    return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  };

  return (
    <Card className="w-80 shadow-lg border-2">
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <span className="text-sm font-medium">{getJobTypeLabel(jobType)}</span>
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onMaximize}>
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <Progress value={progress?.progressPercent || 0} className="h-2" />
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {progress?.currentStep || 'Processing...'}
          </p>
          {progress?.elapsedMs && (
            <p className="text-xs text-muted-foreground">
              Elapsed: {Math.floor(progress.elapsedMs / 1000)}s
            </p>
          )}
          {progress?.totalTasks && progress.totalTasks > 0 && (
            <p className="text-xs text-muted-foreground">
              Tasks: {progress.completedTasks}/{progress.totalTasks}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
