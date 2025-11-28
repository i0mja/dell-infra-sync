import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useJobsWithProgress } from "@/hooks/useJobsWithProgress";
import { JobsTable } from "./JobsTable";
import { Skeleton } from "@/components/ui/skeleton";

interface Job {
  id: string;
  job_type: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  details: any;
  target_scope: any;
  created_by?: string;
  component_order?: number | null;
  totalTasks?: number;
  completedTasks?: number;
  runningTasks?: number;
  currentLog?: string | null;
  averageProgress?: number;
}

export function JobsActivityView() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [jobTypeFilter, setJobTypeFilter] = useState("all");
  const [timeRangeFilter, setTimeRangeFilter] = useState("24h");
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  // Use the progress hook for active jobs
  const { data: jobsWithProgress, isLoading } = useJobsWithProgress();

  useEffect(() => {
    if (jobsWithProgress) {
      setJobs(jobsWithProgress as Job[]);
    }
  }, [jobsWithProgress]);

  // Set up realtime subscription for job updates
  useEffect(() => {
    const channel = supabase
      .channel('jobs-activity-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs',
          filter: 'parent_job_id=is.null'
        },
        async (payload) => {
          if (payload.eventType === 'INSERT') {
            const { data } = await supabase
              .from('jobs')
              .select('*')
              .eq('id', payload.new.id)
              .single();

            if (data) {
              setJobs(prev => [data as Job, ...prev]);
            }
          } else if (payload.eventType === 'UPDATE') {
            setJobs(prev => 
              prev.map(job => 
                job.id === payload.new.id ? { ...job, ...payload.new } as Job : job
              )
            );
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, []);

  const handleJobClick = (job: Job) => {
    setExpandedJobId(expandedJobId === job.id ? null : job.id);
  };

  // Apply filters
  const filteredJobs = jobs.filter(job => {
    if (statusFilter !== "all" && job.status !== statusFilter) return false;
    if (jobTypeFilter !== "all" && job.job_type !== jobTypeFilter) return false;
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      if (!job.job_type.toLowerCase().includes(search)) return false;
    }
    return true;
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  return (
    <JobsTable
      jobs={filteredJobs}
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      statusFilter={statusFilter}
      onStatusFilterChange={setStatusFilter}
      jobTypeFilter={jobTypeFilter}
      onJobTypeFilterChange={setJobTypeFilter}
      timeRangeFilter={timeRangeFilter}
      onTimeRangeFilterChange={setTimeRangeFilter}
      onJobClick={handleJobClick}
      expandedJobId={expandedJobId}
    />
  );
}
