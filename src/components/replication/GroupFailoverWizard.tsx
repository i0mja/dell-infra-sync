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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Zap,
  FlaskConical,
  Server,
  ArrowRight,
  ArrowLeft,
  Power,
  RefreshCw,
  RotateCcw,
  Check,
  Settings,
} from "lucide-react";
import { useFailoverOperations, usePreflightJobStatus, FailoverConfig } from "@/hooks/useFailoverOperations";
import { ProtectionGroup, ProtectedVM } from "@/hooks/useReplication";
import { EditProtectionGroupDialog } from "./EditProtectionGroupDialog";

interface GroupFailoverWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: ProtectionGroup;
  vms: ProtectedVM[];
  initialFailoverType?: 'test' | 'live';
  skipPreflight?: boolean;
}

type WizardStep = 'preflight' | 'options' | 'confirm' | 'executing' | 'complete';

export function GroupFailoverWizard({
  open,
  onOpenChange,
  group,
  vms,
  initialFailoverType = 'test',
  skipPreflight = false,
}: GroupFailoverWizardProps) {
  const { runPreflightCheck, executeFailover, activeFailover, commitFailover, rollbackFailover } = useFailoverOperations(group.id);
  
  const [step, setStep] = useState<WizardStep>(skipPreflight ? 'options' : 'preflight');
  const [preflightJobId, setPreflightJobId] = useState<string | null>(null);
  const [failoverJobId, setFailoverJobId] = useState<string | null>(null);
  const [preflightResults, setPreflightResults] = useState<any>(null);
  const [forceOverride, setForceOverride] = useState(false);
  
  // Options
  const [failoverType, setFailoverType] = useState<'test' | 'live'>(initialFailoverType);
  const [shutdownSourceVms, setShutdownSourceVms] = useState(false);
  const [finalSync, setFinalSync] = useState(true);
  const [reverseProtection, setReverseProtection] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [testDurationMinutes, setTestDurationMinutes] = useState(60);

  const { data: preflightJob } = usePreflightJobStatus(preflightJobId || undefined);
  const { data: failoverJob } = usePreflightJobStatus(failoverJobId || undefined);

  // Start preflight when dialog opens
  useEffect(() => {
    if (open && step === 'preflight' && !preflightJobId) {
      runPreflightCheck.mutateAsync(group.id).then((job) => {
        setPreflightJobId(job.id);
      });
    }
  }, [open, step, group.id]);

  // Update preflight results - check both possible keys
  useEffect(() => {
    const details = preflightJob?.details as Record<string, unknown> | null;
    if (preflightJob?.status === 'completed' && details) {
      // Backend may store results under 'result' or 'preflight_results'
      const results = details.result || details.preflight_results;
      if (results) {
        setPreflightResults(results);
      }
    }
  }, [preflightJob]);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setStep(skipPreflight ? 'options' : 'preflight');
      setPreflightJobId(null);
      setFailoverJobId(null);
      setPreflightResults(null);
      setForceOverride(false);
      setConfirmName('');
    }
  }, [open, skipPreflight]);

  // Track failover job progress
  useEffect(() => {
    if (failoverJob?.status === 'completed' || failoverJob?.status === 'failed') {
      setStep('complete');
    }
  }, [failoverJob]);

  const handleStartFailover = async () => {
    setStep('executing');
    
    const config: FailoverConfig = {
      protection_group_id: group.id,
      failover_type: failoverType,
      shutdown_source_vms: shutdownSourceVms,
      final_sync: finalSync,
      reverse_protection: reverseProtection,
      force: forceOverride,
      test_duration_minutes: failoverType === 'test' ? testDurationMinutes : undefined,
    };
    
    const job = await executeFailover.mutateAsync(config);
    setFailoverJobId(job.id);
  };

  const checks = preflightResults?.checks ? Object.values(preflightResults.checks) as any[] : [];
  const blockers = checks.filter((c: any) => !c.passed && !c.is_warning);
  const warnings = checks.filter((c: any) => !c.passed && c.is_warning);
  const canProceed = preflightResults?.ready || (preflightResults?.can_force && forceOverride);

  // Get progress from job details for preflight
  const preflightProgress = preflightJob?.details as Record<string, unknown> | null;
  const currentCheck = (preflightProgress?.current_step as string) || '';
  const checksCompleted = (preflightProgress?.checks_completed as number) || 0;
  const totalChecks = (preflightProgress?.total_checks as number) || 11;
  const progressPercent = (preflightProgress?.progress_percent as number) || 0;

  const renderStep = () => {
    switch (step) {
      case 'preflight':
        return (
          <div className="space-y-4">
            {preflightJob?.status === 'pending' || preflightJob?.status === 'running' || !preflightResults ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Running pre-flight safety checks...</p>
                
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
            ) : (
              <>
                <div className={`p-4 rounded-lg border ${
                  preflightResults.ready 
                    ? 'bg-green-500/10 border-green-500/30' 
                    : blockers.length > 0 
                      ? 'bg-red-500/10 border-red-500/30'
                      : 'bg-amber-500/10 border-amber-500/30'
                }`}>
                  <div className="flex items-center gap-2">
                    {preflightResults.ready ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : blockers.length > 0 ? (
                      <XCircle className="h-5 w-5 text-red-600" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-amber-600" />
                    )}
                    <span className="font-medium">
                      {preflightResults.ready 
                        ? 'Ready for Failover' 
                        : blockers.length > 0 
                          ? 'Blockers Found'
                          : 'Ready with Warnings'}
                    </span>
                  </div>
                </div>

                {blockers.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-red-600">Blockers</h4>
                    {blockers.map((check: any, i: number) => (
                      <div key={i} className="p-2 rounded bg-red-500/5 border border-red-500/20 text-sm">
                        <span className="font-medium">{check.name}:</span> {check.message}
                      </div>
                    ))}
                  </div>
                )}

                {warnings.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-amber-600">Warnings</h4>
                    {warnings.map((check: any, i: number) => (
                      <div key={i} className="p-2 rounded bg-amber-500/5 border border-amber-500/20 text-sm flex items-center justify-between gap-2">
                        <div>
                          <span className="font-medium">{check.name}:</span> {check.message}
                        </div>
                        {check.name === 'Network Mappings Valid' && (
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => setShowEditDialog(true)}
                            className="shrink-0"
                          >
                            <Settings className="h-3 w-3 mr-1" />
                            Configure
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {blockers.length > 0 && preflightResults.can_force && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-muted">
                    <Switch
                      checked={forceOverride}
                      onCheckedChange={setForceOverride}
                      id="force-override"
                    />
                    <Label htmlFor="force-override" className="text-sm cursor-pointer">
                      Force override (I understand the risks)
                    </Label>
                  </div>
                )}
              </>
            )}
          </div>
        );

      case 'options':
        return (
          <div className="space-y-6">
            <div className="space-y-3">
              <Label>Failover Type</Label>
              <RadioGroup value={failoverType} onValueChange={(v) => setFailoverType(v as 'test' | 'live')}>
                <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="test" id="test" />
                  <Label htmlFor="test" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <FlaskConical className="h-4 w-4 text-blue-500" />
                      <span className="font-medium">Test Failover</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Non-destructive test in isolated network. Source VMs remain running.
                    </p>
                  </Label>
                </div>
                <div className="flex items-center space-x-3 p-3 rounded-lg border border-red-500/30 hover:bg-red-500/5 cursor-pointer">
                  <RadioGroupItem value="live" id="live" />
                  <Label htmlFor="live" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-red-500" />
                      <span className="font-medium">Live Failover</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Production failover to DR site. Source VMs will be shut down.
                    </p>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <Separator />

            <div className="space-y-4">
              <h4 className="text-sm font-medium">Options</h4>
              
              <div className="flex items-center justify-between">
                <div>
                  <Label>Run final sync before failover</Label>
                  <p className="text-xs text-muted-foreground">Ensures latest data is replicated</p>
                </div>
                <Switch checked={finalSync} onCheckedChange={setFinalSync} />
              </div>

              {failoverType === 'test' && (
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Test Duration</Label>
                    <p className="text-xs text-muted-foreground">
                      DR VMs will be automatically powered off after this time
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={testDurationMinutes}
                      onChange={(e) => setTestDurationMinutes(Math.max(15, Math.min(480, parseInt(e.target.value) || 60)))}
                      className="w-20"
                      min={15}
                      max={480}
                    />
                    <span className="text-sm text-muted-foreground">minutes</span>
                  </div>
                </div>
              )}

              {failoverType === 'live' && (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Gracefully shutdown source VMs</Label>
                      <p className="text-xs text-muted-foreground">Sends shutdown signal via VMware Tools</p>
                    </div>
                    <Switch checked={shutdownSourceVms} onCheckedChange={setShutdownSourceVms} />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Enable reverse protection</Label>
                      <p className="text-xs text-muted-foreground">Set up replication back to primary site</p>
                    </div>
                    <Switch checked={reverseProtection} onCheckedChange={setReverseProtection} />
                  </div>
                </>
              )}
            </div>
          </div>
        );

      case 'confirm':
        return (
          <div className="space-y-4">
            <div className={`p-4 rounded-lg border ${
              failoverType === 'live' ? 'bg-red-500/10 border-red-500/30' : 'bg-blue-500/10 border-blue-500/30'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {failoverType === 'live' ? (
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                ) : (
                  <FlaskConical className="h-5 w-5 text-blue-600" />
                )}
                <span className="font-medium">
                  {failoverType === 'live' ? 'Live Failover Warning' : 'Test Failover'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {failoverType === 'live' 
                  ? 'This will power on DR VMs and optionally shutdown source VMs. This is a production-impacting operation.'
                  : 'This will power on DR VMs in an isolated network for testing. Source VMs will remain running.'}
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">VMs to Failover ({vms.length})</h4>
              <div className="max-h-[150px] overflow-y-auto space-y-1">
                {vms.map((vm) => (
                  <div key={vm.id} className="flex items-center gap-2 text-sm p-2 rounded bg-muted/50">
                    <Server className="h-4 w-4" />
                    <span>{vm.vm_name}</span>
                    {vm.dr_shell_vm_created ? (
                      <Badge variant="outline" className="ml-auto text-xs">DR Ready</Badge>
                    ) : (
                      <Badge variant="secondary" className="ml-auto text-xs">No DR Shell</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Failover Type:</span>
                <Badge variant={failoverType === 'live' ? 'destructive' : 'default'}>
                  {failoverType === 'live' ? 'Live' : 'Test'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Final Sync:</span>
                <span>{finalSync ? 'Yes' : 'No'}</span>
              </div>
              {failoverType === 'test' && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Auto-Cleanup:</span>
                  <span>{testDurationMinutes} minutes</span>
                </div>
              )}
              {failoverType === 'live' && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Shutdown Source:</span>
                    <span>{shutdownSourceVms ? 'Graceful' : 'No'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Reverse Protection:</span>
                    <span>{reverseProtection ? 'Yes' : 'No'}</span>
                  </div>
                </>
              )}
            </div>

            {failoverType === 'live' && (
              <div className="space-y-2">
                <Label htmlFor="confirm-name">Type "{group.name}" to confirm:</Label>
                <Input
                  id="confirm-name"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={group.name}
                />
              </div>
            )}
          </div>
        );

      case 'executing':
        const executingDetails = failoverJob?.details as Record<string, unknown> | null;
        return (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <div className="relative">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <Power className="h-5 w-5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary" />
              </div>
              <p className="text-lg font-medium">Executing {failoverType} failover...</p>
              <p className="text-sm text-muted-foreground">
                {(executingDetails?.current_step as string) || 'Initializing...'}
              </p>
            </div>

            <Progress value={(executingDetails?.progress as number) || 0} className="h-2" />

            <div className="text-center text-xs text-muted-foreground">
              Do not close this dialog. The failover is in progress.
            </div>
          </div>
        );

      case 'complete':
        const completeDetails = failoverJob?.details as Record<string, unknown> | null;
        const resultData = completeDetails?.result as Record<string, unknown> | undefined;
        const isSuccess = failoverJob?.status === 'completed' && resultData?.success !== false;
        const failedVms = (resultData?.failed_vms as string[]) || [];
        return (
          <div className="space-y-4">
            <div className={`flex flex-col items-center justify-center py-8 gap-4 ${
              isSuccess ? 'text-green-600' : 'text-red-600'
            }`}>
              {isSuccess ? (
                <CheckCircle2 className="h-12 w-12" />
              ) : (
                <XCircle className="h-12 w-12" />
              )}
              <p className="text-lg font-medium">
                {isSuccess ? 'Failover Complete' : 'Failover Failed'}
              </p>
              {!isSuccess && completeDetails?.error && (
                <p className="text-sm text-muted-foreground text-center">
                  {completeDetails.error as string}
                </p>
              )}
              {!isSuccess && failedVms.length > 0 && (
                <div className="text-center">
                  <p className="text-sm font-medium text-red-600 mb-2">Failed VMs:</p>
                  {failedVms.map((vm) => (
                    <div key={vm} className="text-sm text-muted-foreground">• {vm}</div>
                  ))}
                </div>
              )}
            </div>

            {isSuccess && failoverType === 'live' && activeFailover?.status === 'awaiting_commit' && (
              <div className="p-4 rounded-lg border bg-amber-500/10 border-amber-500/30">
                <h4 className="font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Action Required
                </h4>
                <p className="text-sm text-muted-foreground mt-1">
                  Verify the DR VMs are running correctly, then commit or rollback the failover.
                </p>
                <div className="flex gap-2 mt-3">
                  <Button 
                    size="sm" 
                    onClick={() => activeFailover && commitFailover.mutate(activeFailover.id)}
                    disabled={commitFailover.isPending}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Commit
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => activeFailover && rollbackFailover.mutate({ eventId: activeFailover.id, protectionGroupId: group.id })}
                    disabled={rollbackFailover.isPending}
                  >
                    <RotateCcw className="h-4 w-4 mr-1" />
                    Rollback
                  </Button>
                </div>
              </div>
            )}

            {isSuccess && (
              <div className="text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">VMs Recovered:</span>
                  <span>{(completeDetails?.vms_recovered as number) || vms.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Duration:</span>
                  <span>{(completeDetails?.duration as string) || 'N/A'}</span>
                </div>
              </div>
            )}
          </div>
        );
    }
  };

  const canGoNext = () => {
    switch (step) {
      case 'preflight':
        return canProceed;
      case 'options':
        return true;
      case 'confirm':
        return failoverType === 'test' || confirmName === group.name;
      default:
        return false;
    }
  };

  const handleNext = () => {
    switch (step) {
      case 'preflight':
        setStep('options');
        break;
      case 'options':
        setStep('confirm');
        break;
      case 'confirm':
        handleStartFailover();
        break;
    }
  };

  const handleBack = () => {
    switch (step) {
      case 'options':
        setStep('preflight');
        break;
      case 'confirm':
        setStep('options');
        break;
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-lg"
        onInteractOutside={(e) => {
          // Prevent closing during preflight or execution
          if (step === 'preflight' || step === 'executing') {
            e.preventDefault();
          }
        }}
        onEscapeKeyDown={(e) => {
          if (step === 'preflight' || step === 'executing') {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {failoverType === 'live' ? (
              <Zap className="h-5 w-5 text-red-500" />
            ) : (
              <FlaskConical className="h-5 w-5 text-blue-500" />
            )}
            {failoverType === 'live' ? 'Live' : 'Test'} Failover: {group.name}
          </DialogTitle>
          <DialogDescription>
            {step === 'preflight' && 'Checking if the group is ready for failover'}
            {step === 'options' && 'Configure failover options'}
            {step === 'confirm' && 'Review and confirm failover'}
            {step === 'executing' && 'Failover in progress...'}
            {step === 'complete' && 'Failover operation finished'}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[450px]">
          {renderStep()}
        </ScrollArea>

        <Separator />

        <DialogFooter>
          {step !== 'executing' && step !== 'complete' && (
            <>
              {step !== 'preflight' && (
                <Button variant="outline" onClick={handleBack}>
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>
              )}
              <div className="flex-1" />
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleNext} 
                disabled={!canGoNext()}
                variant={step === 'confirm' && failoverType === 'live' ? 'destructive' : 'default'}
              >
                {step === 'confirm' ? (
                  <>
                    <Zap className="h-4 w-4 mr-1" />
                    Start Failover
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </>
                )}
              </Button>
            </>
          )}
          {step === 'complete' && (
            <Button onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Edit dialog for configuring network mappings */}
    <EditProtectionGroupDialog
      group={group}
      open={showEditDialog}
      onOpenChange={setShowEditDialog}
      onSave={async () => {
        // Just close - the mappings are saved directly
        setShowEditDialog(false);
      }}
    />
    </>
  );
}
