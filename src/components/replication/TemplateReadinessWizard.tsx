/**
 * Template Readiness Wizard
 * 
 * Validates, prepares, and fixes ZFS template VMs for Debian 13.
 * Handles both VMware templates and regular VMs, with auto-fix capabilities.
 */

import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  AlertTriangle, 
  Clock, 
  Wrench, 
  ChevronDown, 
  Terminal,
  Server,
  Key,
  Package,
  User,
  HardDrive,
  RefreshCw,
  SkipForward,
  Copy
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

// Step definition for the wizard
interface WizardStep {
  id: string;
  label: string;
  icon: React.ReactNode;
  status: 'pending' | 'running' | 'success' | 'failed' | 'warning' | 'skipped' | 'fixing' | 'fixed';
  message?: string;
  canAutoFix?: boolean;
}

// Initial step definitions
const WIZARD_STEPS: WizardStep[] = [
  { id: 'vcenter', label: 'vCenter Connection', icon: <Server className="h-4 w-4" />, status: 'pending' },
  { id: 'vm_state', label: 'VM State Detection', icon: <Server className="h-4 w-4" />, status: 'pending' },
  { id: 'convert_to_vm', label: 'Convert to VM', icon: <RefreshCw className="h-4 w-4" />, status: 'pending' },
  { id: 'power_on', label: 'Power On VM', icon: <Server className="h-4 w-4" />, status: 'pending' },
  { id: 'vmware_tools', label: 'VMware Tools', icon: <Package className="h-4 w-4" />, status: 'pending' },
  { id: 'ip_address', label: 'IP Address', icon: <Server className="h-4 w-4" />, status: 'pending' },
  { id: 'ssh_port', label: 'SSH Port', icon: <Terminal className="h-4 w-4" />, status: 'pending' },
  { id: 'ssh_auth', label: 'SSH Authentication', icon: <Key className="h-4 w-4" />, status: 'pending' },
  { id: 'apt_sources', label: 'APT Sources (contrib)', icon: <Package className="h-4 w-4" />, status: 'pending', canAutoFix: true },
  { id: 'zfs_packages', label: 'ZFS Packages', icon: <Package className="h-4 w-4" />, status: 'pending', canAutoFix: true },
  { id: 'nfs_packages', label: 'NFS Packages', icon: <Package className="h-4 w-4" />, status: 'pending', canAutoFix: true },
  { id: 'zfs_module', label: 'ZFS Module Loaded', icon: <HardDrive className="h-4 w-4" />, status: 'pending', canAutoFix: true },
  { id: 'user_account', label: 'User Account (zfsadmin)', icon: <User className="h-4 w-4" />, status: 'pending', canAutoFix: true },
  { id: 'disk_detection', label: 'Secondary Disk', icon: <HardDrive className="h-4 w-4" />, status: 'pending' },
  { id: 'stale_config', label: 'Cleanup Stale Config', icon: <RefreshCw className="h-4 w-4" />, status: 'pending', canAutoFix: true },
  { id: 'finalize', label: 'Finalize', icon: <CheckCircle2 className="h-4 w-4" />, status: 'pending' },
];

interface TemplateReadinessWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  templateName: string;
}

