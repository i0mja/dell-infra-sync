import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AuditLogViewer } from '@/components/settings/AuditLogViewer';
import { SecurityHealthOverview } from '@/components/security/settings/SecurityHealthOverview';
import { CredentialsTabPanel } from '@/components/security/settings/CredentialsTabPanel';
import { SshKeysTabPanel } from '@/components/security/settings/SshKeysTabPanel';
import { SafetyControlsTabPanel } from '@/components/security/settings/SafetyControlsTabPanel';
import { LayoutDashboard, Shield, Key, FileText, ShieldCheck } from 'lucide-react';

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'credentials', label: 'Credentials', icon: Shield },
  { id: 'ssh-keys', label: 'SSH Keys', icon: Key },
  { id: 'audit-logs', label: 'Audit Logs', icon: FileText },
  { id: 'safety-controls', label: 'Safety Controls', icon: ShieldCheck },
] as const;

type SectionId = typeof SECTIONS[number]['id'];

export function SecuritySettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentSection = (searchParams.get('section') as SectionId) || 'overview';

  const handleSectionChange = (section: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (section === 'overview') {
      newParams.delete('section');
    } else {
      newParams.set('section', section);
    }
    setSearchParams(newParams);
  };

  return (
    <div className="space-y-6">
      <Tabs value={currentSection} onValueChange={handleSectionChange}>
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <TabsTrigger
              key={id}
              value={id}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3"
            >
              <Icon className="h-4 w-4 mr-2" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <SecurityHealthOverview onNavigate={handleSectionChange} />
        </TabsContent>

        <TabsContent value="credentials" className="mt-6">
          <CredentialsTabPanel />
        </TabsContent>

        <TabsContent value="ssh-keys" className="mt-6">
          <SshKeysTabPanel />
        </TabsContent>

        <TabsContent value="audit-logs" className="mt-6">
          <AuditLogViewer />
        </TabsContent>

        <TabsContent value="safety-controls" className="mt-6">
          <SafetyControlsTabPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
