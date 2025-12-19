import { SearchResult } from "@/types/global-search";
import { settingsTabs } from "@/config/settings-tabs";

// Generate search index from settings tabs configuration
export const SETTINGS_SEARCH_INDEX: SearchResult[] = settingsTabs.flatMap(tab => {
  const tabResults: SearchResult[] = [];
  
  // Add main tab entry
  tabResults.push({
    id: `settings-${tab.id}`,
    category: 'settings',
    title: tab.title,
    subtitle: tab.description,
    path: `/settings?tab=${tab.id}`,
    keywords: [tab.name.toLowerCase(), tab.id],
  });
  
  // Add subsection entries
  tab.subsections.forEach(subsection => {
    tabResults.push({
      id: `settings-${tab.id}-${subsection.id}`,
      category: 'settings',
      title: subsection.name,
      subtitle: `${tab.name} → ${subsection.description}`,
      path: `/settings?tab=${tab.id}&section=${subsection.id}`,
      keywords: [
        subsection.name.toLowerCase(), 
        subsection.id,
        tab.name.toLowerCase(),
        ...subsection.description.toLowerCase().split(' '),
      ],
    });
  });
  
  return tabResults;
});

// Additional keyword mappings for common search terms
export const SETTINGS_KEYWORD_MAP: Record<string, string[]> = {
  'password': ['credentials', 'ssh-keys'],
  'login': ['credentials', 'identity-management'],
  'email': ['smtp', 'notifications'],
  'mail': ['smtp', 'notifications'],
  'alert': ['notifications', 'preferences'],
  'theme': ['appearance', 'general'],
  'dark': ['appearance', 'general'],
  'light': ['appearance', 'general'],
  'idrac': ['credentials', 'job-executor'],
  'vcenter': ['network', 'openmanage'],
  'firmware': ['firmware-library', 'infrastructure'],
  'update': ['firmware-library', 'infrastructure'],
  'backup': ['virtual-media', 'scp'],
  'iso': ['virtual-media', 'infrastructure'],
  'group': ['server-groups', 'role-mappings'],
  'user': ['users-access', 'identity-management'],
  'ldap': ['connection', 'identity-management'],
  'freeipa': ['connection', 'identity-management'],
  'ad': ['connection', 'identity-management'],
  'active directory': ['connection', 'identity-management'],
  'audit': ['audit-logs', 'security'],
  'log': ['audit-logs', 'activity'],
  'retention': ['activity', 'jobs'],
  'cleanup': ['activity', 'jobs'],
  'webhook': ['teams', 'notifications'],
  'teams': ['teams', 'notifications'],
  'cluster': ['cluster-monitoring', 'server-groups'],
  'safety': ['operations-safety', 'cluster-monitoring'],
  'throttle': ['operations-safety', 'security'],
  'zfs': ['appliance-library', 'replication'],
  'dr': ['appliance-library', 'protection'],
  'replication': ['appliance-library', 'infrastructure'],
};

export const searchSettings = (query: string): SearchResult[] => {
  const lowerQuery = query.toLowerCase().trim();
  if (lowerQuery.length < 2) return [];
  
  // First, check keyword mappings for related settings
  const relatedSectionIds = new Set<string>();
  Object.entries(SETTINGS_KEYWORD_MAP).forEach(([keyword, sectionIds]) => {
    if (keyword.includes(lowerQuery) || lowerQuery.includes(keyword)) {
      sectionIds.forEach(id => relatedSectionIds.add(id));
    }
  });
  
  // Filter settings based on query and related sections
  return SETTINGS_SEARCH_INDEX.filter(result => {
    // Check title and subtitle
    const titleMatch = result.title.toLowerCase().includes(lowerQuery);
    const subtitleMatch = result.subtitle?.toLowerCase().includes(lowerQuery);
    
    // Check keywords
    const keywordMatch = result.keywords?.some(kw => 
      kw.includes(lowerQuery) || lowerQuery.includes(kw)
    );
    
    // Check if it's a related section
    const sectionId = result.id.split('-').slice(2).join('-') || result.id.split('-')[1];
    const relatedMatch = relatedSectionIds.has(sectionId);
    
    return titleMatch || subtitleMatch || keywordMatch || relatedMatch;
  }).slice(0, 8);
};
