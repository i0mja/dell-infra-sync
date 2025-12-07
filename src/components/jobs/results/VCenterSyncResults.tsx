import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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

// Component for displaying a single vCenter's results
const SingleVCenterResults = ({ result, showHeader = true }: { result: any; showHeader?: boolean }) => {
  const vcenterName = result?.vcenter_name || result?.vcenter_host || null;
  const hostsSynced = result?.hosts_synced || result?.hosts || result?.updated_hosts || 0;
  const hostsNew = result?.hosts_new || result?.new_hosts || 0;
  const vmsSynced = result?.vms_synced || result?.vms || result?.vms_processed || 0;
  const clustersSynced = result?.clusters_synced || result?.clusters || 0;
  const datastoresSynced = result?.datastores_synced || result?.datastores || 0;
  const networksSynced = result?.networks_synced || result?.networks || 0;
  const alarms = result?.alarms_synced || result?.alarms || 0;
  const autoLinked = result?.auto_linked || 0;
  const errors = result?.errors || (result?.error ? 1 : 0);
  const syncDuration = result?.sync_duration_seconds 
    ? `${result.sync_duration_seconds}s`
    : result?.sync_duration_ms 
      ? `${(result.sync_duration_ms / 1000).toFixed(1)}s`
      : result?.sync_duration || null;

  const isSuccess = result?.status !== 'failed' && errors === 0;

  return (
    <div className="space-y-4">
      {/* vCenter info header */}
      {showHeader && vcenterName && (
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

      {/* Error message for failed syncs */}
      {result?.error && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
          <p className="text-sm text-destructive">{result.error}</p>
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
        {typeof errors === 'number' && errors > 0 && (
          <StatCard
            icon={<XCircle className="h-4 w-4" />}
            label="Errors"
            value={errors}
            subtext="Failed operations"
            variant="destructive"
          />
        )}
      </div>
    </div>
  );
};

export const VCenterSyncResults = ({ details }: VCenterSyncResultsProps) => {
  // Check if this is a multi-vCenter sync result
  const vcenterResults = details?.vcenter_results as any[] | undefined;
  const totalVcenters = details?.total_vcenters || 1;
  const vcentersSynced = details?.vcenters_synced || 0;

  // If we have multiple vCenter results, show them in an accordion
  if (vcenterResults && vcenterResults.length > 1) {
    const syncDuration = details?.sync_duration_seconds 
      ? `${details.sync_duration_seconds}s`
      : null;

    return (
      <div className="space-y-4">
        {/* Overall summary header */}
        <div className="flex items-center gap-3 pb-2 border-b">
          <Database className="h-5 w-5 text-primary" />
          <div>
            <h4 className="font-semibold">Multi-vCenter Sync Complete</h4>
            <p className="text-sm text-muted-foreground">
              {vcentersSynced}/{totalVcenters} vCenters synced successfully
              {syncDuration && ` in ${syncDuration}`}
            </p>
          </div>
          <Badge 
            variant={vcentersSynced === totalVcenters ? "secondary" : "outline"} 
            className="ml-auto"
          >
            {vcentersSynced === totalVcenters ? (
              <><CheckCircle className="h-3 w-3 mr-1" /> All Synced</>
            ) : (
              <>{vcentersSynced}/{totalVcenters} Complete</>
            )}
          </Badge>
        </div>

        {/* Aggregated totals */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          <div className="text-center p-2 bg-muted/50 rounded">
            <p className="text-lg font-bold">{details?.clusters || 0}</p>
            <p className="text-xs text-muted-foreground">Clusters</p>
          </div>
          <div className="text-center p-2 bg-muted/50 rounded">
            <p className="text-lg font-bold">{details?.datastores || 0}</p>
            <p className="text-xs text-muted-foreground">Datastores</p>
          </div>
          <div className="text-center p-2 bg-muted/50 rounded">
            <p className="text-lg font-bold">{details?.networks || 0}</p>
            <p className="text-xs text-muted-foreground">Networks</p>
          </div>
          <div className="text-center p-2 bg-muted/50 rounded">
            <p className="text-lg font-bold">{details?.vms || 0}</p>
            <p className="text-xs text-muted-foreground">VMs</p>
          </div>
          <div className="text-center p-2 bg-muted/50 rounded">
            <p className="text-lg font-bold">{details?.hosts || 0}</p>
            <p className="text-xs text-muted-foreground">Hosts</p>
          </div>
          <div className="text-center p-2 bg-muted/50 rounded">
            <p className="text-lg font-bold text-success">{details?.auto_linked || 0}</p>
            <p className="text-xs text-muted-foreground">Auto-Linked</p>
          </div>
        </div>

        {/* Per-vCenter accordion */}
        <Accordion type="multiple" className="w-full">
          {vcenterResults.map((result, index) => {
            const isSuccess = result?.status !== 'failed';
            return (
              <AccordionItem key={result?.vcenter_id || index} value={`vcenter-${index}`}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-3 w-full pr-4">
                    <Database className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">
                      {result?.vcenter_name || result?.vcenter_host || `vCenter ${index + 1}`}
                    </span>
                    <Badge 
                      variant={isSuccess ? "secondary" : "destructive"} 
                      className="ml-auto text-xs"
                    >
                      {isSuccess ? 'Success' : 'Failed'}
                    </Badge>
                    {result?.sync_duration_seconds && (
                      <span className="text-xs text-muted-foreground">
                        {result.sync_duration_seconds}s
                      </span>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="pt-2">
                    <SingleVCenterResults result={result} showHeader={false} />
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        {/* Error list if any */}
        {details?.errors && Array.isArray(details.errors) && details.errors.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-destructive flex items-center gap-2">
                <XCircle className="h-4 w-4" />
                Errors ({details.errors.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {details.errors.map((error: string, idx: number) => (
                  <p key={idx} className="text-sm text-muted-foreground font-mono">
                    • {error}
                  </p>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Single vCenter result (or no vcenter_results array)
  return <SingleVCenterResults result={details} />;
};
