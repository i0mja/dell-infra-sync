import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Wrench,
  RefreshCw,
  HardDrive,
  Link2,
  Clock,
  Server,
  Activity,
  Loader2,
  FolderOpen,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface HealthTest {
  name: string;
  success: boolean;
  message?: string;
  pool_status?: string;
  free_gb?: number;
  total_gb?: number;
  used_percent?: number;
  last_scrub?: string;
  partner_name?: string;
  partner_hostname?: string;
  schedule?: string;
  repairable?: boolean;
  // NFS export visibility fields
  export_path?: string;
  has_crossmnt?: boolean;
  child_datasets?: string[];
  // Data transfer test fields
  transfer_time_ms?: number;
  source_content?: string;
  dest_content?: string;
  mismatch_type?: 'content_mismatch' | 'missing_on_dest' | 'transfer_failed';
}

interface HealthResults {
  target_id: string;
  target_name: string;
  hostname: string;
  zfs_pool: string;
  overall_status: 'healthy' | 'degraded' | 'offline';
  tests: HealthTest[];
}

interface RepairResult {
  success: boolean;
  repair_log: string[];
  message?: string;
  testName: string;
}

interface ZfsTargetHealthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  healthResults: HealthResults | null;
  partnerName?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}

const TEST_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  ssh_connectivity: { label: "SSH Connectivity", icon: <Server className="h-4 w-4" /> },
  zfs_pool_health: { label: "ZFS Pool Health", icon: <HardDrive className="h-4 w-4" /> },
  nfs_export_visibility: { label: "NFS Export Visibility", icon: <FolderOpen className="h-4 w-4" /> },
  data_transfer_test: { label: "Data Transfer Test", icon: <HardDrive className="h-4 w-4" /> },
  pool_capacity: { label: "Pool Capacity", icon: <Activity className="h-4 w-4" /> },
  cross_site_ssh: { label: "Cross-Site SSH", icon: <Link2 className="h-4 w-4" /> },
  syncoid_cron: { label: "Replication Schedule", icon: <Clock className="h-4 w-4" /> },
  snapshot_sync_status: { label: "Snapshot Sync Status", icon: <RefreshCw className="h-4 w-4" /> },
  last_sync: { label: "Last Sync", icon: <RefreshCw className="h-4 w-4" /> },
};

const REPAIR_JOB_TYPES: Record<string, string> = {
  zfs_pool_health: 'repair_zfs_pool',
  cross_site_ssh: 'repair_cross_site_ssh',
  syncoid_cron: 'repair_syncoid_cron',
  nfs_export_visibility: 'repair_nfs_export',
  data_transfer_test: 'repair_data_transfer',
};

