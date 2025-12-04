import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { initializeJobExecutorUrl } from "@/lib/job-executor-api";

/**
 * Hook to initialize Job Executor URL from database on app load.
 * This ensures instant API calls use the correct URL before any operations.
 */
export function useJobExecutorInit() {
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadJobExecutorUrl = async () => {
      try {
        const { data } = await supabase
          .from("activity_settings")
          .select("job_executor_url")
          .single();

        if (data?.job_executor_url) {
          initializeJobExecutorUrl(data.job_executor_url);
          console.log("[JobExecutor] Initialized URL from database:", data.job_executor_url);
        }
      } catch (error) {
        console.warn("[JobExecutor] Could not load URL from database, using default");
      } finally {
        setInitialized(true);
        setLoading(false);
      }
    };

    loadJobExecutorUrl();
  }, []);

  return { initialized, loading };
}
