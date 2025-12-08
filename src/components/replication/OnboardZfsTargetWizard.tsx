/**
 * Unified ZFS Target Onboarding Wizard
 * 
 * Single wizard that handles the entire flow from VM selection to syncing data:
 * 1. Select VM/Template from vCenter
 * 2. SSH Authentication (test/deploy keys)
 * 3. Configuration (packages, ZFS, NFS setup)
 * 4. Finalization (register target, add datastore, protection group)
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VMCombobox } from "./VMCombobox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Server,
  Key,
  Settings,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Play,
  XCircle,
  Clock,
  AlertTriangle,
  Wrench,
  SkipForward,
  Terminal,
  HardDrive,
  Shield,
  RefreshCw,
  Power,
  PowerOff,
  Copy,
  Check,
  Plus,
  Fingerprint,
  Plug,
} from "lucide-react";
import { useVCenters } from "@/hooks/useVCenters";
import { useVCenterVMs } from "@/hooks/useVCenterVMs";
import { useSshKeys } from "@/hooks/useSshKeys";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";

interface OnboardZfsTargetWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedVCenterId?: string;
  preselectedVMId?: string;
}

type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'warning' | 'skipped' | 'fixing' | 'fixed';

interface StepResult {
  step: string;
  status: StepStatus;
  message: string;
  needs_root_password?: boolean;
  error?: string;
}

const WIZARD_STEPS = [
  { id: 1, label: 'Select', icon: Server },
  { id: 2, label: 'Auth', icon: Key },
  { id: 3, label: 'Setup', icon: Settings },
  { id: 4, label: 'Finish', icon: CheckCircle2 },
];

const STEP_LABELS: Record<string, string> = {
  vcenter: 'vCenter Connection',
  vm_state: 'VM State Detection',
  convert_to_vm: 'Convert to VM',
  power_on: 'Power On',
  vmware_tools: 'VMware Tools',
  ip_address: 'IP Address',
  ssh_port: 'SSH Port',
  ssh_auth: 'SSH Authentication',
  ssh_key_deploy: 'Deploy SSH Key',
  apt_sources: 'APT Sources',
  zfs_packages: 'ZFS Packages',
  nfs_packages: 'NFS Packages',
  zfs_module: 'ZFS Module',
  user_account: 'User Account',
  disk_detection: 'Disk Detection',
  zfs_pool: 'ZFS Pool',
  nfs_export: 'NFS Export',
  cleanup_config: 'Cleanup Config',
  register_target: 'Register Target',
  register_datastore: 'Add Datastore',
  finalize: 'Finalize',
};

function getStatusIcon(status: StepStatus) {
  switch (status) {
    case 'pending':
      return <Clock className="h-4 w-4 text-muted-foreground" />;
    case 'running':
    case 'fixing':
      return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
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
}

export function OnboardZfsTargetWizard({
  open,
  onOpenChange,
  preselectedVCenterId,
  preselectedVMId,
}: OnboardZfsTargetWizardProps) {
  const { toast } = useToast();
  const { vcenters, loading: vcentersLoading } = useVCenters();
  
  // Wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const [jobId, setJobId] = useState<string | null>(null);
  
  // Step 1: Selection
  const [selectedVCenterId, setSelectedVCenterId] = useState(preselectedVCenterId || "");
  const [selectedVMId, setSelectedVMId] = useState(preselectedVMId || "");
  const [targetName, setTargetName] = useState("");
  
  // Step 2: Authentication
  const [authMethod, setAuthMethod] = useState<'existing_key' | 'generate_key' | 'password'>('existing_key');
  const [selectedSshKeyId, setSelectedSshKeyId] = useState("");
  const [rootPassword, setRootPassword] = useState("");
  const [testingSsh, setTestingSsh] = useState(false);
  const [sshTestResult, setSshTestResult] = useState<'success' | 'failed' | null>(null);
  const [copiedPublicKey, setCopiedPublicKey] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [newGeneratedKeyId, setNewGeneratedKeyId] = useState<string | null>(null);
  
  // Legacy for backward compat
  const generateNewKey = authMethod === 'generate_key';
  
  // Step 3: Configuration options
  const [installPackages, setInstallPackages] = useState(true);
  const [createUser, setCreateUser] = useState(true);
  const [resetMachineId, setResetMachineId] = useState(true);
  const [resetSshHostKeys, setResetSshHostKeys] = useState(true);
  const [resetNfsConfig, setResetNfsConfig] = useState(true);
  const [zfsPoolName, setZfsPoolName] = useState("tank");
  const [nfsNetwork, setNfsNetwork] = useState("10.0.0.0/8");
  
  // Step 4: Finalization options
  const [createProtectionGroup, setCreateProtectionGroup] = useState(false);
  const [protectionGroupName, setProtectionGroupName] = useState("");
  const [startInitialSync, setStartInitialSync] = useState(false);
  const [convertBackToTemplate, setConvertBackToTemplate] = useState(false);
  
  // Job status
  const [jobStatus, setJobStatus] = useState<string>('');
  const [stepResults, setStepResults] = useState<StepResult[]>([]);
  const [progressPercent, setProgressPercent] = useState(0);
  const [consoleLog, setConsoleLog] = useState<string[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [vmState, setVmState] = useState<string>('');
  const [vmIp, setVmIp] = useState<string>('');
  const [needsRootPassword, setNeedsRootPassword] = useState(false);
  
  // Fetch VMs from selected vCenter
  const { data: vms = [], isLoading: vmsLoading, clusters = [] } = useVCenterVMs(selectedVCenterId || undefined);
  
  // Fetch SSH keys
  const { sshKeys = [], isLoading: sshKeysLoading, generateKey } = useSshKeys();
  
  // Filter active SSH keys for picker
  const activeSshKeys = useMemo(() => 
    sshKeys.filter(k => k.status === 'active'), 
    [sshKeys]
  );
  
  // Get selected SSH key details
  const selectedSshKey = useMemo(() => 
    sshKeys.find(k => k.id === selectedSshKeyId),
    [sshKeys, selectedSshKeyId]
  );
  
  // Find selected VM details
  const selectedVM = vms.find(vm => vm.id === selectedVMId);
  
  // Phase 3: Check for duplicate targets
  const { data: duplicateTargets = [] } = useQuery({
    queryKey: ['duplicate-target-check', selectedVMId, selectedVM?.ip_address, selectedVM?.name],
    queryFn: async () => {
      if (!selectedVM) return [];
      
      // Build OR conditions for potential matches
      const conditions: string[] = [];
      if (selectedVM.ip_address) {
        conditions.push(`hostname.eq.${selectedVM.ip_address}`);
      }
      if (selectedVM.name) {
        conditions.push(`name.ilike.%${selectedVM.name}%`);
      }
      
      if (conditions.length === 0) return [];
      
      const { data } = await supabase
        .from('replication_targets')
        .select('id, name, hostname, deployed_vm_moref')
        .or(conditions.join(','));
      
      return data || [];
    },
    enabled: !!selectedVM,
  });
  
  // Phase 3: Check OS compatibility (Debian/Ubuntu required)
  const isOsCompatible = useMemo(() => {
    if (!selectedVM?.guest_os) return null; // Unknown - don't show warning
    const os = selectedVM.guest_os.toLowerCase();
    return os.includes('debian') || os.includes('ubuntu') || os.includes('linux');
  }, [selectedVM?.guest_os]);
  
  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setCurrentStep(1);
      setJobId(null);
      setSelectedVCenterId(preselectedVCenterId || "");
      setSelectedVMId(preselectedVMId || "");
      setTargetName("");
      setRootPassword("");
      setAuthMethod('existing_key');
      setSelectedSshKeyId("");
      setSshTestResult(null);
      setTestingSsh(false);
      setCopiedPublicKey(false);
      setGeneratingKey(false);
      setNewGeneratedKeyId(null);
      setStepResults([]);
      setProgressPercent(0);
      setConsoleLog([]);
      setJobStatus('');
      setVmState('');
      setVmIp('');
      setNeedsRootPassword(false);
    }
  }, [open, preselectedVCenterId, preselectedVMId]);
  
  // Auto-populate target name from VM
  useEffect(() => {
    if (selectedVM && !targetName) {
      setTargetName(`zfs-${selectedVM.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`);
    }
  }, [selectedVM, targetName]);
  
  // Poll job status
  const pollJobStatus = useCallback(async () => {
    if (!jobId) return;
    
    const { data: job, error } = await supabase
      .from('jobs')
      .select('status, details')
      .eq('id', jobId)
      .single();
    
    if (error || !job) return;
    
    setJobStatus(job.status);
    
    const details = job.details as Record<string, unknown> | null;
    if (details) {
      if (details.step_results) {
        setStepResults(details.step_results as StepResult[]);
      }
      if (details.progress_percent !== undefined) {
        setProgressPercent(details.progress_percent as number);
      }
      if (details.console_log) {
        setConsoleLog(details.console_log as string[]);
      }
      if (details.vm_state) {
        setVmState(details.vm_state as string);
      }
      if (details.vm_ip) {
        setVmIp(details.vm_ip as string);
      }
      // Check if we need root password
      const results = details.step_results as StepResult[] | undefined;
      if (results) {
        const needsPwd = results.some(r => r.needs_root_password);
        setNeedsRootPassword(needsPwd);
        if (needsPwd && !rootPassword) {
          // Stay on auth step if password needed
          setCurrentStep(2);
        }
      }
    }
    
    // Move to next step based on progress
    if (job.status === 'running') {
      if (progressPercent < 35) {
        setCurrentStep(2);
      } else if (progressPercent < 90) {
        setCurrentStep(3);
      } else {
        setCurrentStep(4);
      }
    }
    
    if (job.status === 'completed') {
      setCurrentStep(4);
    }
    
    return job.status;
  }, [jobId, rootPassword, progressPercent]);
  
  // Polling effect
  useEffect(() => {
    if (!jobId) return;
    
    const interval = setInterval(async () => {
      const status = await pollJobStatus();
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        clearInterval(interval);
      }
    }, 2000);
    
    // Initial poll
    pollJobStatus();
    
    return () => clearInterval(interval);
  }, [jobId, pollJobStatus]);
  
  // Start the onboarding job
  const startOnboarding = async () => {
    if (!selectedVCenterId || !selectedVMId) {
      toast({ title: 'Please select a vCenter and VM', variant: 'destructive' });
      return;
    }
    
    try {
      const { data: user } = await supabase.auth.getUser();
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'onboard_zfs_target' as const,
          status: 'pending',
          created_by: user?.user?.id,
          target_scope: { 
            vcenter_id: selectedVCenterId,
            vm_id: selectedVMId 
          },
          details: {
            target_name: targetName,
            auth_method: authMethod,
            ssh_key_id: authMethod === 'existing_key' ? selectedSshKeyId : undefined,
            root_password: authMethod === 'password' ? rootPassword : undefined,
            generate_new_key: authMethod === 'generate_key',
            install_packages: installPackages,
            create_user: createUser,
            reset_machine_id: resetMachineId,
            reset_ssh_host_keys: resetSshHostKeys,
            reset_nfs_config: resetNfsConfig,
            zfs_pool_name: zfsPoolName,
            nfs_network: nfsNetwork,
            create_protection_group: createProtectionGroup,
            protection_group_name: protectionGroupName,
            start_initial_sync: startInitialSync,
            convert_back_to_template: convertBackToTemplate,
          }
        })
        .select()
        .single();
      
      if (error) throw error;
      
      setJobId(job.id);
      setCurrentStep(2);
      toast({ title: 'Onboarding started', description: 'Setting up your ZFS target...' });
    } catch (err) {
      toast({ 
        title: 'Failed to start onboarding', 
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive' 
      });
    }
  };
  
  // Update job with root password
  const submitRootPassword = async () => {
    if (!jobId || !rootPassword) return;
    
    try {
      const { error } = await supabase
        .from('jobs')
        .update({
          details: supabase.rpc ? undefined : {
            root_password: rootPassword,
          }
        })
        .eq('id', jobId);
      
      // Actually we need to update the job details properly
      const { data: job } = await supabase
        .from('jobs')
        .select('details')
        .eq('id', jobId)
        .single();
      
      if (job) {
        const currentDetails = (job.details || {}) as Record<string, unknown>;
        await supabase
          .from('jobs')
          .update({
            details: {
              ...currentDetails,
              root_password: rootPassword,
              retry_ssh_auth: true,
            }
          })
          .eq('id', jobId);
      }
      
      setNeedsRootPassword(false);
      toast({ title: 'Password submitted', description: 'Retrying SSH authentication...' });
    } catch (err) {
      toast({ 
        title: 'Failed to update', 
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive' 
      });
    }
  };
  
  // Generate a new SSH key
  const handleGenerateKey = async () => {
    if (!targetName) {
      toast({ title: 'Enter a target name first', variant: 'destructive' });
      return;
    }
    
    setGeneratingKey(true);
    try {
      await generateKey({ 
        name: `${targetName}-key`, 
        description: `Auto-generated for ZFS target: ${targetName}` 
      });
      
      // The key was generated - need to fetch the latest key
      // We'll do a quick query to find the newest key
      const { data: newKey } = await supabase
        .from('ssh_keys')
        .select('id')
        .eq('name', `${targetName}-key`)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (newKey) {
        setNewGeneratedKeyId(newKey.id);
        setSelectedSshKeyId(newKey.id);
        setAuthMethod('existing_key');
      }
      
      toast({ title: 'SSH key generated', description: 'Key is ready for deployment' });
    } catch (err) {
      toast({ 
        title: 'Failed to generate key', 
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive' 
      });
    } finally {
      setGeneratingKey(false);
    }
  };
  
  // Test SSH connection
  const handleTestSshConnection = async () => {
    if (!selectedVM?.ip_address) {
      toast({ title: 'VM has no IP address', variant: 'destructive' });
      return;
    }
    
    setTestingSsh(true);
    setSshTestResult(null);
    
    try {
      const { data: user } = await supabase.auth.getUser();
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          // Cast as any since test_ssh_connection may be added to job_type enum later
          job_type: 'test_ssh_connection' as unknown as 'onboard_zfs_target',
          status: 'pending',
          created_by: user?.user?.id,
          details: {
            vm_ip: selectedVM.ip_address,
            auth_method: authMethod,
            ssh_key_id: authMethod === 'existing_key' ? selectedSshKeyId : undefined,
            root_password: authMethod === 'password' ? rootPassword : undefined,
          }
        })
        .select()
        .single();
      
      if (error) throw error;
      
      // Poll for result (max 30 seconds)
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        const { data: jobResult } = await supabase
          .from('jobs')
          .select('status, details')
          .eq('id', job.id)
          .single();
        
        if (jobResult?.status === 'completed') {
          clearInterval(pollInterval);
          setSshTestResult('success');
          setTestingSsh(false);
          toast({ title: 'SSH connection successful' });
        } else if (jobResult?.status === 'failed' || attempts >= 15) {
          clearInterval(pollInterval);
          setSshTestResult('failed');
          setTestingSsh(false);
          toast({ 
            title: 'SSH connection failed', 
            description: (jobResult?.details as Record<string, unknown>)?.error as string || 'Connection timeout',
            variant: 'destructive' 
          });
        }
      }, 2000);
    } catch (err) {
      setTestingSsh(false);
      setSshTestResult('failed');
      toast({ 
        title: 'Failed to test connection', 
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive' 
      });
    }
  };
  
  // Copy public key to clipboard
  const handleCopyPublicKey = async () => {
    if (!selectedSshKey?.public_key) return;
    
    await navigator.clipboard.writeText(selectedSshKey.public_key);
    setCopiedPublicKey(true);
    toast({ title: 'Public key copied' });
    setTimeout(() => setCopiedPublicKey(false), 2000);
  };
  
  // Validation for proceeding
  const canProceedStep1 = selectedVCenterId && selectedVMId && targetName && (
    authMethod === 'password' ? !!rootPassword : 
    authMethod === 'existing_key' ? !!selectedSshKeyId : 
    authMethod === 'generate_key' ? true : false
  );
  const isJobRunning = jobStatus === 'running' || jobStatus === 'pending';
  const isJobComplete = jobStatus === 'completed';
  const isJobFailed = jobStatus === 'failed';
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Add ZFS Replication Target
          </DialogTitle>
          <DialogDescription>
            Set up a VM as a ZFS replication target with automated configuration
          </DialogDescription>
        </DialogHeader>
        
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 py-4 border-b">
          {WIZARD_STEPS.map((step, index) => {
            const Icon = step.icon;
            const isActive = currentStep === step.id;
            const isComplete = currentStep > step.id || (isJobComplete && step.id <= 4);
            
            return (
              <div key={step.id} className="flex items-center">
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  isActive 
                    ? 'bg-primary text-primary-foreground' 
                    : isComplete 
                      ? 'bg-green-500/10 text-green-600' 
                      : 'bg-muted text-muted-foreground'
                }`}>
                  {isComplete && !isActive ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">{step.label}</span>
                </div>
                {index < WIZARD_STEPS.length - 1 && (
                  <div className={`w-8 h-0.5 mx-1 ${
                    currentStep > step.id ? 'bg-green-500' : 'bg-border'
                  }`} />
                )}
              </div>
            );
          })}
        </div>
        
        <ScrollArea className="flex-1 px-1">
          {/* Step 1: Select VM */}
          {currentStep === 1 && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>vCenter</Label>
                <Select value={selectedVCenterId} onValueChange={setSelectedVCenterId}>
                  <SelectTrigger>
                    <SelectValue placeholder={vcentersLoading ? "Loading..." : "Select vCenter"} />
                  </SelectTrigger>
                  <SelectContent>
                    {vcenters.map((vc) => (
                      <SelectItem key={vc.id} value={vc.id}>
                        {vc.name} ({vc.host})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>VM or Template</Label>
                <VMCombobox
                  vms={vms}
                  clusters={clusters}
                  selectedVmId={selectedVMId}
                  onSelectVm={(vm) => setSelectedVMId(vm.id)}
                  disabled={!selectedVCenterId}
                  isLoading={vmsLoading}
                  placeholder={
                    !selectedVCenterId 
                      ? "Select vCenter first" 
                      : "Select VM or Template"
                  }
                />
              </div>
              
              {/* Enhanced VM Preview Card */}
              {selectedVM && (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-muted/50 space-y-2 text-sm">
                    {/* Header with power state and cluster */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {selectedVM.is_template ? (
                          <Badge variant="outline" className="text-xs">
                            <Copy className="h-3 w-3 mr-1" />
                            Template
                          </Badge>
                        ) : selectedVM.power_state === 'poweredOn' ? (
                          <Badge variant="default" className="bg-green-500/10 text-green-600 border-green-500/30 text-xs">
                            <Power className="h-3 w-3 mr-1" />
                            Powered On
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            <PowerOff className="h-3 w-3 mr-1" />
                            Powered Off
                          </Badge>
                        )}
                      </div>
                      {selectedVM.cluster_name && (
                        <Badge variant="outline" className="text-xs">
                          {selectedVM.cluster_name}
                        </Badge>
                      )}
                    </div>
                    
                    {/* VM details */}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Guest OS:</span>
                      <span>{selectedVM.guest_os || 'Unknown'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">CPU/Memory:</span>
                      <span>{selectedVM.cpu_count || '?'} vCPU / {selectedVM.memory_mb ? Math.round(selectedVM.memory_mb / 1024) : '?'} GB</span>
                    </div>
                    {selectedVM.ip_address && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">IP Address:</span>
                        <span className="font-mono text-xs">{selectedVM.ip_address}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Duplicate Warning */}
                  {duplicateTargets.length > 0 && (
                    <div className="p-3 rounded-lg border border-yellow-500/50 bg-yellow-500/5">
                      <div className="flex items-start gap-2 text-yellow-600 dark:text-yellow-500">
                        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <div className="text-sm">
                          <span className="font-medium">Possible duplicate detected</span>
                          <p className="text-xs mt-0.5 opacity-80">
                            This VM may already be registered as "{duplicateTargets[0].name}"
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* OS Compatibility Warning */}
                  {isOsCompatible === false && (
                    <div className="p-3 rounded-lg border border-orange-500/50 bg-orange-500/5">
                      <div className="flex items-start gap-2 text-orange-600 dark:text-orange-500">
                        <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <div className="text-sm">
                          <span className="font-medium">OS compatibility warning</span>
                          <p className="text-xs mt-0.5 opacity-80">
                            This wizard requires Debian/Ubuntu. Detected: {selectedVM.guest_os}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              <div className="space-y-2">
                <Label>Target Name</Label>
                <Input
                  value={targetName}
                  onChange={(e) => setTargetName(e.target.value)}
                  placeholder="e.g., zfs-dr-target-01"
                />
                <p className="text-xs text-muted-foreground">
                  This name will be used for the replication target and datastore
                </p>
              </div>
              
              <div className="pt-4 border-t space-y-4">
                <Label className="text-sm font-medium">SSH Authentication</Label>
                
                <RadioGroup 
                  value={authMethod} 
                  onValueChange={(v) => setAuthMethod(v as 'existing_key' | 'generate_key' | 'password')}
                  className="space-y-3"
                >
                  {/* Existing SSH Key */}
                  <div className="flex items-start space-x-3">
                    <RadioGroupItem value="existing_key" id="auth-existing" className="mt-1" />
                    <div className="flex-1 space-y-2">
                      <Label htmlFor="auth-existing" className="text-sm cursor-pointer">
                        Use existing SSH key
                      </Label>
                      
                      {authMethod === 'existing_key' && (
                        <div className="space-y-3">
                          <Select 
                            value={selectedSshKeyId} 
                            onValueChange={setSelectedSshKeyId}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder={sshKeysLoading ? "Loading keys..." : "Select SSH key"} />
                            </SelectTrigger>
                            <SelectContent>
                              {activeSshKeys.map((key) => (
                                <SelectItem key={key.id} value={key.id}>
                                  <div className="flex items-center gap-2">
                                    <Key className="h-3 w-3" />
                                    <span>{key.name}</span>
                                    {key.public_key_fingerprint && (
                                      <span className="text-xs text-muted-foreground font-mono">
                                        {key.public_key_fingerprint.slice(0, 16)}...
                                      </span>
                                    )}
                                  </div>
                                </SelectItem>
                              ))}
                              {activeSshKeys.length === 0 && (
                                <SelectItem value="_none" disabled>
                                  No active SSH keys found
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                          
                          {/* Public key display */}
                          {selectedSshKey && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Fingerprint className="h-3 w-3" />
                                  {selectedSshKey.public_key_fingerprint}
                                </span>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  onClick={handleCopyPublicKey}
                                  className="h-6 px-2"
                                >
                                  {copiedPublicKey ? (
                                    <Check className="h-3 w-3 text-green-500" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </Button>
                              </div>
                              <Textarea
                                value={selectedSshKey.public_key}
                                readOnly
                                className="font-mono text-xs h-16 resize-none"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Generate New Key */}
                  <div className="flex items-start space-x-3">
                    <RadioGroupItem value="generate_key" id="auth-generate" className="mt-1" />
                    <div className="flex-1 space-y-2">
                      <Label htmlFor="auth-generate" className="text-sm cursor-pointer">
                        Generate new SSH key
                      </Label>
                      
                      {authMethod === 'generate_key' && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">
                            A new keypair will be generated and saved. The public key will be deployed to the target.
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleGenerateKey}
                            disabled={generatingKey || !targetName}
                          >
                            {generatingKey ? (
                              <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                            ) : (
                              <Plus className="h-3 w-3 mr-2" />
                            )}
                            Generate Now
                          </Button>
                          {newGeneratedKeyId && (
                            <Badge variant="outline" className="text-xs text-green-600">
                              <Check className="h-3 w-3 mr-1" />
                              Key generated
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Password Auth */}
                  <div className="flex items-start space-x-3">
                    <RadioGroupItem value="password" id="auth-password" className="mt-1" />
                    <div className="flex-1 space-y-2">
                      <Label htmlFor="auth-password" className="text-sm cursor-pointer">
                        Use password
                      </Label>
                      
                      {authMethod === 'password' && (
                        <Input
                          type="password"
                          value={rootPassword}
                          onChange={(e) => setRootPassword(e.target.value)}
                          placeholder="Root password"
                        />
                      )}
                    </div>
                  </div>
                </RadioGroup>
                
                {/* Test SSH Connection Button */}
                {selectedVM?.ip_address && (authMethod === 'existing_key' && selectedSshKeyId || authMethod === 'password' && rootPassword) && (
                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleTestSshConnection}
                      disabled={testingSsh}
                    >
                      {testingSsh ? (
                        <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                      ) : (
                        <Plug className="h-3 w-3 mr-2" />
                      )}
                      Test SSH Connection
                    </Button>
                    {sshTestResult === 'success' && (
                      <Badge variant="outline" className="text-green-600">
                        <Check className="h-3 w-3 mr-1" />
                        Connected
                      </Badge>
                    )}
                    {sshTestResult === 'failed' && (
                      <Badge variant="outline" className="text-destructive">
                        <XCircle className="h-3 w-3 mr-1" />
                        Failed
                      </Badge>
                    )}
                  </div>
                )}
              </div>
              
              <div className="pt-4 border-t space-y-3">
                <Label className="text-sm font-medium">Configuration Options</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">ZFS Pool Name</Label>
                    <Input
                      value={zfsPoolName}
                      onChange={(e) => setZfsPoolName(e.target.value)}
                      placeholder="tank"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">NFS Allowed Network</Label>
                    <Input
                      value={nfsNetwork}
                      onChange={(e) => setNfsNetwork(e.target.value)}
                      placeholder="10.0.0.0/8"
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="install-packages" 
                      checked={installPackages} 
                      onCheckedChange={(c) => setInstallPackages(!!c)} 
                    />
                    <Label htmlFor="install-packages" className="text-sm">Install ZFS & NFS packages (Debian 13)</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="create-user" 
                      checked={createUser} 
                      onCheckedChange={(c) => setCreateUser(!!c)} 
                    />
                    <Label htmlFor="create-user" className="text-sm">Create zfsadmin user</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="reset-machine-id" 
                      checked={resetMachineId} 
                      onCheckedChange={(c) => setResetMachineId(!!c)} 
                    />
                    <Label htmlFor="reset-machine-id" className="text-sm">Reset machine-id (recommended for clones)</Label>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Step 2: Authentication */}
          {currentStep === 2 && (
            <div className="space-y-4 py-4">
              {vmState && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">VM State: <strong>{vmState}</strong></span>
                  {vmIp && (
                    <>
                      <span className="text-muted-foreground">|</span>
                      <span className="text-sm">IP: <strong>{vmIp}</strong></span>
                    </>
                  )}
                </div>
              )}
              
              {/* Progress steps */}
              <div className="space-y-2">
                {stepResults.map((result, index) => (
                  <div key={index} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30">
                    {getStatusIcon(result.status)}
                    <span className="flex-1 text-sm">
                      {STEP_LABELS[result.step] || result.step}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {result.message}
                    </span>
                    {result.status === 'fixed' && (
                      <Badge variant="outline" className="text-xs text-green-600">auto-fixed</Badge>
                    )}
                  </div>
                ))}
              </div>
              
              {/* Root password prompt */}
              {needsRootPassword && (
                <div className="p-4 rounded-lg border border-yellow-500/50 bg-yellow-500/5 space-y-3">
                  <div className="flex items-center gap-2 text-yellow-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="font-medium">SSH Key Not Authorized</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Enter the root password to deploy the SSH key automatically.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={rootPassword}
                      onChange={(e) => setRootPassword(e.target.value)}
                      placeholder="Root password"
                      className="flex-1"
                    />
                    <Button onClick={submitRootPassword} disabled={!rootPassword}>
                      <Key className="h-4 w-4 mr-2" />
                      Deploy Key
                    </Button>
                  </div>
                </div>
              )}
              
              {/* Progress bar */}
              {isJobRunning && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Progress</span>
                    <span>{progressPercent}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-500"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Step 3: Setup & Configuration */}
          {currentStep === 3 && (
            <div className="space-y-4 py-4">
              {vmState && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">VM State: <strong>{vmState}</strong></span>
                  {vmIp && (
                    <>
                      <span className="text-muted-foreground">|</span>
                      <span className="text-sm">IP: <strong>{vmIp}</strong></span>
                    </>
                  )}
                </div>
              )}
              
              {/* Progress steps */}
              <div className="space-y-2">
                {stepResults.map((result, index) => (
                  <div key={index} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30">
                    {getStatusIcon(result.status)}
                    <span className="flex-1 text-sm">
                      {STEP_LABELS[result.step] || result.step}
                    </span>
                    <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                      {result.message}
                    </span>
                    {result.status === 'fixed' && (
                      <Badge variant="outline" className="text-xs text-green-600">auto-fixed</Badge>
                    )}
                    {result.status === 'warning' && (
                      <Badge variant="outline" className="text-xs text-yellow-600">warning</Badge>
                    )}
                  </div>
                ))}
              </div>
              
              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          )}
          
          {/* Step 4: Finalization */}
          {currentStep === 4 && (
            <div className="space-y-4 py-4">
              {isJobComplete && (
                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                  <div className="flex items-center gap-2 text-green-600 mb-2">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="font-medium">ZFS Target Ready!</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Your ZFS replication target has been configured successfully.
                  </p>
                </div>
              )}
              
              {isJobFailed && (
                <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                  <div className="flex items-center gap-2 text-destructive mb-2">
                    <XCircle className="h-5 w-5" />
                    <span className="font-medium">Setup Failed</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Check the console log for details.
                  </p>
                </div>
              )}
              
              {/* Summary */}
              <div className="space-y-2">
                {stepResults.filter(r => r.status === 'success' || r.status === 'fixed').map((result, index) => (
                  <div key={index} className="flex items-center gap-3 p-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="flex-1 text-sm">{STEP_LABELS[result.step] || result.step}</span>
                    <span className="text-sm text-muted-foreground">{result.message}</span>
                  </div>
                ))}
              </div>
              
              {/* Post-setup options */}
              {isJobComplete && (
                <div className="pt-4 border-t space-y-3">
                  <Label className="text-sm font-medium">Next Steps</Label>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox 
                        id="create-group" 
                        checked={createProtectionGroup} 
                        onCheckedChange={(c) => setCreateProtectionGroup(!!c)} 
                      />
                      <Label htmlFor="create-group" className="text-sm">Create protection group</Label>
                    </div>
                    {createProtectionGroup && (
                      <Input
                        value={protectionGroupName}
                        onChange={(e) => setProtectionGroupName(e.target.value)}
                        placeholder="Protection group name"
                        className="ml-6"
                      />
                    )}
                    <div className="flex items-center gap-2">
                      <Checkbox 
                        id="start-sync" 
                        checked={startInitialSync} 
                        onCheckedChange={(c) => setStartInitialSync(!!c)} 
                      />
                      <Label htmlFor="start-sync" className="text-sm">Start initial sync now</Label>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Console log */}
          {consoleLog.length > 0 && (
            <Collapsible open={showConsole} onOpenChange={setShowConsole} className="mt-4">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between">
                  <span className="flex items-center gap-2">
                    <Terminal className="h-4 w-4" />
                    Console Log ({consoleLog.length} entries)
                  </span>
                  {showConsole ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 p-3 rounded-lg bg-black text-green-400 font-mono text-xs max-h-48 overflow-y-auto">
                  {consoleLog.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </ScrollArea>
        
        {/* Footer actions */}
        <div className="flex justify-between pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isJobComplete ? 'Close' : 'Cancel'}
          </Button>
          
          <div className="flex gap-2">
            {currentStep === 1 && (
              <Button onClick={startOnboarding} disabled={!canProceedStep1}>
                <Play className="h-4 w-4 mr-2" />
                Start Setup
              </Button>
            )}
            
            {isJobComplete && currentStep === 4 && (
              <Button onClick={() => onOpenChange(false)}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Done
              </Button>
            )}
            
            {isJobRunning && (
              <Button disabled>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Setting up...
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
