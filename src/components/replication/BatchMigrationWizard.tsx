/**
 * Batch Migration Wizard
 * 
 * Multi-step wizard to migrate multiple VMs to the protection datastore.
 */

import { useState, useEffect, useCallback } from "react";
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
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  HardDrive,
  MoveRight,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Server,
  XCircle,
  Clock,
  Info,
} from "lucide-react";
import { ProtectedVM } from "@/hooks/useReplication";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface BatchMigrationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vms: ProtectedVM[];
  protectionGroupId: string;
  protectionDatastore?: string;
  onBatchMigrate: (vmIds: string[]) => Promise<unknown>;
  onComplete: () => void;
}

type WizardStep = 'select' | 'configure' | 'execute' | 'complete';
type MigrationStrategy = 'sequential' | 'parallel';

interface JobStatus {
  id: string;
  status: string;
  vm_name?: string;
  details?: {
    vm_name?: string;
    error?: string;
  };
}

export function BatchMigrationWizard({
  open,
  onOpenChange,
  vms,
  protectionGroupId,
  protectionDatastore,
  onBatchMigrate,
  onComplete,
}: BatchMigrationWizardProps) {
  const [step, setStep] = useState<WizardStep>('select');
  const [selectedVMs, setSelectedVMs] = useState<Set<string>>(new Set());
  const [strategy, setStrategy] = useState<MigrationStrategy>('parallel');
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get only VMs that need migration
  const pendingVMs = vms.filter(vm => vm.needs_storage_vmotion);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep('select');
      setSelectedVMs(new Set(pendingVMs.map(vm => vm.id)));
      setStrategy('parallel');
      setJobIds([]);
      setError(null);
    }
  }, [open, pendingVMs.length]);

  // Poll job statuses during execution
  const { data: jobStatuses } = useQuery({
    queryKey: ['batch-migration-jobs', jobIds],
    queryFn: async () => {
      if (jobIds.length === 0) return [];
      const { data, error } = await supabase
        .from('jobs')
        .select('id, status, details')
        .in('id', jobIds);
      if (error) throw error;
      return (data || []).map(j => ({
        id: j.id,
        status: j.status,
        vm_name: (j.details as any)?.vm_name,
        details: j.details as JobStatus['details'],
      })) as JobStatus[];
    },
    enabled: jobIds.length > 0 && step === 'execute',
    refetchInterval: 2000,
  });

  // Check if all jobs completed
  useEffect(() => {
    if (step === 'execute' && jobStatuses && jobStatuses.length > 0) {
      const allDone = jobStatuses.every(j => 
        j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled'
      );
      if (allDone && !executing) {
        setStep('complete');
      }
    }
  }, [jobStatuses, step, executing]);

  const handleToggleVM = useCallback((vmId: string) => {
    setSelectedVMs(prev => {
      const next = new Set(prev);
      if (next.has(vmId)) {
        next.delete(vmId);
      } else {
        next.add(vmId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedVMs.size === pendingVMs.length) {
      setSelectedVMs(new Set());
    } else {
      setSelectedVMs(new Set(pendingVMs.map(vm => vm.id)));
    }
  }, [pendingVMs, selectedVMs.size]);

  const handleExecute = async () => {
    setExecuting(true);
    setError(null);
    
    try {
      const vmIds = Array.from(selectedVMs);
      const result = await onBatchMigrate(vmIds) as { job_ids?: string[] };
      
      if (result?.job_ids && result.job_ids.length > 0) {
        setJobIds(result.job_ids);
      } else {
        // No job IDs returned, go to complete step
        setStep('complete');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create migration jobs');
      setStep('complete');
    } finally {
      setExecuting(false);
    }
  };

  const handleClose = () => {
    onComplete();
    onOpenChange(false);
  };

  const getSelectedVMsSize = () => {
    // In a real implementation, this would calculate actual disk sizes
    return selectedVMs.size * 100; // Placeholder: assume 100GB per VM
  };

  const getJobStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'running':
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case 'cancelled':
        return <XCircle className="h-4 w-4 text-muted-foreground" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const renderStepIndicator = () => {
    const steps = [
      { id: 'select', label: 'Select VMs' },
      { id: 'configure', label: 'Configure' },
      { id: 'execute', label: 'Execute' },
      { id: 'complete', label: 'Complete' },
    ];
    
    const currentIndex = steps.findIndex(s => s.id === step);
    
    return (
      <div className="flex items-center gap-2 mb-6">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <div className={`
              w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
              ${i <= currentIndex 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-muted text-muted-foreground'}
            `}>
              {i < currentIndex ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                i + 1
              )}
            </div>
            <span className={`text-sm hidden sm:inline ${i <= currentIndex ? 'text-foreground' : 'text-muted-foreground'}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <ArrowRight className="h-4 w-4 text-muted-foreground mx-1" />
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderSelectStep = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">Select VMs to Migrate</h4>
        <Button variant="ghost" size="sm" onClick={handleSelectAll}>
          {selectedVMs.size === pendingVMs.length ? 'Deselect All' : 'Select All'}
        </Button>
      </div>

      {pendingVMs.length === 0 ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No VMs require migration. All VMs are already on the protection datastore.
          </AlertDescription>
        </Alert>
      ) : (
        <ScrollArea className="h-[280px] border rounded-lg">
          <div className="p-2 space-y-1">
            {pendingVMs.map((vm) => (
              <div
                key={vm.id}
                className={`flex items-center gap-3 p-3 rounded-md cursor-pointer transition-colors
                  ${selectedVMs.has(vm.id) 
                    ? 'bg-primary/10 border border-primary/30' 
                    : 'hover:bg-muted/50 border border-transparent'}
                `}
                onClick={() => handleToggleVM(vm.id)}
              >
                <Checkbox
                  checked={selectedVMs.has(vm.id)}
                  onCheckedChange={() => handleToggleVM(vm.id)}
                />
                <Server className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{vm.vm_name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {vm.current_datastore || 'Unknown datastore'}
                  </p>
                </div>
                <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                  <MoveRight className="h-3 w-3 mr-1" />
                  vMotion
                </Badge>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground border-t pt-3">
        <span>{selectedVMs.size} of {pendingVMs.length} VMs selected</span>
        <span>~{getSelectedVMsSize()} GB total</span>
      </div>
    </div>
  );

  const renderConfigureStep = () => (
    <div className="space-y-6">
      {/* Target Datastore */}
      <div className="border rounded-lg p-4 space-y-2">
        <h4 className="font-medium flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          Target Datastore
        </h4>
        <div className="flex items-center gap-2">
          <Badge variant="default" className="text-base px-3 py-1">
            {protectionDatastore || 'Protection Datastore'}
          </Badge>
          <span className="text-sm text-muted-foreground">
            (configured for protection group)
          </span>
        </div>
      </div>

      {/* Migration Strategy */}
      <div className="border rounded-lg p-4 space-y-4">
        <h4 className="font-medium">Migration Strategy</h4>
        <RadioGroup value={strategy} onValueChange={(v) => setStrategy(v as MigrationStrategy)}>
          <div className="flex items-start gap-3 p-3 rounded-md border cursor-pointer hover:bg-muted/50"
               onClick={() => setStrategy('sequential')}>
            <RadioGroupItem value="sequential" id="sequential" className="mt-1" />
            <div>
              <Label htmlFor="sequential" className="font-medium cursor-pointer">Sequential</Label>
              <p className="text-sm text-muted-foreground">
                Migrate VMs one at a time. Safer but slower.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-md border cursor-pointer hover:bg-muted/50"
               onClick={() => setStrategy('parallel')}>
            <RadioGroupItem value="parallel" id="parallel" className="mt-1" />
            <div>
              <Label htmlFor="parallel" className="font-medium cursor-pointer">Parallel</Label>
              <p className="text-sm text-muted-foreground">
                Migrate multiple VMs concurrently. Faster but uses more resources.
              </p>
            </div>
          </div>
        </RadioGroup>
      </div>

      {/* Summary */}
      <div className="border rounded-lg p-4 space-y-3">
        <h4 className="font-medium">Migration Summary</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">VMs to migrate:</span>
            <span className="ml-2 font-medium">{selectedVMs.size}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Strategy:</span>
            <span className="ml-2 font-medium capitalize">{strategy}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Target:</span>
            <span className="ml-2 font-medium">{protectionDatastore || 'Protection DS'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Est. size:</span>
            <span className="ml-2 font-medium">~{getSelectedVMsSize()} GB</span>
          </div>
        </div>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Storage vMotion operations are performed live with zero VM downtime.
          Jobs will be queued and executed by the Job Executor.
        </AlertDescription>
      </Alert>
    </div>
  );

  const renderExecuteStep = () => {
    const completedCount = jobStatuses?.filter(j => j.status === 'completed').length || 0;
    const failedCount = jobStatuses?.filter(j => j.status === 'failed').length || 0;
    const totalJobs = jobIds.length || selectedVMs.size;
    const progressPercent = totalJobs > 0 ? ((completedCount + failedCount) / totalJobs) * 100 : 0;

    return (
      <div className="space-y-4">
        <div className="text-center py-4">
          <Loader2 className="h-10 w-10 mx-auto mb-3 animate-spin text-primary" />
          <h4 className="font-medium mb-1">Migrating VMs...</h4>
          <p className="text-sm text-muted-foreground">
            {completedCount} of {totalJobs} migrations complete
          </p>
        </div>

        <Progress value={progressPercent} className="h-2" />

        <ScrollArea className="h-[200px] border rounded-lg">
          <div className="p-2 space-y-1">
            {jobStatuses?.map((job) => (
              <div key={job.id} className="flex items-center gap-3 p-2 text-sm">
                {getJobStatusIcon(job.status)}
                <span className="flex-1 truncate">{job.vm_name || 'Unknown VM'}</span>
                <Badge variant="outline" className="capitalize">{job.status}</Badge>
              </div>
            )) || selectedVMs.size > 0 && (
              <div className="p-4 text-center text-muted-foreground">
                <Loader2 className="h-4 w-4 mx-auto animate-spin mb-2" />
                Creating migration jobs...
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  };

  const renderCompleteStep = () => {
    const completedCount = jobStatuses?.filter(j => j.status === 'completed').length || 0;
    const failedCount = jobStatuses?.filter(j => j.status === 'failed').length || 0;
    const hasErrors = !!error || failedCount > 0;

    return (
      <div className="space-y-4">
        <div className="text-center py-6">
          {hasErrors ? (
            <>
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
              <h4 className="font-medium mb-2">Migration Completed with Issues</h4>
              {error && (
                <p className="text-sm text-destructive mb-2">{error}</p>
              )}
              <p className="text-sm text-muted-foreground">
                {completedCount} succeeded, {failedCount} failed
              </p>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
              <h4 className="font-medium mb-2">Migration Complete</h4>
              <p className="text-sm text-muted-foreground">
                All {completedCount} VMs have been migrated to the protection datastore.
              </p>
            </>
          )}
        </div>

        {jobStatuses && jobStatuses.length > 0 && (
          <ScrollArea className="h-[180px] border rounded-lg">
            <div className="p-2 space-y-1">
              {jobStatuses.map((job) => (
                <div key={job.id} className="flex items-center gap-3 p-2 text-sm">
                  {getJobStatusIcon(job.status)}
                  <span className="flex-1 truncate">{job.vm_name || 'Unknown VM'}</span>
                  <Badge 
                    variant={job.status === 'completed' ? 'outline' : 'destructive'}
                    className={job.status === 'completed' ? 'text-green-600 border-green-500/30' : ''}
                  >
                    {job.status === 'completed' ? 'Success' : job.status}
                  </Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={step === 'execute' ? undefined : handleClose}>
      <DialogContent 
        className="max-w-2xl"
        onInteractOutside={(e) => {
          if (step === 'execute') {
            e.preventDefault();
          }
        }}
        onEscapeKeyDown={(e) => {
          if (step === 'execute') {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MoveRight className="h-5 w-5" />
            Batch VM Migration
          </DialogTitle>
          <DialogDescription>
            Migrate VMs to the protection datastore for ZFS replication
          </DialogDescription>
        </DialogHeader>

        {renderStepIndicator()}

        <div className="min-h-[350px]">
          {step === 'select' && renderSelectStep()}
          {step === 'configure' && renderConfigureStep()}
          {step === 'execute' && renderExecuteStep()}
          {step === 'complete' && renderCompleteStep()}
        </div>

        <DialogFooter>
          {step === 'select' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button 
                onClick={() => setStep('configure')} 
                disabled={selectedVMs.size === 0}
              >
                Next
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </>
          )}
          {step === 'configure' && (
            <>
              <Button variant="outline" onClick={() => setStep('select')}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <Button 
                onClick={() => {
                  setStep('execute');
                  handleExecute();
                }}
              >
                Start Migration
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </>
          )}
          {step === 'execute' && (
            <Button variant="outline" disabled>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Processing...
            </Button>
          )}
          {step === 'complete' && (
            <Button onClick={handleClose}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
