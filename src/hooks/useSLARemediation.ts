import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { SLARemediation, getErrorDefinition } from "@/lib/sla-error-definitions";

type JobType = Database["public"]["Enums"]["job_type"];
type JobInsert = Database["public"]["Tables"]["jobs"]["Insert"];

export interface SLAViolationWithRemediation {
  id: string;
  protection_group_id: string;
  violation_type: string;
  severity: string;
  details: {
    group_name?: string;
    current_rpo_minutes?: number;
    target_rpo_minutes?: number;
    error_code?: string;
    [key: string]: unknown;
  };
  remediation?: SLARemediation;
}

// Map violation types to error codes
function getErrorCodeFromViolationType(violationType: string): string {
  switch (violationType) {
    case 'rpo_breach':
      return 'LAST_SYNC_TOO_OLD';
    case 'test_overdue':
      return 'FAILOVER_TEST_OVERDUE';
    case 'never_synced':
      return 'NEVER_SYNCED';
    case 'group_paused':
      return 'GROUP_PAUSED';
    case 'dr_shell_missing':
      return 'DR_SHELL_VM_MISSING';
    case 'ssh_trust_failed':
      return 'SSH_TRUST_NOT_ESTABLISHED';
    case 'snapshot_chain_broken':
      return 'SNAPSHOT_CHAIN_BROKEN';
    case 'sync_stuck':
      return 'SYNC_STUCK_IN_PROGRESS';
    default:
      return violationType.toUpperCase();
  }
}

