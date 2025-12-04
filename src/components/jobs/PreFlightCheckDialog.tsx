import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, AlertTriangle, Loader2, Server, HardDrive, Clock, Activity, Thermometer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MaintenanceBlockersPanel } from "./MaintenanceBlockersPanel";

interface PreFlightCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProceed: () => void;
  serverId: string;
  jobType: 'firmware_update' | 'full_server_update';
}

interface IdracCheck {
  passed: boolean;
  status?: string;
  message?: string;
  count?: number;
  jobs?: any[];
  overall?: string;
  details?: any;
  rebuilding?: boolean;
  state?: string;
  warnings?: any[];
}

interface IdracPreflightResult {
  server_id: string;
  hostname: string;
  ip_address: string;
  ready: boolean;
  error?: string;
  checks: {
    lc_status?: IdracCheck;
    pending_jobs?: IdracCheck;
    system_health?: IdracCheck;
    storage_health?: IdracCheck;
    power_state?: IdracCheck;
    thermal_status?: IdracCheck;
  };
  warnings?: string[];
}

interface MaintenanceBlocker {
  vm_name: string;
  vm_id: string;
  reason: 'local_storage' | 'passthrough' | 'affinity' | 'connected_media' | 'vcsa' | 'critical_infra';
  severity: 'critical' | 'warning';
  details: string;
  remediation: string;
  auto_fixable: boolean;
}

interface HostBlockerAnalysis {
  host_id: string;
  host_name: string;
  can_enter_maintenance: boolean;
  blockers: MaintenanceBlocker[];
  warnings: string[];
  total_powered_on_vms: number;
  migratable_vms: number;
  blocked_vms: number;
  estimated_evacuation_time: number;
}

interface SafetyCheckResult {
  safe_to_proceed: boolean;
  total_hosts: number;
  healthy_hosts: number;
  min_required_hosts: number;
  drs_enabled: boolean;
  drs_mode: string;
  drs_warning: boolean;
  target_host_vms: number;
  target_host_powered_on_vms: number;
  target_host_powered_off_vms: number;
  estimated_evacuation_seconds: number;
  warnings: string[];
  recommendation: string;
  // iDRAC Pre-flight Results
  idrac_checks?: IdracPreflightResult[];
  all_idrac_ready?: boolean;
  // Maintenance blocker analysis
  maintenance_blockers?: Record<string, HostBlockerAnalysis>;
  critical_blockers_found?: boolean;
}

