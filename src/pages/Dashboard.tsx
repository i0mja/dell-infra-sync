import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, BarChart3, Gauge, Server, Settings } from "lucide-react";

// Import all dashboard widgets
import { PowerThermalHeatmapWidget } from "@/components/dashboard/PowerThermalHeatmapWidget";
import { FirmwareComplianceWidget } from "@/components/dashboard/FirmwareComplianceWidget";
import { SystemEventLogWidget } from "@/components/dashboard/SystemEventLogWidget";
import { ClusterHealthWidget } from "@/components/dashboard/ClusterHealthWidget";
import { StorageHealthWidget } from "@/components/dashboard/StorageHealthWidget";
import { MaintenanceTimelineWidget } from "@/components/dashboard/MaintenanceTimelineWidget";
import { ScpBackupStatusWidget } from "@/components/dashboard/ScpBackupStatusWidget";
import { VirtualMediaStatusWidget } from "@/components/dashboard/VirtualMediaStatusWidget";
import { ApiHealthMetricsWidget } from "@/components/dashboard/ApiHealthMetricsWidget";
import { EsxiUpgradeReadinessWidget } from "@/components/dashboard/EsxiUpgradeReadinessWidget";

const Dashboard = () => {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Fleet Management Dashboard</h1>
        <p className="text-muted-foreground max-w-3xl">
          Comprehensive visibility across your Dell server infrastructure with real-time health monitoring, 
          compliance tracking, and operational insights.
        </p>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5 lg:w-auto">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            <span className="hidden sm:inline">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="health" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">Health</span>
          </TabsTrigger>
          <TabsTrigger value="infrastructure" className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            <span className="hidden sm:inline">Infrastructure</span>
          </TabsTrigger>
          <TabsTrigger value="operations" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Operations</span>
          </TabsTrigger>
          <TabsTrigger value="metrics" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Metrics</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <FirmwareComplianceWidget />
            <ClusterHealthWidget />
            <SystemEventLogWidget />
            <MaintenanceTimelineWidget />
            <ApiHealthMetricsWidget />
            <EsxiUpgradeReadinessWidget />
          </div>
        </TabsContent>

        <TabsContent value="health" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <PowerThermalHeatmapWidget />
            <SystemEventLogWidget />
            <StorageHealthWidget />
            <ClusterHealthWidget />
            <ScpBackupStatusWidget />
            <ApiHealthMetricsWidget />
          </div>
        </TabsContent>

        <TabsContent value="infrastructure" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <ClusterHealthWidget />
            <StorageHealthWidget />
            <EsxiUpgradeReadinessWidget />
            <FirmwareComplianceWidget />
            <VirtualMediaStatusWidget />
            <PowerThermalHeatmapWidget />
          </div>
        </TabsContent>

        <TabsContent value="operations" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <MaintenanceTimelineWidget />
            <ScpBackupStatusWidget />
            <VirtualMediaStatusWidget />
            <SystemEventLogWidget />
            <ApiHealthMetricsWidget />
            <EsxiUpgradeReadinessWidget />
          </div>
        </TabsContent>

        <TabsContent value="metrics" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <ApiHealthMetricsWidget />
            <FirmwareComplianceWidget />
            <PowerThermalHeatmapWidget />
            <StorageHealthWidget />
            <ClusterHealthWidget />
            <SystemEventLogWidget />
          </div>
        </TabsContent>
      </Tabs>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle>API Integration Details</CardTitle>
          <CardDescription>Data sources and refresh intervals</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <strong>Dell Redfish APIs:</strong>
              <ul className="list-disc list-inside ml-2 text-xs space-y-1 mt-1">
                <li>/Thermal - Temperature sensors (30s refresh)</li>
                <li>/Power - Power consumption data (30s refresh)</li>
                <li>/FirmwareInventory - Version tracking</li>
                <li>/Storage - RAID/drive health</li>
                <li>/Logs/Sel - System Event Logs (1m refresh)</li>
                <li>/VirtualMedia - ISO mount status (30s refresh)</li>
              </ul>
            </div>
            <div>
              <strong>VMware APIs (pyvmomi):</strong>
              <ul className="list-disc list-inside ml-2 text-xs space-y-1 mt-1">
                <li>vim.ClusterComputeResource - Cluster health</li>
                <li>vim.HostSystem - ESXi host data</li>
                <li>Datastore capacity and accessibility</li>
              </ul>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t">
            <strong>Database Tables:</strong>
            <ul className="list-disc list-inside ml-2 text-xs space-y-1 mt-1">
              <li>server_health, server_drives, server_event_logs</li>
              <li>vcenter_clusters, vcenter_hosts, cluster_safety_checks</li>
              <li>maintenance_windows, scp_backups, virtual_media_sessions</li>
              <li>idrac_commands (API metrics), esxi_upgrade_profiles/history</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
