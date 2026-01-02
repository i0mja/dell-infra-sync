import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Server, MonitorDot, Database, HardDrive } from "lucide-react";

export interface SidebarNavItem {
  type: 'vm' | 'host' | 'cluster' | 'datastore';
  id: string;
  name: string;
}

const typeIcons: Record<SidebarNavItem['type'], React.ElementType> = {
  vm: MonitorDot,
  host: Server,
  cluster: Database,
  datastore: HardDrive,
};

const typeLabels: Record<SidebarNavItem['type'], string> = {
  vm: 'VM',
  host: 'Host',
  cluster: 'Cluster',
  datastore: 'Datastore',
};

interface SidebarBreadcrumbProps {
  navStack: SidebarNavItem[];
  currentItem: SidebarNavItem;
  onNavigateBack: () => void;
  onNavigateTo: (index: number) => void;
}

export function SidebarBreadcrumb({
  navStack,
  currentItem,
  onNavigateBack,
  onNavigateTo,
}: SidebarBreadcrumbProps) {
  if (navStack.length === 0) {
    return null;
  }

  const CurrentIcon = typeIcons[currentItem.type];

  return (
    <div className="flex items-center gap-1 px-4 py-2 bg-muted/30 border-b text-sm overflow-hidden">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 flex-shrink-0"
        onClick={onNavigateBack}
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        Back
      </Button>
      
      <div className="flex items-center gap-1 min-w-0 overflow-hidden flex-1">
        {navStack.map((item, index) => {
          const Icon = typeIcons[item.type];
          return (
            <div key={`${item.type}-${item.id}`} className="flex items-center gap-1 min-w-0">
              <button
                onClick={() => onNavigateTo(index)}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors min-w-0"
                title={`${typeLabels[item.type]}: ${item.name}`}
              >
                <Icon className="h-3 w-3 flex-shrink-0" />
                <span className="truncate max-w-[80px]">{item.name}</span>
              </button>
              <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            </div>
          );
        })}
        
        {/* Current item */}
        <div className="flex items-center gap-1 text-foreground font-medium min-w-0">
          <CurrentIcon className="h-3 w-3 flex-shrink-0" />
          <span className="truncate max-w-[100px]">{currentItem.name}</span>
        </div>
      </div>
    </div>
  );
}
