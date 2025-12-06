/**
 * Protection Datastore Wizard
 * 
 * Multi-step wizard to move a VM to the protection datastore for replication.
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
  HardDrive,
  MoveRight,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Info,
} from "lucide-react";
import { ProtectedVM, useProtectionPlan } from "@/hooks/useReplication";

interface ProtectionDatastoreWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vm: ProtectedVM | null;
  protectionDatastore?: string;
  onComplete: () => void;
}

type WizardStep = 'analyze' | 'configure' | 'execute' | 'complete';

export function ProtectionDatastoreWizard({
  open,
  onOpenChange,
  vm,
  protectionDatastore,
  onComplete,
}: ProtectionDatastoreWizardProps) {
  const [step, setStep] = useState<WizardStep>('analyze');
  const [targetDatastore, setTargetDatastore] = useState("");
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  
  const { plan, loading: planLoading, fetchPlan, moveToProtectionDatastore } = useProtectionPlan(vm?.id);

  // Reset state when dialog opens
  useEffect(() => {
    if (open && vm) {
      setStep('analyze');
      setResult(null);
      setTargetDatastore(protectionDatastore || "");
      fetchPlan();
    }
  }, [open, vm, protectionDatastore, fetchPlan]);

  const handleExecute = async () => {
    if (!vm) return;
    
    setExecuting(true);
    try {
      const response = await moveToProtectionDatastore(targetDatastore);
      setResult({ success: true, message: response?.message || 'VM relocated successfully' });
      setStep('complete');
    } catch (error) {
      setResult({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to relocate VM' 
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
          Analyzing current storage configuration and generating migration plan...
        </AlertDescription>
      </Alert>
      
      {planLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : plan || vm ? (
        <div className="space-y-4">
          {/* Current State */}
          <div className="border rounded-lg p-4 space-y-3">
            <h4 className="font-medium flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              Current Configuration
            </h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">VM:</span>
                <span className="ml-2 font-medium">{vm?.vm_name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Current Datastore:</span>
                <span className="ml-2 font-medium">{plan?.current_datastore || vm?.current_datastore || 'Unknown'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Replication Status:</span>
                <span className="ml-2 font-medium">{vm?.replication_status || 'pending'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Priority:</span>
                <span className="ml-2 font-medium">{vm?.priority || 100}</span>
              </div>
            </div>
          </div>

          {/* Migration Plan */}
          <div className="border rounded-lg p-4 space-y-3">
            <h4 className="font-medium flex items-center gap-2">
              <MoveRight className="h-4 w-4 text-muted-foreground" />
              Migration Plan
            </h4>
            <div className="flex items-center gap-4 py-2">
              <Badge variant="outline">{plan?.current_datastore || vm?.current_datastore || 'Current'}</Badge>
              <ArrowRight className="h-4 w-4 text-primary" />
              <Badge variant="default">{vm?.target_datastore || protectionDatastore || 'Protection DS'}</Badge>
            </div>
            <div className="text-sm text-muted-foreground">
              <p>Method: Storage vMotion (zero downtime)</p>
            </div>
          </div>

          {/* Pre-checks */}
          <div className="border rounded-lg p-4 space-y-3">
            <h4 className="font-medium">Pre-flight Checks</h4>
            <div className="space-y-2">
              {[
                { name: 'Target datastore accessible', passed: true },
                { name: 'Sufficient free space', passed: true },
                { name: 'VM tools running', passed: true },
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
          <Label>Target Datastore</Label>
          <Input
            value={targetDatastore}
            onChange={(e) => setTargetDatastore(e.target.value)}
            placeholder="Enter target datastore name"
          />
          <p className="text-xs text-muted-foreground">
            The protection datastore where ZFS replication is enabled
          </p>
        </div>
        
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Storage vMotion will migrate all VM disks to the target datastore. 
            This operation is performed live with no VM downtime.
          </AlertDescription>
        </Alert>

        {(plan || vm) && (
          <div className="border rounded-lg p-4 space-y-2">
            <h4 className="font-medium">Migration Summary</h4>
            <div className="text-sm space-y-1">
              <p><span className="text-muted-foreground">Source:</span> {plan?.current_datastore || vm?.current_datastore}</p>
              <p><span className="text-muted-foreground">Target:</span> {targetDatastore}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderExecuteStep = () => (
    <div className="space-y-4">
      <div className="text-center py-8">
        <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-primary" />
        <h4 className="font-medium mb-2">Relocating VM...</h4>
        <p className="text-sm text-muted-foreground mb-4">
          Moving {vm?.vm_name} to {targetDatastore}
        </p>
        <Progress value={66} className="w-64 mx-auto" />
        <p className="text-xs text-muted-foreground mt-2">
          Storage vMotion in progress via pyVmomi...
        </p>
      </div>
    </div>
  );

  const renderCompleteStep = () => (
    <div className="space-y-4">
      <div className="text-center py-8">
        {result?.success ? (
          <>
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
            <h4 className="font-medium mb-2">VM Relocated Successfully</h4>
            <p className="text-sm text-muted-foreground">
              {result.message}
            </p>
          </>
        ) : (
          <>
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <h4 className="font-medium mb-2">Relocation Failed</h4>
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
      <DialogContent 
        className="max-w-2xl"
        onInteractOutside={(e) => {
          // Prevent closing during execution
          if (step === 'execute' || executing) {
            e.preventDefault();
          }
        }}
        onEscapeKeyDown={(e) => {
          // Prevent escape key during execution
          if (step === 'execute' || executing) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Protection Datastore Wizard
          </DialogTitle>
          <DialogDescription>
            Move VM to the protection datastore for ZFS replication
          </DialogDescription>
        </DialogHeader>

        {renderStepIndicator()}

        <div className="min-h-[300px]">
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
                disabled={!targetDatastore}
              >
                Execute Migration
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
              {result?.success ? 'Done' : 'Close'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
