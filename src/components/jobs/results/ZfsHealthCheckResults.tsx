import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Server, 
  HardDrive, 
  Link2, 
  Wrench,
  Wifi,
  Clock,
  Copy,
  Check
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface HealthTest {
  name: string;
  success: boolean;
  message?: string;
  repairable?: boolean;
  pool_status?: string;
  free_gb?: number;
  total_gb?: number;
  used_percent?: number;
  last_scrub?: string;
  partner_name?: string;
  partner_hostname?: string;
}

interface ZfsHealthCheckResultsProps {
  details: {
    results?: {
      tests?: HealthTest[];
      hostname?: string;
      zfs_pool?: string;
      target_id?: string;
      target_name?: string;
      overall_status?: string;
    };
    zfs_pool?: string;
    target_id?: string;
    target_name?: string;
    hosting_vm_name?: string;
    target_hostname?: string;
  };
}

const TEST_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  ssh_connectivity: { label: "SSH Connectivity", icon: Wifi },
  zfs_pool_health: { label: "ZFS Pool Health", icon: HardDrive },
  cross_site_ssh: { label: "Cross-Site Replication Link", icon: Link2 },
  syncoid_cron: { label: "Syncoid Schedule", icon: Clock },
};

const REPAIR_JOB_TYPES: Record<string, string> = {
  zfs_pool_health: "repair_zfs_pool",
  cross_site_ssh: "repair_cross_site_ssh",
  syncoid_cron: "repair_syncoid_cron",
};

