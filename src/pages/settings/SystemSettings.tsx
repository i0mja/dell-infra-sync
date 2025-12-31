import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SystemHealthOverview } from "@/components/system/SystemHealthOverview";
import { JobExecutorSetupCard } from "@/components/system/JobExecutorSetupCard";
import { DataRetentionSettings } from "@/components/system/DataRetentionSettings";
import { NetworkAdvancedSettings } from "@/components/system/NetworkAdvancedSettings";
import { Activity, Server, Database, Settings2 } from "lucide-react";

type SystemSubsection = 'overview' | 'job-executor' | 'retention' | 'advanced';

const subsections = [
  { id: 'overview' as const, label: 'Overview', icon: Activity },
  { id: 'job-executor' as const, label: 'Job Executor', icon: Server },
  { id: 'retention' as const, label: 'Retention', icon: Database },
  { id: 'advanced' as const, label: 'Advanced', icon: Settings2 },
];

export function SystemSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get('section') as SystemSubsection | null;
  const [activeSection, setActiveSection] = useState<SystemSubsection>(
    sectionParam && subsections.some(s => s.id === sectionParam) ? sectionParam : 'overview'
  );

  const handleSectionChange = (section: string) => {
    setActiveSection(section as SystemSubsection);
    const params = new URLSearchParams(searchParams);
    params.set('section', section);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="space-y-6">
      {/* Subsection Navigation */}
      <Tabs value={activeSection} onValueChange={handleSectionChange}>
        <TabsList className="grid w-full grid-cols-4 h-9">
          {subsections.map((section) => {
            const Icon = section.icon;
            return (
              <TabsTrigger 
                key={section.id} 
                value={section.id}
                className="text-xs gap-1.5"
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{section.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* Section Content */}
      {activeSection === 'overview' && (
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
      )}

      {activeSection === 'job-executor' && (
        <JobExecutorSetupCard />
      )}

      {activeSection === 'retention' && (
        <DataRetentionSettings />
      )}

      {activeSection === 'advanced' && (
        <div className="space-y-4">
          <NetworkAdvancedSettings />
        </div>
      )}
    </div>
  );
}
