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
  Calendar,
  Layers,
  Download,
  Trash2,
} from "lucide-react";
import { useVCenters } from "@/hooks/useVCenters";
import { useVCenterVMs } from "@/hooks/useVCenterVMs";
import { useSshKeys } from "@/hooks/useSshKeys";
import { useProtectionGroups } from "@/hooks/useReplication";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";

// Schedule presets with cron and RPO mappings
const SCHEDULE_PRESETS = {
  every_15m: { label: '15 min', cron: '*/15 * * * *', rpoMinutes: 15 },
  hourly: { label: '1 hour', cron: '0 * * * *', rpoMinutes: 60 },
  every_4h: { label: '4 hours', cron: '0 */4 * * *', rpoMinutes: 240 },
  daily: { label: 'Daily', cron: '0 0 * * *', rpoMinutes: 1440 },
  custom: { label: 'Custom', cron: '', rpoMinutes: 0 },
} as const;

type SchedulePreset = keyof typeof SCHEDULE_PRESETS;

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
  
  // Phase 5: Enhanced configuration
  const [zfsCompression, setZfsCompression] = useState<'lz4' | 'zstd' | 'off'>('lz4');
  const [datastoreName, setDatastoreName] = useState("");
  const [detectedDisks, setDetectedDisks] = useState<Array<{ device: string; size: string; type: string }>>([]);
  const [selectedDisk, setSelectedDisk] = useState("");
  const [detectingDisks, setDetectingDisks] = useState(false);
  const [diskDetectionDone, setDiskDetectionDone] = useState(false);
  
  // Phase 6: Enhanced Finalization options
  const [protectionGroupOption, setProtectionGroupOption] = useState<'new' | 'existing' | 'skip'>('skip');
  const [existingProtectionGroupId, setExistingProtectionGroupId] = useState("");
  const [protectionGroupDescription, setProtectionGroupDescription] = useState("");
  const [vmsToProtect, setVmsToProtect] = useState<string[]>([]);
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>('hourly');
  const [customCron, setCustomCron] = useState("0 * * * *");
  
  // Legacy state - kept for backward compatibility
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
  
  // Phase 7: UX Polish - Recovery state
  const [retryingStep, setRetryingStep] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackStatus, setRollbackStatus] = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  
  // Fetch VMs from selected vCenter
  const { data: vms = [], isLoading: vmsLoading, clusters = [] } = useVCenterVMs(selectedVCenterId || undefined);
  
  // Fetch SSH keys
  const { sshKeys = [], isLoading: sshKeysLoading, generateKey } = useSshKeys();
  
  // Fetch existing protection groups
  const { groups: existingProtectionGroups = [], loading: groupsLoading } = useProtectionGroups();
  
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
      // Phase 5 resets
      setZfsCompression('lz4');
      setDatastoreName("");
      setDetectedDisks([]);
      setSelectedDisk("");
      setDetectingDisks(false);
      setDiskDetectionDone(false);
      // Phase 6 resets
      setProtectionGroupOption('skip');
      setExistingProtectionGroupId("");
      setProtectionGroupDescription("");
      setVmsToProtect([]);
      setSchedulePreset('hourly');
      setCustomCron("0 * * * *");
      // Phase 7 resets
      setRetryingStep(null);
      setRollingBack(false);
      setRollbackStatus('idle');
    }
  }, [open, preselectedVCenterId, preselectedVMId]);
  
  // Auto-populate target name from VM
  useEffect(() => {
    if (selectedVM && !targetName) {
      const generatedName = `zfs-${selectedVM.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      setTargetName(generatedName);
      setDatastoreName(`NFS-${generatedName}`);
    }
  }, [selectedVM, targetName]);
  
  // Auto-update datastore name when target name changes
  useEffect(() => {
    if (targetName && !datastoreName.startsWith('NFS-')) {
      setDatastoreName(`NFS-${targetName}`);
    }
  }, [targetName, datastoreName]);
  
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
            // Phase 5: Enhanced configuration
            zfs_compression: zfsCompression,
            zfs_disk: selectedDisk || undefined,
            datastore_name: datastoreName,
            // Phase 6: Enhanced Finalization
            protection_group_option: protectionGroupOption,
            existing_protection_group_id: protectionGroupOption === 'existing' ? existingProtectionGroupId : undefined,
            protection_group_name: protectionGroupOption === 'new' ? protectionGroupName : undefined,
            protection_group_description: protectionGroupOption === 'new' ? protectionGroupDescription : undefined,
            vms_to_protect: protectionGroupOption !== 'skip' ? vmsToProtect : undefined,
            replication_schedule: protectionGroupOption !== 'skip' 
              ? (schedulePreset === 'custom' ? customCron : SCHEDULE_PRESETS[schedulePreset].cron)
              : undefined,
            rpo_minutes: protectionGroupOption !== 'skip' 
              ? (schedulePreset === 'custom' ? 60 : SCHEDULE_PRESETS[schedulePreset].rpoMinutes)
              : undefined,
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
  
  // Phase 5: Detect available disks
  const handleDetectDisks = async () => {
    if (!selectedVM?.ip_address) {
      toast({ title: 'VM has no IP address', variant: 'destructive' });
      return;
    }
    
    setDetectingDisks(true);
    setDetectedDisks([]);
    
    try {
      const { data: user } = await supabase.auth.getUser();
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'detect_disks' as unknown as 'onboard_zfs_target',
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
          const details = jobResult.details as Record<string, unknown>;
          const disks = (details?.detected_disks || []) as Array<{ device: string; size: string; type: string }>;
          setDetectedDisks(disks);
          setDiskDetectionDone(true);
          setDetectingDisks(false);
          if (disks.length > 0) {
            setSelectedDisk(disks[0].device);
            toast({ title: `Found ${disks.length} available disk(s)` });
          } else {
            toast({ title: 'No unmounted disks found', variant: 'destructive' });
          }
        } else if (jobResult?.status === 'failed' || attempts >= 15) {
          clearInterval(pollInterval);
          setDetectingDisks(false);
          setDiskDetectionDone(true);
          toast({ 
            title: 'Disk detection failed', 
            description: (jobResult?.details as Record<string, unknown>)?.error as string || 'Connection timeout',
            variant: 'destructive' 
          });
        }
      }, 2000);
    } catch (err) {
      setDetectingDisks(false);
      toast({ 
        title: 'Failed to detect disks', 
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive' 
      });
    }
  };
  
  // Phase 7: Export console log to file
  const handleExportLog = useCallback(() => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const content = [
      `ZFS Target Onboarding Log`,
      `========================`,
      `Target: ${targetName}`,
      `Job ID: ${jobId || 'N/A'}`,
      `VM: ${selectedVM?.name || 'N/A'} (${selectedVM?.ip_address || 'No IP'})`,
      `Status: ${jobStatus}`,
      `Exported: ${new Date().toISOString()}`,
      ``,
      `Step Results:`,
      `-------------`,
      ...stepResults.map(r => `[${r.status.toUpperCase()}] ${STEP_LABELS[r.step] || r.step}: ${r.message}`),
      ``,
      `Console Log:`,
      `------------`,
      ...consoleLog
    ].join('\n');
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zfs-onboard-${targetName || 'unknown'}-${timestamp}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast({ title: 'Log exported', description: `Downloaded ${a.download}` });
  }, [targetName, jobId, selectedVM, jobStatus, stepResults, consoleLog, toast]);
  
  // Phase 7: Retry a failed step
  const handleRetryStep = async (stepName: string) => {
    if (!jobId) return;
    
    setRetryingStep(stepName);
    
    try {
      const { data: user } = await supabase.auth.getUser();
      
      const { data: retryJob, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'retry_onboard_step' as unknown as 'onboard_zfs_target',
          status: 'pending',
          created_by: user?.user?.id,
          details: {
            original_job_id: jobId,
            from_step: stepName,
            target_name: targetName,
            vm_ip: vmIp || selectedVM?.ip_address,
            auth_method: authMethod,
            ssh_key_id: authMethod === 'existing_key' ? selectedSshKeyId : undefined,
            root_password: authMethod === 'password' ? rootPassword : undefined,
            zfs_pool_name: zfsPoolName,
            nfs_network: nfsNetwork,
            zfs_compression: zfsCompression,
            zfs_disk: selectedDisk || undefined,
            datastore_name: datastoreName,
          }
        })
        .select()
        .single();
      
      if (error) throw error;
      
      toast({ title: 'Retrying step', description: `Re-running from ${STEP_LABELS[stepName] || stepName}...` });
      
      // Poll for result
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        const { data: jobResult } = await supabase
          .from('jobs')
          .select('status, details')
          .eq('id', retryJob.id)
          .single();
        
        if (jobResult?.status === 'completed') {
          clearInterval(pollInterval);
          setRetryingStep(null);
          // Update step results to show success
          setStepResults(prev => prev.map(r => 
            r.step === stepName ? { ...r, status: 'success' as StepStatus, message: 'Retry successful' } : r
          ));
          toast({ title: 'Retry successful', description: `${STEP_LABELS[stepName] || stepName} completed` });
        } else if (jobResult?.status === 'failed' || attempts >= 30) {
          clearInterval(pollInterval);
          setRetryingStep(null);
          toast({ 
            title: 'Retry failed', 
            description: (jobResult?.details as Record<string, unknown>)?.error as string || 'Retry timeout',
            variant: 'destructive' 
          });
        }
      }, 2000);
    } catch (err) {
      setRetryingStep(null);
      toast({ 
        title: 'Failed to retry step', 
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive' 
      });
    }
  };
  
  // Phase 7: Rollback/cleanup partial configuration
  const handleRollback = async () => {
    if (!jobId) return;
    
    setRollingBack(true);
    setRollbackStatus('running');
    
    try {
      const { data: user } = await supabase.auth.getUser();
      
      const { data: rollbackJob, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'rollback_zfs_onboard' as unknown as 'onboard_zfs_target',
          status: 'pending',
          created_by: user?.user?.id,
          details: {
            original_job_id: jobId,
            target_name: targetName,
            vm_ip: vmIp || selectedVM?.ip_address,
            auth_method: authMethod,
            ssh_key_id: authMethod === 'existing_key' ? selectedSshKeyId : undefined,
            root_password: authMethod === 'password' ? rootPassword : undefined,
            zfs_pool_name: zfsPoolName,
            datastore_name: datastoreName,
          }
        })
        .select()
        .single();
      
      if (error) throw error;
      
      toast({ title: 'Cleanup started', description: 'Removing partial configuration...' });
      
      // Poll for result
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        const { data: jobResult } = await supabase
          .from('jobs')
          .select('status, details')
          .eq('id', rollbackJob.id)
          .single();
        
        if (jobResult?.status === 'completed') {
          clearInterval(pollInterval);
          setRollingBack(false);
          setRollbackStatus('success');
          toast({ title: 'Cleanup complete', description: 'Partial configuration has been removed' });
        } else if (jobResult?.status === 'failed' || attempts >= 30) {
          clearInterval(pollInterval);
          setRollingBack(false);
          setRollbackStatus('failed');
          toast({ 
            title: 'Cleanup failed', 
            description: (jobResult?.details as Record<string, unknown>)?.error as string || 'Cleanup timeout',
            variant: 'destructive' 
          });
        }
      }, 2000);
    } catch (err) {
      setRollingBack(false);
      setRollbackStatus('failed');
      toast({ 
        title: 'Failed to start cleanup', 
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive' 
      });
    }
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
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
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
              
              {/* Phase 5: Reorganized Configuration Sections - Two Column Layout */}
              <div className="pt-4 border-t">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left Column: ZFS & NFS Configuration */}
                  <div className="space-y-4">
                    {/* ZFS Configuration */}
                    <Collapsible defaultOpen className="space-y-2">
                      <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors w-full">
                        <HardDrive className="h-4 w-4" />
                        ZFS Configuration
                        <ChevronDown className="h-4 w-4 ml-auto" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-3 pl-6">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Pool Name</Label>
                          <Input
                            value={zfsPoolName}
                            onChange={(e) => setZfsPoolName(e.target.value)}
                            placeholder="tank"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Compression</Label>
                          <Select value={zfsCompression} onValueChange={(v) => setZfsCompression(v as 'lz4' | 'zstd' | 'off')}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="lz4">LZ4 (fast, default)</SelectItem>
                              <SelectItem value="zstd">ZSTD (better compression)</SelectItem>
                              <SelectItem value="off">Off (no compression)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        
                        {/* Disk Detection - only show after SSH test passes */}
                        {sshTestResult === 'success' && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Label className="text-xs text-muted-foreground">Target Disk</Label>
                              {!diskDetectionDone && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={handleDetectDisks}
                                  disabled={detectingDisks}
                                  className="h-6 text-xs"
                                >
                                  {detectingDisks ? (
                                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  ) : (
                                    <RefreshCw className="h-3 w-3 mr-1" />
                                  )}
                                  Detect Disks
                                </Button>
                              )}
                            </div>
                            
                            {detectedDisks.length > 0 ? (
                              <Select value={selectedDisk} onValueChange={setSelectedDisk}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select disk" />
                                </SelectTrigger>
                                <SelectContent>
                                  {detectedDisks.map((disk) => (
                                    <SelectItem key={disk.device} value={disk.device}>
                                      <div className="flex items-center gap-2">
                                        <HardDrive className="h-3 w-3" />
                                        <span className="font-mono">{disk.device}</span>
                                        <span className="text-muted-foreground">({disk.size})</span>
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : diskDetectionDone ? (
                              <p className="text-xs text-muted-foreground">
                                No disks found. Will auto-detect during setup.
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Click "Detect Disks" to find available disks, or leave empty for auto-detection.
                              </p>
                            )}
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                    
                    {/* NFS Configuration */}
                    <Collapsible defaultOpen className="space-y-2">
                      <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors w-full">
                        <Shield className="h-4 w-4" />
                        NFS Configuration
                        <ChevronDown className="h-4 w-4 ml-auto" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-3 pl-6">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Allowed Network (CIDR)</Label>
                          <Input
                            value={nfsNetwork}
                            onChange={(e) => setNfsNetwork(e.target.value)}
                            placeholder="10.0.0.0/8"
                          />
                          <p className="text-xs text-muted-foreground">
                            Hosts in this network can mount the NFS share
                          </p>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                    
                    {/* vCenter Integration */}
                    <Collapsible defaultOpen className="space-y-2">
                      <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors w-full">
                        <Server className="h-4 w-4" />
                        vCenter Integration
                        <ChevronDown className="h-4 w-4 ml-auto" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-3 pl-6">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Datastore Name</Label>
                          <Input
                            value={datastoreName}
                            onChange={(e) => setDatastoreName(e.target.value)}
                            placeholder={`NFS-${targetName || 'target'}`}
                          />
                          <p className="text-xs text-muted-foreground">
                            This name will appear in vCenter as an NFS datastore
                          </p>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                    
                    {/* Advanced Options */}
                    <Collapsible className="space-y-2">
                      <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors w-full">
                        <Settings className="h-4 w-4" />
                        Advanced Options
                        <ChevronRight className="h-4 w-4 ml-auto" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-2 pl-6">
                        <div className="flex items-center gap-2">
                          <Checkbox 
                            id="install-packages" 
                            checked={installPackages} 
                            onCheckedChange={(c) => setInstallPackages(!!c)} 
                          />
                          <Label htmlFor="install-packages" className="text-sm">Install ZFS & NFS packages</Label>
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
                          <Label htmlFor="reset-machine-id" className="text-sm">Reset machine-id (for clones)</Label>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                  
                  {/* Right Column: Replication & Protection */}
                  <div className="space-y-4">
                    {/* Phase 6: Replication & Protection */}
                    <Collapsible defaultOpen className="space-y-2">
                      <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors w-full">
                        <Layers className="h-4 w-4" />
                        Replication & Protection
                        <ChevronDown className="h-4 w-4 ml-auto" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-4 pl-6 pt-2">
                        {/* Protection Group Options */}
                        <div className="space-y-3">
                          <Label className="text-xs text-muted-foreground">Protection Group</Label>
                          <RadioGroup 
                            value={protectionGroupOption} 
                            onValueChange={(v) => setProtectionGroupOption(v as 'new' | 'existing' | 'skip')}
                            className="space-y-2"
                          >
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="skip" id="pg-skip" />
                              <Label htmlFor="pg-skip" className="text-sm cursor-pointer">Skip - configure later</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="new" id="pg-new" />
                              <Label htmlFor="pg-new" className="text-sm cursor-pointer">Create new protection group</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="existing" id="pg-existing" />
                              <Label htmlFor="pg-existing" className="text-sm cursor-pointer">Add to existing group</Label>
                            </div>
                          </RadioGroup>
                          
                          {/* New Protection Group Fields */}
                          {protectionGroupOption === 'new' && (
                            <div className="space-y-3 pt-2 border-t border-border/50">
                              <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground">Group Name</Label>
                                <Input
                                  value={protectionGroupName}
                                  onChange={(e) => setProtectionGroupName(e.target.value)}
                                  placeholder={`${targetName}-protection`}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground">Description (optional)</Label>
                                <Textarea
                                  value={protectionGroupDescription}
                                  onChange={(e) => setProtectionGroupDescription(e.target.value)}
                                  placeholder="Protection group for DR replication"
                                  className="h-16 resize-none"
                                />
                              </div>
                            </div>
                          )}
                          
                          {/* Existing Protection Group Selector */}
                          {protectionGroupOption === 'existing' && (
                            <div className="space-y-2 pt-2 border-t border-border/50">
                              <Label className="text-xs text-muted-foreground">Select Existing Group</Label>
                              <Select 
                                value={existingProtectionGroupId} 
                                onValueChange={setExistingProtectionGroupId}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={groupsLoading ? "Loading..." : "Select protection group"} />
                                </SelectTrigger>
                                <SelectContent>
                                  {existingProtectionGroups
                                    .filter(g => !selectedVCenterId || g.source_vcenter_id === selectedVCenterId || !g.source_vcenter_id)
                                    .map((group) => (
                                      <SelectItem key={group.id} value={group.id}>
                                        <div className="flex items-center gap-2">
                                          <Shield className="h-3 w-3" />
                                          <span>{group.name}</span>
                                          {group.rpo_minutes && (
                                            <span className="text-xs text-muted-foreground">
                                              (RPO: {group.rpo_minutes}m)
                                            </span>
                                          )}
                                        </div>
                                      </SelectItem>
                                    ))}
                                  {existingProtectionGroups.length === 0 && (
                                    <SelectItem value="_none" disabled>
                                      No protection groups found
                                    </SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                        
                        {/* Replication Schedule - only show if not skipping */}
                        {protectionGroupOption !== 'skip' && (
                          <div className="space-y-3 pt-3 border-t border-border/50">
                            <Label className="text-xs text-muted-foreground">Replication Schedule</Label>
                            <div className="flex flex-wrap gap-2">
                              {(Object.keys(SCHEDULE_PRESETS) as SchedulePreset[]).map((preset) => (
                                <Button
                                  key={preset}
                                  type="button"
                                  variant={schedulePreset === preset ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => setSchedulePreset(preset)}
                                >
                                  <Calendar className="h-3 w-3 mr-1" />
                                  {SCHEDULE_PRESETS[preset].label}
                                </Button>
                              ))}
                            </div>
                            
                            {schedulePreset === 'custom' && (
                              <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground">Cron Expression</Label>
                                <Input
                                  value={customCron}
                                  onChange={(e) => setCustomCron(e.target.value)}
                                  placeholder="*/15 * * * *"
                                  className="font-mono text-xs"
                                />
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* VM Selection - only show if not skipping */}
                        {protectionGroupOption !== 'skip' && vms.length > 0 && (
                          <div className="space-y-3 pt-3 border-t border-border/50">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-muted-foreground">VMs to Protect</Label>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() => {
                                  if (vmsToProtect.length === vms.length) {
                                    setVmsToProtect([]);
                                  } else {
                                    setVmsToProtect(vms.map(v => v.id));
                                  }
                                }}
                              >
                                {vmsToProtect.length === vms.length ? 'Deselect all' : 'Select all'}
                              </Button>
                            </div>
                            <div className="max-h-32 overflow-y-auto space-y-1 rounded border border-border/50 p-2">
                              {vms.slice(0, 20).map((vm) => (
                                <div key={vm.id} className="flex items-center gap-2">
                                  <Checkbox
                                    id={`vm-${vm.id}`}
                                    checked={vmsToProtect.includes(vm.id)}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        setVmsToProtect([...vmsToProtect, vm.id]);
                                      } else {
                                        setVmsToProtect(vmsToProtect.filter(id => id !== vm.id));
                                      }
                                    }}
                                  />
                                  <Label htmlFor={`vm-${vm.id}`} className="text-xs cursor-pointer flex items-center gap-1">
                                    {vm.power_state === 'poweredOn' ? (
                                      <Power className="h-3 w-3 text-green-500" />
                                    ) : (
                                      <PowerOff className="h-3 w-3 text-muted-foreground" />
                                    )}
                                    {vm.name}
                                  </Label>
                                </div>
                              ))}
                              {vms.length > 20 && (
                                <p className="text-xs text-muted-foreground pt-1 border-t">
                                  + {vms.length - 20} more VMs (configure in protection group settings)
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                    
                    {/* Summary Card - only show when required fields are filled */}
                    {targetName && selectedVM && (
                      <div className="p-3 rounded-lg border border-border bg-muted/30">
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium">Setup Summary</span>
                        </div>
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Target:</span>
                            <span className="font-medium">{targetName}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">VM:</span>
                            <span>{selectedVM.name} ({selectedVM.ip_address || 'No IP'})</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">ZFS Pool:</span>
                            <span>{zfsPoolName} ({zfsCompression} compression)</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Datastore:</span>
                            <span>{datastoreName || `NFS-${targetName}`}</span>
                          </div>
                          {protectionGroupOption !== 'skip' && (
                            <>
                              <div className="flex justify-between pt-1 border-t border-border/50 mt-1">
                                <span className="text-muted-foreground">Protection:</span>
                                <span>
                                  {protectionGroupOption === 'new' 
                                    ? (protectionGroupName || 'New group')
                                    : existingProtectionGroups.find(g => g.id === existingProtectionGroupId)?.name || 'Existing group'
                                  }
                                  {vmsToProtect.length > 0 && ` (${vmsToProtect.length} VMs)`}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Schedule:</span>
                                <span>
                                  {schedulePreset === 'custom' 
                                    ? `Custom (${customCron})`
                                    : `${SCHEDULE_PRESETS[schedulePreset].label} (RPO: ${SCHEDULE_PRESETS[schedulePreset].rpoMinutes}m)`
                                  }
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
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
              
              {/* Progress steps with retry buttons */}
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
                    {/* Phase 7: Retry button for failed steps */}
                    {result.status === 'failed' && !isJobRunning && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRetryStep(result.step)}
                        disabled={retryingStep !== null}
                        className="h-7 px-2"
                      >
                        {retryingStep === result.step ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        <span className="ml-1 text-xs">Retry</span>
                      </Button>
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
              
              {/* Progress steps with retry buttons */}
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
                    {/* Phase 7: Retry button for failed steps */}
                    {result.status === 'failed' && !isJobRunning && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRetryStep(result.step)}
                        disabled={retryingStep !== null}
                        className="h-7 px-2"
                      >
                        {retryingStep === result.step ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        <span className="ml-1 text-xs">Retry</span>
                      </Button>
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
                <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 space-y-4">
                  <div className="flex items-center gap-2 text-destructive">
                    <XCircle className="h-5 w-5" />
                    <span className="font-medium">Setup Failed</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Check the console log for details. You can retry individual failed steps or clean up partial configuration.
                  </p>
                  
                  {/* Phase 7: Rollback/Cleanup option */}
                  <div className="pt-3 border-t border-destructive/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Clean Up Partial Configuration?</p>
                        <p className="text-xs text-muted-foreground">
                          Remove any partially created ZFS pool, NFS exports, and datastore registration.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRollback}
                        disabled={rollingBack || rollbackStatus === 'success'}
                      >
                        {rollingBack ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : rollbackStatus === 'success' ? (
                          <Check className="h-4 w-4 mr-2 text-green-500" />
                        ) : (
                          <Trash2 className="h-4 w-4 mr-2" />
                        )}
                        {rollbackStatus === 'success' ? 'Cleaned Up' : 'Clean Up'}
                      </Button>
                    </div>
                  </div>
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
          
          {/* Console log with Export button */}
          {consoleLog.length > 0 && (
            <Collapsible open={showConsole} onOpenChange={setShowConsole} className="mt-4">
              <div className="flex items-center gap-2">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="flex-1 justify-between">
                    <span className="flex items-center gap-2">
                      <Terminal className="h-4 w-4" />
                      Console Log ({consoleLog.length} entries)
                    </span>
                    {showConsole ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
                {/* Phase 7: Export Log button */}
                <Button variant="ghost" size="sm" onClick={handleExportLog} className="shrink-0">
                  <Download className="h-4 w-4 mr-1" />
                  Export
                </Button>
              </div>
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
