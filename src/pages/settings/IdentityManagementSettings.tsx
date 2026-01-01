import { SettingsTabLayout, SettingsTab } from '@/components/settings';
import { Activity, Link, Users, Shield } from 'lucide-react';
import {
  IdmOverview,
  IdmConnectionTab,
  IdmUsersAndAccess,
  IdmSecurityTab,
} from '@/components/settings/idm';

export function IdentityManagementSettings() {
  const tabs: SettingsTab[] = [
    { 
      id: 'overview', 
      label: 'Overview', 
      icon: Activity, 
      content: <IdmOverview />
    },
    { 
      id: 'connection', 
      label: 'Connection', 
      icon: Link, 
      content: <IdmConnectionTab />
    },
    { 
      id: 'users-access', 
      label: 'Users & Access', 
      icon: Users, 
      content: <IdmUsersAndAccess />
    },
    { 
      id: 'security', 
      label: 'Security', 
      icon: Shield, 
      content: <IdmSecurityTab />
    },
  ];

  return (
    <SettingsTabLayout 
      tabs={tabs} 
      defaultTab="overview"
    />
  );
}
