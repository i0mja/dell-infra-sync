import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

export interface JobProgress {
  totalTasks: number;
  completedTasks: number;
  runningTasks: number;
  currentStep?: string;
  progressPercent: number;
  elapsedMs?: number;
}

export function useJobProgress(jobId: string | null, enabled: boolean = true) {
  const { session } = useAuth();
  const query = useQuery({
    queryKey: ['job-progress', jobId],
    queryFn: async () => {
      if (!jobId) return null;
      
      // Fetch job details for current_step
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .select('details, started_at')
        .eq('id', jobId)
        .single();
      
      if (jobError) throw jobError;
      
      // Fetch task progress
      const { data: tasks, error: tasksError } = await supabase
        .from('job_tasks')
        .select('status, progress')
        .eq('job_id', jobId);
      
      if (tasksError) throw tasksError;
      
      const totalTasks = tasks?.length || 0;
      const completedTasks = tasks?.filter(t => t.status === 'completed').length || 0;
      const runningTasks = tasks?.filter(t => t.status === 'running').length || 0;
      
      // Calculate elapsed time
      let elapsedMs: number | undefined;
      if (job?.started_at) {
        elapsedMs = Date.now() - new Date(job.started_at).getTime();
      }
      
      // Calculate progress percentage
      let progressPercent = 0;
      if (totalTasks > 0) {
        progressPercent = Math.round((completedTasks / totalTasks) * 100);
      }
      
      const progress: JobProgress = {
        totalTasks,
        completedTasks,
        runningTasks,
        currentStep: typeof job?.details === 'object' && job?.details !== null 
          ? (job.details as any).current_step 
          : undefined,
        progressPercent,
        elapsedMs
      };
      
      return progress;
    },
    enabled: enabled && !!jobId,
    refetchInterval: 2000, // Refetch every 2 seconds for active jobs
  });
  
  // Subscribe to real-time updates
  useEffect(() => {
    if (!session || !jobId || !enabled) return;
    
    const channel = supabase
      .channel(`job-progress-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_tasks',
          filter: `job_id=eq.${jobId}`
        },
        () => {
          query.refetch();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `id=eq.${jobId}`
        },
        () => {
          query.refetch();
        }
      )
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, jobId, enabled]);
  
  return query;
}

export function formatElapsed(startTime: string | null): string {
  if (!startTime) return '';
  
  const elapsed = Date.now() - new Date(startTime).getTime();
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
