/**
 * Paired ZFS Target Deployment Wizard
 * 
 * Collects configuration for BOTH source and DR sites in one flow,
 * then deploys them in parallel.
 * 
 * Flow:
 * Page 1: Site Configuration (select vCenter + VM for source and DR)
 * Page 2: SSH Authentication (credentials for both sites)
 * Page 3: Storage Configuration (ZFS pool settings for both)
 * Page 4: Review & Deploy (parallel deployment with progress)
 */

import { useState, useEffect, useCallback } from "react";
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
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Server,
  Key,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Building2,
  Play,
  XCircle,
  RefreshCw,
  Copy,
  Clock,
  SkipForward,
  AlertTriangle,
  Terminal,
  ChevronDown,
  Power,
  PowerOff,
  Wand2,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VMCombobox } from "./VMCombobox";
import { ZfsApplianceSelector } from "./ZfsApplianceSelector";
import { PrepareTemplateWizard } from "./PrepareTemplateWizard";
import { ZfsTargetTemplate, useZfsTemplates } from "@/hooks/useZfsTemplates";
import { TemplateCloneConfig, CloneSettings } from "./TemplateCloneConfig";
import { useVCenters } from "@/hooks/useVCenters";
import { useVCenterVMs } from "@/hooks/useVCenterVMs";
import { useSshKeys } from "@/hooks/useSshKeys";
import { useQuickRefresh } from "@/hooks/useQuickRefresh";
import { RefreshIndicator } from "@/components/ui/RefreshIndicator";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { generateTargetNames, getVCenterSiteCodes } from "@/utils/targetNaming";

interface PairedZfsDeployWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (sourceTargetId: string, drTargetId: string) => void;
}

interface SiteConfig {
  vcenterId: string;
  vmId: string;
  targetName: string;
  zfsPool: string;
  nfsNetwork: string;
  compression: 'lz4' | 'zstd' | 'off';
  datastoreName: string;
  authMethod: 'existing_key' | 'password';
  sshKeyId: string;
  password: string;
  // Template support
  isTemplate: boolean;
  cloneSettings: CloneSettings;
  // Source mode
  sourceMode: 'library' | 'vcenter';
  selectedTemplate: ZfsTargetTemplate | null;
}

type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'warning' | 'skipped' | 'fixing' | 'fixed';

interface StepResult {
  step: string;
  status: StepStatus;
  message?: string;
  error?: string;
}

interface JobProgress {
  jobId: string | null;
  status: string;
  progress: number;
  currentStep: string;
  error?: string;
  stepResults: StepResult[];
  consoleLog: string[];
  vmState?: string;
  vmIp?: string;
  targetName?: string;
  clonedVmName?: string;
}

