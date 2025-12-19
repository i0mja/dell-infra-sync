import { SearchResult } from "@/types/global-search";

export interface QuickAction extends SearchResult {
  action?: () => void;
  requiresNavigation?: boolean;
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'action-add-server',
    category: 'quick_action',
    title: 'Add Server',
    subtitle: 'Register a new Dell server',
    path: '/servers',
    keywords: ['add', 'new', 'register', 'server', 'idrac'],
    requiresNavigation: true,
  },
  {
    id: 'action-sync-vcenter',
    category: 'quick_action',
    title: 'Sync vCenter',
    subtitle: 'Refresh vCenter inventory',
    path: '/vcenter',
    keywords: ['sync', 'refresh', 'update', 'vcenter', 'inventory'],
    requiresNavigation: true,
  },
  {
    id: 'action-create-maintenance',
    category: 'quick_action',
    title: 'Create Maintenance Window',
    subtitle: 'Schedule server maintenance',
    path: '/maintenance-planner',
    keywords: ['maintenance', 'schedule', 'window', 'create', 'plan'],
    requiresNavigation: true,
  },
  {
    id: 'action-view-jobs',
    category: 'quick_action',
    title: 'View Running Jobs',
    subtitle: 'Monitor active operations',
    path: '/activity',
    keywords: ['jobs', 'running', 'active', 'monitor', 'activity'],
    requiresNavigation: true,
  },
  {
    id: 'action-create-protection-group',
    category: 'quick_action',
    title: 'Create Protection Group',
    subtitle: 'Set up DR replication',
    path: '/vcenter?tab=replication',
    keywords: ['protection', 'group', 'dr', 'replication', 'create'],
    requiresNavigation: true,
  },
  {
    id: 'action-manage-credentials',
    category: 'quick_action',
    title: 'Manage Credentials',
    subtitle: 'Configure iDRAC credentials',
    path: '/settings?tab=security&section=credentials',
    keywords: ['credentials', 'password', 'idrac', 'manage'],
    requiresNavigation: true,
  },
  {
    id: 'action-view-reports',
    category: 'quick_action',
    title: 'View Reports',
    subtitle: 'Generate compliance reports',
    path: '/reports',
    keywords: ['reports', 'compliance', 'view', 'generate'],
    requiresNavigation: true,
  },
  {
    id: 'action-firmware-update',
    category: 'quick_action',
    title: 'Firmware Update',
    subtitle: 'Update server firmware',
    path: '/servers',
    keywords: ['firmware', 'update', 'bios', 'idrac', 'upgrade'],
    requiresNavigation: true,
  },
];

export const searchQuickActions = (query: string): QuickAction[] => {
  const lowerQuery = query.toLowerCase().trim();
  if (lowerQuery.length < 2) return [];
  
  return QUICK_ACTIONS.filter(action => {
    const titleMatch = action.title.toLowerCase().includes(lowerQuery);
    const subtitleMatch = action.subtitle?.toLowerCase().includes(lowerQuery);
    const keywordMatch = action.keywords?.some(kw => 
      kw.includes(lowerQuery) || lowerQuery.includes(kw)
    );
    
    return titleMatch || subtitleMatch || keywordMatch;
  }).slice(0, 5);
};
