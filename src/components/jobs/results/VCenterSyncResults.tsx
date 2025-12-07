import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Server, 
  HardDrive, 
  AlertTriangle, 
  Link, 
  Monitor, 
  Network, 
  Layers, 
  Database, 
  Clock, 
  XCircle,
  CheckCircle
} from "lucide-react";

interface VCenterSyncResultsProps {
  details: any;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  subtext?: string;
  variant?: 'default' | 'success' | 'warning' | 'destructive' | 'muted';
}

const StatCard = ({ icon, label, value, subtext, variant = 'default' }: StatCardProps) => {
  const valueColorClass = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    destructive: 'text-destructive',
    muted: 'text-muted-foreground'
  }[variant];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${valueColorClass}`}>{value}</div>
        {subtext && (
          <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
        )}
      </CardContent>
    </Card>
  );
};

export const VCenterSyncResults = ({ details }: VCenterSyncResultsProps) => {
  // Extract all possible sync metrics from details
  const vcenterName = details?.vcenter_name || details?.vcenter_host || null;
  const hostsSynced = details?.hosts_synced || details?.updated_hosts || 0;
  const hostsNew = details?.hosts_new || details?.new_hosts || 0;
  const vmsSynced = details?.vms_synced || details?.vms_processed || 0;
  const clustersSynced = details?.clusters_synced || 0;
  const datastoresSynced = details?.datastores_synced || 0;
  const networksSynced = details?.networks_synced || 0;
  const alarms = details?.alarms_synced || details?.alarms || 0;
  const autoLinked = details?.auto_linked || 0;
  const errors = details?.errors || 0;
  
  // Calculate duration if available
  const syncDuration = details?.sync_duration_ms 
    ? `${(details.sync_duration_ms / 1000).toFixed(1)}s`
    : details?.sync_duration || null;

  // Determine if this was a successful sync
  const isSuccess = errors === 0;

  return (
    <div className="space-y-4">
      {/* vCenter info header */}
      {vcenterName && (
        <div className="flex items-center gap-3 pb-2 border-b">
          <Database className="h-5 w-5 text-primary" />
          <div>
            <h4 className="font-semibold">{vcenterName}</h4>
            <p className="text-sm text-muted-foreground">
              vCenter Sync {isSuccess ? 'completed successfully' : 'completed with errors'}
            </p>
          </div>
          <Badge variant={isSuccess ? "secondary" : "destructive"} className="ml-auto">
            {isSuccess ? (
              <><CheckCircle className="h-3 w-3 mr-1" /> Success</>
            ) : (
              <><XCircle className="h-3 w-3 mr-1" /> {errors} Error{errors !== 1 ? 's' : ''}</>
            )}
          </Badge>
        </div>
      )}

      {/* Sync Duration */}
      {syncDuration && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>Sync completed in <span className="font-medium text-foreground">{syncDuration}</span></span>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {/* Hosts synced */}
        <StatCard
          icon={<Server className="h-4 w-4" />}
          label="Hosts Synced"
          value={hostsSynced}
          subtext="Total ESXi hosts"
        />

        {/* New hosts discovered */}
        {hostsNew > 0 && (
          <StatCard
            icon={<Server className="h-4 w-4" />}
            label="New Hosts"
            value={hostsNew}
            subtext="Newly discovered"
            variant="success"
          />
        )}

        {/* Clusters */}
        {clustersSynced > 0 && (
          <StatCard
            icon={<Layers className="h-4 w-4" />}
            label="Clusters"
            value={clustersSynced}
            subtext="Clusters synced"
          />
        )}

        {/* Datastores */}
        {datastoresSynced > 0 && (
          <StatCard
            icon={<HardDrive className="h-4 w-4" />}
            label="Datastores"
            value={datastoresSynced}
            subtext="Storage volumes"
          />
        )}

        {/* Networks */}
        {networksSynced > 0 && (
          <StatCard
            icon={<Network className="h-4 w-4" />}
            label="Networks"
            value={networksSynced}
            subtext="Port groups synced"
          />
        )}

        {/* VMs */}
        {vmsSynced > 0 && (
          <StatCard
            icon={<Monitor className="h-4 w-4" />}
            label="VMs Synced"
            value={vmsSynced}
            subtext="Virtual machines"
          />
        )}

        {/* Auto-linked servers */}
        {autoLinked > 0 && (
          <StatCard
            icon={<Link className="h-4 w-4" />}
            label="Auto-Linked"
            value={autoLinked}
            subtext="Servers matched"
            variant="success"
          />
        )}

        {/* Alarms */}
        {alarms > 0 && (
          <StatCard
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Alarms"
            value={alarms}
            subtext="Active alarms"
            variant="warning"
          />
        )}

        {/* Errors */}
        {errors > 0 && (
          <StatCard
            icon={<XCircle className="h-4 w-4" />}
            label="Errors"
            value={errors}
            subtext="Failed operations"
            variant="destructive"
          />
        )}
      </div>

      {/* Phase breakdown if available */}
      {details?.phases && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Sync Phases</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(details.phases).map(([phase, count]) => (
                <div key={phase} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground capitalize">{phase.replace(/_/g, ' ')}</span>
                  <span className="font-medium">{String(count)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
