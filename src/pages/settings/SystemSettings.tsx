import { SettingsTabLayout, SettingsTab } from "@/components/settings";
import { SystemHealthOverview } from "@/components/system/SystemHealthOverview";
import { JobExecutorSetupCard } from "@/components/system/JobExecutorSetupCard";
import { DataRetentionSettings } from "@/components/system/DataRetentionSettings";
import { NetworkAdvancedSettings } from "@/components/system/NetworkAdvancedSettings";
import { Activity, Server, Database, Settings2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";

export function SystemSettings() {
  const [searchParams, setSearchParams] = useSearchParams();

  const handleSectionChange = (section: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('section', section);
    setSearchParams(params, { replace: true });
  };

  const tabs: SettingsTab[] = [
    { 
      id: 'overview', 
      label: 'Overview', 
      icon: Activity, 
      content: (
        <div className="space-y-4">
          <SystemHealthOverview />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 border rounded-lg bg-muted/30">
              <h3 className="text-sm font-medium mb-2">Quick Actions</h3>
              <ul className="text-xs text-muted-foreground space-y-1.5">
                <li>• <button onClick={() => handleSectionChange('job-executor')} className="text-primary hover:underline">Configure Job Executor</button> - Set up backend connection</li>
                <li>• <button onClick={() => handleSectionChange('retention')} className="text-primary hover:underline">Data Retention</button> - Manage logs and jobs cleanup</li>
                <li>• <button onClick={() => handleSectionChange('advanced')} className="text-primary hover:underline">Advanced Settings</button> - Network timeouts and retry configuration</li>
              </ul>
            </div>
            <div className="p-4 border rounded-lg bg-muted/30">
              <h3 className="text-sm font-medium mb-2">About System Settings</h3>
              <p className="text-xs text-muted-foreground">
                Configure the Job Executor backend service, manage data retention policies, 
                and tune network performance settings. The health dashboard shows the current 
                status of all system components.
              </p>
            </div>
          </div>
        </div>
      )
    },
    { 
      id: 'job-executor', 
      label: 'Job Executor', 
      icon: Server, 
      content: <JobExecutorSetupCard />
    },
    { 
      id: 'retention', 
      label: 'Retention', 
      icon: Database, 
      content: <DataRetentionSettings />
    },
    { 
      id: 'advanced', 
      label: 'Advanced', 
      icon: Settings2, 
      content: (
        <div className="space-y-4">
          <NetworkAdvancedSettings />
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
