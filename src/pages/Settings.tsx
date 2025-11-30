import { useAuth } from "@/hooks/useAuth";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSearchParams } from "react-router-dom";
import { useState, useEffect } from "react";
import { mapLegacyTabId, settingsTabs } from "@/config/settings-tabs";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { GeneralSettings } from "@/pages/settings/GeneralSettings";
import { SecuritySettings } from "@/pages/settings/SecuritySettings";
import { NotificationSettings } from "@/pages/settings/NotificationSettings";
import { InfrastructureSettings } from "@/pages/settings/InfrastructureSettings";
import { SystemSettings } from "@/pages/settings/SystemSettings";

export default function Settings() {
  const isLocalMode = import.meta.env.VITE_SUPABASE_URL?.includes('127.0.0.1') || 
                      import.meta.env.VITE_SUPABASE_URL?.includes('localhost');
  const { user, userRole } = useAuth();
  const [searchParams] = useSearchParams();
  
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<string>('general');

  useEffect(() => {
    const mapped = mapLegacyTabId(tabFromUrl || 'general');
    setActiveTab(mapped.tab);
  }, [tabFromUrl]);

  if (!user) {
    return null;
  }

  if (userRole !== "admin") {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              Only administrators can access settings.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const currentTab = settingsTabs.find(t => t.id === activeTab) || settingsTabs[0];
  const deploymentMode = isLocalMode ? "air-gapped" : "cloud";

  return (
    <div className="h-full overflow-auto">
      <SettingsPageHeader
        icon={currentTab.icon}
        title={currentTab.title}
        description={currentTab.description}
        badge={{
          label: deploymentMode === "cloud" ? "Cloud" : "Air-Gapped",
          variant: deploymentMode === "cloud" ? "default" : "secondary",
        }}
      />
      
      <div className="p-6 space-y-6">
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'security' && <SecuritySettings />}
        {activeTab === 'notifications' && <NotificationSettings />}
        {activeTab === 'infrastructure' && <InfrastructureSettings />}
        {activeTab === 'system' && <SystemSettings />}
      </div>
    </div>
  );
}
