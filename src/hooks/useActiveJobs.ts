import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { INTERNAL_JOB_TYPES, SCHEDULED_BACKGROUND_JOB_TYPES } from "@/lib/job-constants";
import { supabaseQueryWithRetry } from "@/lib/fetch-with-retry";

// Combined list of job types to filter from the active jobs popover
const FILTERED_JOB_TYPES = [...INTERNAL_JOB_TYPES, ...SCHEDULED_BACKGROUND_JOB_TYPES];

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
  const { session } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  const errorCountRef = useRef(0);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      setIsRetrying(false);
      
      const { data, error, retryCount } = await supabaseQueryWithRetry(
        async () => {
          const result = await supabase
            .from("jobs")
            .select("*")
            .is("parent_job_id", null)
            .in("status", ["pending", "running"])
            .not("job_type", "in", `(${FILTERED_JOB_TYPES.join(',')})`)
            .order("created_at", { ascending: false });
          return result;
        },
        { maxRetries: 3, baseDelay: 1000 }
      );

      if (retryCount > 0) {
        setIsRetrying(true);
      }

      if (error) {
        // Only log error once per consecutive failure series
        if (errorCountRef.current === 0) {
          console.error("Error fetching active jobs:", error);
        }
        errorCountRef.current++;
        throw error;
      }
      
      // Reset error counter on success
      errorCountRef.current = 0;
      
      // Filter out scheduled/automatic jobs (only show manually triggered ones)
      const filteredJobs = (data || []).filter(job => {
        const details = job.details as Record<string, unknown> | null;
        // Hide any job that was triggered by scheduled/automatic process
        if (details?.triggered_by === 'scheduled' || 
            details?.triggered_by === 'scheduled_sync') {
          return false;
        }
        // Also hide explicitly silent jobs
        if (details?.silent === true) {
          return false;
        }
        return true;
      });
      
      setJobs(filteredJobs);
    } catch (error) {
      // Keep existing jobs on error (stale-while-revalidate)
    } finally {
      setLoading(false);
      setIsRetrying(false);
    }
  };

  useEffect(() => {
    if (!session) return;

    fetchJobs();

    // Debounce ref for fetch calls to prevent flickering
    const debounceRef = { current: null as NodeJS.Timeout | null };

    const channel = supabase
      .channel(`active-jobs-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs'
        },
        (payload) => {
          const newJob = payload.new as Job | null;
          const oldJob = payload.old as { status?: string } | null;
          
          // Skip vcenter_sync progress-only updates (status unchanged)
          // This prevents flickering from frequent progress updates
          if (newJob?.job_type === 'vcenter_sync' && 
              payload.eventType === 'UPDATE' && 
              oldJob?.status === newJob?.status) {
            return;
          }
          
          // Debounce fetches to prevent rapid successive calls
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(fetchJobs, 300);
        }
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [session]);

  const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'running');
  const completedJobs = jobs.filter(j => j.status === 'completed');

  return {
    activeJobs,
    completedJobs,
    allJobs: jobs,
    loading,
    isRetrying,
    refetch: fetchJobs
  };
}
