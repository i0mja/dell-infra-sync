import { 
  Server, 
  Monitor, 
  Cpu, 
  Boxes, 
  HardDrive, 
  Network, 
  Shield, 
  Target, 
  Activity, 
  Calendar, 
  Settings, 
  Key, 
  FolderOpen,
  Package,
  Disc,
  Zap,
  type LucideIcon 
} from "lucide-react";
import { SearchCategory } from "@/types/global-search";

export const CATEGORY_ICONS: Record<SearchCategory, LucideIcon> = {
  servers: Server,
  vms: Monitor,
  hosts: Cpu,
  clusters: Boxes,
  datastores: HardDrive,
  networks: Network,
  protection_groups: Shield,
  replication_targets: Target,
  jobs: Activity,
  maintenance: Calendar,
  settings: Settings,
  credentials: Key,
  server_groups: FolderOpen,
  firmware: Package,
  iso_images: Disc,
  quick_action: Zap,
};

export const getCategoryIcon = (category: SearchCategory): LucideIcon => {
  return CATEGORY_ICONS[category] || Server;
};