export function ZfsHealthCheckResults({ details }: ZfsHealthCheckResultsProps) {
  const [copied, setCopied] = useState(false);
  const [repairingTest, setRepairingTest] = useState<string | null>(null);
  
  const results = details?.results;
  const tests = results?.tests || [];
  const overallStatus = results?.overall_status || "unknown";
  
  // Extract pool test for capacity info
  const poolTest = tests.find(t => t.name === "zfs_pool_health");
  const crossSiteTest = tests.find(t => t.name === "cross_site_ssh");
  
  // Parse last scrub info
  const parseScrubInfo = (scrubStr?: string) => {
    if (!scrubStr) return null;
    
    // Extract date from scrub string like "scan: scrub repaired 0B in 00:00:00 with 0 errors on Sun Dec 14 00:24:01 2025"
    const dateMatch = scrubStr.match(/on\s+(.+)$/);
    const errorsMatch = scrubStr.match(/with\s+(\d+)\s+errors/);
    
    return {
      dateStr: dateMatch?.[1] || null,
      errors: errorsMatch ? parseInt(errorsMatch[1], 10) : null,
    };
  };
  
  const scrubInfo = parseScrubInfo(poolTest?.last_scrub);
  
  const handleRepair = async (testName: string) => {
    const jobType = REPAIR_JOB_TYPES[testName];
    if (!jobType || !details.target_id) return;
    
    setRepairingTest(testName);
    try {
      const { error } = await supabase.from("jobs").insert({
        job_type: jobType as any,
        status: "pending",
        details: {
          target_id: details.target_id,
          target_name: details.target_name,
          target_hostname: details.target_hostname,
          zfs_pool: details.zfs_pool,
          failed_test: testName,
        },
      });
      
      if (error) throw error;
      
      toast({
        title: "Repair Job Created",
        description: `Started repair for ${TEST_LABELS[testName]?.label || testName}`,
      });
    } catch (err) {
      console.error("Failed to create repair job:", err);
      toast({
        title: "Error",
        description: "Failed to create repair job",
        variant: "destructive",
      });
    } finally {
      setRepairingTest(null);
    }
  };
  
  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(details, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
        return "border-green-500/50 bg-green-500/10";
      case "degraded":
        return "border-yellow-500/50 bg-yellow-500/10";
      case "critical":
      case "unhealthy":
        return "border-destructive/50 bg-destructive/10";
      default:
        return "border-muted";
    }
  };
  
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "healthy":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">● Healthy</Badge>;
      case "degraded":
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">⚠ Degraded</Badge>;
      case "critical":
      case "unhealthy":
        return <Badge variant="destructive">✕ Critical</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Overall Status Banner */}
      <Card className={`${getStatusColor(overallStatus)}`}>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {overallStatus === "healthy" ? (
                <CheckCircle2 className="h-6 w-6 text-green-500" />
              ) : overallStatus === "degraded" ? (
                <AlertTriangle className="h-6 w-6 text-yellow-500" />
              ) : (
                <XCircle className="h-6 w-6 text-destructive" />
              )}
              <div>
                <p className="font-semibold">
                  {overallStatus === "healthy" 
                    ? "All Systems Healthy" 
                    : overallStatus === "degraded"
                    ? "Some Issues Detected"
                    : "Critical Issues Found"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {tests.filter(t => t.success).length} of {tests.length} checks passed
                </p>
              </div>
            </div>
            {getStatusBadge(overallStatus)}
          </div>
        </CardContent>
      </Card>
      
      {/* Target Information */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4" />
            Target Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Target Name</p>
              <p className="font-medium">{details.target_name || results?.target_name || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Hostname</p>
              <p className="font-mono">{details.target_hostname || results?.hostname || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">ZFS Pool</p>
              <p className="font-mono">{details.zfs_pool || results?.zfs_pool || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Hosting VM</p>
              <p className="font-medium">{details.hosting_vm_name || "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Pool Capacity */}
      {poolTest && poolTest.total_gb && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              Pool Capacity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {poolTest.free_gb?.toLocaleString()} GB free of {poolTest.total_gb?.toLocaleString()} GB
                </span>
                <span className="font-medium">{poolTest.used_percent}% used</span>
              </div>
              <Progress 
                value={poolTest.used_percent || 0} 
                className={`h-2 ${
                  (poolTest.used_percent || 0) > 90 
                    ? "[&>div]:bg-destructive" 
                    : (poolTest.used_percent || 0) > 80 
                    ? "[&>div]:bg-yellow-500" 
                    : "[&>div]:bg-green-500"
                }`}
              />
            </div>
            
            {scrubInfo && (
              <div className="pt-2 border-t text-sm">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Last Scrub:</span>
                  <span className="font-medium">{scrubInfo.dateStr}</span>
                  {scrubInfo.errors !== null && (
                    <Badge 
                      variant={scrubInfo.errors === 0 ? "secondary" : "destructive"}
                      className="text-xs"
                    >
                      {scrubInfo.errors === 0 ? "No errors" : `${scrubInfo.errors} errors`}
                    </Badge>
                  )}
                </div>
              </div>
            )}
            
            {poolTest.pool_status && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Pool Status:</span>
                <Badge 
                  variant={poolTest.pool_status === "ONLINE" ? "secondary" : "destructive"}
                  className={poolTest.pool_status === "ONLINE" ? "bg-green-500/20 text-green-400" : ""}
                >
                  {poolTest.pool_status}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      
      {/* Health Tests */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Health Tests</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {tests.map((test) => {
              const config = TEST_LABELS[test.name] || { label: test.name.replace(/_/g, " "), icon: CheckCircle2 };
              const Icon = config.icon;
              const canRepair = !test.success && test.repairable && REPAIR_JOB_TYPES[test.name];
              
              return (
                <div 
                  key={test.name} 
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    test.success ? "bg-muted/30" : "bg-destructive/5 border-destructive/20"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {test.success ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="h-5 w-5 text-destructive shrink-0" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{config.label}</span>
                      </div>
                      {test.message && (
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {test.message}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  {canRepair && (
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => handleRepair(test.name)}
                      disabled={repairingTest === test.name}
                    >
                      <Wrench className="h-4 w-4 mr-1" />
                      {repairingTest === test.name ? "Creating..." : "Repair"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      
      {/* Cross-Site Partner Link */}
      {crossSiteTest && (
        <Card className={crossSiteTest.success ? "" : "border-destructive/30"}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Cross-Site Replication Partner
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="font-medium">{crossSiteTest.partner_name || "Unknown Partner"}</p>
                <p className="text-sm font-mono text-muted-foreground">
                  {crossSiteTest.partner_hostname}
                </p>
              </div>
              <Badge 
                variant={crossSiteTest.success ? "secondary" : "destructive"}
                className={crossSiteTest.success ? "bg-green-500/20 text-green-400" : ""}
              >
                {crossSiteTest.success ? "● Connected" : "✕ Disconnected"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Copy Raw Data */}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={handleCopy}>
          {copied ? (
            <>
              <Check className="h-4 w-4 mr-1" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4 mr-1" />
              Copy Raw JSON
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
