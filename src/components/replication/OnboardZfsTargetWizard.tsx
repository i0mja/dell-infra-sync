/**
 * Unified ZFS Target Onboarding Wizard
 * 
 * 6-Page wizard that handles the entire flow from VM selection to syncing data:
 * Page 1: Select Target (vCenter, VM, name)
 * Page 2: SSH Authentication (key/password, test connection)
 * Page 3: Storage Configuration (ZFS pool, compression, disk, NFS)
 * Page 4: vCenter Integration (datastore name, advanced options)
 * Page 5: Protection (optional - protection group, schedule, VMs)
 * Page 6: Review & Deploy (summary, start setup, progress)
 */

import { useState, useEffect, useCallback, useMemo } from "react";
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
import { VMMultiSelectList } from "./VMMultiSelectList";
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
  Download,
  Trash2,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { useVCenters } from "@/hooks/useVCenters";
import { useVCenterVMs } from "@/hooks/useVCenterVMs";
import { useSshKeys } from "@/hooks/useSshKeys";
import { useProtectionGroups } from "@/hooks/useReplication";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";

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

// 6-page wizard structure
const WIZARD_PAGES = [
  { id: 1, label: 'Target', icon: Server },
  { id: 2, label: 'SSH', icon: Key },
  { id: 3, label: 'Storage', icon: HardDrive },
  { id: 4, label: 'vCenter', icon: Plug },
  { id: 5, label: 'Protect', icon: Shield },
  { id: 6, label: 'Deploy', icon: CheckCircle2 },
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
  const queryClient = useQueryClient();
  const { vcenters, loading: vcentersLoading } = useVCenters();
  
  // Wizard state - 6 pages
  const [currentPage, setCurrentPage] = useState(1);
  const [jobId, setJobId] = useState<string | null>(null);
  
  // Page 1: Selection
  const [selectedVCenterId, setSelectedVCenterId] = useState(preselectedVCenterId || "");
  const [selectedVMId, setSelectedVMId] = useState(preselectedVMId || "");
  const [targetName, setTargetName] = useState("");
  
  // Page 2: Authentication
  const [authMethod, setAuthMethod] = useState<'existing_key' | 'generate_key' | 'password'>('existing_key');
  const [selectedSshKeyId, setSelectedSshKeyId] = useState("");
  const [rootPassword, setRootPassword] = useState("");
  const [testingSsh, setTestingSsh] = useState(false);
  const [sshTestResult, setSshTestResult] = useState<'success' | 'failed' | null>(null);
  const [copiedPublicKey, setCopiedPublicKey] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [newGeneratedKeyId, setNewGeneratedKeyId] = useState<string | null>(null);
  
  // Page 3: Storage Configuration
  const [zfsPoolName, setZfsPoolName] = useState("tank");
  const [zfsCompression, setZfsCompression] = useState<'lz4' | 'zstd' | 'off'>('lz4');
  const [nfsNetwork, setNfsNetwork] = useState("10.0.0.0/8");
  const [detectedDisks, setDetectedDisks] = useState<Array<{ device: string; size: string; type: string }>>([]);
  const [selectedDisk, setSelectedDisk] = useState("");
  const [detectingDisks, setDetectingDisks] = useState(false);
  const [diskDetectionDone, setDiskDetectionDone] = useState(false);
  
  // Page 4: vCenter Integration
  const [datastoreName, setDatastoreName] = useState("");
  const [installPackages, setInstallPackages] = useState(true);
  const [createUser, setCreateUser] = useState(true);
  const [resetMachineId, setResetMachineId] = useState(false);
  
  // Page 5: Protection
  const [protectionGroupOption, setProtectionGroupOption] = useState<'new' | 'existing' | 'skip'>('skip');
  const [protectionGroupName, setProtectionGroupName] = useState("");
  const [existingProtectionGroupId, setExistingProtectionGroupId] = useState("");
  const [protectionGroupDescription, setProtectionGroupDescription] = useState("");
  const [vmsToProtect, setVmsToProtect] = useState<string[]>([]);
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>('hourly');
  const [customCron, setCustomCron] = useState("0 * * * *");
  
  // Page 6: Job execution state
  const [jobStatus, setJobStatus] = useState<string>('');
  const [stepResults, setStepResults] = useState<StepResult[]>([]);
  const [progressPercent, setProgressPercent] = useState(0);
  const [consoleLog, setConsoleLog] = useState<string[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [vmState, setVmState] = useState<string>('');
  const [vmIp, setVmIp] = useState<string>('');
  const [needsRootPassword, setNeedsRootPassword] = useState(false);
  
  // Recovery state
  const [retryingStep, setRetryingStep] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackStatus, setRollbackStatus] = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  
  // Clear VM cache when vCenter changes
  useEffect(() => {
    if (selectedVCenterId) {
      queryClient.invalidateQueries({ queryKey: ['vcenter-vms', selectedVCenterId] });
    }
  }, [selectedVCenterId, queryClient]);
  
  // Fetch VMs from selected vCenter
  const { data: vms = [], isLoading: vmsLoading, clusters = [] } = useVCenterVMs(selectedVCenterId || undefined);
  
  // Fetch SSH keys
  const { sshKeys = [], isLoading: sshKeysLoading, generateKey } = useSshKeys();
  
  // Fetch existing protection groups
  const { groups: existingProtectionGroups = [], loading: groupsLoading } = useProtectionGroups();
  
  // Filter active SSH keys
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
  
  // Check for duplicate targets
  const { data: duplicateTargets = [] } = useQuery({
    queryKey: ['duplicate-target-check', selectedVMId, selectedVM?.ip_address, selectedVM?.name],
    queryFn: async () => {
      if (!selectedVM) return [];
      
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
  
  // Check OS compatibility
  const isOsCompatible = useMemo(() => {
    if (!selectedVM?.guest_os) return null;
    const os = selectedVM.guest_os.toLowerCase();
    return os.includes('debian') || os.includes('ubuntu') || os.includes('linux');
  }, [selectedVM?.guest_os]);
  
  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setCurrentPage(1);
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
      setZfsCompression('lz4');
      setZfsPoolName("tank");
      setNfsNetwork("10.0.0.0/8");
      setDatastoreName("");
      setDetectedDisks([]);
      setSelectedDisk("");
      setDetectingDisks(false);
      setDiskDetectionDone(false);
      setInstallPackages(true);
      setCreateUser(true);
      setResetMachineId(false);
      setProtectionGroupOption('skip');
      setProtectionGroupName("");
      setExistingProtectionGroupId("");
      setProtectionGroupDescription("");
      setVmsToProtect([]);
      setSchedulePreset('hourly');
      setCustomCron("0 * * * *");
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
    if (targetName && !datastoreName) {
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
      const results = details.step_results as StepResult[] | undefined;
      if (results) {
        const needsPwd = results.some(r => r.needs_root_password);
        setNeedsRootPassword(needsPwd);
      }
    }
    
    return job.status;
  }, [jobId]);
  
  // Polling effect
  useEffect(() => {
    if (!jobId) return;
    
    const interval = setInterval(async () => {
      const status = await pollJobStatus();
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        clearInterval(interval);
      }
    }, 2000);
    
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
            zfs_pool_name: zfsPoolName,
            nfs_network: nfsNetwork,
            zfs_compression: zfsCompression,
            zfs_disk: selectedDisk || undefined,
            datastore_name: datastoreName,
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
          }
        })
        .select()
        .single();
      
      if (error) throw error;
      
      setJobId(job.id);
      toast({ title: 'Onboarding started', description: 'Setting up your ZFS target...' });
    } catch (err) {
      toast({ 
        title: 'Failed to start onboarding', 
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive' 
      });
    }
  };
  
  // Submit root password
  const submitRootPassword = async () => {
    if (!jobId || !rootPassword) return;
    
    try {
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
  
  // Copy public key
  const handleCopyPublicKey = async () => {
    if (!selectedSshKey?.public_key) return;
    
    await navigator.clipboard.writeText(selectedSshKey.public_key);
    setCopiedPublicKey(true);
    toast({ title: 'Public key copied' });
    setTimeout(() => setCopiedPublicKey(false), 2000);
  };
  
  // Detect disks
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
  
  // Export log
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
  
  // Retry step
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
  
  // Rollback
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
  
  // Page validation
  const canProceedFromPage = (page: number): boolean => {
    switch (page) {
      case 1: 
        return !!selectedVCenterId && !!selectedVMId && !!targetName;
      case 2: 
        return authMethod === 'password' ? !!rootPassword : 
               authMethod === 'existing_key' ? !!selectedSshKeyId : 
               authMethod === 'generate_key' ? (!!newGeneratedKeyId || !!selectedSshKeyId) : false;
      case 3: 
        return !!zfsPoolName && !!nfsNetwork;
      case 4: 
        return !!datastoreName;
      case 5: 
        return true; // Optional page - can always proceed
      case 6: 
        return !isJobRunning;
      default: 
        return false;
    }
  };
  
  const isJobRunning = jobStatus === 'running' || jobStatus === 'pending';
  const isJobComplete = jobStatus === 'completed';
  const isJobFailed = jobStatus === 'failed';
  const hasStartedJob = !!jobId;
  
  // Navigation handlers
  const handleNext = () => {
    if (currentPage < 6 && canProceedFromPage(currentPage)) {
      setCurrentPage(currentPage + 1);
    }
  };
  
  const handleBack = () => {
    if (currentPage > 1 && !hasStartedJob) {
      setCurrentPage(currentPage - 1);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Add ZFS Replication Target
          </DialogTitle>
          <DialogDescription>
            Set up a VM as a ZFS replication target with automated configuration
          </DialogDescription>
        </DialogHeader>
        
        {/* Page indicator */}
        <div className="flex items-center justify-center gap-1 py-3 border-b shrink-0">
          {WIZARD_PAGES.map((page, index) => {
            const Icon = page.icon;
            const isActive = currentPage === page.id;
            const isComplete = currentPage > page.id || (isJobComplete && page.id <= 6);
            
            return (
              <div key={page.id} className="flex items-center">
                <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
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
                  <span className="hidden sm:inline">{page.label}</span>
                </div>
                {index < WIZARD_PAGES.length - 1 && (
                  <div className={`w-4 h-0.5 mx-0.5 ${
                    currentPage > page.id ? 'bg-green-500' : 'bg-border'
                  }`} />
                )}
              </div>
            );
          })}
        </div>
        
        {/* Page content - scrollable */}
        <div className="flex-1 overflow-y-auto px-1 py-4">
          {/* Page 1: Select Target */}
          {currentPage === 1 && (
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
              
              {/* VM Preview Card */}
              {selectedVM && (
                <div className="p-3 rounded-lg bg-muted/50 space-y-2 text-sm">
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
              )}
              
              {/* Warnings */}
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
              
              {isOsCompatible === false && (
                <div className="p-3 rounded-lg border border-orange-500/50 bg-orange-500/5">
                  <div className="flex items-start gap-2 text-orange-600 dark:text-orange-500">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <span className="font-medium">OS compatibility warning</span>
                      <p className="text-xs mt-0.5 opacity-80">
                        This wizard requires Debian/Ubuntu. Detected: {selectedVM?.guest_os}
                      </p>
                    </div>
                  </div>
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
            </div>
          )}
          
          {/* Page 2: SSH Authentication */}
          {currentPage === 2 && (
            <div className="space-y-4">
              <Label className="text-sm font-medium">SSH Authentication Method</Label>
              
              <RadioGroup 
                value={authMethod} 
                onValueChange={(v) => setAuthMethod(v as 'existing_key' | 'generate_key' | 'password')}
                className="space-y-3"
              >
                {/* Existing SSH Key */}
                <div className="flex items-start space-x-3 p-3 rounded-lg border bg-card">
                  <RadioGroupItem value="existing_key" id="auth-existing" className="mt-1" />
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="auth-existing" className="text-sm cursor-pointer font-medium">
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
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Generate New Key */}
                <div className="flex items-start space-x-3 p-3 rounded-lg border bg-card">
                  <RadioGroupItem value="generate_key" id="auth-generate" className="mt-1" />
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="auth-generate" className="text-sm cursor-pointer font-medium">
                      Generate new SSH key
                    </Label>
                    
                    {authMethod === 'generate_key' && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          A new keypair will be generated and saved.
                        </p>
                        <div className="flex items-center gap-2">
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
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Password Auth */}
                <div className="flex items-start space-x-3 p-3 rounded-lg border bg-card">
                  <RadioGroupItem value="password" id="auth-password" className="mt-1" />
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="auth-password" className="text-sm cursor-pointer font-medium">
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
              
              {/* Test SSH Connection */}
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
          )}
          
          {/* Page 3: Storage Configuration */}
          {currentPage === 3 && (
            <div className="space-y-4">
              <div className="space-y-4 p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <HardDrive className="h-4 w-4" />
                  ZFS Configuration
                </div>
                
                <div className="grid grid-cols-2 gap-4">
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
                </div>
                
                {/* Disk Detection */}
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
                              {disk.device} - {disk.size} ({disk.type})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : diskDetectionDone ? (
                      <p className="text-xs text-muted-foreground">
                        No available disks detected. Pool will be created on detected disks.
                      </p>
                    ) : null}
                  </div>
                )}
                
                {sshTestResult !== 'success' && (
                  <p className="text-xs text-muted-foreground">
                    Test SSH connection first to detect available disks.
                  </p>
                )}
              </div>
              
              <div className="space-y-4 p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Server className="h-4 w-4" />
                  NFS Configuration
                </div>
                
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Allowed Network (CIDR)</Label>
                  <Input
                    value={nfsNetwork}
                    onChange={(e) => setNfsNetwork(e.target.value)}
                    placeholder="10.0.0.0/8"
                  />
                  <p className="text-xs text-muted-foreground">
                    ESXi hosts in this network will have access to the NFS export
                  </p>
                </div>
              </div>
            </div>
          )}
          
          {/* Page 4: vCenter Integration */}
          {currentPage === 4 && (
            <div className="space-y-4">
              <div className="space-y-4 p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Plug className="h-4 w-4" />
                  Datastore Configuration
                </div>
                
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Datastore Name</Label>
                  <Input
                    value={datastoreName}
                    onChange={(e) => setDatastoreName(e.target.value)}
                    placeholder={`NFS-${targetName}`}
                  />
                  <p className="text-xs text-muted-foreground">
                    This NFS datastore will be added to your vCenter
                  </p>
                </div>
              </div>
              
              <div className="space-y-4 p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Settings className="h-4 w-4" />
                  Advanced Options
                </div>
                
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="install-packages"
                      checked={installPackages}
                      onCheckedChange={(c) => setInstallPackages(!!c)}
                    />
                    <Label htmlFor="install-packages" className="text-sm cursor-pointer">
                      Install ZFS & NFS packages
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="create-user"
                      checked={createUser}
                      onCheckedChange={(c) => setCreateUser(!!c)}
                    />
                    <Label htmlFor="create-user" className="text-sm cursor-pointer">
                      Create zfsadmin user
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="reset-machine-id"
                      checked={resetMachineId}
                      onCheckedChange={(c) => setResetMachineId(!!c)}
                    />
                    <Label htmlFor="reset-machine-id" className="text-sm cursor-pointer">
                      Reset machine-id (for cloned VMs)
                    </Label>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Page 5: Protection (Optional) */}
          {currentPage === 5 && (
            <div className="space-y-4">
              <div className="space-y-4 p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Shield className="h-4 w-4" />
                  Protection Group
                </div>
                
                <RadioGroup 
                  value={protectionGroupOption} 
                  onValueChange={(v) => setProtectionGroupOption(v as 'new' | 'existing' | 'skip')}
                  className="space-y-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="skip" id="pg-skip" />
                    <Label htmlFor="pg-skip" className="text-sm cursor-pointer">
                      Skip for now (configure later)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="new" id="pg-new" />
                    <Label htmlFor="pg-new" className="text-sm cursor-pointer">
                      Create new protection group
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="existing" id="pg-existing" />
                    <Label htmlFor="pg-existing" className="text-sm cursor-pointer">
                      Add to existing protection group
                    </Label>
                  </div>
                </RadioGroup>
                
                {protectionGroupOption === 'new' && (
                  <div className="space-y-3 pt-3 border-t">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Group Name</Label>
                      <Input
                        value={protectionGroupName}
                        onChange={(e) => setProtectionGroupName(e.target.value)}
                        placeholder="e.g., prod-web-servers"
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
                
                {protectionGroupOption === 'existing' && (
                  <div className="space-y-2 pt-3 border-t">
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
                              </div>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              
              {/* Replication Schedule */}
              {protectionGroupOption !== 'skip' && (
                <div className="space-y-4 p-4 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Calendar className="h-4 w-4" />
                    Replication Schedule
                  </div>
                  
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(SCHEDULE_PRESETS) as SchedulePreset[]).map((preset) => (
                      <Button
                        key={preset}
                        type="button"
                        variant={schedulePreset === preset ? 'default' : 'outline'}
                        size="sm"
                        className="h-8"
                        onClick={() => setSchedulePreset(preset)}
                      >
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
                        className="font-mono text-sm"
                      />
                    </div>
                  )}
                </div>
              )}
              
              {/* VM Selection */}
              {protectionGroupOption !== 'skip' && vms.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">VMs to Protect</Label>
                  <VMMultiSelectList
                    vms={vms}
                    clusters={clusters}
                    selectedVmIds={vmsToProtect}
                    onSelectionChange={setVmsToProtect}
                    maxHeight="h-64"
                  />
                </div>
              )}
            </div>
          )}
          
          {/* Page 6: Review & Deploy */}
          {currentPage === 6 && (
            <div className="space-y-4">
              {/* Summary Card */}
              {!hasStartedJob && (
                <div className="p-4 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Configuration Summary</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Target:</span>
                      <span className="font-medium">{targetName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">VM:</span>
                      <span>{selectedVM?.name} ({selectedVM?.ip_address || 'No IP'})</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">vCenter:</span>
                      <span>{vcenters.find(v => v.id === selectedVCenterId)?.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ZFS Pool:</span>
                      <span>{zfsPoolName} ({zfsCompression})</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Datastore:</span>
                      <span>{datastoreName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">NFS Network:</span>
                      <span>{nfsNetwork}</span>
                    </div>
                    {protectionGroupOption !== 'skip' && (
                      <div className="flex justify-between pt-2 border-t mt-2">
                        <span className="text-muted-foreground">Protection:</span>
                        <span>
                          {protectionGroupOption === 'new' 
                            ? (protectionGroupName || 'New group')
                            : existingProtectionGroups.find(g => g.id === existingProtectionGroupId)?.name || 'Existing group'
                          }
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {/* Job Status */}
              {hasStartedJob && (
                <>
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
                        Check the console log for details.
                      </p>
                      
                      <div className="pt-3 border-t border-destructive/20">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">Clean Up Partial Configuration?</p>
                            <p className="text-xs text-muted-foreground">
                              Remove any partially created ZFS pool and NFS exports.
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
                  
                  {/* Progress */}
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
                  
                  {/* Step Results */}
                  {stepResults.length > 0 && (
                    <div className="space-y-1">
                      {stepResults.map((result, index) => (
                        <div key={index} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30">
                          {getStatusIcon(result.status)}
                          <span className="flex-1 text-sm">
                            {STEP_LABELS[result.step] || result.step}
                          </span>
                          <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                            {result.message}
                          </span>
                          {result.status === 'failed' && !isJobRunning && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRetryStep(result.step)}
                              disabled={retryingStep !== null}
                              className="h-6 px-2"
                            >
                              {retryingStep === result.step ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3 w-3" />
                              )}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              
              {/* Console log */}
              {consoleLog.length > 0 && (
                <Collapsible open={showConsole} onOpenChange={setShowConsole}>
                  <div className="flex items-center gap-2">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="flex-1 justify-between">
                        <span className="flex items-center gap-2">
                          <Terminal className="h-4 w-4" />
                          Console Log ({consoleLog.length})
                        </span>
                        {showConsole ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                    </CollapsibleTrigger>
                    <Button variant="ghost" size="sm" onClick={handleExportLog} className="shrink-0">
                      <Download className="h-4 w-4 mr-1" />
                      Export
                    </Button>
                  </div>
                  <CollapsibleContent>
                    <div className="mt-2 p-3 rounded-lg bg-black text-green-400 font-mono text-xs max-h-32 overflow-y-auto">
                      {consoleLog.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </div>
        
        {/* Footer with navigation */}
        <DialogFooter className="flex justify-between items-center border-t pt-4 shrink-0">
          <Button 
            variant="outline" 
            onClick={handleBack} 
            disabled={currentPage === 1 || hasStartedJob}
            className={currentPage === 1 || hasStartedJob ? 'invisible' : ''}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {isJobComplete ? 'Close' : 'Cancel'}
            </Button>
            
            {currentPage < 6 && !hasStartedJob && (
              <Button onClick={handleNext} disabled={!canProceedFromPage(currentPage)}>
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}
            
            {currentPage === 6 && !hasStartedJob && (
              <Button onClick={startOnboarding} disabled={!canProceedFromPage(1) || !canProceedFromPage(2)}>
                <Play className="h-4 w-4 mr-2" />
                Start Setup
              </Button>
            )}
            
            {isJobRunning && (
              <Button disabled>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Setting up...
              </Button>
            )}
            
            {isJobComplete && (
              <Button onClick={() => onOpenChange(false)}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Done
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