const STEP_LABELS: Record<string, string> = {
  vcenter: 'vCenter Connection',
  vm_state: 'VM State Detection',
  convert_to_vm: 'Convert to VM',
  clone_template: 'Clone Template',
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

const WIZARD_PAGES = [
  { id: 1, label: 'Sites', icon: Building2 },
  { id: 2, label: 'SSH', icon: Key },
  { id: 3, label: 'Storage', icon: HardDrive },
  { id: 4, label: 'Deploy', icon: CheckCircle2 },
];

const defaultCloneSettings = (): CloneSettings => ({
  cloneName: '',
  targetDatastore: '',
  targetCluster: '',
  useGuestCustomization: true,
  clearMachineId: true,
  clearSshHostKeys: true,
  useStaticIp: false,
  staticIp: '',
  staticNetmask: '',
  staticGateway: '',
  staticDns: '',
});

const defaultSiteConfig = (): SiteConfig => ({
  vcenterId: '',
  vmId: '',
  targetName: '',
  zfsPool: 'tank',
  nfsNetwork: '10.0.0.0/8',
  compression: 'lz4',
  datastoreName: '',
  authMethod: 'existing_key',
  sshKeyId: '',
  password: '',
  isTemplate: false,
  cloneSettings: defaultCloneSettings(),
  sourceMode: 'library',
  selectedTemplate: null,
});

export function PairedZfsDeployWizard({
  open,
  onOpenChange,
  onSuccess,
}: PairedZfsDeployWizardProps) {
  const { toast } = useToast();
  const { vcenters, loading: vcentersLoading } = useVCenters();
  const { sshKeys = [], isLoading: sshKeysLoading } = useSshKeys();
  
  const [currentPage, setCurrentPage] = useState(1);
  
  // Site configurations
  const [sourceConfig, setSourceConfig] = useState<SiteConfig>(defaultSiteConfig());
  const [drConfig, setDrConfig] = useState<SiteConfig>(defaultSiteConfig());
  
  // Track previous vCenter IDs to detect changes and regenerate names
  const [lastSourceVcenterId, setLastSourceVcenterId] = useState<string>('');
  const [lastDrVcenterId, setLastDrVcenterId] = useState<string>('');
  
  // Deployment state
  const defaultJobProgress = (): JobProgress => ({
    jobId: null, status: '', progress: 0, currentStep: '',
    stepResults: [], consoleLog: [], vmState: undefined, vmIp: undefined,
    targetName: undefined, clonedVmName: undefined,
  });
  const [sourceProgress, setSourceProgress] = useState<JobProgress>(defaultJobProgress());
  const [drProgress, setDrProgress] = useState<JobProgress>(defaultJobProgress());
  const [consoleOpen, setConsoleOpen] = useState<{ source: boolean; dr: boolean }>({ source: false, dr: false });
  const [deploying, setDeploying] = useState(false);
  const [deployComplete, setDeployComplete] = useState(false);
  
  // Fix Template wizard state
  const [showPrepareWizard, setShowPrepareWizard] = useState(false);
  const [prepareWizardConfig, setPrepareWizardConfig] = useState<{
    vcenterId: string;
    vmId: string;
    templateName: string;
    sshKeyId?: string;
    password?: string;
    errorMessage: string;
  } | null>(null);
  
  // Helper to detect disk signature errors
  const isDiskSignatureError = (error: string | undefined): boolean => {
    if (!error) return false;
    const patterns = [
      'in use',
      'unknown filesystem',
      'contains a',
      'wipefs',
      'zpool create.*failed',
    ];
    return patterns.some(p => error.toLowerCase().includes(p.toLowerCase()));
  };
  
  // Fetch VMs for each vCenter
  const { data: sourceVms = [], isLoading: sourceVmsLoading, clusters: sourceClusters = [] } = 
    useVCenterVMs(sourceConfig.vcenterId || undefined);
  const { data: drVms = [], isLoading: drVmsLoading, clusters: drClusters = [] } = 
    useVCenterVMs(drConfig.vcenterId || undefined);
  
  // Filter active SSH keys
  const activeSshKeys = sshKeys.filter(k => k.status === 'active');
  
  // Quick refresh for source and DR vCenters
  const sourceRefresh = useQuickRefresh(sourceConfig.vcenterId || null);
  const drRefresh = useQuickRefresh(drConfig.vcenterId || null);
  
  // Get VM details
  const sourceVm = sourceVms.find(vm => vm.id === sourceConfig.vmId);
  const drVm = drVms.find(vm => vm.id === drConfig.vmId);
  
  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setCurrentPage(1);
      setSourceConfig(defaultSiteConfig());
      setDrConfig(defaultSiteConfig());
      setSourceProgress(defaultJobProgress());
      setDrProgress(defaultJobProgress());
      setDeploying(false);
      setDeployComplete(false);
      setConsoleOpen({ source: false, dr: false });
      // Reset vCenter tracking so names regenerate fresh
      setLastSourceVcenterId('');
      setLastDrVcenterId('');
    }
  }, [open]);
  
  // Auto-refresh VMs when vCenter is selected
  useEffect(() => {
    if (open && sourceConfig.vcenterId) {
      sourceRefresh.triggerQuickRefresh(['vms', 'datastores']);
    }
  }, [open, sourceConfig.vcenterId]);
  
  useEffect(() => {
    if (open && drConfig.vcenterId) {
      drRefresh.triggerQuickRefresh(['vms', 'datastores']);
    }
  }, [open, drConfig.vcenterId]);
  
  // Auto-generate names and load default template when source vCenter is selected
  useEffect(() => {
    const initSourceConfig = async () => {
      if (!sourceConfig.vcenterId) return;
      
      const vCenterChanged = sourceConfig.vcenterId !== lastSourceVcenterId;
      
      // Update tracking
      if (vCenterChanged && sourceConfig.vcenterId) {
        setLastSourceVcenterId(sourceConfig.vcenterId);
      }
      
      const vcenter = vcenters.find(v => v.id === sourceConfig.vcenterId);
      
      // If vCenter has a default template, auto-select it (only on vCenter change or initial load)
      if (vcenter?.default_zfs_template_id && (!sourceConfig.vmId || vCenterChanged)) {
        try {
          const { data: template } = await supabase
            .from('zfs_target_templates')
            .select('template_moref, ssh_key_id, default_zfs_pool_name, default_nfs_network, default_cluster, default_datastore')
            .eq('id', vcenter.default_zfs_template_id)
            .single();
          
          if (template) {
            // Find VM with matching moref
            const templateVm = sourceVms.find(vm => vm.vcenter_id === template.template_moref);
            if (templateVm) {
              setSourceConfig(prev => ({
                ...prev,
                vmId: templateVm.id,
                authMethod: template.ssh_key_id ? 'existing_key' : 'password',
                sshKeyId: template.ssh_key_id || '',
                zfsPool: template.default_zfs_pool_name || 'tank',
                nfsNetwork: template.default_nfs_network || '10.0.0.0/8',
                cloneSettings: {
                  ...prev.cloneSettings,
                  targetCluster: template.default_cluster || '',
                  targetDatastore: template.default_datastore || '',
                },
              }));
              toast({ title: 'Gold image loaded', description: `Using default template for ${vcenter.name}` });
              // Continue to generate names below
            }
          }
        } catch (err) {
          console.error('Failed to load default template:', err);
        }
      }
      
      // Generate names if no targetName OR vCenter changed
      if (!sourceConfig.targetName || vCenterChanged) {
        const { siteCode, vmPrefix } = await getVCenterSiteCodes(sourceConfig.vcenterId);
        if (siteCode) {
          const { targetName, vmName, datastoreName } = await generateTargetNames(siteCode, vmPrefix || '');
          setSourceConfig(prev => ({
            ...prev,
            targetName,
            datastoreName,
            cloneSettings: { ...prev.cloneSettings, cloneName: vmName },
          }));
        }
      }
    };
    initSourceConfig();
  }, [sourceConfig.vcenterId, vcenters, sourceVms, lastSourceVcenterId]);
  
  // Auto-generate names and load default template when DR vCenter is selected
  useEffect(() => {
    const initDrConfig = async () => {
      if (!drConfig.vcenterId) return;
      
      const vCenterChanged = drConfig.vcenterId !== lastDrVcenterId;
      
      // Update tracking
      if (vCenterChanged && drConfig.vcenterId) {
        setLastDrVcenterId(drConfig.vcenterId);
      }
      
      const vcenter = vcenters.find(v => v.id === drConfig.vcenterId);
      
      // If vCenter has a default template, auto-select it (only on vCenter change or initial load)
      if (vcenter?.default_zfs_template_id && (!drConfig.vmId || vCenterChanged)) {
        try {
          const { data: template } = await supabase
            .from('zfs_target_templates')
            .select('template_moref, ssh_key_id, default_zfs_pool_name, default_nfs_network, default_cluster, default_datastore')
            .eq('id', vcenter.default_zfs_template_id)
            .single();
          
          if (template) {
            // Find VM with matching moref
            const templateVm = drVms.find(vm => vm.vcenter_id === template.template_moref);
            if (templateVm) {
              setDrConfig(prev => ({
                ...prev,
                vmId: templateVm.id,
                authMethod: template.ssh_key_id ? 'existing_key' : 'password',
                sshKeyId: template.ssh_key_id || '',
                zfsPool: template.default_zfs_pool_name || 'tank',
                nfsNetwork: template.default_nfs_network || '10.0.0.0/8',
                cloneSettings: {
                  ...prev.cloneSettings,
                  targetCluster: template.default_cluster || '',
                  targetDatastore: template.default_datastore || '',
                },
              }));
              // Continue to generate names below
            }
          }
        } catch (err) {
          console.error('Failed to load default template:', err);
        }
      }
      
      // Generate names if no targetName OR vCenter changed
      if (!drConfig.targetName || vCenterChanged) {
        const { siteCode, vmPrefix } = await getVCenterSiteCodes(drConfig.vcenterId);
        if (siteCode) {
          const { targetName, vmName, datastoreName } = await generateTargetNames(siteCode, vmPrefix || '');
          setDrConfig(prev => ({
            ...prev,
            targetName,
            datastoreName,
            cloneSettings: { ...prev.cloneSettings, cloneName: vmName },
          }));
        }
      }
    };
    initDrConfig();
  }, [drConfig.vcenterId, vcenters, drVms, lastDrVcenterId]);
  
  // Detect template mode for source VM
  useEffect(() => {
    if (sourceVm) {
      const isTemplate = sourceVm.is_template === true;
      setSourceConfig(prev => ({ 
        ...prev, 
        isTemplate,
        cloneSettings: isTemplate && !prev.cloneSettings.targetCluster ? {
          ...prev.cloneSettings,
          targetCluster: sourceVm.cluster_name || '',
        } : prev.cloneSettings,
      }));
    }
  }, [sourceVm]);
  
  // Detect template mode for DR VM
  useEffect(() => {
    if (drVm) {
      const isTemplate = drVm.is_template === true;
      setDrConfig(prev => ({ 
        ...prev, 
        isTemplate,
        cloneSettings: isTemplate && !prev.cloneSettings.targetCluster ? {
          ...prev.cloneSettings,
          targetCluster: drVm.cluster_name || '',
        } : prev.cloneSettings,
      }));
    }
  }, [drVm]);
  
  // Poll job status
  const pollJob = useCallback(async (
    jobId: string, 
    setProgress: React.Dispatch<React.SetStateAction<JobProgress>>
  ) => {
    const { data: job } = await supabase
      .from('jobs')
      .select('status, details')
      .eq('id', jobId)
      .single();
    
    if (!job) return null;
    
    const details = job.details as Record<string, unknown> | null;
    const stepResults = (details?.step_results || []) as StepResult[];
    const consoleLog = (details?.console_log || []) as string[];
    const currentStep = stepResults.find(r => r.status === 'running')?.step || 
                       stepResults[stepResults.length - 1]?.step || '';
    
    setProgress(prev => ({
      ...prev,
      status: job.status,
      progress: (details?.progress_percent as number) || 0,
      currentStep,
      error: job.status === 'failed' ? (details?.error as string) : undefined,
      stepResults,
      consoleLog,
      vmState: (details?.vm_state as string) || undefined,
      vmIp: (details?.vm_ip as string) || undefined,
      targetName: (details?.target_name as string) || undefined,
      clonedVmName: (details?.clone_template as Record<string, unknown>)?.clone_name as string || undefined,
    }));
    
    return job.status;
  }, []);
  
  // Build job details for a site
  const buildJobDetails = (config: SiteConfig, vm: any, siteRole: 'primary' | 'dr') => {
    const baseDetails: Record<string, unknown> = {
      target_name: config.targetName,
      site_role: siteRole,
      auth_method: config.authMethod,
      ssh_key_id: config.authMethod === 'existing_key' ? config.sshKeyId : undefined,
      root_password: config.authMethod === 'password' ? config.password : undefined,
      zfs_pool_name: config.zfsPool,
      nfs_network: config.nfsNetwork,
      zfs_compression: config.compression,
      datastore_name: config.datastoreName,
      install_packages: true,
      create_user: true,
    };
    
    // Add template clone config if deploying from template
    if (config.isTemplate) {
      baseDetails.is_template_deploy = true;
      baseDetails.clone_template = {
        source_vm_moref: vm?.vcenter_id,
        clone_name: config.cloneSettings.cloneName,
        target_cluster: config.cloneSettings.targetCluster,
        target_datastore: config.cloneSettings.targetDatastore,
        use_guest_customization: config.cloneSettings.useGuestCustomization,
        clear_machine_id: config.cloneSettings.clearMachineId,
        regenerate_ssh_keys: config.cloneSettings.clearSshHostKeys,
        use_static_ip: config.cloneSettings.useStaticIp,
        static_ip: config.cloneSettings.staticIp,
        static_netmask: config.cloneSettings.staticNetmask,
        static_gateway: config.cloneSettings.staticGateway,
        static_dns: config.cloneSettings.staticDns,
      };
    }
    
    return baseDetails;
  };
  
  // Start parallel deployment
  const startDeployment = async () => {
    setDeploying(true);
    
    try {
      const { data: user } = await supabase.auth.getUser();
      
      // Create source job
      const { data: sourceJob, error: sourceError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'onboard_zfs_target',
          status: 'pending' as const,
          created_by: user?.user?.id,
          target_scope: { 
            vcenter_id: sourceConfig.vcenterId,
            vm_id: sourceConfig.vmId 
          } as unknown as undefined,
          details: buildJobDetails(sourceConfig, sourceVm, 'primary') as unknown as undefined,
        })
        .select()
        .single();
      
      if (sourceError) throw sourceError;
      
      // Create DR job
      const { data: drJob, error: drError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'onboard_zfs_target',
          status: 'pending' as const,
          created_by: user?.user?.id,
          target_scope: { 
            vcenter_id: drConfig.vcenterId,
            vm_id: drConfig.vmId 
          } as unknown as undefined,
          details: buildJobDetails(drConfig, drVm, 'dr') as unknown as undefined,
        })
        .select()
        .single();
      
      if (drError) throw drError;
      
      setSourceProgress(prev => ({ ...prev, jobId: sourceJob.id }));
      setDrProgress(prev => ({ ...prev, jobId: drJob.id }));
      
      toast({ title: 'Deployment started', description: 'Setting up both ZFS targets in parallel...' });
      
      // Poll both jobs
      const pollInterval = setInterval(async () => {
        const sourceStatus = sourceJob.id ? await pollJob(sourceJob.id, setSourceProgress) : null;
        const drStatus = drJob.id ? await pollJob(drJob.id, setDrProgress) : null;
        
        const sourceComplete = sourceStatus === 'completed' || sourceStatus === 'failed';
        const drComplete = drStatus === 'completed' || drStatus === 'failed';
        
        if (sourceComplete && drComplete) {
          clearInterval(pollInterval);
          setDeploying(false);
          
          if (sourceStatus === 'completed' && drStatus === 'completed') {
            setDeployComplete(true);
            
            // Get created target IDs and pair them
            const { data: sourceTarget } = await supabase
              .from('replication_targets')
              .select('id')
              .eq('name', sourceConfig.targetName)
              .order('created_at', { ascending: false })
              .limit(1)
              .single();
            
            const { data: drTarget } = await supabase
              .from('replication_targets')
              .select('id')
              .eq('name', drConfig.targetName)
              .order('created_at', { ascending: false })
              .limit(1)
              .single();
            
            if (sourceTarget && drTarget) {
              // Pair the targets
              await supabase
                .from('replication_targets')
                .update({ 
                  partner_target_id: drTarget.id,
                  site_role: 'primary',
                })
                .eq('id', sourceTarget.id);
              
              await supabase
                .from('replication_targets')
                .update({ 
                  partner_target_id: sourceTarget.id,
                  site_role: 'dr',
                })
                .eq('id', drTarget.id);
              
              onSuccess?.(sourceTarget.id, drTarget.id);
            }
            
            toast({ 
              title: 'Deployment complete', 
              description: 'Both ZFS targets deployed and paired successfully!' 
            });
          } else {
            toast({ 
              title: 'Deployment had issues', 
              description: 'One or both deployments failed. Check the details.',
              variant: 'destructive'
            });
          }
        }
      }, 2000);
      
    } catch (err) {
      setDeploying(false);
      toast({ 
        title: 'Failed to start deployment', 
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive' 
      });
    }
  };
  
  // Page validation
  const canProceedFromPage = (page: number): boolean => {
    switch (page) {
      case 1: {
        // Library mode requires template selection OR vcenter mode requires VM
        const sourceBasicValid = sourceConfig.sourceMode === 'library'
          ? !!sourceConfig.selectedTemplate && !!sourceConfig.vmId && !!sourceConfig.targetName
          : !!sourceConfig.vcenterId && !!sourceConfig.vmId && !!sourceConfig.targetName;
        const drBasicValid = drConfig.sourceMode === 'library'
          ? !!drConfig.selectedTemplate && !!drConfig.vmId && !!drConfig.targetName
          : !!drConfig.vcenterId && !!drConfig.vmId && !!drConfig.targetName;
        
        // Templates need clone config with at least clone name and cluster
        const sourceCloneValid = !sourceConfig.isTemplate || 
          (!!sourceConfig.cloneSettings.cloneName && !!sourceConfig.cloneSettings.targetCluster);
        const drCloneValid = !drConfig.isTemplate ||
          (!!drConfig.cloneSettings.cloneName && !!drConfig.cloneSettings.targetCluster);
        
        return sourceBasicValid && drBasicValid && sourceCloneValid && drCloneValid;
      }
      case 2:
        const sourceAuthValid = sourceConfig.authMethod === 'password' 
          ? !!sourceConfig.password 
          : !!sourceConfig.sshKeyId;
        const drAuthValid = drConfig.authMethod === 'password' 
          ? !!drConfig.password 
          : !!drConfig.sshKeyId;
        return sourceAuthValid && drAuthValid;
      case 3:
        return !!sourceConfig.zfsPool && !!sourceConfig.nfsNetwork && !!sourceConfig.datastoreName &&
               !!drConfig.zfsPool && !!drConfig.nfsNetwork && !!drConfig.datastoreName;
      case 4:
        return !deploying;
      default:
        return false;
    }
  };
  
  const isJobRunning = deploying || sourceProgress.status === 'running' || drProgress.status === 'running';
  const hasStartedDeploy = !!sourceProgress.jobId || !!drProgress.jobId;
  
  const handleNext = () => {
    if (currentPage < 4 && canProceedFromPage(currentPage)) {
      setCurrentPage(currentPage + 1);
    }
  };
  
  const handleBack = () => {
    if (currentPage > 1 && !hasStartedDeploy) {
      setCurrentPage(currentPage - 1);
    }
  };
  
  // Handler for template selection
  const handleTemplateSelect = (
    template: ZfsTargetTemplate | null, 
    setConfig: React.Dispatch<React.SetStateAction<SiteConfig>>
  ) => {
    if (template) {
      setConfig(prev => ({
        ...prev,
        selectedTemplate: template,
        vcenterId: template.vcenter_id || '',
        zfsPool: template.default_zfs_pool_name || 'tank',
        nfsNetwork: template.default_nfs_network || '10.0.0.0/8',
        authMethod: template.ssh_key_id ? 'existing_key' : 'password',
        sshKeyId: template.ssh_key_id || '',
        cloneSettings: {
          ...prev.cloneSettings,
          targetCluster: template.default_cluster || '',
          targetDatastore: template.default_datastore || '',
        },
      }));
    } else {
      setConfig(prev => ({
        ...prev,
        selectedTemplate: null,
        vmId: '',
      }));
    }
  };

  // Auto-select VMs when templates are selected and VMs are loaded
  useEffect(() => {
    if (sourceConfig.selectedTemplate && sourceVms.length > 0 && !sourceConfig.vmId) {
      const templateVm = sourceVms.find(vm => vm.vcenter_id === sourceConfig.selectedTemplate?.template_moref);
      if (templateVm) {
        setSourceConfig(prev => ({ ...prev, vmId: templateVm.id }));
      }
    }
  }, [sourceConfig.selectedTemplate, sourceVms, sourceConfig.vmId]);

  useEffect(() => {
    if (drConfig.selectedTemplate && drVms.length > 0 && !drConfig.vmId) {
      const templateVm = drVms.find(vm => vm.vcenter_id === drConfig.selectedTemplate?.template_moref);
      if (templateVm) {
        setDrConfig(prev => ({ ...prev, vmId: templateVm.id }));
      }
    }
  }, [drConfig.selectedTemplate, drVms, drConfig.vmId]);

  const renderSiteCard = (
    title: string,
    badgeLabel: string,
    isPrimary: boolean,
    config: SiteConfig,
    setConfig: React.Dispatch<React.SetStateAction<SiteConfig>>,
    vms: any[],
    vmsLoading: boolean,
    clusters: string[],
    selectedVm: any,
    refreshState: ReturnType<typeof useQuickRefresh>
  ) => (
    <div className={`space-y-4 p-4 rounded-lg border ${isPrimary ? 'bg-primary/5 border-primary/20' : 'bg-secondary/30'}`}>
      <div className="flex items-center gap-2 pb-2 border-b">
        <Badge className={isPrimary ? 'bg-primary' : ''} variant={isPrimary ? 'default' : 'secondary'}>
          {badgeLabel}
        </Badge>
        <span className="font-semibold">{title}</span>
        {config.isTemplate && (
          <Badge variant="outline" className="text-xs ml-auto">
            <Copy className="h-3 w-3 mr-1" />
            Template
          </Badge>
        )}
      </div>
      
      {currentPage === 1 && (
        <div className="space-y-3">
          {/* Source Mode Toggle */}
          <div className="space-y-2">
            <Label className="text-xs">Source</Label>
            <RadioGroup 
              value={config.sourceMode} 
              onValueChange={(v) => setConfig(prev => ({ 
                ...prev, 
                sourceMode: v as 'library' | 'vcenter',
                selectedTemplate: null,
                vcenterId: '',
                vmId: '',
              }))}
              className="grid grid-cols-2 gap-2"
            >
              <div className={`flex items-center space-x-2 p-2 rounded border cursor-pointer text-xs ${config.sourceMode === 'library' ? 'border-primary bg-primary/5' : 'bg-card'}`}>
                <RadioGroupItem value="library" id={`${badgeLabel}-lib`} />
                <Label htmlFor={`${badgeLabel}-lib`} className="text-xs cursor-pointer">Appliance Library</Label>
              </div>
              <div className={`flex items-center space-x-2 p-2 rounded border cursor-pointer text-xs ${config.sourceMode === 'vcenter' ? 'border-primary bg-primary/5' : 'bg-card'}`}>
                <RadioGroupItem value="vcenter" id={`${badgeLabel}-vc`} />
                <Label htmlFor={`${badgeLabel}-vc`} className="text-xs cursor-pointer">vCenter VM</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Library Mode */}
          {config.sourceMode === 'library' && (
            <div className="space-y-3">
              {/* Step 1: Select vCenter first */}
              <div className="space-y-2">
                <Label className="text-xs">vCenter / Site</Label>
                <Select 
                  value={config.vcenterId} 
                  onValueChange={(v) => setConfig(prev => ({ 
                    ...prev, 
                    vcenterId: v, 
                    selectedTemplate: null // Clear template when vCenter changes
                  }))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={vcentersLoading ? "Loading..." : "Select site"} />
                  </SelectTrigger>
                  <SelectContent>
                    {vcenters.map((vc) => (
                      <SelectItem key={vc.id} value={vc.id}>
                        {vc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {/* Step 2: Show templates only after vCenter is selected */}
              {config.vcenterId ? (
                <div className="space-y-2">
                  <Label className="text-xs">Select Appliance</Label>
                  <ZfsApplianceSelector
                    selectedId={config.selectedTemplate?.id}
                    onSelect={(template) => handleTemplateSelect(template, setConfig)}
                    showOnlyReady={true}
                    vcenterId={config.vcenterId}
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Select a vCenter to see available appliance templates
                </p>
              )}
            </div>
          )}

          {/* vCenter Mode */}
          {config.sourceMode === 'vcenter' && (
            <>
              <div className="space-y-2">
                <Label className="text-xs">vCenter</Label>
                <Select value={config.vcenterId} onValueChange={(v) => setConfig(prev => ({ ...prev, vcenterId: v, vmId: '', isTemplate: false, cloneSettings: defaultCloneSettings() }))}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={vcentersLoading ? "Loading..." : "Select vCenter"} />
                  </SelectTrigger>
                  <SelectContent>
                    {vcenters.map((vc) => (
                      <SelectItem key={vc.id} value={vc.id}>
                        {vc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label className="text-xs">VM or Template</Label>
                <div className="flex items-center gap-1">
                  <div className="flex-1">
                    <VMCombobox
                      vms={vms}
                      clusters={clusters}
                      selectedVmId={config.vmId}
                      onSelectVm={(vm) => setConfig(prev => ({ ...prev, vmId: vm.id }))}
                      disabled={!config.vcenterId}
                      isLoading={vmsLoading}
                      placeholder={!config.vcenterId ? "Select vCenter first" : "Select VM or Template"}
                    />
                  </div>
                  {config.vcenterId && (
                    <RefreshButton 
                      onClick={() => refreshState.refreshSingle('vms')}
                      isRefreshing={refreshState.isRefreshingScope('vms')}
                      tooltip="Refresh VMs"
                    />
                  )}
                </div>
              </div>
            </>
          )}
          
          {selectedVm && !config.isTemplate && (
            <div className="text-xs text-muted-foreground p-2 rounded bg-muted/50">
              <div className="flex justify-between">
                <span>IP:</span>
                <span className="font-mono">{selectedVm.ip_address || 'None'}</span>
              </div>
              <div className="flex justify-between">
                <span>OS:</span>
                <span>{selectedVm.guest_os || 'Unknown'}</span>
              </div>
            </div>
          )}
          
          <div className="space-y-2">
            <Label className="text-xs">Target Name</Label>
            <Input
              value={config.targetName}
              onChange={(e) => setConfig(prev => ({ 
                ...prev, 
                targetName: e.target.value,
                datastoreName: `NFS-${e.target.value}`,
              }))}
              placeholder="e.g., zfs-mar-vrep-01"
              className="h-9"
            />
            <p className="text-xs text-muted-foreground">Auto-generated from site code. Edit to override.</p>
          </div>
          
          {config.isTemplate && (
            <div className="space-y-2">
              <Label className="text-xs">Clone VM Name</Label>
              <Input
                value={config.cloneSettings.cloneName}
                onChange={(e) => setConfig(prev => ({ 
                  ...prev, 
                  cloneSettings: { ...prev.cloneSettings, cloneName: e.target.value }
                }))}
                placeholder="e.g., S06-VREP-01"
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">VM name in vCenter after cloning.</p>
            </div>
          )}
          
          {/* Template Cluster Selection - only show if template and cluster not auto-selected */}
          {config.isTemplate && selectedVm && (
            <div className="space-y-2">
              <Label className="text-xs">Target Cluster</Label>
              <Select 
                value={config.cloneSettings.targetCluster} 
                onValueChange={(v) => setConfig(prev => ({ 
                  ...prev, 
                  cloneSettings: { ...prev.cloneSettings, targetCluster: v }
                }))}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select cluster" />
                </SelectTrigger>
                <SelectContent>
                  {clusters.map((cluster) => (
                    <SelectItem key={cluster} value={cluster}>
                      {cluster}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
      
      {currentPage === 2 && (
        <div className="space-y-3">
          <RadioGroup 
            value={config.authMethod} 
            onValueChange={(v) => setConfig(prev => ({ ...prev, authMethod: v as 'existing_key' | 'password' }))}
            className="space-y-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="existing_key" id={`${badgeLabel}-ssh`} />
              <Label htmlFor={`${badgeLabel}-ssh`} className="text-xs">SSH Key</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="password" id={`${badgeLabel}-pwd`} />
              <Label htmlFor={`${badgeLabel}-pwd`} className="text-xs">Password</Label>
            </div>
          </RadioGroup>
          
          {config.authMethod === 'existing_key' && (
            <Select value={config.sshKeyId} onValueChange={(v) => setConfig(prev => ({ ...prev, sshKeyId: v }))}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={sshKeysLoading ? "Loading..." : "Select SSH key"} />
              </SelectTrigger>
              <SelectContent>
                {activeSshKeys.map((key) => (
                  <SelectItem key={key.id} value={key.id}>
                    <div className="flex items-center gap-2">
                      <Key className="h-3 w-3" />
                      {key.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          
          {config.authMethod === 'password' && (
            <Input
              type="password"
              value={config.password}
              onChange={(e) => setConfig(prev => ({ ...prev, password: e.target.value }))}
              placeholder="Root password"
              className="h-9"
            />
          )}
        </div>
      )}
      
      {currentPage === 3 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">ZFS Pool</Label>
              <Input
                value={config.zfsPool}
                onChange={(e) => setConfig(prev => ({ ...prev, zfsPool: e.target.value }))}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Compression</Label>
              <Select value={config.compression} onValueChange={(v) => setConfig(prev => ({ ...prev, compression: v as 'lz4' | 'zstd' | 'off' }))}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lz4">LZ4 (fast)</SelectItem>
                  <SelectItem value="zstd">ZSTD (balanced)</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="space-y-1">
            <Label className="text-xs">NFS Network (CIDR)</Label>
            <Input
              value={config.nfsNetwork}
              onChange={(e) => setConfig(prev => ({ ...prev, nfsNetwork: e.target.value }))}
              placeholder="10.0.0.0/8"
              className="h-9"
            />
          </div>
          
          <div className="space-y-1">
            <Label className="text-xs">Datastore Name</Label>
            <Input
              value={config.datastoreName}
              onChange={(e) => setConfig(prev => ({ ...prev, datastoreName: e.target.value }))}
              className="h-9"
            />
          </div>
        </div>
      )}
    </div>
  );
  
  const renderProgressCard = (
    label: string,
    progress: JobProgress,
    isPrimary: boolean,
    config: SiteConfig,
    selectedVm: any,
    consoleOpenKey: 'source' | 'dr'
  ) => {
    const vcenter = vcenters.find(v => v.id === config.vcenterId);
    const displayTargetName = progress.targetName || config.targetName;
    const displayVmName = progress.clonedVmName || selectedVm?.name || 'Unknown';
    
    return (
      <div className={`rounded-lg border overflow-hidden ${isPrimary ? 'bg-primary/5 border-primary/20' : 'bg-secondary/30'}`}>
        {/* Header with config summary */}
        <div className="p-3 border-b bg-card/50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Badge variant={isPrimary ? 'default' : 'secondary'}>{label}</Badge>
              {progress.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
              {progress.status === 'failed' && <XCircle className="h-4 w-4 text-destructive" />}
              {progress.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              {progress.status === 'pending' && <RefreshCw className="h-4 w-4 text-muted-foreground" />}
            </div>
            <span className="text-sm font-semibold">{Math.round(progress.progress)}%</span>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <div className="flex justify-between">
              <span>Target:</span>
              <span className="font-medium text-foreground">{displayTargetName}</span>
            </div>
            <div className="flex justify-between">
              <span>{config.isTemplate ? 'Cloning:' : 'VM:'}</span>
              <span className="font-mono">{displayVmName}</span>
            </div>
            {vcenter && (
              <div className="flex justify-between">
                <span>vCenter:</span>
                <span>{vcenter.name}</span>
              </div>
            )}
          </div>
        </div>
        
        {/* Progress bar */}
        <div className="px-3 pt-3">
          <Progress value={progress.progress} className="h-2" />
        </div>
        
        {/* Step list */}
        {progress.stepResults.length > 0 && (
          <div className="p-3 space-y-1">
            <ScrollArea className="max-h-[180px]">
              <div className="space-y-1">
                {progress.stepResults.map((step, idx) => (
                  <div 
                    key={`${step.step}-${idx}`}
                    className={`flex items-center gap-2 p-1.5 rounded text-xs ${
                      step.status === 'running' ? 'bg-primary/10' : ''
                    }`}
                  >
                    {getStatusIcon(step.status)}
                    <span className={step.status === 'running' ? 'font-medium' : ''}>
                      {STEP_LABELS[step.step] || step.step}
                    </span>
                    {step.message && (
                      <span className="text-muted-foreground ml-auto truncate max-w-[150px]">
                        {step.message}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
        
        {/* VM State badges */}
        {(progress.vmState || progress.vmIp) && (
          <div className="px-3 pb-2 flex gap-2 flex-wrap">
            {progress.vmState && (
              <Badge variant="outline" className="text-xs gap-1">
                {progress.vmState === 'poweredOn' ? (
                  <Power className="h-3 w-3 text-green-500" />
                ) : (
                  <PowerOff className="h-3 w-3 text-muted-foreground" />
                )}
                {progress.vmState}
              </Badge>
            )}
            {progress.vmIp && (
              <Badge variant="outline" className="text-xs font-mono">
                IP: {progress.vmIp}
              </Badge>
            )}
          </div>
        )}
        
        {/* Error display */}
        {progress.error && (
          <div className="mx-3 mb-3 p-2 rounded bg-destructive/10 border border-destructive/20">
            <p className="text-xs text-destructive flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{progress.error}</span>
            </p>
            
            {/* Show "Fix Template" button for disk signature errors */}
            {isDiskSignatureError(progress.error) && config.isTemplate && (
              <div className="mt-2 pt-2 border-t border-destructive/20">
                <p className="text-xs text-muted-foreground mb-2">
                  The template's disk has leftover signatures. Re-run template preparation to clean the disk.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  onClick={() => {
                    setPrepareWizardConfig({
                      vcenterId: config.vcenterId,
                      vmId: config.vmId,
                      templateName: config.selectedTemplate?.name || selectedVm?.name || 'Unknown Template',
                      sshKeyId: config.authMethod === 'existing_key' ? config.sshKeyId : undefined,
                      password: config.authMethod === 'password' ? config.password : undefined,
                      errorMessage: progress.error || 'Disk signature error',
                    });
                    setShowPrepareWizard(true);
                  }}
                >
                  <Wand2 className="h-3 w-3 mr-1" />
                  Fix Template
                </Button>
              </div>
            )}
          </div>
        )}
        
        {/* Console log collapsible */}
        {progress.consoleLog.length > 0 && (
          <Collapsible
            open={consoleOpen[consoleOpenKey]}
            onOpenChange={(open) => setConsoleOpen(prev => ({ ...prev, [consoleOpenKey]: open }))}
          >
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 border-t">
                <Terminal className="h-3.5 w-3.5" />
                <span>Console Log ({progress.consoleLog.length} lines)</span>
                <ChevronDown className={`h-3.5 w-3.5 ml-auto transition-transform ${consoleOpen[consoleOpenKey] ? 'rotate-180' : ''}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea className="h-[120px] bg-muted/30 border-t">
                <pre className="p-2 text-[10px] font-mono text-muted-foreground whitespace-pre-wrap">
                  {progress.consoleLog.join('\n')}
                </pre>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    );
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" />
              Deploy Paired ZFS Replication Targets
            </DialogTitle>
            <RefreshIndicator isRefreshing={sourceRefresh.isRefreshing || drRefresh.isRefreshing} />
          </div>
          <DialogDescription>
            Set up both source and DR ZFS appliances for replication between sites
          </DialogDescription>
        </DialogHeader>
        
        {/* Page indicator */}
        <div className="flex items-center justify-center gap-1 py-3 border-b shrink-0">
          {WIZARD_PAGES.map((page, index) => {
            const Icon = page.icon;
            const isActive = currentPage === page.id;
            const isComplete = currentPage > page.id || deployComplete;
            
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
                  <div className={`w-6 h-0.5 mx-1 ${
                    currentPage > page.id ? 'bg-green-500' : 'bg-border'
                  }`} />
                )}
              </div>
            );
          })}
        </div>
        
        {/* Page content */}
        <div className="flex-1 overflow-y-auto px-1 py-4">
          {currentPage <= 3 && (
            <div className="grid md:grid-cols-2 gap-4">
              {renderSiteCard(
                'Source Site (Primary)',
                'A',
                true,
                sourceConfig,
                setSourceConfig,
                sourceVms,
                sourceVmsLoading,
                sourceClusters,
                sourceVm,
                sourceRefresh
              )}
              {renderSiteCard(
                'DR Site (Recovery)',
                'B',
                false,
                drConfig,
                setDrConfig,
                drVms,
                drVmsLoading,
                drClusters,
                drVm,
                drRefresh
              )}
            </div>
          )}
          
          {currentPage === 4 && (
            <div className="space-y-4">
              {!hasStartedDeploy && (
                <div className="p-4 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 mb-4">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <span className="font-medium">Ready to Deploy</span>
                  </div>
                  
                  <div className="grid md:grid-cols-2 gap-4 text-sm">
                    <div className="space-y-2 p-3 rounded bg-primary/5">
                      <div className="font-medium flex items-center gap-2">
                        <Badge>A</Badge> Source Site
                        {sourceConfig.isTemplate && (
                          <Badge variant="outline" className="text-xs">
                            <Copy className="h-3 w-3 mr-1" />
                            From Template
                          </Badge>
                        )}
                      </div>
                      <div className="space-y-1 text-muted-foreground">
                        <div>Target: {sourceConfig.targetName}</div>
                        <div>VM: {sourceVm?.name}</div>
                        {sourceConfig.isTemplate && (
                          <div>Clone Name: {sourceConfig.cloneSettings.cloneName}</div>
                        )}
                        <div>Pool: {sourceConfig.zfsPool} ({sourceConfig.compression})</div>
                        <div>Datastore: {sourceConfig.datastoreName}</div>
                      </div>
                    </div>
                    <div className="space-y-2 p-3 rounded bg-secondary/30">
                      <div className="font-medium flex items-center gap-2">
                        <Badge variant="secondary">B</Badge> DR Site
                        {drConfig.isTemplate && (
                          <Badge variant="outline" className="text-xs">
                            <Copy className="h-3 w-3 mr-1" />
                            From Template
                          </Badge>
                        )}
                      </div>
                      <div className="space-y-1 text-muted-foreground">
                        <div>Target: {drConfig.targetName}</div>
                        <div>VM: {drVm?.name}</div>
                        {drConfig.isTemplate && (
                          <div>Clone Name: {drConfig.cloneSettings.cloneName}</div>
                        )}
                        <div>Pool: {drConfig.zfsPool} ({drConfig.compression})</div>
                        <div>Datastore: {drConfig.datastoreName}</div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-4 p-3 rounded bg-muted/50 text-sm text-muted-foreground">
                    <strong>What will happen:</strong>
                    <ol className="list-decimal ml-4 mt-1 space-y-1">
                      {(sourceConfig.isTemplate || drConfig.isTemplate) && (
                        <li>Templates will be cloned to new VMs with guest customization</li>
                      )}
                      <li>Both VMs will be configured in parallel</li>
                      <li>ZFS and NFS packages will be installed</li>
                      <li>ZFS pools and NFS exports will be created</li>
                      <li>Datastores will be registered in vCenter</li>
                      <li>Targets will be paired for replication</li>
                    </ol>
                  </div>
                </div>
              )}
              
              {hasStartedDeploy && (
                <div className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                    {renderProgressCard('Source Site', sourceProgress, true, sourceConfig, sourceVm, 'source')}
                    {renderProgressCard('DR Site', drProgress, false, drConfig, drVm, 'dr')}
                  </div>
                  
                  {deployComplete && (
                    <div className="p-4 rounded-lg border border-green-500/30 bg-green-500/10">
                      <div className="flex items-center gap-2 text-green-600">
                        <CheckCircle2 className="h-5 w-5" />
                        <span className="font-medium">Deployment Complete!</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-2">
                        Both ZFS targets have been deployed and paired. They are ready for replication.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <DialogFooter className="border-t pt-4 shrink-0">
          <div className="flex w-full justify-between">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={currentPage === 1 || hasStartedDeploy}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {deployComplete ? 'Close' : 'Cancel'}
              </Button>
              
              {currentPage < 4 && (
                <Button onClick={handleNext} disabled={!canProceedFromPage(currentPage)}>
                  Next
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              )}
              
              {currentPage === 4 && !hasStartedDeploy && (
                <Button onClick={startDeployment} disabled={deploying}>
                  {deploying ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Start Deployment
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
      
      {/* Prepare Template Wizard for fixing disk issues */}
      <PrepareTemplateWizard
        open={showPrepareWizard}
        onOpenChange={setShowPrepareWizard}
        preselectedVCenterId={prepareWizardConfig?.vcenterId}
        preselectedVMId={prepareWizardConfig?.vmId}
        preselectedTemplateName={prepareWizardConfig?.templateName}
        preselectedSshKeyId={prepareWizardConfig?.sshKeyId}
        preselectedPassword={prepareWizardConfig?.password}
        startAtStep={5}
        errorContext={`Disk has leftover signatures from previous use. Run the "Clean" step to wipe disk signatures before re-deploying.`}
      />
    </Dialog>
  );
}
