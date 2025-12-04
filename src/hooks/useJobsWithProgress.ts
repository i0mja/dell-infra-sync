import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Internal job types that should not appear in Activity Monitor
const INTERNAL_JOB_TYPES = [
  'idm_authenticate',
  'idm_test_auth',
  'idm_test_connection',
  'idm_network_check',
  'idm_test_ad_connection',
  'idm_search_groups',
  'idm_search_ad_groups',
  'idm_search_ad_users',
  'idm_sync_users',
];

interface JobTask {
  id: string;
  status: string;
  progress: number | null;
  log: string | null;
}

interface JobWithProgress {
  id: string;
  job_type: string;
  status: string;
  started_at: string | null;
  created_at: string;
  details: any;
  target_scope: any;
  completed_at: string | null;
  component_order?: number | null;
  totalTasks: number;
  completedTasks: number;
  runningTasks: number;
  currentLog: string | null;
  averageProgress: number;
  calculatedProgress: number | null;
}

export function useJobsWithProgress() {
  return useQuery({
    queryKey: ['active-jobs-with-progress'],
    queryFn: async () => {
      // Fetch active parent jobs (excluding internal job types)
      const { data: jobs, error: jobsError } = await supabase
        .from("jobs")
        .select("*")
        .is("parent_job_id", null)
        .in("status", ["pending", "running"])
        .not("job_type", "in", `(${INTERNAL_JOB_TYPES.join(',')})`)
        .order("created_at", { ascending: false });

      if (jobsError) throw jobsError;
      if (!jobs) return [];

      // Fetch tasks for all active jobs
      const jobIds = jobs.map(j => j.id);
      const { data: allTasks, error: tasksError } = await supabase
        .from("job_tasks")
        .select("job_id, status, progress, log")
        .in("job_id", jobIds);

      if (tasksError) throw tasksError;

      // Aggregate task data for each job
      const jobsWithProgress: JobWithProgress[] = jobs.map(job => {
        const tasks = (allTasks || []).filter(t => t.job_id === job.id);
        const completedTasks = tasks.filter(t => t.status === 'completed').length;
        const runningTasks = tasks.filter(t => t.status === 'running').length;
        const runningTask = tasks.find(t => t.status === 'running');
        
        // Calculate average progress across all tasks
        const tasksWithProgress = tasks.filter(t => t.progress !== null);
        const averageProgress = tasksWithProgress.length > 0
          ? tasksWithProgress.reduce((sum, t) => sum + (t.progress || 0), 0) / tasksWithProgress.length
          : 0;

        // Calculate progress from details if available
        const calculatedProgress = (() => {
          const details = job.details;
          if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
          
          // Already has explicit progress
          if ('progress_percent' in details && details.progress_percent !== undefined && details.progress_percent !== null) {
            return typeof details.progress_percent === 'number' ? details.progress_percent : null;
          }
          
          // vCenter sync: vms_processed / vms_total
          if ('vms_total' in details && 'vms_processed' in details && 
              typeof details.vms_total === 'number' && typeof details.vms_processed === 'number' && 
              details.vms_total > 0) {
            return Math.round((details.vms_processed / details.vms_total) * 100);
          }
          
          // Discovery scan: servers_scanned / total_ips
          if ('total_ips' in details && 'servers_scanned' in details && 
              typeof details.total_ips === 'number' && typeof details.servers_scanned === 'number' && 
              details.total_ips > 0) {
            return Math.round((details.servers_scanned / details.total_ips) * 100);
          }
          
          // Hosts sync: hosts_processed / hosts_total or hosts_synced / hosts_total
          if ('hosts_total' in details && 
              typeof details.hosts_total === 'number' && details.hosts_total > 0) {
            const processed = ('hosts_processed' in details && typeof details.hosts_processed === 'number') 
              ? details.hosts_processed 
              : ('hosts_synced' in details && typeof details.hosts_synced === 'number') 
              ? details.hosts_synced 
              : null;
            if (processed !== null) {
              return Math.round((processed / details.hosts_total) * 100);
            }
          }
          
          // Multi-server jobs: current_server_index / total_servers
          if ('total_servers' in details && 'current_server_index' in details && 
              typeof details.total_servers === 'number' && typeof details.current_server_index === 'number' && 
              details.total_servers > 0) {
            return Math.round(((details.current_server_index + 1) / details.total_servers) * 100);
          }
          
          // Health check: (success_count + failed_count) / total
          if ('total' in details && 'success_count' in details && 
              typeof details.total === 'number' && details.total > 0) {
            const completed = (typeof details.success_count === 'number' ? details.success_count : 0) + 
                             (typeof details.failed_count === 'number' ? details.failed_count : 0);
            return Math.round((completed / details.total) * 100);
          }
          
          // Multi-server jobs with total_servers: scp_export, power_control, event_log_fetch
          if ('total_servers' in details && 
              typeof details.total_servers === 'number' && details.total_servers > 0) {
            // Check if we have success/failed counts
            if ('success_count' in details || 'failed_count' in details) {
              const completed = (typeof details.success_count === 'number' ? details.success_count : 0) + 
                               (typeof details.failed_count === 'number' ? details.failed_count : 0);
              return Math.round((completed / details.total_servers) * 100);
            }
            // Check if we have results array
            if ('results' in details && Array.isArray(details.results)) {
              return Math.round((details.results.length / details.total_servers) * 100);
            }
          }
          
          return null;
        })();

        return {
          ...job,
          totalTasks: tasks.length,
          completedTasks,
          runningTasks,
          currentLog: runningTask?.log || null,
          averageProgress,
          calculatedProgress,
        };
      });

      return jobsWithProgress;
    },
    refetchInterval: 2000, // Poll every 2 seconds for live updates
  });
}
