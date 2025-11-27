import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Server, HardDrive, Cpu, Activity, CheckCircle2, XCircle } from "lucide-react";
import type { VCenterCluster } from "@/hooks/useVCenterData";

interface ClustersPanelProps {
  clusters: VCenterCluster[];
  selectedClusterId: string | null;
  onClusterClick: (cluster: VCenterCluster) => void;
  loading: boolean;
}

export function ClustersPanel({ clusters, selectedClusterId, onClusterClick, loading }: ClustersPanelProps) {
  const getStatusColor = (status: string | null) => {
    switch (status?.toLowerCase()) {
      case "green":
        return "bg-success text-success-foreground";
      case "yellow":
        return "bg-warning text-warning-foreground";
      case "red":
        return "bg-destructive text-destructive-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return "0 TB";
    const tb = bytes / (1024 ** 4);
    return `${tb.toFixed(1)} TB`;
  };

  const getUsagePercent = (used: number | null, total: number | null) => {
    if (!used || !total) return 0;
    return Math.round((used / total) * 100);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          Loading clusters...
        </div>
      </div>
    );
  }

  if (clusters.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p className="text-lg font-medium mb-2">No clusters found</p>
          <p className="text-sm">Sync vCenter data to see clusters</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
      {clusters.map((cluster) => {
        const cpuPercent = getUsagePercent(cluster.used_cpu_mhz, cluster.total_cpu_mhz);
        const memoryPercent = getUsagePercent(cluster.used_memory_bytes, cluster.total_memory_bytes);
        const storagePercent = getUsagePercent(cluster.used_storage_bytes, cluster.total_storage_bytes);

        return (
          <Card
            key={cluster.id}
            className={`cursor-pointer transition-colors ${
              selectedClusterId === cluster.id ? "ring-2 ring-primary" : "hover:bg-accent/50"
            }`}
            onClick={() => onClusterClick(cluster)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <CardTitle className="text-lg">{cluster.cluster_name}</CardTitle>
                <Badge className={getStatusColor(cluster.overall_status)}>
                  {cluster.overall_status || "Unknown"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Host and VM counts */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Hosts</p>
                    <p className="text-lg font-semibold">{cluster.host_count || 0}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">VMs</p>
                    <p className="text-lg font-semibold">{cluster.vm_count || 0}</p>
                  </div>
                </div>
              </div>

              {/* HA/DRS Status */}
              <div className="flex items-center gap-4 pt-2 border-t">
                <div className="flex items-center gap-1.5">
                  {cluster.ha_enabled ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-xs">HA</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {cluster.drs_enabled ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-xs">DRS</span>
                  {cluster.drs_enabled && cluster.drs_automation_level && (
                    <Badge variant="outline" className="text-xs">
                      {cluster.drs_automation_level}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Resource Usage */}
              <div className="space-y-3 pt-2 border-t">
                {/* CPU */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-1">
                      <Cpu className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">CPU</span>
                    </div>
                    <span className="font-medium">{cpuPercent}%</span>
                  </div>
                  <Progress value={cpuPercent} className="h-1.5" />
                </div>

                {/* Memory */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-1">
                      <Activity className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Memory</span>
                    </div>
                    <span className="font-medium">{memoryPercent}%</span>
                  </div>
                  <Progress value={memoryPercent} className="h-1.5" />
                </div>

                {/* Storage */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-1">
                      <HardDrive className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Storage</span>
                    </div>
                    <span className="font-medium">{storagePercent}%</span>
                  </div>
                  <Progress value={storagePercent} className="h-1.5" />
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatBytes(cluster.used_storage_bytes)} / {formatBytes(cluster.total_storage_bytes)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
