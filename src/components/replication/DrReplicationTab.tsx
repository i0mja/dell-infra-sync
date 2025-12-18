import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProtectionGroupsPanel } from "./ProtectionGroupsPanel";
import { ReplicationJobsPanel } from "./ReplicationJobsPanel";
import { ReplicationTargetsPanel } from "./ReplicationTargetsPanel";
import { DrStatsBar } from "./DrStatsBar";
import { DrQuickActions } from "./DrQuickActions";
import { DrOnboarding } from "./DrOnboarding";
import { OnboardZfsTargetWizard } from "./OnboardZfsTargetWizard";
import { UnifiedStatusHeader } from "./UnifiedStatusHeader";
import { SLAViolationsPanel } from "./SLAViolationsPanel";
import { useProtectionGroups } from "@/hooks/useReplication";
import { Shield, Server, Activity, AlertTriangle } from "lucide-react";

export function DrReplicationTab() {
  const { groups, loading } = useProtectionGroups();
  const [activeTab, setActiveTab] = useState("groups");
  const [showOnboardWizard, setShowOnboardWizard] = useState(false);

  const hasData = groups.length > 0;

  // Show onboarding if no data
  if (!loading && !hasData) {
    return (
      <>
        <DrOnboarding onOpenOnboardWizard={() => setShowOnboardWizard(true)} />
        <OnboardZfsTargetWizard
          open={showOnboardWizard}
          onOpenChange={setShowOnboardWizard}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <DrStatsBar />
      <DrQuickActions onOpenOnboardWizard={() => setShowOnboardWizard(true)} />
      <UnifiedStatusHeader />
      <div className="flex-1 overflow-auto p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-4 max-w-2xl">
            <TabsTrigger value="groups" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              <span className="hidden sm:inline">Protection Groups</span>
              <span className="sm:hidden">Groups</span>
            </TabsTrigger>
            <TabsTrigger value="targets" className="flex items-center gap-2">
              <Server className="h-4 w-4" />
              <span className="hidden sm:inline">ZFS Infrastructure</span>
              <span className="sm:hidden">Infra</span>
            </TabsTrigger>
            <TabsTrigger value="jobs" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              <span className="hidden sm:inline">Activity History</span>
              <span className="sm:hidden">Activity</span>
            </TabsTrigger>
            <TabsTrigger value="sla" className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="hidden sm:inline">SLA Compliance</span>
              <span className="sm:hidden">SLA</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="groups" className="mt-4">
            <ProtectionGroupsPanel />
          </TabsContent>
          <TabsContent value="targets" className="mt-4">
            <ReplicationTargetsPanel onAddTarget={() => setShowOnboardWizard(true)} />
          </TabsContent>
          <TabsContent value="jobs" className="mt-4">
            <ReplicationJobsPanel />
          </TabsContent>
          <TabsContent value="sla" className="mt-4">
            <SLAViolationsPanel />
          </TabsContent>
        </Tabs>
      </div>
      
      <OnboardZfsTargetWizard
        open={showOnboardWizard}
        onOpenChange={setShowOnboardWizard}
      />
    </div>
  );
}
