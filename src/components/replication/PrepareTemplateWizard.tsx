/**
 * PrepareTemplateWizard
 * 
 * Enhanced 6-step wizard to prepare a baseline ZFS appliance template:
 * Step 1: Select VM - Choose existing VM to convert to template
 * Step 2: Pre-flight - Validate prerequisites before changes
 * Step 3: Connect - SSH to VM, verify connectivity
 * Step 4: Configure - Install packages, ZFS tuning, create user, set up SSH key
 * Step 5: Clean - Clear machine-id, SSH host keys, cloud-init, network state
 * Step 6: Convert - Power off, convert to VMware template
 */

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { VMCombobox } from "./VMCombobox";
import {
  Server,
  Key,
  Settings,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Power,
  Plug,
  Package,
  Trash2,
  FileBox,
  Terminal,
  ShieldCheck,
  ChevronDown,
  Cpu,
  HardDrive,
  Network,
  Tag,
  Camera,
  Activity,
  AlertTriangle,
} from "lucide-react";
import { useVCenters } from "@/hooks/useVCenters";
import { useVCenterVMs } from "@/hooks/useVCenterVMs";
import { useSshKeys } from "@/hooks/useSshKeys";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";

interface PrepareTemplateWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedVCenterId?: string;
}

const WIZARD_STEPS = [
  { id: 1, label: 'Select', icon: Server },
  { id: 2, label: 'Pre-flight', icon: ShieldCheck },
  { id: 3, label: 'Connect', icon: Plug },
  { id: 4, label: 'Configure', icon: Package },
  { id: 5, label: 'Clean', icon: Trash2 },
  { id: 6, label: 'Convert', icon: FileBox },
];

const DEFAULT_PACKAGES = [
  { name: 'zfsutils-linux', description: 'ZFS filesystem utilities', required: true },
  { name: 'nfs-kernel-server', description: 'NFS server for datastore exports', required: true },
  { name: 'open-vm-tools', description: 'VMware Tools for guest integration', required: true },
  { name: 'parted', description: 'Disk partitioning utility', required: false },
  { name: 'htop', description: 'System monitoring utility', required: false },
  { name: 'iotop', description: 'I/O monitoring utility', required: false },
];

interface PreflightCheck {
  check: string;
  ok: boolean;
  value: string;
  critical?: boolean;
}

