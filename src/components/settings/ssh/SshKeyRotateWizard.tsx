import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { 
  Loader2, CheckCircle2, XCircle, ArrowRight, RotateCcw, 
  Key, Upload, CheckSquare, Power, Trash2, AlertTriangle 
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { SshKey, SshKeyDeployment } from "@/hooks/useSshKeys";

interface SshKeyRotateWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  oldKey: SshKey | null;
  deployments: SshKeyDeployment[];
  onComplete?: () => void;
}

type WizardStep = 'info' | 'generate' | 'deploy' | 'verify' | 'activate' | 'remove' | 'complete';

interface StepStatus {
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
}

export function SshKeyRotateWizard({ open, onOpenChange, oldKey, deployments, onComplete }: SshKeyRotateWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('info');
  const [newKeyName, setNewKeyName] = useState("");
  const [newKey, setNewKey] = useState<{ id: string; publicKey: string } | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [stepStatuses, setStepStatuses] = useState<Record<WizardStep, StepStatus>>({
    info: { status: 'completed' },
    generate: { status: 'pending' },
    deploy: { status: 'pending' },
    verify: { status: 'pending' },
    activate: { status: 'pending' },
    remove: { status: 'pending' },
    complete: { status: 'pending' },
  });
  const [jobId, setJobId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (open && oldKey) {
      setCurrentStep('info');
      setNewKeyName(`${oldKey.name} (rotated)`);
      setNewKey(null);
      setAdminPassword("");
      setStepStatuses({
        info: { status: 'completed' },
        generate: { status: 'pending' },
        deploy: { status: 'pending' },
        verify: { status: 'pending' },
        activate: { status: 'pending' },
        remove: { status: 'pending' },
        complete: { status: 'pending' },
      });
    }
  }, [open, oldKey]);

  // Poll job status
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null;

    if (jobId && isProcessing) {
      pollInterval = setInterval(async () => {
        const { data: job } = await supabase
          .from('jobs')
          .select('status, details')
          .eq('id', jobId)
          .single();

        if (job && (job.status === 'completed' || job.status === 'failed')) {
          setIsProcessing(false);
          
          if (job.status === 'completed') {
            updateStepStatus(currentStep, 'completed');
            advanceStep();
          } else {
            const details = job.details as { error?: string };
            updateStepStatus(currentStep, 'failed', details?.error || 'Job failed');
          }
          
          setJobId(null);
          if (pollInterval) clearInterval(pollInterval);
        }
      }, 2000);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [jobId, isProcessing, currentStep]);

  const updateStepStatus = (step: WizardStep, status: StepStatus['status'], error?: string) => {
    setStepStatuses(prev => ({
      ...prev,
      [step]: { status, error }
    }));
  };

  const advanceStep = () => {
    const steps: WizardStep[] = ['info', 'generate', 'deploy', 'verify', 'activate', 'remove', 'complete'];
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1]);
    }
  };

  const handleGenerateKey = async () => {
    if (!newKeyName.trim()) {
      toast.error('Please enter a name for the new key');
      return;
    }

    setIsProcessing(true);
    updateStepStatus('generate', 'running');

    try {
      // Generate key pair
      const { data: keyData, error: keyError } = await supabase.functions.invoke('generate-ssh-keypair', {
        body: { comment: newKeyName, returnFingerprint: true },
      });

      if (keyError) throw keyError;

      // Encrypt private key
      const { data: encryptedData, error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
        body: { password: keyData.privateKey },
      });

      if (encryptError) throw encryptError;

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();

      // Store in database
      const { data: sshKey, error: insertError } = await supabase
        .from('ssh_keys')
        .insert({
          name: newKeyName,
          description: `Rotated from: ${oldKey?.name}`,
          key_type: keyData.keyType || 'ed25519',
          public_key: keyData.publicKey,
          public_key_fingerprint: keyData.fingerprint,
          private_key_encrypted: encryptedData.encrypted,
          status: 'pending',
          created_by: user?.id,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      setNewKey({ id: sshKey.id, publicKey: keyData.publicKey });
      updateStepStatus('generate', 'completed');
      setIsProcessing(false);
      advanceStep();
      toast.success('New key generated');
    } catch (error) {
      console.error('Key generation failed:', error);
      updateStepStatus('generate', 'failed', String(error));
      setIsProcessing(false);
      toast.error('Failed to generate key');
    }
  };

  const handleDeploy = async () => {
    if (!newKey) return;

    const targetIds = deployments
      .filter(d => d.replication_target_id && d.status !== 'removed')
      .map(d => d.replication_target_id as string);

    if (targetIds.length === 0) {
      updateStepStatus('deploy', 'completed');
      advanceStep();
      return;
    }

    setIsProcessing(true);
    updateStepStatus('deploy', 'running');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'ssh_key_deploy',
          status: 'pending',
          created_by: user?.id,
          details: {
            ssh_key_id: newKey.id,
            target_ids: targetIds,
            admin_password: adminPassword || undefined,
          },
        })
        .select()
        .single();

      if (error) throw error;
      setJobId(job.id);
    } catch (error) {
      console.error('Deploy failed:', error);
      updateStepStatus('deploy', 'failed', String(error));
      setIsProcessing(false);
    }
  };

  const handleVerify = async () => {
    if (!newKey) return;

    const targetIds = deployments
      .filter(d => d.replication_target_id && d.status !== 'removed')
      .map(d => d.replication_target_id as string);

    if (targetIds.length === 0) {
      updateStepStatus('verify', 'completed');
      advanceStep();
      return;
    }

    setIsProcessing(true);
    updateStepStatus('verify', 'running');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'ssh_key_verify',
          status: 'pending',
          created_by: user?.id,
          details: {
            ssh_key_id: newKey.id,
            target_ids: targetIds,
          },
        })
        .select()
        .single();

      if (error) throw error;
      setJobId(job.id);
    } catch (error) {
      console.error('Verify failed:', error);
      updateStepStatus('verify', 'failed', String(error));
      setIsProcessing(false);
    }
  };

  const handleActivate = async () => {
    if (!newKey) return;

    setIsProcessing(true);
    updateStepStatus('activate', 'running');

    try {
      // Activate new key
      await supabase
        .from('ssh_keys')
        .update({ 
          status: 'active',
          activated_at: new Date().toISOString()
        })
        .eq('id', newKey.id);

      // Update replication targets to use new key
      const targetIds = deployments
        .filter(d => d.replication_target_id)
        .map(d => d.replication_target_id);

      if (targetIds.length > 0) {
        await supabase
          .from('replication_targets')
          .update({ ssh_key_id: newKey.id })
          .in('id', targetIds);
      }

      updateStepStatus('activate', 'completed');
      setIsProcessing(false);
      advanceStep();
      toast.success('New key activated');
    } catch (error) {
      console.error('Activation failed:', error);
      updateStepStatus('activate', 'failed', String(error));
      setIsProcessing(false);
    }
  };

  const handleRemoveOldKey = async () => {
    if (!oldKey) return;

    const targetIds = deployments
      .filter(d => d.replication_target_id && d.status !== 'removed')
      .map(d => d.replication_target_id as string);

    if (targetIds.length === 0) {
      // Just revoke the old key
      await handleRevokeOldKey();
      return;
    }

    setIsProcessing(true);
    updateStepStatus('remove', 'running');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'ssh_key_remove',
          status: 'pending',
          created_by: user?.id,
          details: {
            ssh_key_id: oldKey.id,
            target_ids: targetIds,
          },
        })
        .select()
        .single();

      if (error) throw error;
      setJobId(job.id);
    } catch (error) {
      console.error('Remove failed:', error);
      updateStepStatus('remove', 'failed', String(error));
      setIsProcessing(false);
    }
  };

  const handleRevokeOldKey = async () => {
    if (!oldKey) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();

      await supabase
        .from('ssh_keys')
        .update({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          revoked_by: user?.id,
          revocation_reason: 'Rotated to new key',
        })
        .eq('id', oldKey.id);

      updateStepStatus('remove', 'completed');
      updateStepStatus('complete', 'completed');
      setCurrentStep('complete');
      setIsProcessing(false);
      toast.success('Old key revoked');
    } catch (error) {
      console.error('Revoke failed:', error);
      updateStepStatus('remove', 'failed', String(error));
      setIsProcessing(false);
    }
  };

  const handleComplete = () => {
    onOpenChange(false);
    onComplete?.();
  };

  const steps: { key: WizardStep; label: string; icon: React.ReactNode }[] = [
    { key: 'info', label: 'Info', icon: <AlertTriangle className="h-4 w-4" /> },
    { key: 'generate', label: 'Generate', icon: <Key className="h-4 w-4" /> },
    { key: 'deploy', label: 'Deploy', icon: <Upload className="h-4 w-4" /> },
    { key: 'verify', label: 'Verify', icon: <CheckSquare className="h-4 w-4" /> },
    { key: 'activate', label: 'Activate', icon: <Power className="h-4 w-4" /> },
    { key: 'remove', label: 'Remove Old', icon: <Trash2 className="h-4 w-4" /> },
    { key: 'complete', label: 'Complete', icon: <CheckCircle2 className="h-4 w-4" /> },
  ];

  const currentStepIndex = steps.findIndex(s => s.key === currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  const renderStepContent = () => {
    switch (currentStep) {
      case 'info':
        return (
          <div className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This wizard will rotate SSH key "{oldKey?.name}" by generating a new key,
                deploying it to all targets, verifying it works, then removing the old key.
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Current key details:</p>
              <div className="p-3 bg-muted rounded-lg text-sm">
                <div><strong>Name:</strong> {oldKey?.name}</div>
                <div><strong>Fingerprint:</strong> <code className="text-xs">{oldKey?.public_key_fingerprint}</code></div>
                <div><strong>Deployed to:</strong> {deployments.filter(d => d.status === 'deployed' || d.status === 'verified').length} targets</div>
              </div>
            </div>
            <Button onClick={() => setCurrentStep('generate')} className="w-full">
              Start Rotation <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        );

      case 'generate':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-key-name">New Key Name</Label>
              <Input
                id="new-key-name"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                disabled={isProcessing}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-password">Admin Password (optional)</Label>
              <Input
                id="admin-password"
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="For targets requiring password auth"
                disabled={isProcessing}
              />
            </div>
            <Button onClick={handleGenerateKey} disabled={isProcessing} className="w-full">
              {isProcessing ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...</>
              ) : (
                <>Generate New Key <ArrowRight className="ml-2 h-4 w-4" /></>
              )}
            </Button>
          </div>
        );

      case 'deploy':
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Deploying new key to {deployments.filter(d => d.replication_target_id).length} targets...
            </p>
            {newKey && (
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">New Public Key:</p>
                <code className="text-xs break-all">{newKey.publicKey.substring(0, 80)}...</code>
              </div>
            )}
            <Button onClick={handleDeploy} disabled={isProcessing} className="w-full">
              {isProcessing ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deploying...</>
              ) : (
                <>Deploy to Targets <ArrowRight className="ml-2 h-4 w-4" /></>
              )}
            </Button>
          </div>
        );

      case 'verify':
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Verifying new key works on all targets...
            </p>
            <Button onClick={handleVerify} disabled={isProcessing} className="w-full">
              {isProcessing ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...</>
              ) : (
                <>Verify Key <ArrowRight className="ml-2 h-4 w-4" /></>
              )}
            </Button>
          </div>
        );

      case 'activate':
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Activate the new key and update all targets to use it.
            </p>
            <Button onClick={handleActivate} disabled={isProcessing} className="w-full">
              {isProcessing ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Activating...</>
              ) : (
                <>Activate New Key <ArrowRight className="ml-2 h-4 w-4" /></>
              )}
            </Button>
          </div>
        );

      case 'remove':
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Remove the old key from all targets and revoke it.
            </p>
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This will permanently remove the old key from all targets.
              </AlertDescription>
            </Alert>
            <Button onClick={handleRemoveOldKey} disabled={isProcessing} variant="destructive" className="w-full">
              {isProcessing ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Removing...</>
              ) : (
                <>Remove Old Key <ArrowRight className="ml-2 h-4 w-4" /></>
              )}
            </Button>
          </div>
        );

      case 'complete':
        return (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
            <h3 className="text-lg font-semibold">Rotation Complete!</h3>
            <p className="text-sm text-muted-foreground">
              SSH key has been successfully rotated. The old key has been revoked.
            </p>
            <Button onClick={handleComplete} className="w-full">
              Done
            </Button>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" />
            Rotate SSH Key
          </DialogTitle>
          <DialogDescription>
            Safely rotate "{oldKey?.name}" with zero downtime
          </DialogDescription>
        </DialogHeader>

        {/* Progress */}
        <div className="space-y-2">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between">
            {steps.map((step, idx) => {
              const status = stepStatuses[step.key];
              const isCurrent = step.key === currentStep;
              const isPast = idx < currentStepIndex;
              
              return (
                <div
                  key={step.key}
                  className={`flex flex-col items-center gap-1 ${
                    isCurrent ? 'text-primary' : isPast ? 'text-muted-foreground' : 'text-muted-foreground/50'
                  }`}
                >
                  <div className={`p-1.5 rounded-full ${
                    status.status === 'completed' ? 'bg-green-500/20 text-green-500' :
                    status.status === 'failed' ? 'bg-destructive/20 text-destructive' :
                    status.status === 'running' ? 'bg-primary/20 text-primary' :
                    'bg-muted'
                  }`}>
                    {status.status === 'running' ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : status.status === 'completed' ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : status.status === 'failed' ? (
                      <XCircle className="h-3 w-3" />
                    ) : (
                      step.icon
                    )}
                  </div>
                  <span className="text-[10px]">{step.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step Content */}
        <div className="py-4">
          {stepStatuses[currentStep]?.status === 'failed' && (
            <Alert variant="destructive" className="mb-4">
              <XCircle className="h-4 w-4" />
              <AlertDescription>
                {stepStatuses[currentStep].error || 'Step failed'}
              </AlertDescription>
            </Alert>
          )}
          {renderStepContent()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
