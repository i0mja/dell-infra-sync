import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
}

export function useJobsWithProgress() {
  return useQuery({
    queryKey: ['active-jobs-with-progress'],
    queryFn: async () => {
      // Fetch active parent jobs
      const { data: jobs, error: jobsError } = await supabase
        .from("jobs")
        .select("*")
        .is("parent_job_id", null)
        .in("status", ["pending", "running"])
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

        return {
          ...job,
          totalTasks: tasks.length,
          completedTasks,
          runningTasks,
          currentLog: runningTask?.log || null,
          averageProgress,
        };
      });

      return jobsWithProgress;
    },
    refetchInterval: 2000, // Poll every 2 seconds for live updates
  });
}
