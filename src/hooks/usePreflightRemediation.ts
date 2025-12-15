import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type JobType = Database["public"]["Enums"]["job_type"];
type JobInsert = Database["public"]["Tables"]["jobs"]["Insert"];

export interface Remediation {
  action_type: string;
  job_type?: string;
  job_params?: Record<string, unknown>;
  description: string;
  can_auto_fix: boolean;
  requires_password?: boolean;
  requires_confirmation?: boolean;
}

export interface CheckWithRemediation {
  name: string;
  passed: boolean;
  message: string;
  remediation?: Remediation;
  can_override?: boolean;
  is_warning?: boolean;
}

export function usePreflightRemediation() {
  const queryClient = useQueryClient();

  const applyFix = useMutation({
    mutationFn: async ({ remediation, adminPassword }: { 
      remediation: Remediation; 
      adminPassword?: string;
    }) => {
      if (!remediation.job_type) {
        throw new Error("No job type specified for remediation");
      }

      // Create the remediation job
      const jobParams: Record<string, unknown> = {
        ...remediation.job_params,
        is_remediation: true,
      };

      if (adminPassword) {
        jobParams.admin_password = adminPassword;
      }

      const insertData: JobInsert = {
        job_type: remediation.job_type as JobType,
        status: "pending",
        details: jobParams as Database["public"]["Tables"]["jobs"]["Insert"]["details"],
      };

      const { data: job, error } = await supabase
        .from("jobs")
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;
      return job;
    },
    onSuccess: (job) => {
      toast.success("Remediation job created", {
        description: `Job ${job.id.slice(0, 8)} queued for execution`,
      });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error) => {
      toast.error("Failed to create remediation job", {
        description: error.message,
      });
    },
  });

  const applyAllFixes = useMutation({
    mutationFn: async ({ 
      remediations, 
      adminPassword 
    }: { 
      remediations: Remediation[]; 
      adminPassword?: string;
    }) => {
      const autoFixable = remediations.filter(r => r.can_auto_fix && r.job_type);
      
      if (autoFixable.length === 0) {
        throw new Error("No auto-fixable issues found");
      }

      const results = await Promise.all(
        autoFixable.map(async (remediation) => {
          const jobParams: Record<string, unknown> = {
            ...remediation.job_params,
            is_remediation: true,
          };

          if (adminPassword && remediation.requires_password) {
            jobParams.admin_password = adminPassword;
          }

          const insertData: JobInsert = {
            job_type: remediation.job_type as JobType,
            status: "pending",
            details: jobParams as Database["public"]["Tables"]["jobs"]["Insert"]["details"],
          };

          const { data, error } = await supabase
            .from("jobs")
            .insert(insertData)
            .select()
            .single();

          if (error) throw error;
          return data;
        })
      );

      return results;
    },
    onSuccess: (jobs) => {
      toast.success(`${jobs.length} remediation jobs created`, {
        description: "Jobs queued for execution",
      });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error) => {
      toast.error("Failed to create remediation jobs", {
        description: error.message,
      });
    },
  });

  const getAutoFixableCount = (checks: CheckWithRemediation[]) => {
    return checks.filter(c => !c.passed && c.remediation?.can_auto_fix).length;
  };

  const getRemediations = (checks: CheckWithRemediation[]) => {
    return checks
      .filter(c => !c.passed && c.remediation)
      .map(c => c.remediation!);
  };

  return {
    applyFix,
    applyAllFixes,
    getAutoFixableCount,
    getRemediations,
  };
}
