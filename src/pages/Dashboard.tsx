import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { InfrastructureStatusStrip } from "@/components/dashboard/InfrastructureStatusStrip";
import { PriorityAlertCenter } from "@/components/dashboard/PriorityAlertCenter";
import { ClusterTopologyMap } from "@/components/dashboard/ClusterTopologyMap";
import { OperationsCommandPanel } from "@/components/dashboard/OperationsCommandPanel";
import { TrendAnalytics } from "@/components/dashboard/TrendAnalytics";
import { ServerCoverageWidget } from "@/components/dashboard/ServerCoverageWidget";
import { RecentActivityWidget } from "@/components/dashboard/RecentActivityWidget";
import { QuickActionsWidget } from "@/components/dashboard/QuickActionsWidget";

const Dashboard = () => {
  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      {/* Header with Fleet Health Score */}
      <DashboardHeader />

      {/* Infrastructure Status Strip */}
      <InfrastructureStatusStrip />
      
      {/* Priority Alerts */}
      <PriorityAlertCenter />

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Cluster Topology */}
        <ClusterTopologyMap />
        
        {/* Operations Command Panel */}
        <OperationsCommandPanel />
      </div>

      {/* Trends */}
      <TrendAnalytics />

      {/* Bottom Widgets */}
      <div className="grid md:grid-cols-3 gap-6">
        <ServerCoverageWidget />
        <RecentActivityWidget />
        <QuickActionsWidget />
      </div>
    </div>
  );
};

export default Dashboard;
