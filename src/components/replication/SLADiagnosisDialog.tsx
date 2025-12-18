import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Play,
  Settings,
  RefreshCw,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { RPOGauge } from "./RPOGauge";
import { 
  analyzeProtectionGroup, 
  DiagnosticResult,
  ProtectionGroupData,
  ReplicationTarget,
  ProtectedVM,
  ReplicationJob,
  formatDuration,
} from "@/lib/sla-diagnostics";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

interface SLADiagnosisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  protectionGroupId: string;
  onRunSync?: () => void;
  onEditGroup?: () => void;
}

export function SLADiagnosisDialog({
  open,
  onOpenChange,
  protectionGroupId,
  onRunSync,
  onEditGroup,
}: SLADiagnosisDialogProps) {
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());

  // Fetch protection group
  const { data: group, isLoading: groupLoading } = useQuery({
    queryKey: ['protection-group-diagnosis', protectionGroupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('protection_groups')
        .select('*')
        .eq('id', protectionGroupId)
        .single();
      if (error) throw error;
      return data as ProtectionGroupData;
    },
    enabled: open && !!protectionGroupId,
  });

  // Fetch target
  const { data: target } = useQuery({
    queryKey: ['replication-target-diagnosis', group?.target_id],
    queryFn: async () => {
      if (!group?.target_id) return null;
      const { data, error } = await supabase
        .from('replication_targets')
        .select('*')
        .eq('id', group.target_id)
        .single();
      if (error) return null;
      return data as ReplicationTarget;
    },
    enabled: open && !!group?.target_id,
  });

  // Fetch partner target if exists
  const { data: partnerTarget } = useQuery({
    queryKey: ['partner-target-diagnosis', target?.partner_target_id],
    queryFn: async () => {
      if (!target?.partner_target_id) return null;
      const { data, error } = await supabase
        .from('replication_targets')
        .select('*')
        .eq('id', target.partner_target_id)
        .single();
      if (error) return null;
      return data as ReplicationTarget;
    },
    enabled: open && !!target?.partner_target_id,
  });

  // Fetch protected VMs
  const { data: vms = [] } = useQuery({
    queryKey: ['protected-vms-diagnosis', protectionGroupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('protected_vms')
        .select('id, vm_name, dr_shell_vm_created, replication_status, failover_ready')
        .eq('protection_group_id', protectionGroupId);
      if (error) throw error;
      return data as ProtectedVM[];
    },
    enabled: open && !!protectionGroupId,
  });

  // Fetch recent jobs
  const { data: recentJobs = [] } = useQuery({
    queryKey: ['recent-jobs-diagnosis', protectionGroupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, job_type, status, created_at, completed_at, details')
        .eq('job_type', 'run_replication_sync')
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      // Filter by protection group in details
      return (data || []).filter(j => {
        const details = j.details as Record<string, any> | null;
        return details?.protection_group_id === protectionGroupId;
      }) as ReplicationJob[];
    },
    enabled: open && !!protectionGroupId,
  });

  // Analyze the group
  const diagnostics: DiagnosticResult[] = group 
    ? analyzeProtectionGroup(group, target || null, partnerTarget || null, vms, recentJobs)
    : [];

  const criticalCount = diagnostics.filter(d => d.definition.severity === 'critical').length;
  const warningCount = diagnostics.filter(d => d.definition.severity === 'warning').length;

  const toggleIssue = (code: string) => {
    setExpandedIssues(prev => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertTriangle className="h-4 w-4 text-destructive" />;
      case 'warning':
        return <AlertCircle className="h-4 w-4 text-amber-500" />;
      default:
        return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <Badge variant="destructive">Critical</Badge>;
      case 'warning':
        return <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">Warning</Badge>;
      default:
        return <Badge variant="secondary">Info</Badge>;
    }
  };

  // Calculate current RPO
  const currentRpoMinutes = group?.current_rpo_seconds 
    ? Math.round(group.current_rpo_seconds / 60)
    : group?.last_replication_at
      ? Math.round((Date.now() - new Date(group.last_replication_at).getTime()) / (1000 * 60))
      : 0;

  const targetRpoMinutes = group?.rpo_minutes || 60;

  if (groupLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {criticalCount > 0 ? (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            ) : warningCount > 0 ? (
              <AlertCircle className="h-5 w-5 text-amber-500" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            )}
            SLA Diagnosis: {group?.name}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 pb-4">
            {/* Current Status Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Current Status
              </h3>
              <div className="p-4 rounded-lg border bg-card">
                <RPOGauge 
                  currentMinutes={currentRpoMinutes} 
                  targetMinutes={targetRpoMinutes}
                  size="lg"
                />
                {group?.last_replication_at && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Last sync: {formatDistanceToNow(new Date(group.last_replication_at), { addSuffix: true })}
                  </p>
                )}
              </div>
            </div>

            {/* Root Causes Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  Root Causes Detected
                </h3>
                <span className="text-sm text-muted-foreground">
                  {diagnostics.length} issue{diagnostics.length !== 1 ? 's' : ''} found
                </span>
              </div>

              {diagnostics.length === 0 ? (
                <div className="p-6 rounded-lg border bg-card text-center">
                  <CheckCircle2 className="h-10 w-10 mx-auto text-green-500 mb-3" />
                  <p className="font-medium">No issues detected</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    This protection group appears to be configured correctly
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {diagnostics.map((diagnostic) => (
                    <Collapsible 
                      key={diagnostic.errorCode}
                      open={expandedIssues.has(diagnostic.errorCode)}
                      onOpenChange={() => toggleIssue(diagnostic.errorCode)}
                    >
                      <div className={cn(
                        "rounded-lg border bg-card overflow-hidden",
                        diagnostic.definition.severity === 'critical' && "border-destructive/50",
                        diagnostic.definition.severity === 'warning' && "border-amber-500/50",
                      )}>
                        <CollapsibleTrigger className="w-full">
                          <div className="flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors">
                            {getSeverityIcon(diagnostic.definition.severity)}
                            <div className="flex-1 text-left">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{diagnostic.definition.title}</span>
                                {getSeverityBadge(diagnostic.definition.severity)}
                              </div>
                            </div>
                            {expandedIssues.has(diagnostic.errorCode) ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </CollapsibleTrigger>

                        <CollapsibleContent>
                          <div className="px-3 pb-3 pt-0 space-y-3 border-t">
                            <div className="pt-3">
                              <p className="text-sm text-muted-foreground">
                                {diagnostic.definition.description}
                              </p>
                            </div>

                            <div>
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                Impact
                              </p>
                              <p className="text-sm">
                                {diagnostic.definition.impact}
                              </p>
                            </div>

                            <div>
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                                How to Fix
                              </p>
                              <ol className="list-decimal list-inside space-y-1 text-sm">
                                {diagnostic.definition.howToFix.map((step, i) => (
                                  <li key={i} className="text-muted-foreground">
                                    <span className="text-foreground">{step}</span>
                                  </li>
                                ))}
                              </ol>
                            </div>

                            {/* Context info if available */}
                            {Object.keys(diagnostic.context).length > 0 && (
                              <div className="pt-2 border-t">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                  Details
                                </p>
                                <div className="text-xs text-muted-foreground font-mono bg-muted/50 rounded p-2">
                                  {Object.entries(diagnostic.context).map(([key, value]) => (
                                    <div key={key}>
                                      {key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Quick action button */}
                            {diagnostic.definition.quickActionLabel && (
                              <Button 
                                size="sm" 
                                variant="outline"
                                className="mt-2"
                                onClick={() => {
                                  // Handle quick actions based on type
                                  if (diagnostic.errorCode === 'NEVER_SYNCED' || 
                                      diagnostic.errorCode === 'LAST_SYNC_TOO_OLD') {
                                    onRunSync?.();
                                  } else {
                                    onEditGroup?.();
                                  }
                                  onOpenChange(false);
                                }}
                              >
                                {diagnostic.definition.quickActionLabel}
                                <ExternalLink className="h-3 w-3 ml-1" />
                              </Button>
                            )}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Activity Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Recent Activity
              </h3>
              <div className="p-4 rounded-lg border bg-card">
                {recentJobs.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    No recent replication activity for this group
                  </p>
                ) : (
                  <div className="space-y-2">
                    {recentJobs.slice(0, 5).map((job) => (
                      <div key={job.id} className="flex items-center gap-3 text-sm">
                        {job.status === 'completed' ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : job.status === 'failed' ? (
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                        ) : (
                          <Clock className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="flex-1">
                          {job.job_type.replace(/_/g, ' ')}
                        </span>
                        <span className={cn(
                          "text-xs",
                          job.status === 'failed' && "text-destructive",
                          job.status === 'completed' && "text-green-600"
                        )}>
                          {job.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {onRunSync && (
            <Button onClick={() => { onRunSync(); onOpenChange(false); }}>
              <Play className="h-4 w-4 mr-2" />
              Run Manual Sync
            </Button>
          )}
          {onEditGroup && (
            <Button variant="secondary" onClick={() => { onEditGroup(); onOpenChange(false); }}>
              <Settings className="h-4 w-4 mr-2" />
              Edit Group
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
