import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Job {
  id: string;
  job_type: string;
  status: string;
  target_scope: any;
  details: any;
  created_by: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  schedule_at: string | null;
  parent_job_id: string | null;
}

export function useActiveJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .is("parent_job_id", null)
        .in("status", ["pending", "running"])
        .order("created_at", { ascending: false });

      if (error) throw error;
      setJobs(data || []);
    } catch (error) {
      console.error("Error fetching active jobs:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();

    const channel = supabase
      .channel('active-jobs-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs'
        },
        () => {
          fetchJobs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'running');
  const completedJobs = jobs.filter(j => j.status === 'completed');

  return {
    activeJobs,
    completedJobs,
    allJobs: jobs,
    loading,
    refetch: fetchJobs
  };
}