export function useSLARemediation() {
  const queryClient = useQueryClient();

  // Apply a single fix
  const applyFix = useMutation({
    mutationFn: async ({ 
      violation, 
      adminPassword 
    }: { 
      violation: SLAViolationWithRemediation; 
      adminPassword?: string;
    }) => {
      const errorCode = violation.details.error_code || getErrorCodeFromViolationType(violation.violation_type);
      const definition = getErrorDefinition(errorCode);
      const remediation = definition?.remediation;

      if (!remediation) {
        throw new Error("No remediation available for this violation");
      }

      // Handle direct_update actions
      if (remediation.action_type === 'direct_update') {
        if (errorCode === 'GROUP_PAUSED') {
          const { error } = await supabase
            .from('protection_groups')
            .update({ 
              paused_at: null, 
              pause_reason: null,
              is_enabled: true
            })
            .eq('id', violation.protection_group_id);
          
          if (error) throw error;
          
          // Resolve the violation
          await supabase
            .from('sla_violations')
            .update({ resolved_at: new Date().toISOString() })
            .eq('id', violation.id);
          
          return { type: 'direct_update', success: true };
        }
        throw new Error(`Unknown direct_update action for ${errorCode}`);
      }

      // Handle create_job actions
      if (remediation.action_type === 'create_job' && remediation.job_type) {
        const jobParams: Record<string, unknown> = {
          protection_group_id: violation.protection_group_id,
          triggered_by: 'sla_remediation',
          violation_id: violation.id,
          ...remediation.job_params,
        };

        // Handle password encryption if needed
        if (adminPassword && remediation.requires_password) {
          const { data: encryptData, error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
            body: { password: adminPassword, type: 'return_only' }
          });
          if (encryptError) throw encryptError;
          jobParams.admin_password_encrypted = encryptData?.encrypted;
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
        return { type: 'job_created', job };
      }

      // Handle open_wizard actions - return info for UI to handle
      if (remediation.action_type === 'open_wizard') {
        return { 
          type: 'open_wizard', 
          wizard: errorCode === 'FAILOVER_TEST_OVERDUE' ? 'test_failover' : 'edit_group',
          groupId: violation.protection_group_id
        };
      }

      throw new Error("Unknown remediation action type");
    },
    onSuccess: (result) => {
      if (result.type === 'direct_update') {
        toast.success("Issue resolved", {
          description: "The protection group has been updated",
        });
      } else if (result.type === 'job_created') {
        toast.success("Remediation job created", {
          description: `Job ${result.job.id.slice(0, 8)} queued for execution`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["sla-violations"] });
      queryClient.invalidateQueries({ queryKey: ["protection-groups"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error) => {
      toast.error("Failed to apply fix", {
        description: error.message,
      });
    },
  });

  // Apply all auto-fixable violations
  const applyAllFixes = useMutation({
    mutationFn: async ({ 
      violations, 
      adminPassword 
    }: { 
      violations: SLAViolationWithRemediation[]; 
      adminPassword?: string;
    }) => {
      const autoFixable = violations.filter(v => {
        const errorCode = v.details.error_code || getErrorCodeFromViolationType(v.violation_type);
        const definition = getErrorDefinition(errorCode);
        return definition?.remediation?.can_auto_fix && 
               definition?.remediation?.action_type !== 'open_wizard';
      });

      if (autoFixable.length === 0) {
        throw new Error("No auto-fixable violations found");
      }

      const results = [];
      for (const violation of autoFixable) {
        try {
          const errorCode = violation.details.error_code || getErrorCodeFromViolationType(violation.violation_type);
          const definition = getErrorDefinition(errorCode);
          const remediation = definition?.remediation;

          if (!remediation) continue;

          if (remediation.action_type === 'direct_update' && errorCode === 'GROUP_PAUSED') {
            await supabase
              .from('protection_groups')
              .update({ paused_at: null, pause_reason: null, is_enabled: true })
              .eq('id', violation.protection_group_id);
            
            await supabase
              .from('sla_violations')
              .update({ resolved_at: new Date().toISOString() })
              .eq('id', violation.id);
            
            results.push({ type: 'direct_update', violation_id: violation.id });
          } else if (remediation.action_type === 'create_job' && remediation.job_type) {
            const jobParams: Record<string, unknown> = {
              protection_group_id: violation.protection_group_id,
              triggered_by: 'sla_remediation',
              violation_id: violation.id,
              ...remediation.job_params,
            };

            if (adminPassword && remediation.requires_password) {
              const { data: encryptData } = await supabase.functions.invoke('encrypt-credentials', {
                body: { password: adminPassword, type: 'return_only' }
              });
              if (encryptData?.encrypted) {
                jobParams.admin_password_encrypted = encryptData.encrypted;
              }
            }

            const { data: job, error } = await supabase
              .from("jobs")
              .insert({
                job_type: remediation.job_type as JobType,
                status: "pending",
                details: jobParams as Database["public"]["Tables"]["jobs"]["Insert"]["details"],
              })
              .select()
              .single();

            if (!error && job) {
              results.push({ type: 'job_created', job_id: job.id });
            }
          }
        } catch (err) {
          console.error('Failed to remediate violation:', violation.id, err);
        }
      }

      return results;
    },
    onSuccess: (results) => {
      const jobCount = results.filter(r => r.type === 'job_created').length;
      const directCount = results.filter(r => r.type === 'direct_update').length;
      
      const parts = [];
      if (jobCount > 0) parts.push(`${jobCount} job${jobCount > 1 ? 's' : ''} created`);
      if (directCount > 0) parts.push(`${directCount} issue${directCount > 1 ? 's' : ''} resolved`);
      
      toast.success("Remediation complete", {
        description: parts.join(', '),
      });
      
      queryClient.invalidateQueries({ queryKey: ["sla-violations"] });
      queryClient.invalidateQueries({ queryKey: ["protection-groups"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error) => {
      toast.error("Failed to apply fixes", {
        description: error.message,
      });
    },
  });

  // Get count of auto-fixable violations
  const getAutoFixableCount = (violations: SLAViolationWithRemediation[]): number => {
    return violations.filter(v => {
      const errorCode = v.details.error_code || getErrorCodeFromViolationType(v.violation_type);
      const definition = getErrorDefinition(errorCode);
      return definition?.remediation?.can_auto_fix;
    }).length;
  };

  // Get remediation for a violation
  const getRemediation = (violation: SLAViolationWithRemediation): SLARemediation | undefined => {
    const errorCode = violation.details.error_code || getErrorCodeFromViolationType(violation.violation_type);
    const definition = getErrorDefinition(errorCode);
    return definition?.remediation;
  };

  return {
    applyFix,
    applyAllFixes,
    getAutoFixableCount,
    getRemediation,
    getErrorCodeFromViolationType,
  };
}
