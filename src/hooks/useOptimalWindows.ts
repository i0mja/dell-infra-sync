import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface OptimalWindow {
  start: string;
  end: string;
  duration_hours: number;
  confidence: 'high' | 'medium' | 'low';
  affected_clusters: string[];
  available_hosts?: number;
  all_clusters_safe: boolean;
  avg_healthy_hosts: number;
  avg_total_hosts: number;
  reason?: string;
}

export function useOptimalWindows(clusters: string[]) {
  const [windows, setWindows] = useState<OptimalWindow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOptimalWindows = async () => {
      if (clusters.length === 0) {
        setWindows([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        
        // Analyze from today to 90 days in the future
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 90);
        
        const { data, error } = await supabase.functions.invoke('analyze-maintenance-windows', {
          body: { 
            clusters,
            start_date: startDate.toISOString(),
            end_date: endDate.toISOString(),
            min_window_duration_hours: 4
          }
        });

        if (error) throw error;
        setWindows(data?.optimal_windows || []);
      } catch (error) {
        console.error('Error fetching optimal windows:', error);
        setWindows([]);
      } finally {
        setLoading(false);
      }
    };

    fetchOptimalWindows();
  }, [clusters.join(',')]);

  return {
    windows,
    loading
  };
}
