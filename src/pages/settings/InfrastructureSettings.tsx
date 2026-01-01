import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  LayoutDashboard, 
  Library, 
  Briefcase, 
  Plug 
} from "lucide-react";
import {
  InfrastructureHealthOverview,
  LibraryTabPanel,
  OpenManageIntegrationCard,
  ServerGroupsCard
} from "@/components/infrastructure/settings";

export function InfrastructureSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('section') || 'overview');
  const [librarySubTab, setLibrarySubTab] = useState<string>('iso');

  useEffect(() => {
    const section = searchParams.get('section');
    if (section && ['overview', 'libraries', 'server-groups', 'integrations'].includes(section)) {
      setActiveTab(section);
    }
  }, [searchParams]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    // Preserve existing params (like 'tab') while updating 'section'
    const newParams = new URLSearchParams(searchParams);
    newParams.set('section', value);
    setSearchParams(newParams);
  };

  const handleNavigateToTab = (tab: string) => {
    handleTabChange(tab);
  };

  const handleQuickAction = (action: string) => {
    switch (action) {
      case 'add-iso':
        setLibrarySubTab('iso');
        handleTabChange('libraries');
        // The IsoImageLibrary will handle opening the dialog via its own state
        break;
      case 'upload-firmware':
        setLibrarySubTab('firmware');
        handleTabChange('libraries');
        break;
      case 'prepare-appliance':
        setLibrarySubTab('zfs');
        handleTabChange('libraries');
        break;
      case 'create-group':
        handleTabChange('server-groups');
        break;
      case 'sync-openmanage':
        handleTabChange('integrations');
        break;
    }
  };

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <LayoutDashboard className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="libraries" className="gap-2">
            <Library className="h-4 w-4" />
            Libraries
          </TabsTrigger>
          <TabsTrigger value="server-groups" className="gap-2">
            <Briefcase className="h-4 w-4" />
            Server Groups
          </TabsTrigger>
          <TabsTrigger value="integrations" className="gap-2">
            <Plug className="h-4 w-4" />
            Integrations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <InfrastructureHealthOverview
            onNavigateToTab={handleNavigateToTab}
            onQuickAction={handleQuickAction}
          />
        </TabsContent>

        <TabsContent value="libraries" className="mt-6">
          <LibraryTabPanel defaultTab={librarySubTab} />
        </TabsContent>

        <TabsContent value="server-groups" className="mt-6">
          <ServerGroupsCard />
        </TabsContent>

        <TabsContent value="integrations" className="mt-6">
          <div className="space-y-4">
            <OpenManageIntegrationCard />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
