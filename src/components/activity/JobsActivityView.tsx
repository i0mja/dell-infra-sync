import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { JobActivityCard } from "./JobActivityCard";
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
  created_by: string;
}

export function JobsActivityView() {
  const [jobs, setJobs] = useState<Job[]>([]);

  // Fetch recent jobs (last 24h)
  const { data: jobsData, isLoading } = useQuery({
    queryKey: ['recent-jobs'],
    queryFn: async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .is('parent_job_id', null)
        .gte('created_at', yesterday.toISOString())
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as Job[];
    },
    staleTime: 0,
    refetchInterval: 3000, // Poll every 3 seconds
  });

  useEffect(() => {
    if (jobsData) {
      setJobs(jobsData);
    }
  }, [jobsData]);

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
              setJobs(prev => [data as Job, ...prev].slice(0, 50));
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

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="text-center space-y-3">
          <div className="text-5xl">📋</div>
          <h3 className="text-lg font-semibold">No recent operations</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Jobs and operations will appear here once you start managing servers or running tasks.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      {jobs.map(job => (
        <JobActivityCard key={job.id} job={job} />
      ))}
    </div>
  );
}
