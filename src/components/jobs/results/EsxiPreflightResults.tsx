import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, AlertTriangle, Server, HardDrive, Network, Shield } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

interface PreflightCheck {
  success: boolean;
  ready: boolean;
  host_name: string;
  host_id: string;
  checks: {
    current_version: string;
    target_version: string;
    connection_state: string;
    power_state: string;
    vmotion_enabled: boolean;
    vmotion_ip?: string;
    cluster_name?: string;
    cluster_drs_enabled?: boolean;
    cluster_ha_enabled?: boolean;
    cluster_connected_hosts?: number;
    cluster_total_hosts?: number;
    running_vms: number;
    powered_off_vms: number;
    min_datastore_free_gb: number;
    pending_reboot: boolean;
    in_maintenance_mode: boolean;
  };
  warnings: string[];
  blockers: string[];
}

interface EsxiPreflightResultsProps {
  details: {
    profile_name: string;
    target_version: string;
    total_hosts: number;
    ready_count: number;
    blocked_count: number;
    results: PreflightCheck[];
  };
}

export function EsxiPreflightResults({ details }: EsxiPreflightResultsProps) {
  const { profile_name, target_version, total_hosts, ready_count, blocked_count, results } = details;

  const overallReady = blocked_count === 0;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <Card className="p-6 border-border/50">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold mb-1">ESXi Upgrade Pre-flight Check</h3>
            <p className="text-sm text-muted-foreground">
              Profile: {profile_name} → {target_version}
            </p>
          </div>
          <Badge variant={overallReady ? "default" : "destructive"} className="text-sm">
            {overallReady ? (
              <><CheckCircle2 className="w-4 h-4 mr-1" /> All Ready</>
            ) : (
              <><XCircle className="w-4 h-4 mr-1" /> {blocked_count} Blocked</>
            )}
          </Badge>
        </div>

        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold">{total_hosts}</div>
            <div className="text-sm text-muted-foreground">Total Hosts</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{ready_count}</div>
            <div className="text-sm text-muted-foreground">Ready</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-destructive">{blocked_count}</div>
            <div className="text-sm text-muted-foreground">Blocked</div>
          </div>
        </div>
      </Card>

      {/* Individual Host Results */}
      {results.map((result, index) => (
        <Card key={index} className="p-6 border-border/50">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <Server className="w-5 h-5 text-muted-foreground" />
              <div>
                <h4 className="font-semibold">{result.host_name}</h4>
                <p className="text-sm text-muted-foreground">
                  Current: {result.checks.current_version}
                </p>
              </div>
            </div>
            <Badge variant={result.ready ? "default" : result.blockers.length > 0 ? "destructive" : "secondary"}>
              {result.ready ? "Ready" : result.blockers.length > 0 ? "Blocked" : "Warning"}
            </Badge>
          </div>

          {/* Blockers */}
          {result.blockers.length > 0 && (
            <Alert variant="destructive" className="mb-4">
              <XCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-semibold mb-2">Critical Issues:</div>
                <ul className="list-disc list-inside space-y-1">
                  {result.blockers.map((blocker, i) => (
                    <li key={i} className="text-sm">{blocker}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <Alert className="mb-4 border-yellow-500/50 bg-yellow-500/10">
              <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              <AlertDescription>
                <div className="font-semibold mb-2 text-yellow-600 dark:text-yellow-400">Warnings:</div>
                <ul className="list-disc list-inside space-y-1">
                  {result.warnings.map((warning, i) => (
                    <li key={i} className="text-sm">{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Detailed Checks */}
          <div className="space-y-4">
            {/* Host Status */}
            <div>
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <Server className="w-4 h-4" />
                Host Status
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">Connection:</span>
                  <Badge variant={result.checks.connection_state === 'connected' ? 'default' : 'destructive'} className="h-5 text-xs">
                    {result.checks.connection_state}
                  </Badge>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">Power:</span>
                  <Badge variant={result.checks.power_state === 'poweredOn' ? 'default' : 'secondary'} className="h-5 text-xs">
                    {result.checks.power_state}
                  </Badge>
                </div>
                {result.checks.pending_reboot && (
                  <div className="flex justify-between p-2 rounded bg-muted/50">
                    <span className="text-muted-foreground">Reboot Required:</span>
                    <Badge variant="secondary" className="h-5 text-xs">Yes</Badge>
                  </div>
                )}
                {result.checks.in_maintenance_mode && (
                  <div className="flex justify-between p-2 rounded bg-muted/50">
                    <span className="text-muted-foreground">Maintenance Mode:</span>
                    <Badge variant="secondary" className="h-5 text-xs">Active</Badge>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Network */}
            <div>
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <Network className="w-4 h-4" />
                vMotion Network
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">Status:</span>
                  <Badge variant={result.checks.vmotion_enabled ? 'default' : 'destructive'} className="h-5 text-xs">
                    {result.checks.vmotion_enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
                {result.checks.vmotion_ip && (
                  <div className="flex justify-between p-2 rounded bg-muted/50">
                    <span className="text-muted-foreground">IP:</span>
                    <span className="font-mono">{result.checks.vmotion_ip}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Cluster Info */}
            {result.checks.cluster_name && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium mb-2">
                    <Shield className="w-4 h-4" />
                    Cluster: {result.checks.cluster_name}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex justify-between p-2 rounded bg-muted/50">
                      <span className="text-muted-foreground">DRS:</span>
                      <Badge variant={result.checks.cluster_drs_enabled ? 'default' : 'secondary'} className="h-5 text-xs">
                        {result.checks.cluster_drs_enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                    <div className="flex justify-between p-2 rounded bg-muted/50">
                      <span className="text-muted-foreground">HA:</span>
                      <Badge variant={result.checks.cluster_ha_enabled ? 'default' : 'secondary'} className="h-5 text-xs">
                        {result.checks.cluster_ha_enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                    <div className="flex justify-between p-2 rounded bg-muted/50 col-span-2">
                      <span className="text-muted-foreground">Hosts:</span>
                      <span>{result.checks.cluster_connected_hosts} / {result.checks.cluster_total_hosts} connected</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            <Separator />

            {/* VMs and Storage */}
            <div>
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <HardDrive className="w-4 h-4" />
                VMs & Storage
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">Running VMs:</span>
                  <span className="font-semibold">{result.checks.running_vms}</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">Powered Off VMs:</span>
                  <span className="font-semibold">{result.checks.powered_off_vms}</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/50 col-span-2">
                  <span className="text-muted-foreground">Min Datastore Free:</span>
                  <Badge variant={result.checks.min_datastore_free_gb >= 10 ? 'default' : 'destructive'} className="h-5 text-xs">
                    {result.checks.min_datastore_free_gb.toFixed(1)} GB
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
