import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Server, Database, Briefcase, Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ClusterSafetyWidget } from "@/components/dashboard/ClusterSafetyWidget";
import { NextMaintenanceWidget } from "@/components/dashboard/NextMaintenanceWidget";
import { FleetHealthOverview } from "@/components/dashboard/FleetHealthOverview";
import { JobOrchestrationPanel } from "@/components/dashboard/JobOrchestrationPanel";
import { CompliancePanel } from "@/components/dashboard/CompliancePanel";
import { PowerThermalOptimizationPanel } from "@/components/dashboard/PowerThermalOptimizationPanel";
import { LifecycleAutomationPanel } from "@/components/dashboard/LifecycleAutomationPanel";
import { AccessGovernancePanel } from "@/components/dashboard/AccessGovernancePanel";
import { NetworkDiagnosticsPanel } from "@/components/dashboard/NetworkDiagnosticsPanel";
import { InventoryTopologyPanel } from "@/components/dashboard/InventoryTopologyPanel";
import { BackupRecoveryPanel } from "@/components/dashboard/BackupRecoveryPanel";
import { ObservabilityPanel } from "@/components/dashboard/ObservabilityPanel";

interface Stats {
  serverCount: number;
  vcenterHostCount: number;
  linkedCount: number;
  activeJobsCount: number;
}

const Dashboard = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [servers, vcenterHosts, jobs] = await Promise.all([
          supabase.from("servers").select("*", { count: "exact" }),
          supabase.from("vcenter_hosts").select("*", { count: "exact" }),
          supabase
            .from("jobs")
            .select("*", { count: "exact" })
            .in("status", ["pending", "running"]),
        ]);

        const linkedServers = await supabase
          .from("servers")
          .select("*", { count: "exact" })
          .not("vcenter_host_id", "is", null);

        setStats({
          serverCount: servers.count || 0,
          vcenterHostCount: vcenterHosts.count || 0,
          linkedCount: linkedServers.count || 0,
          activeJobsCount: jobs.count || 0,
        });
      } catch (error) {
        console.error("Error fetching stats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const statCards = [
    {
      title: "Dell Servers",
      description: "Discovered via iDRAC",
      value: stats?.serverCount || 0,
      icon: Server,
      color: "text-primary",
    },
    {
      title: "vCenter Hosts",
      description: "ESXi hosts in vCenter",
      value: stats?.vcenterHostCount || 0,
      icon: Database,
      color: "text-accent",
    },
    {
      title: "Linked Servers",
      description: "Physical to virtual mapping",
      value: stats?.linkedCount || 0,
      icon: Activity,
      color: "text-success",
    },
    {
      title: "Active Jobs",
      description: "Running or pending",
      value: stats?.activeJobsCount || 0,
      icon: Briefcase,
      color: "text-warning",
    },
  ];

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Infrastructure Dashboard</h1>
        <p className="text-muted-foreground">
          Monitor and manage your Dell server infrastructure and VMware vCenter integration
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <p className="text-xs text-muted-foreground">{stat.description}</p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-6">
        <FleetHealthOverview />
      </div>

      <div className="grid gap-6 xl:grid-cols-6 mt-6">
        <JobOrchestrationPanel />
        <CompliancePanel />
      </div>

      <div className="grid gap-6 xl:grid-cols-6 mt-6">
        <PowerThermalOptimizationPanel />
        <LifecycleAutomationPanel />
      </div>

      <div className="grid gap-6 xl:grid-cols-6 mt-6">
        <InventoryTopologyPanel />
        <NetworkDiagnosticsPanel />
      </div>

      <div className="grid gap-6 xl:grid-cols-6 mt-6">
        <BackupRecoveryPanel />
        <ObservabilityPanel />
      </div>

      <div className="grid gap-6 xl:grid-cols-6 mt-6">
        <div className="xl:col-span-4 grid gap-4 md:grid-cols-2">
          <ClusterSafetyWidget />
          <NextMaintenanceWidget />
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common datacenter operations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>• Discover new servers via IP scan</p>
              <p>• Sync vCenter inventory</p>
              <p>• Create firmware update job</p>
              <p>• Link servers to vCenter hosts</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>System Status</CardTitle>
              <CardDescription>Platform health overview</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>Database</span>
                <span className="text-success">● Operational</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Authentication</span>
                <span className="text-success">● Operational</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Job Scheduler</span>
                <span className="text-success">● Ready</span>
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="xl:col-span-2">
          <AccessGovernancePanel />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
