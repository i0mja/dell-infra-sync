import { useState } from "react";
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
}

interface HealthResults {
  target_id: string;
  target_name: string;
  hostname: string;
  zfs_pool: string;
  overall_status: 'healthy' | 'degraded' | 'offline';
  tests: HealthTest[];
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
  pool_capacity: { label: "Pool Capacity", icon: <Activity className="h-4 w-4" /> },
  cross_site_ssh: { label: "Cross-Site SSH", icon: <Link2 className="h-4 w-4" /> },
  syncoid_cron: { label: "Replication Schedule", icon: <Clock className="h-4 w-4" /> },
  last_sync: { label: "Last Sync", icon: <RefreshCw className="h-4 w-4" /> },
};

const REPAIR_JOB_TYPES: Record<string, string> = {
  zfs_pool_health: 'repair_zfs_pool',
  cross_site_ssh: 'repair_cross_site_ssh',
  syncoid_cron: 'repair_syncoid_cron',
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

    setRepairingTest(testName);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase.from("jobs").insert({
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
      });

      if (error) throw error;

      toast({
        title: "Repair job created",
        description: `Attempting to repair ${TEST_LABELS[testName]?.label || testName}`,
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    } finally {
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
                
                return (
                  <div
                    key={test.name}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
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
                      </div>
                    </div>
                    {!test.success && test.repairable && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRepair(test.name)}
                        disabled={repairingTest === test.name}
                      >
                        {repairingTest === test.name ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Wrench className="h-4 w-4 mr-1" />
                            Repair
                          </>
                        )}
                      </Button>
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
            <Button onClick={onRefresh} disabled={refreshing}>
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
