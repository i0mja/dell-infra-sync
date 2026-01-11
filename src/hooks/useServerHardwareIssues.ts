import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ServerHardwareIssue {
  server_id: string;
  drive_issues: number;
  memory_issues: number;
  has_critical: boolean;  // At least one critical-level issue
  has_warning: boolean;   // Only warning-level issues (no critical)
}

export function useServerHardwareIssues() {
  return useQuery({
    queryKey: ["server-hardware-issues"],
    queryFn: async () => {
      // Get drive issues per server
      const { data: driveData } = await supabase
        .from("server_drives")
        .select("server_id, health, status, predicted_failure");
      
      // Get memory issues per server
      const { data: memoryData } = await supabase
        .from("server_memory")
        .select("server_id, health, status");
      
      // Aggregate by server_id
      const issueMap = new Map<string, ServerHardwareIssue>();
      
      driveData?.forEach(d => {
        // Critical-level issues
        const isCritical = 
          d.health === "Critical" || 
          d.status === "Disabled" || 
          d.status === "UnavailableOffline" ||
          d.predicted_failure === true;
        
        // Warning-level issues (health is Warning but not critical)
        const isWarning = d.health === "Warning" && !isCritical;
        
        if (isCritical || isWarning) {
          const existing = issueMap.get(d.server_id) || { 
            server_id: d.server_id, 
            drive_issues: 0, 
            memory_issues: 0,
            has_critical: false,
            has_warning: false
          };
          existing.drive_issues++;
          if (isCritical) existing.has_critical = true;
          if (isWarning && !existing.has_critical) existing.has_warning = true;
          issueMap.set(d.server_id, existing);
        }
      });
      
      memoryData?.forEach(m => {
        const isCritical = m.health === "Critical" || m.status === "Disabled";
        const isWarning = m.health === "Warning" && !isCritical;
        const hasIssue = isCritical || isWarning || (m.health && m.health !== "OK");
        
        if (hasIssue) {
          const existing = issueMap.get(m.server_id) || { 
            server_id: m.server_id, 
            drive_issues: 0, 
            memory_issues: 0,
            has_critical: false,
            has_warning: false
          };
          existing.memory_issues++;
          if (isCritical) existing.has_critical = true;
          if (isWarning && !existing.has_critical) existing.has_warning = true;
          issueMap.set(m.server_id, existing);
        }
      });
      
      return issueMap;
    },
    staleTime: 30000, // Cache for 30 seconds
  });
}
