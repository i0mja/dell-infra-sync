import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ServerHardwareIssue {
  server_id: string;
  drive_issues: number;
  memory_issues: number;
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
        const hasIssue = 
          d.health === "Critical" || 
          d.status === "Disabled" || 
          d.status === "UnavailableOffline" ||
          d.predicted_failure === true;
        
        if (hasIssue) {
          const existing = issueMap.get(d.server_id) || { 
            server_id: d.server_id, 
            drive_issues: 0, 
            memory_issues: 0 
          };
          existing.drive_issues++;
          issueMap.set(d.server_id, existing);
        }
      });
      
      memoryData?.forEach(m => {
        const hasIssue = (m.health && m.health !== "OK") || m.status === "Disabled";
        
        if (hasIssue) {
          const existing = issueMap.get(m.server_id) || { 
            server_id: m.server_id, 
            drive_issues: 0, 
            memory_issues: 0 
          };
          existing.memory_issues++;
          issueMap.set(m.server_id, existing);
        }
      });
      
      return issueMap;
    },
    staleTime: 30000, // Cache for 30 seconds
  });
}
