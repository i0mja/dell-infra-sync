export type SearchCategory = 
  | 'servers' 
  | 'vms' 
  | 'hosts' 
  | 'clusters' 
  | 'datastores' 
  | 'networks' 
  | 'protection_groups' 
  | 'replication_targets'
  | 'jobs' 
  | 'maintenance' 
  | 'settings' 
  | 'credentials' 
  | 'server_groups' 
  | 'firmware' 
  | 'iso_images'
  | 'quick_action';

export interface SearchResult {
  id: string;
  category: SearchCategory;
  title: string;
  subtitle?: string;
  icon?: string;
  path: string;
  metadata?: Record<string, unknown>;
  keywords?: string[];
}

export interface SearchState {
  query: string;
  results: SearchResult[];
  isLoading: boolean;
  error: string | null;
}

export const CATEGORY_LABELS: Record<SearchCategory, string> = {
  servers: 'Servers',
  vms: 'Virtual Machines',
  hosts: 'ESXi Hosts',
  clusters: 'Clusters',
  datastores: 'Datastores',
  networks: 'Networks',
  protection_groups: 'Protection Groups',
  replication_targets: 'Replication Targets',
  jobs: 'Jobs',
  maintenance: 'Maintenance Windows',
  settings: 'Settings',
  credentials: 'Credentials',
  server_groups: 'Server Groups',
  firmware: 'Firmware Packages',
  iso_images: 'ISO Images',
  quick_action: 'Quick Actions',
};
