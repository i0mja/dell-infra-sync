import { Server, Activity, AlertCircle, CheckCircle2, AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

export const FleetStatusBar = () => {
  const { data: servers, isLoading: serversLoading } = useQuery({
    queryKey: ['servers-count'],
    queryFn: async () => {
      const { data } = await supabase.from('servers').select('id, connection_status');
      return data || [];
    }
  });

  const { data: clusters, isLoading: clustersLoading } = useQuery({
    queryKey: ['clusters-count'],
    queryFn: async () => {
      const { data } = await supabase.from('vcenter_clusters').select('id, ha_enabled, drs_enabled');
      return data || [];
    }
  });

  // Query for hardware issues (drives and memory with problems)
  const { data: hardwareIssues, isLoading: hardwareLoading } = useQuery({
    queryKey: ['hardware-issues-count'],
    queryFn: async () => {
      const { data: driveData } = await supabase
        .from("server_drives")
        .select("server_id, health, status, predicted_failure");
      
      const { data: memoryData } = await supabase
        .from("server_memory")
        .select("server_id, health, status");
      
      // Count unique servers with issues
      const serversWithIssues = new Set<string>();
      
      driveData?.forEach(d => {
        if (d.health === "Critical" || d.health === "Warning" || 
            d.status === "Disabled" || d.status === "UnavailableOffline" ||
            d.predicted_failure === true) {
          serversWithIssues.add(d.server_id);
        }
      });
      
      memoryData?.forEach(m => {
        if ((m.health && m.health !== "OK") || m.status === "Disabled") {
          serversWithIssues.add(m.server_id);
        }
      });
      
      return serversWithIssues.size;
    }
  });

  const { data: apiMetrics, isLoading: apiLoading } = useQuery({
    queryKey: ['api-success-rate'],
    queryFn: async () => {
      const { data } = await supabase
        .from('idrac_commands')
        .select('success')
        .gte('timestamp', new Date(Date.now() - 60 * 60 * 1000).toISOString());
      
      if (!data || data.length === 0) return null;
      const successful = data.filter(d => d.success).length;
      return Math.round((successful / data.length) * 100);
    }
  });

  const onlineServers = servers?.filter(s => s.connection_status === 'online').length || 0;
  const totalServers = servers?.length || 0;
  const healthyClusters = clusters?.filter(c => c.ha_enabled && c.drs_enabled).length || 0;
  const totalClusters = clusters?.length || 0;
  const degradedCount = hardwareIssues || 0;

  const isLoading = serversLoading || clustersLoading || hardwareLoading || apiLoading;

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  const stats = [
    {
      icon: Server,
      label: "Servers",
      value: `${onlineServers}/${totalServers}`,
      subtext: "online",
      color: onlineServers === totalServers ? "text-green-600" : "text-amber-600"
    },
    {
      icon: AlertTriangle,
      label: "Hardware Issues",
      value: degradedCount.toString(),
      subtext: "servers degraded",
      color: degradedCount === 0 ? "text-green-600" : "text-amber-600"
    },
    {
      icon: Activity,
      label: "vCenter Clusters",
      value: `${healthyClusters}/${totalClusters}`,
      subtext: "healthy",
      color: healthyClusters === totalClusters ? "text-green-600" : "text-amber-600"
    },
    {
      icon: CheckCircle2,
      label: "API Success Rate",
      value: apiMetrics ? `${apiMetrics}%` : "N/A",
      subtext: "last hour",
      color: apiMetrics && apiMetrics > 95 ? "text-green-600" : "text-amber-600"
    }
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((stat, idx) => (
        <div key={idx} className="p-3 border rounded-lg bg-card hover:bg-accent/5 transition-colors">
          <div className="flex items-center gap-2">
            <stat.icon className={`h-6 w-6 ${stat.color}`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground truncate">{stat.label}</div>
              <div className={`text-xl font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-xs text-muted-foreground">{stat.subtext}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