export const PreFlightCheckDialog = ({ open, onOpenChange, onProceed, serverId, jobType }: PreFlightCheckDialogProps) => {
  const [loading, setLoading] = useState(true);
  const [checkJobId, setCheckJobId] = useState<string | null>(null);
  const [result, setResult] = useState<SafetyCheckResult | null>(null);
  const [serverInfo, setServerInfo] = useState<any>(null);
  const [clusterName, setClusterName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (open && serverId) {
      startPreFlightCheck();
    } else {
      // Reset state when dialog closes
      setLoading(true);
      setCheckJobId(null);
      setResult(null);
      setServerInfo(null);
      setClusterName("");
      setError(null);
    }
  }, [open, serverId]);

  const startPreFlightCheck = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch server and vCenter host info
      const { data: server, error: serverError } = await supabase
        .from('servers')
        .select('*, vcenter_hosts(*)')
        .eq('id', serverId)
        .single();

      if (serverError) throw serverError;
      if (!server) throw new Error("Server not found");

      setServerInfo(server);

      // Check if server has vCenter link
      if (!server.vcenter_host_id || !server.vcenter_hosts) {
        throw new Error("Server is not linked to vCenter - safety check unavailable");
      }

      const vcenterHost = Array.isArray(server.vcenter_hosts) ? server.vcenter_hosts[0] : server.vcenter_hosts;
      
      if (!vcenterHost?.cluster) {
        throw new Error("Server's vCenter host is not part of a cluster");
      }

      setClusterName(vcenterHost.cluster);

      // Create cluster safety check job
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'cluster_safety_check',
          created_by: user?.id,
          status: 'pending',
          details: {
            cluster_name: vcenterHost.cluster,
            min_required_hosts: 2,
            check_drs: true,
            check_ha: true,
            target_host_id: server.vcenter_host_id
          },
          target_scope: {}
        })
        .select()
        .single();

      if (jobError) throw jobError;
      setCheckJobId(job.id);

      // Poll for results
      pollJobStatus(job.id);
    } catch (err: any) {
      console.error("Pre-flight check error:", err);
      setError(err.message);
      setLoading(false);
    }
  };

  const pollJobStatus = async (jobId: string) => {
    const maxAttempts = 30; // 60 seconds max
    let attempts = 0;

    const poll = async () => {
      attempts++;

      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .select('*, cluster_safety_checks(*)')
        .eq('id', jobId)
        .single();

      if (jobError) {
        setError(jobError.message);
        setLoading(false);
        return;
      }

      if (job.status === 'completed') {
        const safetyCheck = Array.isArray(job.cluster_safety_checks) 
          ? job.cluster_safety_checks[0] 
          : job.cluster_safety_checks;
        
        if (safetyCheck?.details) {
          setResult(safetyCheck.details as unknown as SafetyCheckResult);
        } else if (job.details) {
          setResult(job.details as unknown as SafetyCheckResult);
        }
        setLoading(false);
      } else if (job.status === 'failed') {
        const errorMsg = typeof job.details === 'object' && job.details !== null && 'error' in job.details
          ? String(job.details.error)
          : "Safety check failed";
        setError(errorMsg);
        setLoading(false);
      } else if (attempts < maxAttempts) {
        setTimeout(poll, 2000);
      } else {
        setError("Safety check timeout - please try again");
        setLoading(false);
      }
    };

    poll();
  };

  const formatEvacuationTime = (seconds: number): string => {
    if (seconds < 60) return `~${seconds} seconds`;
    const minutes = Math.ceil(seconds / 60);
    return `~${minutes} minute${minutes > 1 ? 's' : ''}`;
  };

  const getStatusIcon = () => {
    if (result?.safe_to_proceed) {
      return <CheckCircle className="h-6 w-6 text-green-500" />;
    } else if (result?.warnings && result.warnings.length > 0) {
      return <AlertTriangle className="h-6 w-6 text-yellow-500" />;
    } else {
      return <XCircle className="h-6 w-6 text-destructive" />;
    }
  };

  const getStatusBadge = () => {
    if (!result) return null;
    
    if (result.safe_to_proceed && result.warnings.length === 0) {
      return <Badge className="bg-green-500 hover:bg-green-600">Safe to Proceed</Badge>;
    } else if (result.safe_to_proceed) {
      return <Badge className="bg-yellow-500 hover:bg-yellow-600">Proceed with Caution</Badge>;
    } else {
      return <Badge variant="destructive">Unsafe to Proceed</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Pre-Flight Check: Server Update
            {result && getStatusIcon()}
          </DialogTitle>
          <DialogDescription>
            Validating cluster safety for: {serverInfo?.hostname || serverInfo?.ip_address}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loading && !error && (
            <div className="space-y-4">
              <Alert>
                <Loader2 className="h-4 w-4 animate-spin" />
                <AlertDescription>Running safety checks...</AlertDescription>
              </Alert>
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            </div>
          )}

          {!loading && !error && result && (
            <>
              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <span className="font-semibold">Overall Status</span>
                {getStatusBadge()}
              </div>

              {/* Cluster Information */}
              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  Cluster: {clusterName}
                </h4>
                <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
                  <div>
                    <div className="text-sm text-muted-foreground">Total Hosts</div>
                    <div className="text-2xl font-bold">{result.total_hosts}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Healthy Hosts</div>
                    <div className="text-2xl font-bold">{result.healthy_hosts}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">After Maintenance</div>
                    <div className="text-2xl font-bold">{result.healthy_hosts - 1}</div>
                  </div>
                </div>
              </div>

              {/* DRS Status */}
              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  DRS Configuration
                </h4>
                <div className="space-y-2 p-4 bg-muted rounded-lg">
                  <div className="flex items-center justify-between">
                    <span>DRS Enabled</span>
                    {result.drs_enabled ? (
                      <Badge className="bg-green-500">Yes</Badge>
                    ) : (
                      <Badge variant="destructive">No</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Automation Level</span>
                    <Badge variant={result.drs_mode === 'fullyAutomated' ? 'default' : 'secondary'}>
                      {result.drs_mode === 'fullyAutomated' ? 'Fully Automated' :
                       result.drs_mode === 'partiallyAutomated' ? 'Partially Automated' : 'Manual'}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* VM Information */}
              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Virtual Machines on Target Host
                </h4>
                <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
                  <div>
                    <div className="text-sm text-muted-foreground">Running VMs</div>
                    <div className="text-2xl font-bold">{result.target_host_powered_on_vms}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Powered Off</div>
                    <div className="text-2xl font-bold">{result.target_host_powered_off_vms}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Est. Evacuation</div>
                    <div className="text-lg font-bold">{formatEvacuationTime(result.estimated_evacuation_seconds)}</div>
                  </div>
                </div>
              </div>

              {/* Maintenance Blockers Panel */}
              {result.maintenance_blockers && Object.keys(result.maintenance_blockers).length > 0 && (
                <MaintenanceBlockersPanel 
                  blockers={result.maintenance_blockers}
                  onSkipHost={(hostId) => {
                    toast({
                      title: "Skip Host",
                      description: `Host ${hostId} will be skipped during the update`,
                    });
                  }}
                />
              )}

              {/* Warnings */}
              {result.warnings && result.warnings.length > 0 && (
                <Alert className="border-yellow-500">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="font-semibold mb-2">Warnings:</div>
                    <ul className="list-disc list-inside space-y-1">
                      {result.warnings.map((warning, idx) => (
                        <li key={idx}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* NEW: iDRAC Pre-Flight Checks */}
              {result.idrac_checks && result.idrac_checks.length > 0 && (
                <div className="space-y-4">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Dell iDRAC Pre-Flight Checks
                  </h4>
                  
                  {result.idrac_checks.map((server) => (
                    <Card key={server.server_id} className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <span className="font-medium">{server.hostname}</span>
                          <span className="text-sm text-muted-foreground ml-2">({server.ip_address})</span>
                        </div>
                        <Badge variant={server.ready ? "default" : "destructive"}>
                          {server.ready ? "Ready" : "Not Ready"}
                        </Badge>
                      </div>
                      
                      {server.error ? (
                        <Alert variant="destructive">
                          <AlertDescription>{server.error}</AlertDescription>
                        </Alert>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          {/* Lifecycle Controller */}
                          {server.checks.lc_status && (
                            <div className="flex items-center justify-between p-2 bg-muted rounded">
                              <span className="flex items-center gap-2">
                                {server.checks.lc_status.passed ? (
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-destructive" />
                                )}
                                Lifecycle Controller
                              </span>
                              <span className="text-xs">{server.checks.lc_status.status}</span>
                            </div>
                          )}
                          
                          {/* Pending Jobs */}
                          {server.checks.pending_jobs && (
                            <div className="flex items-center justify-between p-2 bg-muted rounded">
                              <span className="flex items-center gap-2">
                                {server.checks.pending_jobs.passed ? (
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-destructive" />
                                )}
                                Job Queue
                              </span>
                              <span className="text-xs">
                                {server.checks.pending_jobs.count || 0} pending
                              </span>
                            </div>
                          )}
                          
                          {/* System Health */}
                          {server.checks.system_health && (
                            <div className="flex items-center justify-between p-2 bg-muted rounded">
                              <span className="flex items-center gap-2">
                                {server.checks.system_health.passed ? (
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                ) : (
                                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                                )}
                                System Health
                              </span>
                              <span className="text-xs">{server.checks.system_health.overall}</span>
                            </div>
                          )}
                          
                          {/* Storage */}
                          {server.checks.storage_health && (
                            <div className="flex items-center justify-between p-2 bg-muted rounded">
                              <span className="flex items-center gap-2">
                                {server.checks.storage_health.passed ? (
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                ) : (
                                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                                )}
                                Storage/RAID
                              </span>
                              <span className="text-xs">
                                {server.checks.storage_health.rebuilding ? "Rebuilding" : "OK"}
                              </span>
                            </div>
                          )}
                          
                          {/* Power */}
                          {server.checks.power_state && (
                            <div className="flex items-center justify-between p-2 bg-muted rounded">
                              <span className="flex items-center gap-2">
                                {server.checks.power_state.passed ? (
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-destructive" />
                                )}
                                Power State
                              </span>
                              <span className="text-xs">{server.checks.power_state.state}</span>
                            </div>
                          )}
                          
                          {/* Thermal */}
                          {server.checks.thermal_status && (
                            <div className="flex items-center justify-between p-2 bg-muted rounded">
                              <span className="flex items-center gap-2">
                                {server.checks.thermal_status.passed ? (
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                ) : (
                                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                                )}
                                <Thermometer className="h-3 w-3" />
                                Thermal
                              </span>
                              <span className="text-xs">
                                {server.checks.thermal_status.warnings?.length || 0} warning(s)
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* Server-specific warnings */}
                      {server.warnings && server.warnings.length > 0 && (
                        <Alert className="mt-3 border-yellow-500">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                            <ul className="list-disc list-inside text-xs">
                              {server.warnings.map((warning, idx) => (
                                <li key={idx}>{warning}</li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      )}
                    </Card>
                  ))}
                </div>
              )}

              {/* Recommendation */}
              <Alert variant={result.safe_to_proceed && !result.critical_blockers_found ? "default" : "destructive"}>
                <AlertDescription>
                  <div className="font-semibold mb-1">{result.recommendation}</div>
                  {result.safe_to_proceed && !result.critical_blockers_found ? (
                    <p className="text-sm">
                      Cluster has sufficient capacity for maintenance.
                      {result.drs_enabled && " VMs will be automatically evacuated via DRS."}
                      {result.idrac_checks && result.idrac_checks.length > 0 && result.all_idrac_ready && 
                        " All Dell servers passed pre-flight checks."}
                    </p>
                  ) : (
                    <p className="text-sm">
                      {result.critical_blockers_found
                        ? "Critical maintenance blockers detected. Some VMs cannot be automatically migrated (local storage, passthrough devices, or vCenter Server). Review the blockers above and resolve issues before proceeding."
                        : !result.all_idrac_ready && result.idrac_checks && result.idrac_checks.length > 0
                        ? "One or more Dell servers failed critical pre-flight checks. Resolve issues before proceeding."
                        : "Insufficient hosts or DRS configuration prevents safe update. Recommend enabling DRS or adding hosts before proceeding."}
                    </p>
                  )}
                </AlertDescription>
              </Alert>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {!loading && !error && result && (
            <>
              {result.safe_to_proceed && !result.critical_blockers_found ? (
                <Button onClick={() => {
                  onOpenChange(false);
                  onProceed();
                }}>
                  Proceed with Update
                </Button>
              ) : (
                <Button 
                  variant="destructive"
                  onClick={() => {
                    onOpenChange(false);
                    onProceed();
                  }}
                >
                  {result.critical_blockers_found ? "Proceed Anyway (Risk)" : "Override (Admin Only)"}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
