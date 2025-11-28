import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useJobsWithProgress } from "@/hooks/useJobsWithProgress";
import { JobsTable } from "./JobsTable";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

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

interface JobsActivityViewProps {
  activeJobs: Job[];
  realtimeStatus: 'connected' | 'disconnected' | 'connecting';
}

export function JobsActivityView({ activeJobs, realtimeStatus }: JobsActivityViewProps) {
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
    <div className="flex flex-col h-full border rounded-lg shadow-sm">
      {/* Toolbar row with tabs, active jobs badge, filters, and live status */}
      <div className="flex items-center gap-2 px-4 py-2 border-b flex-wrap">
        <TabsList>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="api-log">API Log</TabsTrigger>
        </TabsList>

        {activeJobs.length > 0 && (
          <>
            <div className="w-px h-6 bg-border mx-1" />
            <div className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-blue-500/10 text-blue-600 text-xs">
              <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
              {activeJobs.length} running
            </div>
          </>
        )}

        <div className="flex-1" />

        <div
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
            realtimeStatus === 'connected'
              ? 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/30'
              : 'bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/30'
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-current" />
          {realtimeStatus === 'connected' ? 'Live' : 'Paused'}
        </div>
      </div>

      {/* Jobs table fills remaining space */}
      <div className="flex-1 overflow-hidden">
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
      </div>
    </div>
  );
}
