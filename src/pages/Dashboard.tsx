import { FleetStatusBar } from "@/components/dashboard/FleetStatusBar";
import { AlertSummaryBanner } from "@/components/dashboard/AlertSummaryBanner";
import { ClusterStatusSummary } from "@/components/dashboard/ClusterStatusSummary";
import { InfrastructureHealthCard } from "@/components/dashboard/InfrastructureHealthCard";
import { OperationsCard } from "@/components/dashboard/OperationsCard";
const Dashboard = () => {
  return <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Fleet Management Dashboard</h1>
        <p className="text-muted-foreground max-w-3xl">
          Real-time visibility across the Dell server infrastructure
        </p>
      </div>

      <FleetStatusBar />
      
      <AlertSummaryBanner />

      <div className="grid md:grid-cols-2 gap-6">
        <InfrastructureHealthCard />
        <OperationsCard />
      </div>

      <div className="border rounded-lg p-4">
        <ClusterStatusSummary />
      </div>
    </div>;
};
export default Dashboard;