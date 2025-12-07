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
  details?: Record<string, any>;
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
      
      // Calculate progress percentage from details if available
      const calculatedProgress = (() => {
        const jobDetails = job?.details;
        if (!jobDetails || typeof jobDetails !== 'object' || Array.isArray(jobDetails)) return null;
        
        // Already has explicit progress
        if ('progress_percent' in jobDetails && jobDetails.progress_percent !== undefined && jobDetails.progress_percent !== null) {
          return typeof jobDetails.progress_percent === 'number' ? jobDetails.progress_percent : null;
        }
        
        // vCenter sync: vms_processed / vms_total
        if ('vms_total' in jobDetails && 'vms_processed' in jobDetails && 
            typeof jobDetails.vms_total === 'number' && typeof jobDetails.vms_processed === 'number' && 
            jobDetails.vms_total > 0) {
          return Math.round((jobDetails.vms_processed / jobDetails.vms_total) * 100);
        }
        
        // Discovery scan: servers_scanned / total_ips
        if ('total_ips' in jobDetails && 'servers_scanned' in jobDetails && 
            typeof jobDetails.total_ips === 'number' && typeof jobDetails.servers_scanned === 'number' && 
            jobDetails.total_ips > 0) {
          return Math.round((jobDetails.servers_scanned / jobDetails.total_ips) * 100);
        }
        
        // Hosts sync: hosts_processed / hosts_total or hosts_synced / hosts_total
        if ('hosts_total' in jobDetails && 
            typeof jobDetails.hosts_total === 'number' && jobDetails.hosts_total > 0) {
          const processed = ('hosts_processed' in jobDetails && typeof jobDetails.hosts_processed === 'number') 
            ? jobDetails.hosts_processed 
            : ('hosts_synced' in jobDetails && typeof jobDetails.hosts_synced === 'number') 
            ? jobDetails.hosts_synced 
            : null;
          if (processed !== null) {
            return Math.round((processed / jobDetails.hosts_total) * 100);
          }
        }
        
        // Multi-server jobs: current_server_index / total_servers
        if ('total_servers' in jobDetails && 'current_server_index' in jobDetails && 
            typeof jobDetails.total_servers === 'number' && typeof jobDetails.current_server_index === 'number' && 
            jobDetails.total_servers > 0) {
          return Math.round(((jobDetails.current_server_index + 1) / jobDetails.total_servers) * 100);
        }
        
        // Health check: (success_count + failed_count) / total
        if ('total' in jobDetails && 'success_count' in jobDetails && 
            typeof jobDetails.total === 'number' && jobDetails.total > 0) {
          const completed = (typeof jobDetails.success_count === 'number' ? jobDetails.success_count : 0) + 
                           (typeof jobDetails.failed_count === 'number' ? jobDetails.failed_count : 0);
          return Math.round((completed / jobDetails.total) * 100);
        }
        
        // Multi-server jobs with total_servers: scp_export, power_control, event_log_fetch
        if ('total_servers' in jobDetails && 
            typeof jobDetails.total_servers === 'number' && jobDetails.total_servers > 0) {
          // Check if we have success/failed counts
          if ('success_count' in jobDetails || 'failed_count' in jobDetails) {
            const completed = (typeof jobDetails.success_count === 'number' ? jobDetails.success_count : 0) + 
                             (typeof jobDetails.failed_count === 'number' ? jobDetails.failed_count : 0);
            return Math.round((completed / jobDetails.total_servers) * 100);
          }
          // Check if we have results array
          if ('results' in jobDetails && Array.isArray(jobDetails.results)) {
            return Math.round((jobDetails.results.length / jobDetails.total_servers) * 100);
          }
        }
        
        return null;
      })();
      
      // Fallback: Query workflow_executions for workflow-based jobs
      let workflowProgress: number | null = null;
      let workflowCurrentStep: string | undefined;
      
      if (calculatedProgress === null && totalTasks === 0) {
        const { data: workflowSteps } = await supabase
          .from('workflow_executions')
          .select('step_name, step_status')
          .eq('job_id', jobId)
          .order('step_number', { ascending: true });
        
        if (workflowSteps && workflowSteps.length > 0) {
          const completedSteps = workflowSteps.filter(s => 
            ['completed', 'skipped'].includes(s.step_status)
          ).length;
          workflowProgress = Math.round((completedSteps / workflowSteps.length) * 100);
          
          // Get current step from running workflow execution
          const runningStep = workflowSteps.find(s => s.step_status === 'running');
          if (runningStep) {
            workflowCurrentStep = runningStep.step_name?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          }
        }
      }

      // Extract iDRAC job queue for firmware updates
      let idracCurrentStep: string | undefined;
      const jobDetails = job?.details;
      if (jobDetails && typeof jobDetails === 'object' && !Array.isArray(jobDetails) && 'idrac_job_queue' in jobDetails) {
        const idracQueue = (jobDetails as any).idrac_job_queue as Array<{
          id: string;
          name: string;
          job_state: string;
          percent_complete: number;
        }>;
        
        if (Array.isArray(idracQueue) && idracQueue.length > 0) {
          // Find running iDRAC jobs
          const runningIdracJobs = idracQueue.filter(j => 
            j.job_state?.toLowerCase() === 'running'
          );
          
          if (runningIdracJobs.length > 0) {
            const firstRunning = runningIdracJobs[0];
            idracCurrentStep = `${firstRunning.name} (${firstRunning.percent_complete}%)`;
          } else {
            // If no running jobs, show scheduled jobs count
            const scheduledJobs = idracQueue.filter(j => 
              ['scheduled', 'new', 'downloaded'].includes(j.job_state?.toLowerCase())
            );
            if (scheduledJobs.length > 0) {
              idracCurrentStep = `${scheduledJobs.length} iDRAC jobs queued`;
            }
          }
        }
      }

      // Use calculated progress or fall back to workflow/task-based calculation
      let progressPercent = 0;
      if (calculatedProgress !== null) {
        progressPercent = calculatedProgress;
      } else if (workflowProgress !== null) {
        progressPercent = workflowProgress;
      } else if (totalTasks > 0) {
        progressPercent = Math.round((completedTasks / totalTasks) * 100);
      }
      
      const progress: JobProgress = {
        totalTasks,
        completedTasks,
        runningTasks,
        currentStep: idracCurrentStep || workflowCurrentStep || (typeof job?.details === 'object' && job?.details !== null 
          ? (job.details as any).current_step 
          : undefined),
        progressPercent,
        elapsedMs,
        details: job?.details as Record<string, any> | undefined
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
