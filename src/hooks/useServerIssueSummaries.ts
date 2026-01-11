import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface IssueDetail {
  type: 'drive' | 'memory';
  slot: string;           // "Bay 9" or "DIMM A1"
  health: string;         // "Critical", "Warning"
  status: string;         // "Enabled", "Disabled", "UnavailableOffline"
  message?: string;       // Failure message if available
  isCritical: boolean;    // Quick check for severity
}

export interface ServerIssueSummary {
  server_id: string;
  issues: IssueDetail[];
  hasCritical: boolean;   // At least one critical issue
  hasWarning: boolean;    // Only warnings (no critical)
}

export function useServerIssueSummaries() {
  return useQuery({
    queryKey: ["server-issue-summaries"],
    queryFn: async () => {
      // Get drive issues with details
      const { data: driveData } = await supabase
        .from("server_drives")
        .select("server_id, slot, health, status, predicted_failure, model");
      
      // Get memory issues with details
      const { data: memoryData } = await supabase
        .from("server_memory")
        .select("server_id, slot_name, health, status");
      
      // Aggregate by server_id with full details
      const summaryMap = new Map<string, ServerIssueSummary>();
      
      driveData?.forEach(d => {
        const isCritical = 
          d.health === "Critical" || 
          d.status === "Disabled" || 
          d.status === "UnavailableOffline" ||
          d.predicted_failure === true;
        
        const isWarning = d.health === "Warning" && !isCritical;
        
        if (isCritical || isWarning) {
          const existing = summaryMap.get(d.server_id) || { 
            server_id: d.server_id, 
            issues: [],
            hasCritical: false,
            hasWarning: false
          };
          
          existing.issues.push({
            type: 'drive',
            slot: d.slot || 'Unknown',
            health: d.health || 'Unknown',
            status: d.status || 'Unknown',
            message: d.predicted_failure 
              ? 'Predictive failure detected'
              : (d.status === "Disabled" ? 'Drive disabled' : undefined),
            isCritical
          });
          
          if (isCritical) existing.hasCritical = true;
          if (isWarning && !existing.hasCritical) existing.hasWarning = true;
          
          summaryMap.set(d.server_id, existing);
        }
      });
      
      memoryData?.forEach(m => {
        const isCritical = m.health === "Critical" || m.status === "Disabled";
        const isWarning = m.health === "Warning" && !isCritical;
        const hasIssue = isCritical || isWarning || (m.health && m.health !== "OK");
        
        if (hasIssue) {
          const existing = summaryMap.get(m.server_id) || { 
            server_id: m.server_id, 
            issues: [],
            hasCritical: false,
            hasWarning: false
          };
          
          existing.issues.push({
            type: 'memory',
            slot: m.slot_name || 'Unknown',
            health: m.health || 'Unknown',
            status: m.status || 'Unknown',
            message: m.health === "Critical" ? 'Memory failure' : undefined,
            isCritical
          });
          
          if (isCritical) existing.hasCritical = true;
          if (isWarning && !existing.hasCritical) existing.hasWarning = true;
          
          summaryMap.set(m.server_id, existing);
        }
      });
      
      return summaryMap;
    },
    staleTime: 30000,
  });
}
