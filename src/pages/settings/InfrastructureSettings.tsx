import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { SettingsTabLayout, SettingsTab } from "@/components/settings";
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
  const [searchParams] = useSearchParams();
  const [librarySubTab, setLibrarySubTab] = useState<string>('iso');

  const handleNavigateToTab = (tab: string) => {
    // Navigation is handled by SettingsTabLayout via URL
    const params = new URLSearchParams(searchParams);
    params.set('section', tab);
    window.history.replaceState({}, '', `?${params.toString()}`);
  };

  const handleQuickAction = (action: string) => {
    switch (action) {
      case 'add-iso':
        setLibrarySubTab('iso');
        handleNavigateToTab('libraries');
        break;
      case 'upload-firmware':
        setLibrarySubTab('firmware');
        handleNavigateToTab('libraries');
        break;
      case 'prepare-appliance':
        setLibrarySubTab('zfs');
        handleNavigateToTab('libraries');
        break;
      case 'create-group':
        handleNavigateToTab('server-groups');
        break;
      case 'sync-openmanage':
        handleNavigateToTab('integrations');
        break;
    }
  };

  const tabs: SettingsTab[] = [
    { 
      id: 'overview', 
      label: 'Overview', 
      icon: LayoutDashboard, 
      content: (
        <InfrastructureHealthOverview
          onNavigateToTab={handleNavigateToTab}
          onQuickAction={handleQuickAction}
        />
      )
    },
    { 
      id: 'libraries', 
      label: 'Libraries', 
      icon: Library, 
      content: <LibraryTabPanel defaultTab={librarySubTab} />
    },
    { 
      id: 'server-groups', 
      label: 'Server Groups', 
      icon: Briefcase, 
      content: <ServerGroupsCard />
    },
    { 
      id: 'integrations', 
      label: 'Integrations', 
      icon: Plug, 
      content: (
        <div className="space-y-4">
          <OpenManageIntegrationCard />
        </div>
      )
    },
  ];

  return (
    <SettingsTabLayout 
      tabs={tabs} 
      defaultTab="overview"
    />
  );
}
