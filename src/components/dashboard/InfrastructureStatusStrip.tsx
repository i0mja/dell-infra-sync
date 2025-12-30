import { Server, Activity, HardDrive, Database, AlertTriangle } from "lucide-react";
import { useFleetHealth } from "@/hooks/useFleetHealth";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface StatusSegmentProps {
  icon: React.ElementType;
  label: string;
  value: string;
  status: 'healthy' | 'warning' | 'critical';
  pulse?: boolean;
  to: string;
  tooltip?: string;
}

const StatusSegment = ({ icon: Icon, label, value, status, pulse, to, tooltip }: StatusSegmentProps) => {
  const statusColors = {
    healthy: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    critical: 'bg-destructive/10 text-destructive border-destructive/20',
  };

  const dotColors = {
    healthy: 'bg-green-500',
    warning: 'bg-amber-500',
    critical: 'bg-destructive',
  };

  const content = (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all",
        "hover:scale-105 hover:shadow-sm",
        statusColors[status]
      )}
    >
      <div className="relative">
        <Icon className="h-4 w-4" />
        {pulse && (
          <div className={cn(
            "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full animate-pulse",
            dotColors[status]
          )} />
        )}
      </div>
      <span className="text-xs font-medium">{label}</span>
      <span className="text-sm font-bold tabular-nums">{value}</span>
    </Link>
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return content;
};

export const InfrastructureStatusStrip = () => {
  const { data: health, isLoading } = useFleetHealth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-3 p-3 rounded-xl bg-card border">
        {[1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} className="h-8 w-28 rounded-full" />
        ))}
      </div>
    );
  }

  const { totals } = health || { totals: { servers: { online: 0, total: 0 }, clusters: { healthy: 0, total: 0 }, vms: 0, datastores: 0, criticalAlerts: 0 } };

  const serverStatus = totals.servers.online === totals.servers.total 
    ? 'healthy' 
    : totals.servers.online > totals.servers.total * 0.8 
      ? 'warning' 
      : 'critical';

  const clusterStatus = totals.clusters.healthy === totals.clusters.total 
    ? 'healthy' 
    : totals.clusters.healthy > totals.clusters.total * 0.8 
      ? 'warning' 
      : 'critical';

  const alertStatus = totals.criticalAlerts === 0 
    ? 'healthy' 
    : totals.criticalAlerts <= 3 
      ? 'warning' 
      : 'critical';

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 p-3 rounded-xl bg-card border shadow-sm">
      <StatusSegment
        icon={Server}
        label="Servers"
        value={`${totals.servers.online}/${totals.servers.total}`}
        status={serverStatus}
        pulse={serverStatus !== 'healthy'}
        to="/servers"
        tooltip={`${totals.servers.online} online, ${totals.servers.total - totals.servers.online} offline`}
      />

      <div className="h-4 w-px bg-border hidden sm:block" />

      <StatusSegment
        icon={Activity}
        label="Clusters"
        value={`${totals.clusters.healthy}/${totals.clusters.total}`}
        status={clusterStatus}
        pulse={clusterStatus !== 'healthy'}
        to="/vcenter?tab=clusters"
        tooltip={`${totals.clusters.healthy} healthy (HA+DRS enabled)`}
      />

      <div className="h-4 w-px bg-border hidden sm:block" />

      <StatusSegment
        icon={HardDrive}
        label="VMs"
        value={totals.vms.toLocaleString()}
        status="healthy"
        to="/vcenter?tab=vms"
        tooltip={`${totals.vms} virtual machines tracked`}
      />

      <div className="h-4 w-px bg-border hidden sm:block" />

      <StatusSegment
        icon={Database}
        label="Datastores"
        value={totals.datastores.toString()}
        status="healthy"
        to="/vcenter?tab=datastores"
        tooltip={`${totals.datastores} datastores`}
      />

      <div className="h-4 w-px bg-border hidden sm:block" />

      <StatusSegment
        icon={AlertTriangle}
        label="Alerts"
        value={totals.criticalAlerts.toString()}
        status={alertStatus}
        pulse={alertStatus !== 'healthy'}
        to="/servers?tab=events"
        tooltip={`${totals.criticalAlerts} critical/error events in last 24h`}
      />
    </div>
  );
};
