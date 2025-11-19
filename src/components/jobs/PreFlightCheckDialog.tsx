import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, AlertTriangle, Loader2, Server, HardDrive, Clock } from "lucide-react";

interface PreFlightCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProceed: () => void;
  serverId: string;
  jobType: 'firmware_update' | 'full_server_update';
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

              {/* Recommendation */}
              <Alert variant={result.safe_to_proceed ? "default" : "destructive"}>
                <AlertDescription>
                  <div className="font-semibold mb-1">{result.recommendation}</div>
                  {result.safe_to_proceed ? (
                    <p className="text-sm">
                      Cluster has sufficient capacity for maintenance.
                      {result.drs_enabled && " VMs will be automatically evacuated via DRS."}
                    </p>
                  ) : (
                    <p className="text-sm">
                      Insufficient hosts or DRS configuration prevents safe update.
                      Recommend enabling DRS or adding hosts before proceeding.
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
              {result.safe_to_proceed ? (
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
                  Override (Admin Only)
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
