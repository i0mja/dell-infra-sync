import { FleetStatusBar } from "@/components/dashboard/FleetStatusBar";
import { IssuesBanner } from "@/components/dashboard/IssuesBanner";
import { RecentActivityWidget } from "@/components/dashboard/RecentActivityWidget";
import { ServerCoverageWidget } from "@/components/dashboard/ServerCoverageWidget";
import { QuickActionsWidget } from "@/components/dashboard/QuickActionsWidget";
import { OperationsCard } from "@/components/dashboard/OperationsCard";

const Dashboard = () => {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Fleet Management Dashboard</h1>
        <p className="text-muted-foreground max-w-3xl">
          Real-time visibility across the Dell server infrastructure
        </p>
      </div>

      <FleetStatusBar />
      
      <IssuesBanner />

      <div className="grid md:grid-cols-2 gap-6">
        <RecentActivityWidget />
        <OperationsCard />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <ServerCoverageWidget />
        <QuickActionsWidget />
      </div>
    </div>
  );
};

export default Dashboard;
