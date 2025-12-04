import { LucideIcon, Palette, Shield, Bell, Server, Activity, Users } from "lucide-react";

export interface SettingsSubsection {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
}

export interface SettingsTab {
  id: string;
  name: string;
  title: string;
  description: string;
  icon: LucideIcon;
  subsections: SettingsSubsection[];
}

export const settingsTabs: SettingsTab[] = [
  {
    id: 'general',
    name: 'General',
    title: 'General Settings',
    description: 'Application appearance and user preferences',
    icon: Palette,
    subsections: [
      {
        id: 'appearance',
        name: 'Appearance',
        description: 'Customize the look and feel of the application',
        icon: Palette,
      },
    ],
  },
  {
    id: 'security',
    name: 'Security & Access',
    title: 'Security & Access Control',
    description: 'Manage credentials, audit logs, and security settings',
    icon: Shield,
    subsections: [
      {
        id: 'credentials',
        name: 'Credentials',
        description: 'Manage iDRAC credential sets for server operations',
        icon: Shield,
      },
      {
        id: 'audit-logs',
        name: 'Audit Logs',
        description: 'View security events and authentication history',
        icon: Activity,
      },
      {
        id: 'operations-safety',
        name: 'Operations Safety',
        description: 'Configure throttling and emergency kill switch',
        icon: Shield,
      },
    ],
  },
  {
    id: 'identity-management',
    name: 'Identity Management',
    title: 'Identity Management',
    description: 'Configure FreeIPA/LDAP authentication and user directory',
    icon: Users,
    subsections: [
      {
        id: 'overview',
        name: 'Overview',
        description: 'Status dashboard and connection health',
        icon: Activity,
      },
      {
        id: 'connection',
        name: 'Connection',
        description: 'FreeIPA server, AD integration, and directory structure',
        icon: Server,
      },
      {
        id: 'users-access',
        name: 'Users & Access',
        description: 'Manage users and group-to-role mappings',
        icon: Users,
      },
      {
        id: 'security',
        name: 'Security',
        description: 'Rate limits, sessions, and break-glass admins',
        icon: Shield,
      },
    ],
  },
  {
    id: 'notifications',
    name: 'Notifications',
    title: 'Notification Settings',
    description: 'Configure alerts and notification channels',
    icon: Bell,
    subsections: [
      {
        id: 'preferences',
        name: 'Alert Preferences',
        description: 'Choose which events trigger notifications',
        icon: Bell,
      },
      {
        id: 'smtp',
        name: 'Email (SMTP)',
        description: 'Configure SMTP server for email notifications',
        icon: Bell,
      },
      {
        id: 'teams',
        name: 'Microsoft Teams',
        description: 'Configure Teams webhook for notifications',
        icon: Bell,
      },
    ],
  },
  {
    id: 'infrastructure',
    name: 'Infrastructure',
    title: 'Infrastructure Management',
    description: 'Manage servers, firmware, and external integrations',
    icon: Server,
    subsections: [
      {
        id: 'server-groups',
        name: 'Server Groups',
        description: 'Organize servers into application clusters',
        icon: Server,
      },
      {
        id: 'virtual-media',
        name: 'Virtual Media & Backup',
        description: 'Configure ISO share and SCP backup defaults',
        icon: Server,
      },
      {
        id: 'firmware-library',
        name: 'Firmware Library',
        description: 'Manage Dell Update Packages (DUPs)',
        icon: Server,
      },
      {
        id: 'openmanage',
        name: 'OpenManage Enterprise',
        description: 'Configure automatic server discovery',
        icon: Server,
      },
    ],
  },
  {
    id: 'system',
    name: 'System & Monitoring',
    title: 'System & Monitoring',
    description: 'Network, monitoring, and system configuration',
    icon: Activity,
    subsections: [
      {
        id: 'job-executor',
        name: 'Job Executor',
        description: 'Configure the Python backend service for server operations',
        icon: Server,
      },
      {
        id: 'network',
        name: 'Network Connectivity',
        description: 'Test connectivity and configure network settings',
        icon: Activity,
      },
      {
        id: 'cluster-monitoring',
        name: 'Cluster Monitoring',
        description: 'Configure scheduled safety checks',
        icon: Activity,
      },
      {
        id: 'activity',
        name: 'Activity Monitor',
        description: 'Configure log retention and cleanup',
        icon: Activity,
      },
      {
        id: 'jobs',
        name: 'Jobs Configuration',
        description: 'Manage job retention and stale jobs',
        icon: Activity,
      },
    ],
  },
];

export type SettingsTabId = typeof settingsTabs[number]['id'];

export const getSettingsNavigation = () => {
  return settingsTabs.map(tab => ({
    name: tab.name,
    href: `/settings?tab=${tab.id}`,
    icon: tab.icon,
  }));
};

export const getTabMetadata = () => {
  const metadata: Record<string, { title: string; description: string; icon: LucideIcon }> = {};
  
  settingsTabs.forEach(tab => {
    metadata[tab.id] = {
      title: tab.title,
      description: tab.description,
      icon: tab.icon,
    };
    
    tab.subsections.forEach(subsection => {
      metadata[subsection.id] = {
        title: subsection.name,
        description: subsection.description,
        icon: subsection.icon,
      };
    });
  });
  
  return metadata;
};

export const getTabById = (id: string): SettingsTab | undefined => {
  return settingsTabs.find(tab => tab.id === id);
};

// Map old tab IDs to new structure for backward compatibility
export const mapLegacyTabId = (oldTabId: string): { tab: string; section?: string } => {
  // First, check if it's already a valid tab ID
  const validTabIds = ['general', 'security', 'identity-management', 'notifications', 'infrastructure', 'system'];
  if (validTabIds.includes(oldTabId)) {
    return { tab: oldTabId };
  }
  
  // Then check legacy mappings for backward compatibility
  const mapping: Record<string, { tab: string; section?: string }> = {
    'appearance': { tab: 'general', section: 'appearance' },
    'preferences': { tab: 'notifications', section: 'preferences' },
    'credentials': { tab: 'security', section: 'credentials' },
    'identity-provider': { tab: 'identity-management', section: 'overview' },
    'audit-logs': { tab: 'security', section: 'audit-logs' },
    'operations-safety': { tab: 'security', section: 'operations-safety' },
    'smtp': { tab: 'notifications', section: 'smtp' },
    'teams': { tab: 'notifications', section: 'teams' },
    'openmanage': { tab: 'infrastructure', section: 'openmanage' },
    'server-groups': { tab: 'infrastructure', section: 'server-groups' },
    'virtual-media': { tab: 'infrastructure', section: 'virtual-media' },
    'firmware-library': { tab: 'infrastructure', section: 'firmware-library' },
    'network': { tab: 'system', section: 'network' },
    'cluster-monitoring': { tab: 'system', section: 'cluster-monitoring' },
    'activity': { tab: 'system', section: 'activity' },
    'activity-monitor': { tab: 'system', section: 'activity' },
    'jobs': { tab: 'system', section: 'jobs' },
    // IDM legacy mappings (old 7-tab structure to new 4-tab structure)
    'directory': { tab: 'identity-management', section: 'connection' },
    'user-manager': { tab: 'identity-management', section: 'users-access' },
    'role-mappings': { tab: 'identity-management', section: 'users-access' },
    'security-policies': { tab: 'identity-management', section: 'security' },
    'break-glass': { tab: 'identity-management', section: 'security' },
  };
  
  return mapping[oldTabId] || { tab: 'general' };
};