export function TemplateReadinessWizard({ 
  open, 
  onOpenChange, 
  templateId, 
  templateName 
}: TemplateReadinessWizardProps) {
  const { toast } = useToast();
  
  // State
  const [steps, setSteps] = useState<WizardStep[]>(WIZARD_STEPS);
  const [isRunning, setIsRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [consoleLog, setConsoleLog] = useState<string[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [rootPassword, setRootPassword] = useState('');
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [vmState, setVmState] = useState<string | null>(null);
  
  // Options
  const [installPackages, setInstallPackages] = useState(true);
  const [createUser, setCreateUser] = useState(true);
  const [resetMachineId, setResetMachineId] = useState(true);
  const [resetSshHostKeys, setResetSshHostKeys] = useState(true);
  const [resetNfsConfig, setResetNfsConfig] = useState(true);
  const [convertBackToTemplate, setConvertBackToTemplate] = useState(true);
  
  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSteps(WIZARD_STEPS.map(s => ({ ...s, status: 'pending', message: undefined })));
      setProgress(0);
      setConsoleLog([]);
      setJobId(null);
      setIsRunning(false);
      setShowPasswordPrompt(false);
      setRootPassword('');
      setVmState(null);
    }
  }, [open]);

  // Poll job status
  const pollJobStatus = useCallback(async (id: string) => {
    const maxAttempts = 180; // 3 minutes max
    let attempts = 0;

    const poll = async () => {
      attempts++;
      
      try {
        const { data: job, error } = await supabase
          .from('jobs')
          .select('status, details')
          .eq('id', id)
          .single();

        if (error) throw error;

        const details = job.details as Record<string, unknown> || {};
        
        // Update console log
        if (details.console_log && Array.isArray(details.console_log)) {
          setConsoleLog(details.console_log as string[]);
        }
        
        // Update progress
        if (typeof details.progress_percent === 'number') {
          setProgress(details.progress_percent);
        }
        
        // Update VM state
        if (details.vm_state) {
          setVmState(details.vm_state as string);
        }

        // Update step statuses from job details
        if (details.step_results && Array.isArray(details.step_results)) {
          const stepResults = details.step_results as Array<{
            step: string;
            status: string;
            message?: string;
          }>;
          
          setSteps(prev => prev.map(step => {
            const result = stepResults.find(r => r.step === step.id);
            if (result) {
              return {
                ...step,
                status: result.status as WizardStep['status'],
                message: result.message
              };
            }
            return step;
          }));
        }
        
        // Check if job needs password
        if (details.needs_root_password) {
          setShowPasswordPrompt(true);
          setIsRunning(false);
          return; // Stop polling, wait for password
        }

        // Check completion
        if (job.status === 'completed') {
          setIsRunning(false);
          setProgress(100);
          toast({ title: 'Template preparation complete', description: 'Template is ready for deployment' });
          return;
        }
        
        if (job.status === 'failed') {
          setIsRunning(false);
          const errorMsg = details.error as string || 'Unknown error';
          toast({ title: 'Preparation failed', description: errorMsg, variant: 'destructive' });
          return;
        }

        // Continue polling
        if (attempts < maxAttempts && job.status === 'running') {
          setTimeout(poll, 1000);
        } else if (attempts >= maxAttempts) {
          setIsRunning(false);
          toast({ title: 'Timeout', description: 'Operation took too long', variant: 'destructive' });
        }
      } catch (err) {
        setIsRunning(false);
        console.error('Error polling job:', err);
      }
    };

    poll();
  }, [toast]);

  // Start the preparation job
  const handleStart = async (password?: string) => {
    setIsRunning(true);
    setShowPasswordPrompt(false);
    setSteps(WIZARD_STEPS.map(s => ({ ...s, status: 'pending', message: undefined })));
    setProgress(0);
    setConsoleLog([]);

    try {
      const { data: user } = await supabase.auth.getUser();
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'prepare_zfs_template' as const,
          status: 'pending',
          created_by: user?.user?.id,
          target_scope: { template_id: templateId },
          details: {
            template_id: templateId,
            root_password: password || rootPassword,
            install_packages: installPackages,
            create_user: createUser,
            reset_machine_id: resetMachineId,
            reset_ssh_host_keys: resetSshHostKeys,
            reset_nfs_config: resetNfsConfig,
            convert_back_to_template: convertBackToTemplate
          }
        })
        .select()
        .single();

      if (error) throw error;

      setJobId(job.id);
      setRootPassword(''); // Clear password
      pollJobStatus(job.id);
      
    } catch (err) {
      setIsRunning(false);
      console.error('Failed to start preparation:', err);
      toast({ 
        title: 'Failed to start', 
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive'
      });
    }
  };

  // Handle password submission
  const handlePasswordSubmit = () => {
    if (!rootPassword.trim()) {
      toast({ title: 'Password required', description: 'Enter the root password to continue', variant: 'destructive' });
      return;
    }
    handleStart(rootPassword);
  };

  // Render step status icon
  const renderStepIcon = (step: WizardStep) => {
    switch (step.status) {
      case 'running':
      case 'fixing':
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case 'success':
      case 'fixed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'skipped':
        return <SkipForward className="h-4 w-4 text-muted-foreground" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const completedSteps = steps.filter(s => ['success', 'fixed', 'skipped'].includes(s.status)).length;
  const totalSteps = steps.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Template Readiness Wizard
          </DialogTitle>
          <DialogDescription>
            Preparing: <span className="font-medium">{templateName}</span>
            {vmState && (
              <Badge variant="outline" className="ml-2">
                {vmState}
              </Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Progress</span>
              <span>{completedSteps} / {totalSteps} steps</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Password prompt */}
          {showPasswordPrompt && (
            <Alert>
              <Key className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-3">
                  <p className="text-sm">
                    Root password required to deploy SSH key and install packages.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="Root password"
                      value={rootPassword}
                      onChange={(e) => setRootPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                    />
                    <Button onClick={handlePasswordSubmit} disabled={!rootPassword.trim()}>
                      Continue
                    </Button>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Steps list */}
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-2">
              {steps.map((step) => (
                <div
                  key={step.id}
                  className={`flex items-center gap-3 p-2 rounded-lg border ${
                    step.status === 'running' || step.status === 'fixing' 
                      ? 'bg-primary/5 border-primary/20' 
                      : step.status === 'failed' 
                        ? 'bg-destructive/5 border-destructive/20'
                        : step.status === 'success' || step.status === 'fixed'
                          ? 'bg-green-500/5 border-green-500/20'
                          : 'bg-muted/30 border-border'
                  }`}
                >
                  {renderStepIcon(step)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{step.label}</span>
                      {step.status === 'fixed' && (
                        <Badge variant="secondary" className="text-xs">auto-fixed</Badge>
                      )}
                      {step.canAutoFix && step.status === 'pending' && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">auto-fix</Badge>
                      )}
                    </div>
                    {step.message && (
                      <p className="text-xs text-muted-foreground truncate">{step.message}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Options (shown before running) */}
          {!isRunning && !jobId && (
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                <ChevronDown className="h-4 w-4" />
                Options
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-3 p-3 border rounded-lg bg-muted/30">
                <div className="flex items-center justify-between">
                  <Label htmlFor="install-packages" className="text-sm">Install ZFS/NFS packages</Label>
                  <Switch id="install-packages" checked={installPackages} onCheckedChange={setInstallPackages} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="create-user" className="text-sm">Create zfsadmin user</Label>
                  <Switch id="create-user" checked={createUser} onCheckedChange={setCreateUser} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="reset-machine-id" className="text-sm">Reset machine-id</Label>
                  <Switch id="reset-machine-id" checked={resetMachineId} onCheckedChange={setResetMachineId} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="reset-ssh-keys" className="text-sm">Regenerate SSH host keys</Label>
                  <Switch id="reset-ssh-keys" checked={resetSshHostKeys} onCheckedChange={setResetSshHostKeys} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="reset-nfs" className="text-sm">Reset NFS configuration</Label>
                  <Switch id="reset-nfs" checked={resetNfsConfig} onCheckedChange={setResetNfsConfig} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="convert-back" className="text-sm">Convert back to template when done</Label>
                  <Switch id="convert-back" checked={convertBackToTemplate} onCheckedChange={setConvertBackToTemplate} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Console log */}
          {consoleLog.length > 0 && (
            <Collapsible open={showConsole} onOpenChange={setShowConsole}>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                <Terminal className="h-4 w-4" />
                Console Log ({consoleLog.length} entries)
                <ChevronDown className={`h-4 w-4 transition-transform ${showConsole ? 'rotate-180' : ''}`} />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <ScrollArea className="h-32 w-full rounded border bg-black p-2">
                  <pre className="text-xs text-green-400 font-mono">
                    {consoleLog.join('\n')}
                  </pre>
                </ScrollArea>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1"
                  onClick={() => navigator.clipboard.writeText(consoleLog.join('\n'))}
                >
                  <Copy className="h-3 w-3 mr-1" />
                  Copy Log
                </Button>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isRunning}>
            {isRunning ? 'Running...' : 'Close'}
          </Button>
          {!isRunning && !jobId && (
            <Button onClick={() => handleStart()}>
              <Wrench className="h-4 w-4 mr-2" />
              Start Preparation
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
