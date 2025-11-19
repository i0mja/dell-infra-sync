import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnalysisRequest {
  start_date: string;
  end_date: string;
  min_window_duration_hours?: number;
  clusters?: string[];
}

interface OptimalWindow {
  start: string;
  end: string;
  duration_hours: number;
  confidence: 'high' | 'medium' | 'low';
  all_clusters_safe: boolean;
  affected_clusters: string[];
  avg_healthy_hosts: number;
  avg_total_hosts: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { start_date, end_date, min_window_duration_hours = 4, clusters }: AnalysisRequest = await req.json();

    console.log(`Analyzing maintenance windows from ${start_date} to ${end_date}`);

    // Fetch all safety checks for the date range
    let query = supabase
      .from('cluster_safety_checks')
      .select('*')
      .gte('check_timestamp', start_date)
      .lte('check_timestamp', end_date)
      .order('check_timestamp', { ascending: true });

    if (clusters && clusters.length > 0) {
      query = query.in('cluster_id', clusters);
    }

    const { data: safetyChecks, error } = await query;

    if (error) {
      throw error;
    }

    if (!safetyChecks || safetyChecks.length === 0) {
      return new Response(JSON.stringify({ 
        optimal_windows: [],
        cluster_statistics: {},
        recommendations: ['No safety check data available for the selected period']
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Group checks by day and cluster
    const dailyStatus = new Map<string, Map<string, any>>();

    for (const check of safetyChecks) {
      const dateKey = new Date(check.check_timestamp).toISOString().split('T')[0];
      
      if (!dailyStatus.has(dateKey)) {
        dailyStatus.set(dateKey, new Map());
      }
      
      const dayMap = dailyStatus.get(dateKey)!;
      const clusterId = check.cluster_id;
      
      // Keep the latest check for each cluster on each day
      if (!dayMap.has(clusterId) || 
          new Date(check.check_timestamp) > new Date(dayMap.get(clusterId).check_timestamp)) {
        dayMap.set(clusterId, {
          safe: check.safe_to_proceed,
          healthy_hosts: check.healthy_hosts,
          total_hosts: check.total_hosts,
          check_timestamp: check.check_timestamp
        });
      }
    }

    // Get unique clusters
    const uniqueClusters = new Set<string>();
    safetyChecks.forEach(check => uniqueClusters.add(check.cluster_id));
    const clusterArray = Array.from(uniqueClusters);

    // Identify continuous safe periods
    const optimalWindows: OptimalWindow[] = [];
    let currentWindow: OptimalWindow | null = null;

    const sortedDates = Array.from(dailyStatus.keys()).sort();

    for (const dateKey of sortedDates) {
      const dayMap = dailyStatus.get(dateKey)!;
      const allClustersPresent = clusterArray.every(c => dayMap.has(c));
      const allSafe = allClustersPresent && Array.from(dayMap.values()).every(c => c.safe);

      if (allSafe) {
        const dayDate = new Date(dateKey + 'T00:00:00Z');
        
        if (!currentWindow) {
          // Start new window
          const avgHealthy = Array.from(dayMap.values()).reduce((sum, c) => sum + c.healthy_hosts, 0) / dayMap.size;
          const avgTotal = Array.from(dayMap.values()).reduce((sum, c) => sum + c.total_hosts, 0) / dayMap.size;
          
          currentWindow = {
            start: dayDate.toISOString(),
            end: new Date(dayDate.getTime() + 24 * 60 * 60 * 1000).toISOString(),
            duration_hours: 24,
            confidence: 'high',
            all_clusters_safe: true,
            affected_clusters: clusterArray,
            avg_healthy_hosts: avgHealthy,
            avg_total_hosts: avgTotal
          };
        } else {
          // Extend existing window
          const nextDay = new Date(dayDate.getTime() + 24 * 60 * 60 * 1000);
          currentWindow.end = nextDay.toISOString();
          currentWindow.duration_hours = 
            (new Date(currentWindow.end).getTime() - new Date(currentWindow.start).getTime()) / (1000 * 60 * 60);
        }
      } else if (currentWindow) {
        // Window ended, save it if it meets minimum duration
        if (currentWindow.duration_hours >= min_window_duration_hours) {
          // Calculate confidence based on window length and cluster coverage
          if (currentWindow.duration_hours >= 48) {
            currentWindow.confidence = 'high';
          } else if (currentWindow.duration_hours >= 24) {
            currentWindow.confidence = 'medium';
          } else {
            currentWindow.confidence = 'low';
          }
          
          optimalWindows.push(currentWindow);
        }
        currentWindow = null;
      }
    }

    // Don't forget the last window if still open
    if (currentWindow && currentWindow.duration_hours >= min_window_duration_hours) {
      optimalWindows.push(currentWindow);
    }

    // Sort windows by duration (longest first) and confidence
    optimalWindows.sort((a, b) => {
      if (a.confidence !== b.confidence) {
        const confOrder = { high: 3, medium: 2, low: 1 };
        return confOrder[b.confidence] - confOrder[a.confidence];
      }
      return b.duration_hours - a.duration_hours;
    });

    // Calculate cluster statistics
    const clusterStats: { [key: string]: any } = {};
    
    for (const cluster of clusterArray) {
      const clusterChecks = safetyChecks.filter(c => c.cluster_id === cluster);
      const safeChecks = clusterChecks.filter(c => c.safe_to_proceed);
      const uptimePct = (safeChecks.length / clusterChecks.length) * 100;
      
      // Calculate best days/times (simplified for MVP)
      const dayOfWeekCounts = new Map<string, { safe: number, total: number }>();
      
      for (const check of clusterChecks) {
        const date = new Date(check.check_timestamp);
        const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
        
        if (!dayOfWeekCounts.has(dayName)) {
          dayOfWeekCounts.set(dayName, { safe: 0, total: 0 });
        }
        
        const dayCount = dayOfWeekCounts.get(dayName)!;
        dayCount.total++;
        if (check.safe_to_proceed) dayCount.safe++;
      }
      
      const bestDays = Array.from(dayOfWeekCounts.entries())
        .sort((a, b) => (b[1].safe / b[1].total) - (a[1].safe / a[1].total))
        .slice(0, 3)
        .map(([day]) => day);

      clusterStats[cluster] = {
        avg_uptime_pct: Math.round(uptimePct * 10) / 10,
        total_checks: clusterChecks.length,
        safe_checks: safeChecks.length,
        best_days: bestDays
      };
    }

    // Generate recommendations
    const recommendations: string[] = [];
    
    if (optimalWindows.length === 0) {
      recommendations.push('No optimal maintenance windows found. Consider running more frequent safety checks.');
    } else if (optimalWindows.length < 3) {
      recommendations.push('Limited maintenance windows available. Monitor cluster health closely.');
    } else {
      recommendations.push(`${optimalWindows.length} optimal maintenance windows identified.`);
      
      const highConfWindows = optimalWindows.filter(w => w.confidence === 'high');
      if (highConfWindows.length > 0) {
        recommendations.push(`${highConfWindows.length} high-confidence windows available for immediate planning.`);
      }
    }

    // Check for patterns
    const avgWindowDuration = optimalWindows.reduce((sum, w) => sum + w.duration_hours, 0) / optimalWindows.length;
    if (avgWindowDuration > 48) {
      recommendations.push('Clusters show good stability with extended safe periods.');
    }

    return new Response(JSON.stringify({ 
      optimal_windows: optimalWindows.slice(0, 10), // Return top 10
      cluster_statistics: clusterStats,
      recommendations
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error analyzing maintenance windows:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      optimal_windows: [],
      cluster_statistics: {},
      recommendations: []
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
