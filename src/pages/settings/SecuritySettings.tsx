import { SettingsTabLayout, SettingsTab } from '@/components/settings';
import { AuditLogViewer } from '@/components/settings/AuditLogViewer';
import { SecurityHealthOverview } from '@/components/security/settings/SecurityHealthOverview';
import { CredentialsTabPanel } from '@/components/security/settings/CredentialsTabPanel';
import { SshKeysTabPanel } from '@/components/security/settings/SshKeysTabPanel';
import { SafetyControlsTabPanel } from '@/components/security/settings/SafetyControlsTabPanel';
import { LayoutDashboard, Shield, Key, FileText, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

export function SecuritySettings() {
  const [navigateTo, setNavigateTo] = useState<string | null>(null);

  const handleNavigate = (section: string) => {
    setNavigateTo(section);
  };

  const tabs: SettingsTab[] = [
    { 
      id: 'overview', 
      label: 'Overview', 
      icon: LayoutDashboard, 
      content: <SecurityHealthOverview onNavigate={handleNavigate} /> 
    },
    { 
      id: 'credentials', 
      label: 'Credentials', 
      icon: Shield, 
      content: <CredentialsTabPanel /> 
    },
    { 
      id: 'ssh-keys', 
      label: 'SSH Keys', 
      icon: Key, 
      content: <SshKeysTabPanel /> 
    },
    { 
      id: 'audit-logs', 
      label: 'Audit Logs', 
      icon: FileText, 
      content: <AuditLogViewer /> 
    },
    { 
      id: 'safety-controls', 
      label: 'Safety Controls', 
      icon: ShieldCheck, 
      content: <SafetyControlsTabPanel /> 
    },
  ];

  return (
    <SettingsTabLayout 
      tabs={tabs} 
      defaultTab="overview"
      onSectionChange={(section) => {
        // Handle navigation requests from child components
        if (navigateTo && navigateTo !== section) {
          setNavigateTo(null);
        }
      }}
    />
  );
}
