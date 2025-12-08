import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProtectionGroupsPanel } from "./ProtectionGroupsPanel";
import { ReplicationJobsPanel } from "./ReplicationJobsPanel";
import { ReplicationPairsPanel } from "./ReplicationPairsPanel";
import { DrStatsBar } from "./DrStatsBar";
import { DrQuickActions } from "./DrQuickActions";
import { DrOnboarding } from "./DrOnboarding";
import { OnboardZfsTargetWizard } from "./OnboardZfsTargetWizard";
import { useProtectionGroups } from "@/hooks/useReplication";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

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
      <div className="flex-1 overflow-auto p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="groups">Protection Groups</TabsTrigger>
              <TabsTrigger value="pairs">Replication Pairs</TabsTrigger>
              <TabsTrigger value="jobs">Replication Jobs</TabsTrigger>
            </TabsList>
            <Button size="sm" onClick={() => setShowOnboardWizard(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add ZFS Target
            </Button>
          </div>
          <TabsContent value="groups" className="mt-4">
            <ProtectionGroupsPanel />
          </TabsContent>
          <TabsContent value="pairs" className="mt-4">
            <ReplicationPairsPanel />
          </TabsContent>
          <TabsContent value="jobs" className="mt-4">
            <ReplicationJobsPanel />
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
