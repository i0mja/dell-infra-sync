import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Database } from "@/integrations/supabase/types";

export interface ScpBackup {
  id: string;
  backup_name: string;
  description: string | null;
  scp_file_size_bytes: number | null;
  include_bios: boolean | null;
  include_idrac: boolean | null;
  include_nic: boolean | null;
  include_raid: boolean | null;
  checksum: string | null;
  exported_at: string | null;
  last_imported_at: string | null;
  is_valid: boolean | null;
  created_by: string | null;
}

type JobStatus = Database["public"]["Enums"]["job_status"];

export interface JobSummary {
  id: string;
  status: JobStatus;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  details: any;
}

export function useScpBackups(serverId: string, enabled: boolean) {
  const [backups, setBackups] = useState<ScpBackup[]>([]);
  const [recentJobs, setRecentJobs] = useState<JobSummary[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Check if there are any active jobs
  const hasActiveJobs = recentJobs.some(
    (job) => job.status === "pending" || job.status === "running"
  );

  const fetchBackups = async () => {
    setLoadingBackups(true);
    try {
      const { data, error } = await supabase
        .from("scp_backups")
        .select(
          "id, backup_name, description, scp_file_size_bytes, include_bios, include_idrac, include_nic, include_raid, checksum, exported_at, last_imported_at, is_valid, created_by"
        )
        .eq("server_id", serverId)
        .order("exported_at", { ascending: false });

      if (error) throw error;
      setBackups(data || []);
    } catch (error: any) {
      console.error("Error fetching backups:", error);
      toast.error("Failed to load backups");
    } finally {
      setLoadingBackups(false);
    }
  };

  const fetchRecentJobs = async (silent = false) => {
    if (!silent) setLoadingJobs(true);
    try {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, status, created_at, started_at, completed_at, details")
        .eq("job_type", "scp_export")
        .contains("target_scope", { server_ids: [serverId] })
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) throw error;
      setRecentJobs(data || []);
    } catch (error: any) {
      console.error("Error fetching jobs:", error);
      if (!silent) toast.error("Failed to load job status");
    } finally {
      if (!silent) setLoadingJobs(false);
    }
  };

  // Initial fetch when dialog opens
  useEffect(() => {
    if (enabled) {
      fetchBackups();
      fetchRecentJobs();
    }
  }, [enabled, serverId]);

  // Conditional polling - only when there are active jobs
  useEffect(() => {
    if (enabled && hasActiveJobs) {
      // Start polling
      intervalRef.current = setInterval(() => {
        fetchRecentJobs(true);
        fetchBackups();
      }, 5000);
    } else {
      // Stop polling when no active jobs
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [enabled, hasActiveJobs, serverId]);

  return {
    backups,
    recentJobs,
    loadingBackups,
    loadingJobs,
    fetchBackups,
    fetchRecentJobs,
  };
}