export function ZfsTargetHealthDialog({
  open,
  onOpenChange,
  healthResults,
  partnerName,
  onRefresh,
  refreshing,
}: ZfsTargetHealthDialogProps) {
  const { toast } = useToast();
  const [repairingTest, setRepairingTest] = useState<string | null>(null);
  const [activeRepairJobId, setActiveRepairJobId] = useState<string | null>(null);
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null);

  // Subscribe to repair job updates
  useEffect(() => {
    if (!activeRepairJobId) return;

    const channel = supabase
      .channel(`repair-job-${activeRepairJobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `id=eq.${activeRepairJobId}`,
        },
        (payload) => {
          const job = payload.new as any;
          if (job.status === 'completed' || job.status === 'failed') {
            const details = job.details || {};
            setRepairResult({
              success: details.success ?? job.status === 'completed',
              repair_log: details.repair_log || [],
              message: details.message,
              testName: repairingTest || '',
            });
            setActiveRepairJobId(null);
            setRepairingTest(null);
            
            // Auto-refresh health check after repair
            if (onRefresh) {
              setTimeout(() => onRefresh(), 1000);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeRepairJobId, repairingTest, onRefresh]);

  // Clear repair result when dialog closes
  useEffect(() => {
    if (!open) {
      setRepairResult(null);
      setRepairingTest(null);
      setActiveRepairJobId(null);
    }
  }, [open]);

  if (!healthResults) {
    return null;
  }

  const handleRepair = async (testName: string) => {
    const jobType = REPAIR_JOB_TYPES[testName];
    if (!jobType) {
      toast({
        title: "Cannot repair",
        description: `No repair action available for ${testName}`,
        variant: "destructive",
      });
      return;
    }

    // Clear previous result if repairing same test
    if (repairResult?.testName === testName) {
      setRepairResult(null);
    }

    setRepairingTest(testName);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase.from("jobs").insert({
        job_type: jobType as any,
        status: "pending",
        created_by: user?.id,
        details: {
          target_id: healthResults.target_id,
          target_name: healthResults.target_name,
          hostname: healthResults.hostname,
          zfs_pool: healthResults.zfs_pool,
          failed_test: testName,
        },
      }).select('id');

      if (error) throw error;

      if (data && data[0]) {
        setActiveRepairJobId(data[0].id);
        toast({
          title: "Repair started",
          description: `Repairing ${TEST_LABELS[testName]?.label || testName}...`,
        });
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
      setRepairingTest(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">Healthy</Badge>;
      case 'degraded':
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30">Degraded</Badge>;
      case 'offline':
        return <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/30">Offline</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const poolTest = healthResults.tests.find(t => t.name === 'zfs_pool_health');
  const crossSiteTest = healthResults.tests.find(t => t.name === 'cross_site_ssh');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Health Check: {healthResults.target_name}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <span>{healthResults.hostname}</span>
            <span className="text-muted-foreground">•</span>
            <span>Pool: {healthResults.zfs_pool}</span>
            <span className="text-muted-foreground">•</span>
            {getStatusBadge(healthResults.overall_status)}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-4 pr-4">
            {/* Pool Capacity Card */}
            {poolTest && poolTest.success && poolTest.used_percent !== undefined && (
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Pool Capacity</span>
                  <span className="text-sm text-muted-foreground">
                    {poolTest.free_gb} GB free of {poolTest.total_gb} GB
                  </span>
                </div>
                <Progress 
                  value={poolTest.used_percent} 
                  className={poolTest.used_percent > 90 ? "[&>div]:bg-red-500" : poolTest.used_percent > 75 ? "[&>div]:bg-yellow-500" : ""}
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{poolTest.used_percent}% used</span>
                  {poolTest.last_scrub && (
                    <span title="Last scrub">{poolTest.last_scrub}</span>
                  )}
                </div>
              </div>
            )}

            {/* Test Results */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Health Tests</h4>
              {healthResults.tests.map((test) => {
                const testConfig = TEST_LABELS[test.name] || { label: test.name, icon: <Activity className="h-4 w-4" /> };
                const isRepairing = repairingTest === test.name && activeRepairJobId;
                const hasRepairResult = repairResult?.testName === test.name;
                
                return (
                  <div
                    key={test.name}
                    className="p-3 rounded-lg border"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={test.success ? "text-green-500" : "text-red-500"}>
                          {test.success ? (
                            <CheckCircle2 className="h-5 w-5" />
                          ) : (
                            <XCircle className="h-5 w-5" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            {testConfig.icon}
                            <span className="font-medium text-sm">{testConfig.label}</span>
                          </div>
                          {test.message && (
                            <p className="text-xs text-muted-foreground mt-0.5 max-w-[280px] truncate" title={test.message}>
                              {test.message}
                            </p>
                          )}
                          {test.partner_name && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Partner: {test.partner_name} ({test.partner_hostname})
                            </p>
                          )}
                          {/* NFS export visibility details */}
                          {test.name === "nfs_export_visibility" && (
                            <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                              {test.export_path && (
                                <p>Export: <span className="font-mono">{test.export_path}</span></p>
                              )}
                              {test.child_datasets && test.child_datasets.length > 0 && (
                                <p>Child datasets: {test.child_datasets.length}</p>
                              )}
                              {!test.success && test.child_datasets && test.child_datasets.length > 0 && !test.has_crossmnt && (
                                <Badge variant="destructive" className="text-xs mt-1">
                                  Missing crossmnt - child datasets invisible
                                </Badge>
                              )}
                            </div>
                          )}
                          {/* Data transfer test details */}
                          {test.name === "data_transfer_test" && !test.success && !hasRepairResult && (
                            <div className="text-xs mt-2 space-y-2">
                              {test.transfer_time_ms && (
                                <p className="text-muted-foreground">Transfer time: {test.transfer_time_ms}ms</p>
                              )}
                              <div className="bg-destructive/10 border border-destructive/20 rounded p-2">
                                <p className="font-medium text-destructive mb-1">Possible causes:</p>
                                <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                                  <li>Stale test datasets from previous checks</li>
                                  <li>Interrupted ZFS send/receive operation</li>
                                  <li>Network timeout during transfer</li>
                                </ul>
                              </div>
                              <p className="text-muted-foreground italic">
                                Click "Repair" to clean up stale data and re-test
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      {!test.success && test.repairable && !isRepairing && !hasRepairResult && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRepair(test.name)}
                          disabled={!!repairingTest}
                        >
                          <Wrench className="h-4 w-4 mr-1" />
                          Repair
                        </Button>
                      )}
                    </div>

                    {/* Repair in progress indicator */}
                    {isRepairing && (
                      <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                          <span className="text-sm text-blue-400">Repair in progress...</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Cleaning up stale data and re-testing transfer...
                        </p>
                      </div>
                    )}

                    {/* Repair result display */}
                    {hasRepairResult && (
                      <div className={`mt-3 p-3 rounded border ${
                        repairResult.success 
                          ? 'bg-green-500/10 border-green-500/20' 
                          : 'bg-red-500/10 border-red-500/20'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          {repairResult.success ? (
                            <CheckCircle2 className="h-4 w-4 text-green-400" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400" />
                          )}
                          <span className={`text-sm font-medium ${
                            repairResult.success ? 'text-green-400' : 'text-red-400'
                          }`}>
                            {repairResult.success ? 'Repair Successful' : 'Repair Failed'}
                          </span>
                        </div>
                        {repairResult.message && (
                          <p className="text-xs text-muted-foreground mb-2">{repairResult.message}</p>
                        )}
                        {repairResult.repair_log.length > 0 && (
                          <div className="text-xs space-y-0.5 text-muted-foreground max-h-32 overflow-y-auto">
                            {repairResult.repair_log.map((step, i) => (
                              <div key={i} className="flex items-start gap-2">
                                <span className="text-muted-foreground/50 shrink-0">•</span>
                                <span className="break-words">{step}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {!repairResult.success && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => handleRepair(test.name)}
                          >
                            <Wrench className="h-4 w-4 mr-1" />
                            Retry Repair
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Partner Link Status */}
            {partnerName && (
              <>
                <Separator />
                <div className="rounded-lg border p-4">
                  <h4 className="font-medium flex items-center gap-2 mb-2">
                    <Link2 className="h-4 w-4" />
                    Partner Target
                  </h4>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">{partnerName}</span>
                    {crossSiteTest ? (
                      crossSiteTest.success ? (
                        <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Connected
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/30">
                          <XCircle className="h-3 w-3 mr-1" />
                          Disconnected
                        </Badge>
                      )
                    ) : (
                      <Badge variant="outline" className="bg-muted text-muted-foreground">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Not tested
                      </Badge>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {onRefresh && (
            <Button onClick={onRefresh} disabled={refreshing || !!activeRepairJobId}>
              {refreshing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Re-check
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
