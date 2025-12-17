import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle, Clock, Activity, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SLAViolation {
  id: string;
  protection_group_id: string;
  violation_type: string;
  severity: string;
  details: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
  notification_sent: boolean;
}

interface SLAJob {
  id: string;
  job_type: string;
  status: string;
  completed_at: string | null;
  details: {
    groups_checked?: number;
    rpo_violations?: number;
    test_overdue?: number;
    triggered_syncs?: string[];
    next_run_scheduled?: boolean;
  };
}

export function SLAMonitoringStatus() {
  // Fetch recent SLA monitoring jobs
  const { data: slaJobs } = useQuery({
    queryKey: ["sla-monitoring-jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, job_type, status, completed_at, details")
        .in("job_type", ["scheduled_replication_check", "rpo_monitoring"])
        .order("completed_at", { ascending: false })
        .limit(10);
      
      if (error) throw error;
      return data as SLAJob[];
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch active SLA violations
  const { data: violations } = useQuery({
    queryKey: ["sla-violations-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sla_violations")
        .select("*")
        .is("resolved_at", null)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data as SLAViolation[];
    },
    refetchInterval: 30000,
  });

  // Get last run times for each job type
  const lastRpoCheck = slaJobs?.find(j => j.job_type === "rpo_monitoring" && j.status === "completed");
  const lastScheduleCheck = slaJobs?.find(j => j.job_type === "scheduled_replication_check" && j.status === "completed");

  // Count violations by type
  const rpoViolations = violations?.filter(v => v.violation_type === "rpo_breach") || [];
  const testOverdue = violations?.filter(v => v.violation_type === "test_overdue") || [];

  const hasViolations = (violations?.length || 0) > 0;

  return (
    <Card className={hasViolations ? "border-destructive/50" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4" />
          SLA Monitoring
          {hasViolations ? (
            <Badge variant="destructive" className="ml-auto">
              {violations?.length} Active Violation{violations?.length !== 1 ? "s" : ""}
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto bg-green-500/10 text-green-600 border-green-500/30">
              All Clear
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Monitoring Status */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">RPO Check:</span>
            {lastRpoCheck?.completed_at ? (
              <span className="text-foreground">
                {formatDistanceToNow(new Date(lastRpoCheck.completed_at), { addSuffix: true })}
              </span>
            ) : (
              <span className="text-muted-foreground italic">Never</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Sync Check:</span>
            {lastScheduleCheck?.completed_at ? (
              <span className="text-foreground">
                {formatDistanceToNow(new Date(lastScheduleCheck.completed_at), { addSuffix: true })}
              </span>
            ) : (
              <span className="text-muted-foreground italic">Never</span>
            )}
          </div>
        </div>

        {/* Violations Summary */}
        {hasViolations && (
          <div className="space-y-2 pt-2 border-t">
            {rpoViolations.length > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="text-destructive font-medium">
                  {rpoViolations.length} RPO Breach{rpoViolations.length !== 1 ? "es" : ""}
                </span>
              </div>
            )}
            {testOverdue.length > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <AlertCircle className="h-4 w-4 text-yellow-500" />
                <span className="text-yellow-600 font-medium">
                  {testOverdue.length} Test{testOverdue.length !== 1 ? "s" : ""} Overdue
                </span>
              </div>
            )}
          </div>
        )}

        {/* All Clear Message */}
        {!hasViolations && (
          <div className="flex items-center gap-2 text-sm text-green-600 pt-2 border-t">
            <CheckCircle className="h-4 w-4" />
            <span>All protection groups meeting SLA targets</span>
          </div>
        )}

        {/* Recent Activity */}
        {lastRpoCheck?.details && (
          <div className="text-xs text-muted-foreground pt-2 border-t">
            Last check: {lastRpoCheck.details.groups_checked || 0} groups monitored
            {lastRpoCheck.details.triggered_syncs && lastRpoCheck.details.triggered_syncs.length > 0 && (
              <span className="ml-2">• {lastRpoCheck.details.triggered_syncs.length} syncs triggered</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
