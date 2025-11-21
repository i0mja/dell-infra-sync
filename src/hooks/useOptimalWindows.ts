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
        const { data, error } = await supabase.functions.invoke('analyze-maintenance-windows', {
          body: { clusters }
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
