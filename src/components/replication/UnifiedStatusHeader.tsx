import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  ChevronDown, 
  ChevronUp, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Loader2,
  Server,
  Shield,
  ExternalLink
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { SLADiagnosisDialog } from "./SLADiagnosisDialog";
import { cn } from "@/lib/utils";

interface ActiveJob {
  id: string;
  job_type: string;
  status: string;
  started_at: string | null;
  details: Record<string, any> | null;
}

interface SLAViolation {
  id: string;
  violation_type: string;
  severity: string;
  protection_group_id: string;
  details: Record<string, any>;
}

export function UnifiedStatusHeader() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  // Fetch active replication jobs
  const { data: activeJobs = [] } = useQuery({
    queryKey: ['active-replication-jobs'],
    queryFn: async () => {
      const { data } = await supabase
        .from('jobs')
        .select('id, job_type, status, started_at, details')
        .in('job_type', ['run_replication_sync', 'storage_vmotion', 'create_dr_shell'])
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false })
        .limit(10);
      return (data || []) as ActiveJob[];
    },
    refetchInterval: 3000,
  });

  // Fetch active SLA violations
  const { data: violations = [] } = useQuery({
    queryKey: ['active-sla-violations'],
    queryFn: async () => {
      const { data } = await supabase
        .from('sla_violations')
        .select('id, violation_type, severity, protection_group_id, details')
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(10);
      return (data || []) as SLAViolation[];
    },
    refetchInterval: 30000,
  });

  const runningJobs = activeJobs.filter(j => j.status === 'running');
  const pendingJobs = activeJobs.filter(j => j.status === 'pending');
  const criticalViolations = violations.filter(v => v.severity === 'critical');
  const warningViolations = violations.filter(v => v.severity === 'warning');

  const hasActivity = activeJobs.length > 0 || violations.length > 0;

  if (!hasActivity) {
    return (
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/20">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span>All systems nominal</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="border-b bg-muted/20">
          <CollapsibleTrigger asChild>
            <Button 
              variant="ghost" 
              className="w-full flex items-center justify-between px-4 py-2 h-auto hover:bg-muted/30 rounded-none"
            >
              <div className="flex items-center gap-4">
                {/* Active Jobs Indicator */}
                {runningJobs.length > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                    </div>
                    <span className="text-sm font-medium text-blue-600">
                      {runningJobs.length} syncing
                    </span>
                    {pendingJobs.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        +{pendingJobs.length} queued
                      </span>
                    )}
                  </div>
                )}

                {/* SLA Status */}
                {criticalViolations.length > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {criticalViolations.length} critical
                  </Badge>
                )}
                {warningViolations.length > 0 && (
                  <Badge variant="outline" className="gap-1 text-amber-600 border-amber-500/30">
                    <Clock className="h-3 w-3" />
                    {warningViolations.length} warning
                  </Badge>
                )}

                {/* All clear indicator when jobs but no violations */}
                {violations.length === 0 && activeJobs.length > 0 && (
                  <Badge variant="outline" className="gap-1 text-green-600 border-green-500/30">
                    <Shield className="h-3 w-3" />
                    SLA OK
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="text-xs">Details</span>
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </Button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="px-4 py-3 space-y-3 bg-muted/10 border-t">
              {/* Active Jobs Detail */}
              {activeJobs.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active Jobs</h4>
                  <div className="grid gap-2">
                    {activeJobs.slice(0, 3).map((job) => {
                      const details = job.details || {};
                      const progress = details.progress_percent || 0;
                      const vmName = details.vm_name || details.current_vm;
                      const groupName = details.protection_group_name;

                      return (
                        <div key={job.id} className="flex items-center gap-3 p-2 rounded-md bg-background/50">
                          <div className="flex-shrink-0">
                            {job.status === 'running' ? (
                              <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                            ) : (
                              <Clock className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              {vmName && (
                                <span className="text-sm font-medium flex items-center gap-1 truncate">
                                  <Server className="h-3 w-3" />
                                  {vmName}
                                </span>
                              )}
                              {groupName && !vmName && (
                                <span className="text-sm text-muted-foreground truncate">{groupName}</span>
                              )}
                            </div>
                            <Progress value={progress} className="h-1 mt-1" />
                          </div>
                          <div className="flex-shrink-0 text-xs text-muted-foreground">
                            {progress}%
                          </div>
                        </div>
                      );
                    })}
                    {activeJobs.length > 3 && (
                      <p className="text-xs text-muted-foreground pl-2">
                        +{activeJobs.length - 3} more jobs...
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* SLA Violations Detail - Now Clickable */}
              {violations.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">SLA Issues</h4>
                  <div className="grid gap-1">
                    {violations.slice(0, 5).map((v) => (
                      <button
                        key={v.id}
                        onClick={() => setSelectedGroupId(v.protection_group_id)}
                        className={cn(
                          "flex items-center gap-2 text-sm w-full text-left",
                          "p-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer",
                          "group"
                        )}
                      >
                        {v.severity === 'critical' ? (
                          <AlertTriangle className="h-3 w-3 text-destructive flex-shrink-0" />
                        ) : (
                          <Clock className="h-3 w-3 text-amber-500 flex-shrink-0" />
                        )}
                        <span className="text-muted-foreground flex-shrink-0">
                          {v.details?.group_name || 'Protection Group'}:
                        </span>
                        <span className="flex-1 truncate">
                          {v.violation_type === 'rpo_breach' 
                            ? `RPO ${v.details?.current_rpo_minutes}m (target: ${v.details?.target_rpo_minutes}m)`
                            : 'Test overdue'}
                        </span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* SLA Diagnosis Dialog */}
      <SLADiagnosisDialog
        open={!!selectedGroupId}
        onOpenChange={(open) => !open && setSelectedGroupId(null)}
        protectionGroupId={selectedGroupId || ''}
      />
    </>
  );
}
