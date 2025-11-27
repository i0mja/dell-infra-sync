import { LucideIcon, Palette, Mail, MessageSquare, Server, Briefcase, Activity, Bell, Shield, Network, Users, Disc, ShieldAlert, CloudCog } from "lucide-react";

export interface SettingsTab {
  id: string;
  name: string;
  title: string;
  description: string;
  icon: LucideIcon;
  group: 'General' | 'Security' | 'Integrations' | 'Monitoring' | 'Infrastructure';
  order: number;
}

export const settingsTabs: SettingsTab[] = [
  {
    id: 'appearance',
    name: 'Appearance',
    title: 'Appearance',
    description: 'Customize how the application looks and feels',
    icon: Palette,
    group: 'General',
    order: 1,
  },
  {
    id: 'preferences',
    name: 'Preferences',
    title: 'Notification Preferences',
    description: 'Choose which events trigger notifications',
    icon: Bell,
    group: 'General',
    order: 2,
  },
  {
    id: 'credentials',
    name: 'Credentials',
    title: 'Credential Management',
    description: 'Manage iDRAC credential sets for server discovery and operations',
    icon: Shield,
    group: 'Security',
    order: 3,
  },
  {
    id: 'operations-safety',
    name: 'Operations Safety',
    title: 'Operations Safety Controls',
    description: 'Configure iDRAC operation throttling and emergency kill switch',
    icon: ShieldAlert,
    group: 'Security',
    order: 4,
  },
  {
    id: 'smtp',
    name: 'SMTP Email',
    title: 'SMTP Configuration',
    description: 'Configure your SMTP server for email notifications',
    icon: Mail,
    group: 'Integrations',
    order: 5,
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    title: 'Microsoft Teams Integration',
    description: 'Configure Teams webhook for job notifications',
    icon: MessageSquare,
    group: 'Integrations',
    order: 6,
  },
  {
    id: 'openmanage',
    name: 'OpenManage',
    title: 'Dell OpenManage Enterprise',
    description: 'Configure automatic server discovery from OpenManage Enterprise',
    icon: Server,
    group: 'Integrations',
    order: 7,
  },
  {
    id: 'server-groups',
    name: 'Server Groups',
    title: 'Server Groups',
    description: 'Organize Dell servers into application clusters for unified maintenance planning',
    icon: Users,
    group: 'Infrastructure',
    order: 8,
  },
  {
    id: 'virtual-media',
    name: 'Virtual Media & Backup',
    title: 'Virtual Media & SCP Backup',
    description: 'Configure ISO share defaults and SCP export share for backups',
    icon: Disc,
    group: 'Infrastructure',
    order: 9,
  },
  {
    id: 'firmware-library',
    name: 'Firmware Library',
    title: 'Firmware Library',
    description: 'Manage Dell Update Packages (DUPs) for offline firmware updates',
    icon: Server,
    group: 'Infrastructure',
    order: 10,
  },
  {
    id: 'network',
    name: 'Network',
    title: 'Network Connectivity',
    description: 'Test connectivity to iDRAC servers and vCenter hosts',
    icon: Network,
    group: 'Monitoring',
    order: 11,
  },
  {
    id: 'cluster-monitoring',
    name: 'Cluster Monitoring',
    title: 'Scheduled Cluster Safety Checks',
    description: 'Configure automated cluster health monitoring and safety alerts',
    icon: CloudCog,
    group: 'Monitoring',
    order: 12,
  },
  {
    id: 'activity',
    name: 'Activity Monitor',
    title: 'Activity Monitor Settings',
    description: 'Configure log retention, cleanup, and monitoring preferences',
    icon: Activity,
    group: 'Monitoring',
    order: 13,
  },
  {
    id: 'jobs',
    name: 'Jobs',
    title: 'Jobs Configuration',
    description: 'Configure job retention, cleanup, and stale job management',
    icon: Briefcase,
    group: 'Monitoring',
    order: 14,
  },
];

export type SettingsTabId = typeof settingsTabs[number]['id'];

export const getSettingsNavigation = () => {
  return settingsTabs
    .sort((a, b) => a.order - b.order)
    .map(tab => ({
      name: tab.name,
      href: `/settings?tab=${tab.id}`,
      icon: tab.icon,
      group: tab.group,
    }));
};

export const getTabMetadata = () => {
  return settingsTabs.reduce((acc, tab) => {
    acc[tab.id] = {
      title: tab.title,
      description: tab.description,
      icon: tab.icon,
    };
    return acc;
  }, {} as Record<string, { title: string; description: string; icon: LucideIcon }>);
};

export const getTabById = (id: string): SettingsTab | undefined => {
  return settingsTabs.find(tab => tab.id === id);
};
