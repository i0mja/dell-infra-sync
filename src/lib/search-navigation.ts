import { NavigateFunction } from "react-router-dom";
import { SearchResult, SearchCategory } from "@/types/global-search";

// Map categories to their navigation paths
const CATEGORY_ROUTES: Record<SearchCategory, (id: string) => string> = {
  servers: (id) => `/servers?selected=${id}`,
  vms: (id) => `/vcenter?tab=vms&selected=${id}`,
  hosts: (id) => `/vcenter?tab=hosts&selected=${id}`,
  clusters: (id) => `/vcenter?tab=clusters&selected=${id}`,
  datastores: (id) => `/vcenter?tab=datastores&selected=${id}`,
  networks: (id) => `/vcenter?tab=networks&selected=${id}`,
  protection_groups: (id) => `/vcenter?tab=replication&group=${id}`,
  replication_targets: (id) => `/vcenter?tab=replication&target=${id}`,
  jobs: (id) => `/activity?job=${id}`,
  maintenance: (id) => `/maintenance-planner?id=${id}`,
  settings: () => '/settings',
  credentials: () => '/settings?tab=security&section=credentials',
  server_groups: () => '/settings?tab=infrastructure&section=server-groups',
  firmware: (id) => `/settings?tab=infrastructure&section=firmware-library&package=${id}`,
  iso_images: (id) => `/settings?tab=infrastructure&section=virtual-media&iso=${id}`,
  quick_action: () => '/',
};

export const navigateToResult = (
  result: SearchResult, 
  navigate: NavigateFunction
): void => {
  // If result has a direct path, use it
  if (result.path) {
    navigate(result.path);
    return;
  }
  
  // Otherwise, use the category route generator
  const routeGenerator = CATEGORY_ROUTES[result.category];
  if (routeGenerator) {
    navigate(routeGenerator(result.id));
  }
};

export const getResultPath = (result: SearchResult): string => {
  if (result.path) return result.path;
  
  const routeGenerator = CATEGORY_ROUTES[result.category];
  return routeGenerator ? routeGenerator(result.id) : '/';
};
