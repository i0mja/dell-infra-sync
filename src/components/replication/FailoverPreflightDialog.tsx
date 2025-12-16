import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Shield,
  Zap,
  Wrench,
  Wand2,
} from "lucide-react";
import { useFailoverOperations, usePreflightJobStatus, PreflightCheckResult } from "@/hooks/useFailoverOperations";
import { usePreflightRemediation, type Remediation } from "@/hooks/usePreflightRemediation";
import { AdminPasswordDialog } from "./AdminPasswordDialog";

interface FailoverPreflightDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  groupName: string;
  onProceedToFailover: (forceOverride?: boolean) => void;
}

export function FailoverPreflightDialog({
  open,
  onOpenChange,
  groupId,
  groupName,
  onProceedToFailover,
}: FailoverPreflightDialogProps) {
  const { runPreflightCheck } = useFailoverOperations(groupId);
  const { applyFix, applyAllFixes, getAutoFixableCount, getRemediations } = usePreflightRemediation();
  const [jobId, setJobId] = useState<string | null>(null);
  const [results, setResults] = useState<{
    checks: Record<string, PreflightCheckResult>;
    ready: boolean;
    can_force: boolean;
  } | null>(null);
  const [pendingRemediation, setPendingRemediation] = useState<Remediation | null>(null);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);

  const { data: job, isLoading: polling } = usePreflightJobStatus(jobId || undefined);

  // Start pre-flight check when dialog opens
  useEffect(() => {
    if (open && !jobId && !results) {
      runPreflightCheck.mutateAsync(groupId).then((job) => {
        setJobId(job.id);
      });
    }
  }, [open, groupId]);

  // Update results when job completes
  useEffect(() => {
    const details = job?.details as Record<string, unknown> | null;
    if (job?.status === 'completed' && details?.result) {
      setResults(details.result as typeof results);
    } else if (job?.status === 'failed') {
      setResults({
        checks: {
          job_failed: {
            name: 'Pre-flight Check Job',
            passed: false,
            message: (details?.error as string) || 'Pre-flight check failed',
          }
        },
        ready: false,
        can_force: false,
      });
    }
  }, [job]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setJobId(null);
      setResults(null);
      setPendingRemediation(null);
    }
  }, [open]);

  const handleRunAgain = () => {
    setJobId(null);
    setResults(null);
    runPreflightCheck.mutateAsync(groupId).then((job) => {
      setJobId(job.id);
    });
  };

  const handleApplyFix = (remediation: Remediation) => {
    if (remediation.requires_password) {
      setPendingRemediation(remediation);
      setShowPasswordDialog(true);
    } else {
      applyFix.mutate({ remediation });
    }
  };

  const handlePasswordSubmit = (password: string) => {
    if (pendingRemediation) {
      applyFix.mutate({ remediation: pendingRemediation, adminPassword: password });
      setShowPasswordDialog(false);
      setPendingRemediation(null);
    }
  };

  const handleApplyAllFixes = () => {
    const checks = results?.checks ? Object.values(results.checks) : [];
    const remediations = checks
      .filter(c => !c.passed && c.remediation?.can_auto_fix)
      .map(c => c.remediation!);
    
    if (remediations.length > 0) {
      applyAllFixes.mutate({ remediations });
    }
  };

  const isLoading = runPreflightCheck.isPending || (polling && !results);
  const isApplyingFix = applyFix.isPending || applyAllFixes.isPending;
  const checks = results?.checks ? Object.values(results.checks) : [];
  const blockers = checks.filter(c => !c.passed && !c.is_warning);
  const warnings = checks.filter(c => !c.passed && c.is_warning);
  const passed = checks.filter(c => c.passed);
  const autoFixableCount = checks.filter(c => !c.passed && c.remediation?.can_auto_fix).length;

  // Get progress from job details
  const jobProgress = job?.details as Record<string, unknown> | null;
  const currentCheck = (jobProgress?.current_step as string) || '';
  const checksCompleted = (jobProgress?.checks_completed as number) || 0;
  const totalChecks = (jobProgress?.total_checks as number) || 11;
  const progressPercent = (jobProgress?.progress_percent as number) || 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent 
          className="max-w-lg"
          onInteractOutside={(e) => {
            // Prevent closing while running checks
            if (isLoading) {
              e.preventDefault();
            }
          }}
          onEscapeKeyDown={(e) => {
            if (isLoading) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Pre-Flight Safety Checks
            </DialogTitle>
            <DialogDescription>
              Validating {groupName} is ready for failover
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[400px] pr-4">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Running safety checks...</p>
                
                {/* Progress indicator */}
                {checksCompleted > 0 && (
                  <>
                    <Progress value={progressPercent} className="h-2 w-full max-w-xs" />
                    <p className="text-xs text-muted-foreground text-center">
                      {currentCheck}
                    </p>
                  </>
                )}
              </div>
            ) : results ? (
              <div className="space-y-4">
                {/* Overall Status */}
                <div className={`p-4 rounded-lg border ${
                  results.ready 
                    ? 'bg-green-500/10 border-green-500/30' 
                    : blockers.length > 0 
                      ? 'bg-red-500/10 border-red-500/30'
                      : 'bg-amber-500/10 border-amber-500/30'
                }`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {results.ready ? (
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                      ) : blockers.length > 0 ? (
                        <XCircle className="h-5 w-5 text-red-600" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-amber-600" />
                      )}
                      <span className="font-medium">
                        {results.ready 
                          ? 'Ready for Failover' 
                          : blockers.length > 0 
                            ? 'Not Ready - Blockers Found'
                            : 'Ready with Warnings'}
                      </span>
                    </div>
                    {autoFixableCount > 0 && (
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={handleApplyAllFixes}
                        disabled={isApplyingFix}
                      >
                        <Wand2 className="h-4 w-4 mr-1" />
                        Auto-Fix {autoFixableCount}
                      </Button>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {passed.length}/{checks.length} checks passed
                    {warnings.length > 0 && `, ${warnings.length} warnings`}
                    {blockers.length > 0 && `, ${blockers.length} blockers`}
                  </p>
                </div>

                {/* Blockers */}
                {blockers.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-red-600 flex items-center gap-1">
                      <XCircle className="h-4 w-4" />
                      Blockers ({blockers.length})
                    </h4>
                    {blockers.map((check, i) => (
                      <div key={i} className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className="text-sm font-medium">{check.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{check.message}</p>
                            {check.remediation && (
                              <p className="text-xs text-muted-foreground mt-1 italic">
                                Fix: {check.remediation.description}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {check.can_override && (
                              <Badge variant="outline" className="text-xs">
                                Can Override
                              </Badge>
                            )}
                            {check.remediation && (
                              <Button 
                                size="sm" 
                                variant="outline"
                                className="h-7"
                                onClick={() => handleApplyFix(check.remediation!)}
                                disabled={isApplyingFix}
                              >
                                <Wrench className="h-3 w-3 mr-1" />
                                {check.remediation.can_auto_fix ? 'Fix' : 'Fix...'}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Warnings */}
                {warnings.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4" />
                      Warnings ({warnings.length})
                    </h4>
                    {warnings.map((check, i) => (
                      <div key={i} className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className="text-sm font-medium">{check.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{check.message}</p>
                          </div>
                          {check.remediation && (
                            <Button 
                              size="sm" 
                              variant="ghost"
                              className="h-7"
                              onClick={() => handleApplyFix(check.remediation!)}
                              disabled={isApplyingFix}
                            >
                              <Wrench className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Passed Checks */}
                {passed.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4" />
                      Passed ({passed.length})
                    </h4>
                    <div className="space-y-1">
                      {passed.map((check, i) => (
                        <div key={i} className="flex items-center gap-2 p-2 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                          <span>{check.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No results yet</p>
              </div>
            )}
          </ScrollArea>

          <Separator />

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleRunAgain} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
              Run Again
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              {results && (
                <>
                  {results.ready || (results.can_force && blockers.length === 0) ? (
                    <Button onClick={() => onProceedToFailover(false)}>
                      <Zap className="h-4 w-4 mr-1" />
                      Proceed to Failover
                    </Button>
                  ) : results.can_force ? (
                    <Button 
                      variant="destructive" 
                      onClick={() => onProceedToFailover(true)}
                    >
                      <AlertTriangle className="h-4 w-4 mr-1" />
                      Force Proceed
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminPasswordDialog
        open={showPasswordDialog}
        onOpenChange={setShowPasswordDialog}
        onSubmit={handlePasswordSubmit}
        isLoading={applyFix.isPending}
        title="Root Password Required"
        description="This fix requires the root password for the target server."
      />
    </>
  );
}