export function PrepareTemplateWizard({
  open,
  onOpenChange,
  preselectedVCenterId,
}: PrepareTemplateWizardProps) {
  const { toast } = useToast();
  const { vcenters, loading: vcentersLoading } = useVCenters();
  
  // Wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>('');
  const [jobProgress, setJobProgress] = useState(0);
  
  // Step 1: Select VM
  const [selectedVCenterId, setSelectedVCenterId] = useState(preselectedVCenterId || "");
  const [selectedVMId, setSelectedVMId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateVersion, setTemplateVersion] = useState("1.0.0");
  
  // Step 2: Pre-flight
  const [preflightChecks, setPreflightChecks] = useState<PreflightCheck[]>([]);
  const [preflightStatus, setPreflightStatus] = useState<'idle' | 'running' | 'passed' | 'failed'>('idle');
  const [preflightJobId, setPreflightJobId] = useState<string | null>(null);
  
  // Step 3: Connect
  const [selectedSshKeyId, setSelectedSshKeyId] = useState("");
  const [rootPassword, setRootPassword] = useState("");
  const [sshTestResult, setSshTestResult] = useState<'success' | 'failed' | null>(null);
  const [testingSsh, setTestingSsh] = useState(false);
  
  // Step 4: Configure
  const [installPackages, setInstallPackages] = useState(true);
  const [selectedPackages, setSelectedPackages] = useState<string[]>(
    DEFAULT_PACKAGES.filter(p => p.required).map(p => p.name)
  );
  const [createUser, setCreateUser] = useState(true);
  const [username, setUsername] = useState("zfsadmin");
  const [deployKey, setDeployKey] = useState(true);
  const [installHealthScript, setInstallHealthScript] = useState(true);
  
  // ZFS Tuning options
  const [enableZfsTuning, setEnableZfsTuning] = useState(true);
  const [arcPercent, setArcPercent] = useState(50);
  const [enablePrefetch, setEnablePrefetch] = useState(true);
  const [enableNfsTuning, setEnableNfsTuning] = useState(true);
  const [showAdvancedTuning, setShowAdvancedTuning] = useState(false);
  
  // Step 5: Clean
  const [clearMachineId, setClearMachineId] = useState(true);
  const [clearSshHostKeys, setClearSshHostKeys] = useState(true);
  const [cleanCloudInit, setCleanCloudInit] = useState(true);
  const [cleanNetwork, setCleanNetwork] = useState(true);
  
  // Step 6: Convert
  const [convertToTemplate, setConvertToTemplate] = useState(true);
  const [powerOffFirst, setPowerOffFirst] = useState(true);
  const [createRollbackSnapshot, setCreateRollbackSnapshot] = useState(false);
  
  // Fetch VMs from selected vCenter
  const { data: vms = [], isLoading: vmsLoading, clusters = [] } = useVCenterVMs(selectedVCenterId || undefined);
  
  // Fetch SSH keys
  const { sshKeys = [], isLoading: sshKeysLoading } = useSshKeys();
  
  // Filter active SSH keys
  const activeSshKeys = useMemo(() => 
    sshKeys.filter(k => k.status === 'active'), 
    [sshKeys]
  );
  
  // Find selected VM details
  const selectedVM = vms.find(vm => vm.id === selectedVMId);
  
  // Filter to only show powered-on VMs (templates cannot be prepared)
  const eligibleVMs = useMemo(() => 
    vms.filter(vm => !vm.is_template && vm.power_state === 'poweredOn'),
    [vms]
  );
  
  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setCurrentStep(1);
      setJobId(null);
      setJobStatus('');
      setJobProgress(0);
      setSelectedVCenterId(preselectedVCenterId || "");
      setSelectedVMId("");
      setTemplateName("");
      setTemplateVersion("1.0.0");
      setPreflightChecks([]);
      setPreflightStatus('idle');
      setPreflightJobId(null);
      setSelectedSshKeyId("");
      setRootPassword("");
      setSshTestResult(null);
      setTestingSsh(false);
      setInstallPackages(true);
      setSelectedPackages(DEFAULT_PACKAGES.filter(p => p.required).map(p => p.name));
      setCreateUser(true);
      setUsername("zfsadmin");
      setDeployKey(true);
      setInstallHealthScript(true);
      setEnableZfsTuning(true);
      setArcPercent(50);
      setEnablePrefetch(true);
      setEnableNfsTuning(true);
      setShowAdvancedTuning(false);
      setClearMachineId(true);
      setClearSshHostKeys(true);
      setCleanCloudInit(true);
      setCleanNetwork(true);
      setConvertToTemplate(true);
      setPowerOffFirst(true);
      setCreateRollbackSnapshot(false);
    }
  }, [open, preselectedVCenterId]);
  
  // Auto-populate template name from VM
  useEffect(() => {
    if (selectedVM && !templateName) {
      setTemplateName(`zfs-appliance-template-${selectedVM.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`);
    }
  }, [selectedVM, templateName]);
  
  // Run pre-flight checks
  const runPreflightChecks = async () => {
    if (!selectedVM?.ip_address || !rootPassword) {
      toast({ title: 'VM IP and root password required', variant: 'destructive' });
      return;
    }
    
    setPreflightStatus('running');
    setPreflightChecks([]);
    
    try {
      const { data: user } = await supabase.auth.getUser();
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'test_ssh_connection' as const,
          status: 'pending',
          created_by: user?.user?.id,
          target_scope: {
            vcenter_id: selectedVCenterId,
            vm_id: selectedVMId
          },
          details: {
            vm_ip: selectedVM.ip_address,
            root_password: rootPassword,
            preflight_only: true,
          }
        })
        .select()
        .single();
      
      if (error) throw error;
      
      setPreflightJobId(job.id);
      
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
          const details = jobResult.details as Record<string, unknown>;
          const checks = (details?.preflight_checks || []) as PreflightCheck[];
          setPreflightChecks(checks);
          
          const hasCriticalFailure = checks.some(c => !c.ok && c.critical);
          setPreflightStatus(hasCriticalFailure ? 'failed' : 'passed');
          
          if (hasCriticalFailure) {
            toast({ title: 'Pre-flight checks failed', variant: 'destructive' });
          } else {
            toast({ title: 'Pre-flight checks passed' });
          }
        } else if (jobResult?.status === 'failed' || attempts >= 30) {
          clearInterval(pollInterval);
          setPreflightStatus('failed');
          toast({ 
            title: 'Pre-flight check failed', 
            description: (jobResult?.details as Record<string, unknown>)?.error as string || 'Timeout',
            variant: 'destructive' 
          });
        }
      }, 2000);
    } catch (err) {
      setPreflightStatus('failed');
      toast({ 
        title: 'Failed to run pre-flight checks', 
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive' 
      });
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
          job_type: 'test_ssh_connection' as const,
          status: 'pending',
          created_by: user?.user?.id,
          details: {
            vm_ip: selectedVM.ip_address,
            auth_method: 'password',
            root_password: rootPassword,
          }
        })
        .select()
        .single();
      
      if (error) throw error;
      
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
          
          // Also mark preflight as passed since SSH works
          if (preflightStatus === 'idle') {
            setPreflightStatus('passed');
          }
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
  
  // Start template preparation job
  const startPreparation = async () => {
    if (!selectedVCenterId || !selectedVMId) {
      toast({ title: 'Please select a vCenter and VM', variant: 'destructive' });
      return;
    }
    
    try {
      const { data: user } = await supabase.auth.getUser();
      
      const jobInsert = {
          job_type: 'prepare_zfs_template' as const,
          status: 'pending' as const,
          created_by: user?.user?.id,
          target_scope: { 
            vcenter_id: selectedVCenterId,
            vm_id: selectedVMId 
          },
          details: {
            template_name: templateName,
            template_version: templateVersion,
            vm_moref: String((selectedVM as unknown as Record<string, unknown>)?.vcenter_id || selectedVM?.id || ''),
            install_packages: installPackages,
            packages: selectedPackages,
            create_user: createUser,
            username: username,
            ssh_key_id: deployKey ? selectedSshKeyId : undefined,
            root_password: rootPassword,
            install_health_script: installHealthScript,
            zfs_tuning: {
              enabled: enableZfsTuning,
              arc_percent: arcPercent,
              enable_prefetch: enablePrefetch,
              nfs_tuning: enableNfsTuning,
            },
            cleanup: {
              clear_machine_id: clearMachineId,
              clear_ssh_host_keys: clearSshHostKeys,
              clean_cloud_init: cleanCloudInit,
              clean_network: cleanNetwork,
            },
            power_off_first: powerOffFirst,
            convert_to_template: convertToTemplate,
            create_rollback_snapshot: createRollbackSnapshot,
          }
        };
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert([jobInsert])
        .select()
        .single();
      
      if (error) throw error;
      
      setJobId(job.id);
      toast({ title: 'Template preparation started', description: 'Configuring VM as ZFS appliance template...' });
      
      // Poll for job completion
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        const { data: jobResult } = await supabase
          .from('jobs')
          .select('status, details')
          .eq('id', job.id)
          .single();
        
        setJobStatus(jobResult?.status || '');
        const details = jobResult?.details as Record<string, unknown> | null;
        if (details?.progress_percent) {
          setJobProgress(details.progress_percent as number);
        }
        
        if (jobResult?.status === 'completed') {
          clearInterval(pollInterval);
          setJobProgress(100);
          toast({ title: 'Template preparation complete', description: 'VM is now ready as a ZFS appliance template' });
        } else if (jobResult?.status === 'failed') {
          clearInterval(pollInterval);
          toast({ 
            title: 'Template preparation failed', 
            description: details?.error as string || 'Unknown error',
            variant: 'destructive' 
          });
        } else if (attempts >= 180) { // 6 minute timeout
          clearInterval(pollInterval);
          toast({ 
            title: 'Template preparation timeout', 
            description: 'Job is taking longer than expected. Check job status.',
            variant: 'destructive' 
          });
        }
      }, 2000);
    } catch (err) {
      toast({ 
        title: 'Failed to start preparation', 
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive' 
      });
    }
  };
  
  // Step validation
  const canProceedFromStep = (step: number): boolean => {
    switch (step) {
      case 1: 
        return !!selectedVCenterId && !!selectedVMId && !!templateName && !!templateVersion;
      case 2:
        // Pre-flight must pass or be skipped with SSH test success
        return preflightStatus === 'passed' || sshTestResult === 'success';
      case 3: 
        return !!rootPassword && sshTestResult === 'success';
      case 4: 
        return !installPackages || selectedPackages.length > 0;
      case 5: 
        return true; // All optional
      case 6: 
        return !jobId || jobStatus === 'completed' || jobStatus === 'failed';
      default: 
        return false;
    }
  };
  
  const isJobRunning = jobStatus === 'running' || jobStatus === 'pending';
  const isJobComplete = jobStatus === 'completed';
  
  const handleNext = () => {
    if (currentStep < 6 && canProceedFromStep(currentStep)) {
      setCurrentStep(currentStep + 1);
    }
  };
  
  const handleBack = () => {
    if (currentStep > 1 && !isJobRunning) {
      setCurrentStep(currentStep - 1);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileBox className="h-5 w-5" />
            Prepare ZFS Appliance Template
          </DialogTitle>
          <DialogDescription>
            Configure a VM as a baseline ZFS appliance template with enhanced validation and tuning
          </DialogDescription>
        </DialogHeader>
        
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-0.5 py-3 border-b shrink-0">
          {WIZARD_STEPS.map((step, index) => {
            const Icon = step.icon;
            const isActive = currentStep === step.id;
            const isComplete = currentStep > step.id || isJobComplete;
            
            return (
              <div key={step.id} className="flex items-center">
                <div className={`flex items-center gap-1 px-1.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  isActive 
                    ? 'bg-primary text-primary-foreground' 
                    : isComplete 
                      ? 'bg-green-500/10 text-green-600' 
                      : 'bg-muted text-muted-foreground'
                }`}>
                  {isComplete && !isActive ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <Icon className="h-3 w-3" />
                  )}
                  <span className="hidden md:inline">{step.label}</span>
                </div>
                {index < WIZARD_STEPS.length - 1 && (
                  <div className={`w-3 h-0.5 mx-0.5 ${
                    currentStep > step.id ? 'bg-green-500' : 'bg-border'
                  }`} />
                )}
              </div>
            );
          })}
        </div>
        
        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-1 py-4">
          {/* Step 1: Select VM */}
          {currentStep === 1 && (
            <div className="space-y-4">
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
                <Label>VM to Convert (must be powered on)</Label>
                <VMCombobox
                  vms={eligibleVMs}
                  clusters={clusters}
                  selectedVmId={selectedVMId}
                  onSelectVm={(vm) => setSelectedVMId(vm.id)}
                  disabled={!selectedVCenterId}
                  isLoading={vmsLoading}
                  placeholder={
                    !selectedVCenterId 
                      ? "Select vCenter first" 
                      : "Select a powered-on VM"
                  }
                />
              </div>
              
              {/* VM Preview */}
              {selectedVM && (
                <div className="p-3 rounded-lg bg-muted/50 space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="bg-green-500/10 text-green-600 border-green-500/30 text-xs">
                      <Power className="h-3 w-3 mr-1" />
                      Powered On
                    </Badge>
                    {selectedVM.cluster_name && (
                      <Badge variant="outline" className="text-xs">
                        {selectedVM.cluster_name}
                      </Badge>
                    )}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Guest OS:</span>
                    <span>{selectedVM.guest_os || 'Unknown'}</span>
                  </div>
                  {selectedVM.ip_address && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">IP Address:</span>
                      <span className="font-mono text-xs">{selectedVM.ip_address}</span>
                    </div>
                  )}
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Template Name</Label>
                  <Input
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="e.g., zfs-appliance-template-v1"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    <Tag className="h-3 w-3" />
                    Version
                  </Label>
                  <Input
                    value={templateVersion}
                    onChange={(e) => setTemplateVersion(e.target.value)}
                    placeholder="1.0.0"
                  />
                </div>
              </div>
            </div>
          )}
          
          {/* Step 2: Pre-flight Checks */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertDescription>
                  Pre-flight checks validate disk space, repository access, and kernel headers before making changes.
                </AlertDescription>
              </Alert>
              
              {!rootPassword && (
                <div className="space-y-2">
                  <Label>Root Password (for pre-flight SSH)</Label>
                  <Input
                    type="password"
                    value={rootPassword}
                    onChange={(e) => setRootPassword(e.target.value)}
                    placeholder="Enter root password"
                  />
                </div>
              )}
              
              {rootPassword && (
                <div className="space-y-4">
                  <Button
                    onClick={runPreflightChecks}
                    disabled={preflightStatus === 'running' || !selectedVM?.ip_address}
                    variant={preflightStatus === 'passed' ? 'outline' : 'default'}
                  >
                    {preflightStatus === 'running' ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : preflightStatus === 'passed' ? (
                      <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
                    ) : (
                      <ShieldCheck className="h-4 w-4 mr-2" />
                    )}
                    {preflightStatus === 'running' ? 'Running Checks...' : 
                     preflightStatus === 'passed' ? 'Re-run Checks' : 'Run Pre-flight Checks'}
                  </Button>
                  
                  {preflightChecks.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Results</Label>
                      <div className="space-y-1.5">
                        {preflightChecks.map((check, idx) => (
                          <div key={idx} className={`flex items-center justify-between p-2 rounded text-sm ${
                            check.ok ? 'bg-green-500/10' : check.critical ? 'bg-destructive/10' : 'bg-yellow-500/10'
                          }`}>
                            <div className="flex items-center gap-2">
                              {check.ok ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                              ) : check.critical ? (
                                <AlertCircle className="h-4 w-4 text-destructive" />
                              ) : (
                                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                              )}
                              <span className="capitalize">{check.check.replace(/_/g, ' ')}</span>
                            </div>
                            <span className="text-muted-foreground">{check.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {preflightStatus === 'failed' && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Critical pre-flight checks failed. Address the issues before proceeding.
                      </AlertDescription>
                    </Alert>
                  )}
                  
                  {preflightStatus === 'passed' && (
                    <Alert className="border-green-500/30 bg-green-500/5">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <AlertDescription className="text-green-700 dark:text-green-400">
                        All pre-flight checks passed. Ready to proceed.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </div>
          )}
          
          {/* Step 3: Connect */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <Alert>
                <Terminal className="h-4 w-4" />
                <AlertDescription>
                  Root access is required to install packages and configure the template.
                </AlertDescription>
              </Alert>
              
              <div className="space-y-2">
                <Label>Root Password</Label>
                <Input
                  type="password"
                  value={rootPassword}
                  onChange={(e) => setRootPassword(e.target.value)}
                  placeholder="Enter root password for SSH access"
                />
              </div>
              
              {selectedVM?.ip_address && rootPassword && (
                <div className="flex items-center gap-2">
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
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                  )}
                  {sshTestResult === 'failed' && (
                    <Badge variant="outline" className="text-destructive">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      Failed
                    </Badge>
                  )}
                </div>
              )}
              
              {sshTestResult === 'success' && (
                <div className="space-y-4 pt-4 border-t">
                  <div className="space-y-2">
                    <Label>SSH Key for Deployments</Label>
                    <Select value={selectedSshKeyId} onValueChange={setSelectedSshKeyId}>
                      <SelectTrigger>
                        <SelectValue placeholder={sshKeysLoading ? "Loading..." : "Select SSH key"} />
                      </SelectTrigger>
                      <SelectContent>
                        {activeSshKeys.map((key) => (
                          <SelectItem key={key.id} value={key.id}>
                            <div className="flex items-center gap-2">
                              <Key className="h-3 w-3" />
                              <span>{key.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      This key will be pre-installed in the template for passwordless deployment
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Step 4: Configure */}
          {currentStep === 4 && (
            <div className="space-y-4">
              {/* Packages */}
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="install-packages"
                  checked={installPackages}
                  onCheckedChange={(checked) => setInstallPackages(!!checked)}
                />
                <Label htmlFor="install-packages" className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Install ZFS/NFS packages
                </Label>
              </div>
              
              {installPackages && (
                <div className="space-y-2 pl-6">
                  {DEFAULT_PACKAGES.map((pkg) => (
                    <div key={pkg.name} className="flex items-center space-x-2">
                      <Checkbox
                        id={`pkg-${pkg.name}`}
                        checked={selectedPackages.includes(pkg.name)}
                        disabled={pkg.required}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedPackages([...selectedPackages, pkg.name]);
                          } else {
                            setSelectedPackages(selectedPackages.filter(p => p !== pkg.name));
                          }
                        }}
                      />
                      <Label htmlFor={`pkg-${pkg.name}`} className="text-sm">
                        <span className="font-mono">{pkg.name}</span>
                        <span className="text-muted-foreground ml-2">- {pkg.description}</span>
                        {pkg.required && (
                          <Badge variant="secondary" className="ml-2 text-xs">Required</Badge>
                        )}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
              
              {/* ZFS Tuning */}
              <Collapsible open={showAdvancedTuning} onOpenChange={setShowAdvancedTuning}>
                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="zfs-tuning"
                      checked={enableZfsTuning}
                      onCheckedChange={(checked) => setEnableZfsTuning(!!checked)}
                    />
                    <Label htmlFor="zfs-tuning" className="flex items-center gap-2">
                      <Cpu className="h-4 w-4" />
                      Apply ZFS Performance Tuning
                    </Label>
                  </div>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <ChevronDown className={`h-4 w-4 transition-transform ${showAdvancedTuning ? 'rotate-180' : ''}`} />
                    </Button>
                  </CollapsibleTrigger>
                </div>
                
                <CollapsibleContent className="space-y-4 pt-3 pl-6">
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label className="text-sm flex items-center gap-2">
                        <HardDrive className="h-3 w-3" />
                        ARC Cache Limit: {arcPercent}% of RAM
                      </Label>
                      <Slider
                        value={[arcPercent]}
                        onValueChange={([value]) => setArcPercent(value)}
                        min={10}
                        max={90}
                        step={5}
                        disabled={!enableZfsTuning}
                      />
                      <p className="text-xs text-muted-foreground">
                        Higher values improve read performance but use more memory
                      </p>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="enable-prefetch"
                        checked={enablePrefetch}
                        onCheckedChange={(checked) => setEnablePrefetch(!!checked)}
                        disabled={!enableZfsTuning}
                      />
                      <Label htmlFor="enable-prefetch" className="text-sm">
                        Enable prefetch (good for sequential reads)
                      </Label>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="nfs-tuning"
                        checked={enableNfsTuning}
                        onCheckedChange={(checked) => setEnableNfsTuning(!!checked)}
                        disabled={!enableZfsTuning}
                      />
                      <Label htmlFor="nfs-tuning" className="text-sm">
                        NFS server tuning (16 threads)
                      </Label>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
              
              {/* Service User */}
              <div className="flex items-center space-x-2 pt-4 border-t">
                <Checkbox
                  id="create-user"
                  checked={createUser}
                  onCheckedChange={(checked) => setCreateUser(!!checked)}
                />
                <Label htmlFor="create-user">Create service user with sudo access</Label>
              </div>
              
              {createUser && (
                <div className="space-y-2 pl-6">
                  <Label className="text-xs text-muted-foreground">Username</Label>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="zfsadmin"
                    className="max-w-xs"
                  />
                </div>
              )}
              
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="deploy-key"
                  checked={deployKey}
                  onCheckedChange={(checked) => setDeployKey(!!checked)}
                  disabled={!selectedSshKeyId}
                />
                <Label htmlFor="deploy-key">
                  Deploy SSH key to authorized_keys
                  {!selectedSshKeyId && (
                    <span className="text-muted-foreground ml-2">(select key in Step 3)</span>
                  )}
                </Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="install-health-script"
                  checked={installHealthScript}
                  onCheckedChange={(checked) => setInstallHealthScript(!!checked)}
                />
                <Label htmlFor="install-health-script" className="flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Install health check script (/usr/local/bin/zfs-health-check)
                </Label>
              </div>
            </div>
          )}
          
          {/* Step 5: Clean */}
          {currentStep === 5 && (
            <div className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Cleaning ensures each cloned VM gets unique identifiers. This is critical for proper network operation.
                </AlertDescription>
              </Alert>
              
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="clear-machine-id"
                    checked={clearMachineId}
                    onCheckedChange={(checked) => setClearMachineId(!!checked)}
                  />
                  <div>
                    <Label htmlFor="clear-machine-id">Clear machine-id</Label>
                    <p className="text-xs text-muted-foreground">
                      Removes /etc/machine-id so a new one is generated on first boot
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="clear-ssh-keys"
                    checked={clearSshHostKeys}
                    onCheckedChange={(checked) => setClearSshHostKeys(!!checked)}
                  />
                  <div>
                    <Label htmlFor="clear-ssh-keys">Clear SSH host keys</Label>
                    <p className="text-xs text-muted-foreground">
                      Removes /etc/ssh/ssh_host_* so new unique keys are generated
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="clean-cloud-init"
                    checked={cleanCloudInit}
                    onCheckedChange={(checked) => setCleanCloudInit(!!checked)}
                  />
                  <div>
                    <Label htmlFor="clean-cloud-init">Clean cloud-init state</Label>
                    <p className="text-xs text-muted-foreground">
                      Removes cloud-init artifacts for fresh initialization on clone
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="clean-network"
                    checked={cleanNetwork}
                    onCheckedChange={(checked) => setCleanNetwork(!!checked)}
                  />
                  <div>
                    <Label htmlFor="clean-network" className="flex items-center gap-2">
                      <Network className="h-4 w-4" />
                      Clean network state
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Removes DHCP leases, persistent net rules, and NetworkManager connections
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Step 6: Convert */}
          {currentStep === 6 && (
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="rollback-snapshot"
                    checked={createRollbackSnapshot}
                    onCheckedChange={(checked) => setCreateRollbackSnapshot(!!checked)}
                  />
                  <div>
                    <Label htmlFor="rollback-snapshot" className="flex items-center gap-2">
                      <Camera className="h-4 w-4" />
                      Create rollback snapshot before changes
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Creates a VMware snapshot before modifications (allows reverting)
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="power-off"
                    checked={powerOffFirst}
                    onCheckedChange={(checked) => setPowerOffFirst(!!checked)}
                  />
                  <div>
                    <Label htmlFor="power-off">Power off VM before conversion</Label>
                    <p className="text-xs text-muted-foreground">
                      VM must be powered off to convert to template
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="convert-template"
                    checked={convertToTemplate}
                    onCheckedChange={(checked) => setConvertToTemplate(!!checked)}
                  />
                  <div>
                    <Label htmlFor="convert-template">Convert to VMware template</Label>
                    <p className="text-xs text-muted-foreground">
                      Mark as template for efficient cloning. Uncheck to keep as VM.
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Summary */}
              <div className="p-4 rounded-lg border bg-muted/30 space-y-2 mt-4">
                <h4 className="font-medium text-sm">Summary</h4>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Template Name:</span>
                    <span>{templateName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Version:</span>
                    <Badge variant="secondary" className="text-xs">{templateVersion}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Source VM:</span>
                    <span>{selectedVM?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Packages:</span>
                    <span>{selectedPackages.length} selected</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ZFS Tuning:</span>
                    <span>{enableZfsTuning ? `ARC ${arcPercent}%` : 'Disabled'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Service User:</span>
                    <span>{createUser ? username : 'Not creating'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rollback Snapshot:</span>
                    <span>{createRollbackSnapshot ? 'Yes' : 'No'}</span>
                  </div>
                </div>
              </div>
              
              {/* Job status */}
              {jobId && (
                <div className="p-4 rounded-lg border space-y-3">
                  <div className="flex items-center gap-2">
                    {isJobRunning ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : isJobComplete ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    )}
                    <span className="font-medium">
                      {isJobRunning ? 'Preparing template...' : 
                       isJobComplete ? 'Template ready!' : 
                       'Preparation failed'}
                    </span>
                  </div>
                  {isJobRunning && (
                    <Progress value={jobProgress} className="h-2" />
                  )}
                </div>
              )}
              
              {!jobId && (
                <Button 
                  onClick={startPreparation} 
                  className="w-full"
                  disabled={!canProceedFromStep(5)}
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Start Template Preparation
                </Button>
              )}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <DialogFooter className="border-t pt-4">
          <div className="flex justify-between w-full">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={currentStep === 1 || isJobRunning}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {isJobComplete ? 'Close' : 'Cancel'}
              </Button>
              {currentStep < 6 && (
                <Button
                  onClick={handleNext}
                  disabled={!canProceedFromStep(currentStep)}
                >
                  Next
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
