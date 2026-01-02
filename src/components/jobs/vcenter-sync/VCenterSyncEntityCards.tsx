import { 
  Layers, 
  HardDrive, 
  Network, 
  Monitor, 
  AlertTriangle, 
  Server,
  Link,
  TrendingUp,
  TrendingDown,
  Minus
} from "lucide-react";
import { cn } from "@/lib/utils";

interface VCenterSyncEntityCardsProps {
  details: any;
}

interface EntityCardData {
  key: string;
  label: string;
  icon: React.ReactNode;
  count: number;
  delta?: number;
  subtext?: string;
  variant?: 'default' | 'success' | 'warning' | 'muted';
}

export const VCenterSyncEntityCards = ({ details }: VCenterSyncEntityCardsProps) => {
  // Extract counts from various possible field names
  const getCount = (primaryKey: string, ...fallbackKeys: string[]): number => {
    if (details?.[primaryKey]) return details[primaryKey];
    for (const key of fallbackKeys) {
      if (details?.[key]) return details[key];
    }
    return 0;
  };
  
  const clusters = getCount('clusters_synced', 'clusters');
  const hosts = getCount('hosts_synced', 'updated_hosts', 'hosts');
  const hostsNew = getCount('hosts_new', 'new_hosts');
  const datastores = getCount('datastores_synced', 'datastores');
  const networks = getCount('networks_synced', 'networks');
  const vms = getCount('vms_synced', 'vms_processed', 'vms');
  const alarms = getCount('alarms_synced', 'alarms');
  const autoLinked = getCount('auto_linked');
  
  // Check for warnings
  const hasNetworkWarning = networks === 0 && hosts > 0;
  
  const entities: EntityCardData[] = [
    {
      key: 'clusters',
      label: 'Clusters',
      icon: <Layers className="h-5 w-5" />,
      count: clusters,
      subtext: 'Compute clusters'
    },
    {
      key: 'hosts',
      label: 'Hosts',
      icon: <Server className="h-5 w-5" />,
      count: hosts,
      delta: hostsNew,
      subtext: hostsNew > 0 ? `+${hostsNew} new` : 'ESXi hosts'
    },
    {
      key: 'datastores',
      label: 'Datastores',
      icon: <HardDrive className="h-5 w-5" />,
      count: datastores,
      subtext: 'Storage volumes'
    },
    {
      key: 'networks',
      label: 'Networks',
      icon: <Network className="h-5 w-5" />,
      count: networks,
      variant: hasNetworkWarning ? 'warning' : 'default',
      subtext: hasNetworkWarning ? '⚠️ Check permissions' : 'Port groups'
    },
    {
      key: 'vms',
      label: 'VMs',
      icon: <Monitor className="h-5 w-5" />,
      count: vms,
      subtext: 'Virtual machines'
    },
    {
      key: 'alarms',
      label: 'Alarms',
      icon: <AlertTriangle className="h-5 w-5" />,
      count: alarms,
      variant: alarms > 0 ? 'warning' : 'muted',
      subtext: 'Active alarms'
    },
  ];
  
  // Add auto-linked if present
  if (autoLinked > 0) {
    entities.push({
      key: 'autoLinked',
      label: 'Auto-Linked',
      icon: <Link className="h-5 w-5" />,
      count: autoLinked,
      variant: 'success',
      subtext: 'Servers matched'
    });
  }
  
  // Filter out zero-count entities except networks (to show warning)
  const visibleEntities = entities.filter(e => e.count > 0 || e.key === 'networks');

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {visibleEntities.map((entity) => (
        <EntityCard key={entity.key} entity={entity} />
      ))}
    </div>
  );
};

interface EntityCardProps {
  entity: EntityCardData;
}

const EntityCard = ({ entity }: EntityCardProps) => {
  const getVariantClasses = () => {
    switch (entity.variant) {
      case 'success':
        return {
          bg: 'bg-success/10 border-success/30',
          icon: 'text-success',
          count: 'text-success'
        };
      case 'warning':
        return {
          bg: 'bg-warning/10 border-warning/30',
          icon: 'text-warning',
          count: 'text-warning'
        };
      case 'muted':
        return {
          bg: 'bg-muted/50 border-border',
          icon: 'text-muted-foreground',
          count: 'text-muted-foreground'
        };
      default:
        return {
          bg: 'bg-card border-border hover:border-primary/30',
          icon: 'text-primary',
          count: 'text-foreground'
        };
    }
  };
  
  const classes = getVariantClasses();
  
  const getDeltaIcon = () => {
    if (!entity.delta) return null;
    if (entity.delta > 0) return <TrendingUp className="h-3 w-3 text-success" />;
    if (entity.delta < 0) return <TrendingDown className="h-3 w-3 text-destructive" />;
    return <Minus className="h-3 w-3 text-muted-foreground" />;
  };

  return (
    <div 
      className={cn(
        "rounded-lg border p-4 transition-colors cursor-default",
        classes.bg
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className={cn("p-2 rounded-md bg-background/50", classes.icon)}>
          {entity.icon}
        </div>
        {getDeltaIcon()}
      </div>
      
      <div className="space-y-1">
        <p className={cn("text-2xl font-bold tabular-nums", classes.count)}>
          {entity.count.toLocaleString()}
        </p>
        <p className="text-sm font-medium">{entity.label}</p>
        {entity.subtext && (
          <p className="text-xs text-muted-foreground">{entity.subtext}</p>
        )}
      </div>
    </div>
  );
};
