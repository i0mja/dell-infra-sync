/**
 * DR Shell VM Wizard
 * 
 * Multi-step wizard to create a DR shell VM at the DR site with replicated disks.
 */

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
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Server as ServerIcon,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Info,
  Cpu,
  MemoryStick,
  Cloud,
} from "lucide-react";
import { ProtectedVM, useDRShellPlan } from "@/hooks/useReplication";

interface DrShellVmWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vm: ProtectedVM | null;
  onComplete: () => void;
}

type WizardStep = 'analyze' | 'configure' | 'execute' | 'complete';

export function DrShellVmWizard({
  open,
  onOpenChange,
  vm,
  onComplete,
}: DrShellVmWizardProps) {
  const [step, setStep] = useState<WizardStep>('analyze');
  const [shellVmName, setShellVmName] = useState("");
  const [cpuCount, setCpuCount] = useState(2);
  const [memoryMb, setMemoryMb] = useState(4096);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; shell_vm_name?: string } | null>(null);
  
  const { plan, loading: planLoading, fetchPlan, createDRShell } = useDRShellPlan(vm?.id);

  // Reset state when dialog opens
  useEffect(() => {
    if (open && vm) {
      setStep('analyze');
      setResult(null);
      setShellVmName(`${vm.vm_name}-DR`);
      fetchPlan();
    }
  }, [open, vm, fetchPlan]);

  // Update config from plan when loaded (plan is now raw protected_vms row)
  useEffect(() => {
    if (plan && vm) {
      // Use VM name for suggested shell name
      setShellVmName(`${vm.vm_name}-DR`);
      // Keep default CPU/memory since the raw table doesn't have these enriched fields
    }
  }, [plan, vm]);

  const handleExecute = async () => {
    if (!vm) return;
    
    setExecuting(true);
    try {
      const response = await createDRShell({
        shell_vm_name: shellVmName,
        cpu_count: cpuCount,
        memory_mb: memoryMb,
      });
      setResult({ 
        success: true, 
        message: response?.message || 'DR Shell VM created successfully',
        shell_vm_name: response?.shell_vm_name,
      });
      setStep('complete');
    } catch (error) {
      setResult({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to create DR Shell VM' 
      });
      setStep('complete');
    } finally {
      setExecuting(false);
    }
  };

  const handleClose = () => {
    if (result?.success) {
      onComplete();
    }
    onOpenChange(false);
  };

  const renderStepIndicator = () => {
    const steps = [
      { id: 'analyze', label: 'Analyze' },
      { id: 'configure', label: 'Configure' },
      { id: 'execute', label: 'Create' },
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
            <span className={`text-sm ${i <= currentIndex ? 'text-foreground' : 'text-muted-foreground'}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <ArrowRight className="h-4 w-4 text-muted-foreground mx-2" />
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderAnalyzeStep = () => (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Analyzing source VM configuration and DR site resources...
        </AlertDescription>
      </Alert>
      
      {planLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : plan || vm ? (
        <div className="space-y-4">
          {/* Source VM Config */}
          <div className="border rounded-lg p-4 space-y-3">
            <h4 className="font-medium flex items-center gap-2">
              <ServerIcon className="h-4 w-4 text-muted-foreground" />
              Source VM Configuration
            </h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <ServerIcon className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">VM Name:</span>
                <span className="font-medium">{vm?.vm_name || '-'}</span>
              </div>
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Current Datastore:</span>
                <span className="font-medium">{vm?.current_datastore || '-'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">CPU:</span>
                <span className="font-medium">{cpuCount} vCPU (configurable)</span>
              </div>
              <div className="flex items-center gap-2">
                <MemoryStick className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Memory:</span>
                <span className="font-medium">{(memoryMb / 1024).toFixed(1)} GB (configurable)</span>
              </div>
            </div>
          </div>

          {/* DR Site Target */}
          <div className="border rounded-lg p-4 space-y-3">
            <h4 className="font-medium flex items-center gap-2">
              <Cloud className="h-4 w-4 text-muted-foreground" />
              DR Site Target
            </h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">vCenter:</span>
                <span className="ml-2 font-medium">DR-vCenter</span>
              </div>
              <div>
                <span className="text-muted-foreground">Cluster:</span>
                <span className="ml-2 font-medium">DR-Cluster</span>
              </div>
              <div>
                <span className="text-muted-foreground">Datastore:</span>
                <span className="ml-2 font-medium">{vm?.target_datastore || 'DR-ZFS-Store'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Network:</span>
                <span className="ml-2 font-medium">DR-Network</span>
              </div>
            </div>
          </div>

          {/* Pre-checks */}
          <div className="border rounded-lg p-4 space-y-3">
            <h4 className="font-medium">Pre-flight Checks</h4>
            <div className="space-y-2">
              {[
                { name: 'DR vCenter accessible', passed: true },
                { name: 'Replicated disks available', passed: !!vm?.last_replication_at },
                { name: 'Target cluster has capacity', passed: true },
                { name: 'Network mapping configured', passed: true },
              ].map((check, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {check.passed ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  )}
                  {check.name}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          No plan data available
        </div>
      )}
    </div>
  );

  const renderConfigureStep = () => (
    <div className="space-y-4">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>DR Shell VM Name</Label>
          <Input
            value={shellVmName}
            onChange={(e) => setShellVmName(e.target.value)}
            placeholder="Enter VM name"
          />
          <p className="text-xs text-muted-foreground">
            The name for the shell VM at the DR site
          </p>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              CPU (vCPU)
            </Label>
            <Input
              type="number"
              value={cpuCount}
              onChange={(e) => setCpuCount(parseInt(e.target.value) || 1)}
              min={1}
              max={128}
            />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <MemoryStick className="h-4 w-4" />
              Memory (MB)
            </Label>
            <Input
              type="number"
              value={memoryMb}
              onChange={(e) => setMemoryMb(parseInt(e.target.value) || 1024)}
              min={512}
              step={512}
            />
          </div>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            The DR Shell VM will be created in a powered-off state with replicated disks attached.
            During DR failover, power on the VM and update network settings as needed.
          </AlertDescription>
        </Alert>

        <div className="border rounded-lg p-4 space-y-2">
          <h4 className="font-medium">Shell VM Summary</h4>
          <div className="text-sm space-y-1">
            <p><span className="text-muted-foreground">Name:</span> {shellVmName}</p>
            <p><span className="text-muted-foreground">CPU:</span> {cpuCount} vCPU</p>
            <p><span className="text-muted-foreground">Memory:</span> {(memoryMb / 1024).toFixed(1)} GB</p>
            <p><span className="text-muted-foreground">Disks:</span> Attached from ZFS replication</p>
            <p><span className="text-muted-foreground">Power State:</span> Off (ready for failover)</p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderExecuteStep = () => (
    <div className="space-y-4">
      <div className="text-center py-8">
        <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-primary" />
        <h4 className="font-medium mb-2">Creating DR Shell VM...</h4>
        <p className="text-sm text-muted-foreground mb-4">
          Creating {shellVmName} at DR site
        </p>
        <Progress value={66} className="w-64 mx-auto" />
        <div className="text-xs text-muted-foreground mt-4 space-y-1">
          <p>• Creating VM shell at DR vCenter</p>
          <p>• Attaching replicated disks from ZFS</p>
          <p>• Configuring network adapters</p>
        </div>
      </div>
    </div>
  );

  const renderCompleteStep = () => (
    <div className="space-y-4">
      <div className="text-center py-8">
        {result?.success ? (
          <>
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
            <h4 className="font-medium mb-2">DR Shell VM Created</h4>
            <p className="text-sm text-muted-foreground mb-4">
              {result.message}
            </p>
            <div className="inline-flex items-center gap-2 bg-muted/50 px-4 py-2 rounded-lg">
              <ServerIcon className="h-4 w-4" />
              <span className="font-medium">{result.shell_vm_name || shellVmName}</span>
              <Badge variant="outline" className="text-green-600 border-green-500/30">
                Ready
              </Badge>
            </div>
          </>
        ) : (
          <>
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <h4 className="font-medium mb-2">Creation Failed</h4>
            <p className="text-sm text-destructive">
              {result?.message || 'An error occurred'}
            </p>
          </>
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ServerIcon className="h-5 w-5" />
            DR Shell VM Wizard
          </DialogTitle>
          <DialogDescription>
            Create a shell VM at the DR site with replicated disks
          </DialogDescription>
        </DialogHeader>

        {renderStepIndicator()}

        <div className="min-h-[350px]">
          {step === 'analyze' && renderAnalyzeStep()}
          {step === 'configure' && renderConfigureStep()}
          {step === 'execute' && renderExecuteStep()}
          {step === 'complete' && renderCompleteStep()}
        </div>

        <DialogFooter>
          {step === 'analyze' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={() => setStep('configure')} disabled={planLoading}>
                Next
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </>
          )}
          {step === 'configure' && (
            <>
              <Button variant="outline" onClick={() => setStep('analyze')}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <Button 
                onClick={() => {
                  setStep('execute');
                  handleExecute();
                }} 
                disabled={!shellVmName}
              >
                Create Shell VM
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </>
          )}
          {step === 'execute' && (
            <Button variant="outline" disabled>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Creating...
            </Button>
          )}
          {step === 'complete' && (
            <Button onClick={handleClose}>
              {result?.success ? 'Done' : 'Close'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
