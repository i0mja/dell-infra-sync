/**
 * Deploy ZFS Target Wizard
 * 
 * 4-step wizard for deploying a ZFS replication target from a VMware template.
 * Steps: Select Template → Configure Deployment → Review → Progress
 */

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { 
  Rocket, 
  Server, 
  Network, 
  HardDrive, 
  Cpu, 
  MemoryStick, 
  CheckCircle2, 
  ArrowRight, 
  ArrowLeft,
  Loader2,
  AlertCircle,
  Circle,
  Power,
  Key,
  Database,
  FolderOpen,
  ClipboardCheck,
  Wifi,
  Info
} from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useZfsTemplates, ZfsTargetTemplate } from '@/hooks/useZfsTemplates';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DeploymentConsole } from './DeploymentConsole';
import { cn } from '@/lib/utils';

// Deployment phases for progress timeline - matches handler phases in zfs_target.py
const DEPLOYMENT_PHASES = [
  { id: 'clone', label: 'Cloning Template', icon: Rocket, progress: 20 },
  { id: 'power_on', label: 'Powering On VM', icon: Power, progress: 25 },
  { id: 'wait_tools', label: 'Waiting for VM Tools', icon: Loader2, progress: 35 },
  { id: 'wait_ip', label: 'Waiting for IP Address', icon: Wifi, progress: 40 },
  { id: 'ssh_connect', label: 'Connecting via SSH', icon: Key, progress: 50 },
  { id: 'zfs_create', label: 'Creating ZFS Pool', icon: Database, progress: 60 },
  { id: 'nfs_setup', label: 'Configuring NFS Share', icon: FolderOpen, progress: 75 },
  { id: 'register_target', label: 'Registering Target', icon: ClipboardCheck, progress: 85 },
  { id: 'register_datastore', label: 'Registering Datastore', icon: HardDrive, progress: 100 },
] as const;

interface DeployZfsTargetWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface DeploymentConfig {
  template_id: string;
  vm_name: string;
  // Network selection
  network_id?: string;
  network_name?: string;
  vlan_id?: number;
  use_dhcp: boolean;
  // Static IP config
  ip_address: string;
  subnet_mask: string;
  gateway: string;
  dns_servers: string;
  hostname: string;
  // ZFS config
  zfs_pool_name: string;
  zfs_disk_gb: number;
  nfs_network: string;
  // Resources
  cpu_count: number;
  memory_gb: number;
}

const initialConfig: DeploymentConfig = {
  template_id: '',
  vm_name: '',
  network_id: undefined,
  network_name: undefined,
  vlan_id: undefined,
  use_dhcp: false,
  ip_address: '',
  subnet_mask: '255.255.255.0',
  gateway: '',
  dns_servers: '',
  hostname: '',
  zfs_pool_name: 'tank',
  zfs_disk_gb: 500,
  nfs_network: '10.0.0.0/8',
  cpu_count: 2,
  memory_gb: 8
};

interface VCenterNetwork {
  id: string;
  name: string;
  vlan_id?: number;
  vlan_type?: string;
  network_type?: string;
  parent_switch_name?: string;
}

export function DeployZfsTargetWizard({ open, onOpenChange, onSuccess }: DeployZfsTargetWizardProps) {
  const { templates, loading: templatesLoading, deployFromTemplate, isDeploying } = useZfsTemplates();
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState<DeploymentConfig>(initialConfig);
  const [selectedTemplate, setSelectedTemplate] = useState<ZfsTargetTemplate | null>(null);
  const [deployedJobId, setDeployedJobId] = useState<string | null>(null);
  
  const activeTemplates = templates.filter(t => t.is_active);

  // Fetch networks for the selected template's vCenter
  const { data: networks = [] } = useQuery({
    queryKey: ['vcenter-networks-for-deploy', selectedTemplate?.vcenter_id],
    queryFn: async () => {
      if (!selectedTemplate?.vcenter_id) return [];
      const { data, error } = await supabase
        .from('vcenter_networks')
        .select('id, name, vlan_id, vlan_type, network_type, parent_switch_name')
        .eq('source_vcenter_id', selectedTemplate.vcenter_id)
        .eq('uplink_port_group', false)
        .eq('accessible', true)
        .order('name');
      if (error) throw error;
      return data as VCenterNetwork[];
    },
    enabled: !!selectedTemplate?.vcenter_id
  });

  // Poll job status when deployed
  const { data: jobStatus } = useQuery({
    queryKey: ['job-status', deployedJobId],
    queryFn: async () => {
      if (!deployedJobId) return null;
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', deployedJobId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!deployedJobId,
    refetchInterval: deployedJobId ? 3000 : false
  });

  // Update config when template is selected
  useEffect(() => {
    if (selectedTemplate) {
      setConfig(prev => ({
        ...prev,
        template_id: selectedTemplate.id,
        zfs_pool_name: selectedTemplate.default_zfs_pool_name,
        zfs_disk_gb: selectedTemplate.default_zfs_disk_gb,
        nfs_network: selectedTemplate.default_nfs_network,
        cpu_count: selectedTemplate.default_cpu_count,
        memory_gb: selectedTemplate.default_memory_gb
      }));
    }
  }, [selectedTemplate]);

  // Auto-select default network when networks load and template has a default
  useEffect(() => {
    if (selectedTemplate?.default_network && networks.length > 0 && !config.network_id) {
      const defaultNetwork = networks.find(n => n.name === selectedTemplate.default_network);
      if (defaultNetwork) {
        setConfig(prev => ({
          ...prev,
          network_id: defaultNetwork.id,
          network_name: defaultNetwork.name,
          vlan_id: defaultNetwork.vlan_id ?? undefined
        }));
      }
    }
  }, [selectedTemplate, networks]);

  // Generate default VM name
  useEffect(() => {
    if (selectedTemplate && !config.vm_name) {
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      setConfig(prev => ({
        ...prev,
        vm_name: `zfs-dr-${timestamp}`,
        hostname: `zfs-dr-${timestamp}`
      }));
    }
  }, [selectedTemplate]);

  const handleClose = () => {
    setStep(1);
    setConfig(initialConfig);
    setSelectedTemplate(null);
    setDeployedJobId(null);
    onOpenChange(false);
  };

  const handleDeploy = async () => {
    try {
      const job = await deployFromTemplate({
        template_id: config.template_id,
        vm_name: config.vm_name,
        // Network config
        network_id: config.network_id,
        network_name: config.network_name,
        use_dhcp: config.use_dhcp,
        // Only include static IP config if not using DHCP
        ip_address: config.use_dhcp ? undefined : config.ip_address,
        subnet_mask: config.use_dhcp ? undefined : config.subnet_mask,
        gateway: config.use_dhcp ? undefined : config.gateway,
        dns_servers: config.use_dhcp 
          ? undefined 
          : (config.dns_servers ? config.dns_servers.split(',').map(s => s.trim()) : undefined),
        hostname: config.hostname || config.vm_name,
        zfs_pool_name: config.zfs_pool_name,
        zfs_disk_gb: config.zfs_disk_gb,
        nfs_network: config.nfs_network,
        cpu_count: config.cpu_count,
        memory_gb: config.memory_gb
      });
      setDeployedJobId(job.id);
      setStep(4);
    } catch (error) {
      // Error handled by hook
    }
  };

  const handleNetworkSelect = (networkId: string) => {
    const network = networks.find(n => n.id === networkId);
    if (network) {
      setConfig(prev => ({
        ...prev,
        network_id: network.id,
        network_name: network.name,
        vlan_id: network.vlan_id ?? undefined
      }));
    }
  };

  const canProceed = () => {
    switch (step) {
      case 1:
        return !!selectedTemplate;
      case 2:
        // Network required, and either DHCP or full static config
        const hasNetwork = !!config.network_id;
        const hasStaticConfig = config.ip_address && config.subnet_mask && config.gateway;
        return config.vm_name && hasNetwork && (config.use_dhcp || hasStaticConfig);
      case 3:
        return true;
      default:
        return false;
    }
  };

  // Get current phase from job details
  const getCurrentPhase = (): string => {
    const details = jobStatus?.details as Record<string, unknown> | null;
    return (details?.current_phase as string) || 'clone';
  };

  // Calculate progress based on current phase
  const getJobProgress = (): number => {
    if (!jobStatus) return 0;
    if (jobStatus.status === 'completed') return 100;
    if (jobStatus.status === 'failed') return 100;
    
    const details = jobStatus?.details as Record<string, unknown> | null;
    
    // Use explicit progress_percent if available
    if (details?.progress_percent !== undefined) {
      return details.progress_percent as number;
    }
    
    // Calculate from current phase
    const currentPhase = getCurrentPhase();
    const phaseIndex = DEPLOYMENT_PHASES.findIndex(p => p.id === currentPhase);
    if (phaseIndex >= 0) {
      return DEPLOYMENT_PHASES[phaseIndex].progress;
    }
    
    // Fallback
    switch (jobStatus.status) {
      case 'pending': return 5;
      case 'running': return 50;
      default: return 0;
    }
  };

  // Get phase status for timeline
  const getPhaseStatus = (phaseId: string): 'completed' | 'running' | 'pending' => {
    if (!jobStatus || jobStatus.status === 'pending') return phaseId === 'clone' ? 'running' : 'pending';
    if (jobStatus.status === 'completed') return 'completed';
    if (jobStatus.status === 'failed') {
      const currentPhase = getCurrentPhase();
      const phaseIndex = DEPLOYMENT_PHASES.findIndex(p => p.id === phaseId);
      const currentIndex = DEPLOYMENT_PHASES.findIndex(p => p.id === currentPhase);
      if (phaseIndex < currentIndex) return 'completed';
      if (phaseIndex === currentIndex) return 'running';
      return 'pending';
    }
    
    const currentPhase = getCurrentPhase();
    const phaseIndex = DEPLOYMENT_PHASES.findIndex(p => p.id === phaseId);
    const currentIndex = DEPLOYMENT_PHASES.findIndex(p => p.id === currentPhase);
    
    if (phaseIndex < currentIndex) return 'completed';
    if (phaseIndex === currentIndex) return 'running';
    return 'pending';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            Deploy ZFS Target from Template
          </DialogTitle>
          <DialogDescription>
            Step {step} of 4: {step === 1 ? 'Select Template' : step === 2 ? 'Configure Deployment' : step === 3 ? 'Review' : 'Progress'}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center justify-between mb-4">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center">
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                ${step >= s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}
              `}>
                {step > s ? <CheckCircle2 className="h-4 w-4" /> : s}
              </div>
              {s < 4 && (
                <div className={`w-16 h-1 mx-2 ${step > s ? 'bg-primary' : 'bg-muted'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Select Template */}
        {step === 1 && (
          <div className="space-y-4">
            {templatesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : activeTemplates.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No active templates available</p>
                <p className="text-sm">Configure templates in Settings → Infrastructure</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {activeTemplates.map((template) => (
                  <Card 
                    key={template.id}
                    className={`cursor-pointer transition-colors ${
                      selectedTemplate?.id === template.id 
                        ? 'border-primary ring-1 ring-primary' 
                        : 'hover:border-primary/50'
                    }`}
                    onClick={() => setSelectedTemplate(template)}
                  >
                    <CardHeader className="py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base">{template.name}</CardTitle>
                          <CardDescription className="text-xs">
                            {template.template_name} ({template.template_moref})
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Cpu className="h-3 w-3" /> {template.default_cpu_count}
                          </span>
                          <span className="flex items-center gap-1">
                            <MemoryStick className="h-3 w-3" /> {template.default_memory_gb}GB
                          </span>
                          <span className="flex items-center gap-1">
                            <HardDrive className="h-3 w-3" /> {template.default_zfs_disk_gb}GB
                          </span>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Configure Deployment */}
        {step === 2 && (
          <div className="space-y-6">
            {/* VM Identity */}
            <div className="space-y-4">
              <h4 className="font-medium flex items-center gap-2">
                <Server className="h-4 w-4" /> VM Identity
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="vm_name">VM Name *</Label>
                  <Input
                    id="vm_name"
                    value={config.vm_name}
                    onChange={(e) => setConfig({ ...config, vm_name: e.target.value })}
                    placeholder="e.g., zfs-dr-west"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hostname">Hostname</Label>
                  <Input
                    id="hostname"
                    value={config.hostname}
                    onChange={(e) => setConfig({ ...config, hostname: e.target.value })}
                    placeholder="Same as VM name if empty"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Network Configuration */}
            <div className="space-y-4">
              <h4 className="font-medium flex items-center gap-2">
                <Network className="h-4 w-4" /> Network Configuration
              </h4>
              
              {/* Network/VLAN Selection */}
              <div className="space-y-2">
                <Label htmlFor="network">Network/VLAN *</Label>
                <Select
                  value={config.network_id || ''}
                  onValueChange={handleNetworkSelect}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a network..." />
                  </SelectTrigger>
                  <SelectContent>
                    {networks.length === 0 ? (
                      <SelectItem value="_none" disabled>
                        No networks available
                      </SelectItem>
                    ) : (
                      networks.map((network) => (
                        <SelectItem key={network.id} value={network.id}>
                          <div className="flex items-center gap-2">
                            <span>{network.name}</span>
                            {network.vlan_id && (
                              <Badge variant="outline" className="text-xs">
                                VLAN {network.vlan_id}
                              </Badge>
                            )}
                            {network.parent_switch_name && (
                              <span className="text-muted-foreground text-xs">
                                • {network.parent_switch_name}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {selectedTemplate?.default_network && config.network_name === selectedTemplate.default_network && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    Auto-selected from template default
                  </p>
                )}
              </div>

              {/* DHCP Toggle */}
              <div className="space-y-3">
                <Label>IP Configuration</Label>
                <RadioGroup
                  value={config.use_dhcp ? 'dhcp' : 'static'}
                  onValueChange={(v) => setConfig({ ...config, use_dhcp: v === 'dhcp' })}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="static" id="static" />
                    <Label htmlFor="static" className="cursor-pointer font-normal">Static IP</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="dhcp" id="dhcp" />
                    <Label htmlFor="dhcp" className="cursor-pointer font-normal flex items-center gap-1">
                      <Wifi className="h-3 w-3" /> DHCP
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Static IP Configuration */}
              {!config.use_dhcp ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="ip_address">IP Address *</Label>
                    <Input
                      id="ip_address"
                      value={config.ip_address}
                      onChange={(e) => setConfig({ ...config, ip_address: e.target.value })}
                      placeholder="e.g., 10.0.1.100"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="subnet_mask">Subnet Mask *</Label>
                    <Input
                      id="subnet_mask"
                      value={config.subnet_mask}
                      onChange={(e) => setConfig({ ...config, subnet_mask: e.target.value })}
                      placeholder="e.g., 255.255.255.0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gateway">Gateway *</Label>
                    <Input
                      id="gateway"
                      value={config.gateway}
                      onChange={(e) => setConfig({ ...config, gateway: e.target.value })}
                      placeholder="e.g., 10.0.1.1"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dns_servers">DNS Servers</Label>
                    <Input
                      id="dns_servers"
                      value={config.dns_servers}
                      onChange={(e) => setConfig({ ...config, dns_servers: e.target.value })}
                      placeholder="e.g., 8.8.8.8, 8.8.4.4"
                    />
                  </div>
                </div>
              ) : (
                <div className="bg-muted/50 rounded-lg p-3 border border-border/50">
                  <p className="text-sm text-muted-foreground flex items-start gap-2">
                    <Info className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      IP will be assigned by DHCP. Ensure DHCP is available on the selected VLAN.
                      The target will be registered once the IP is detected via VMware Tools.
                    </span>
                  </p>
                </div>
              )}
            </div>

            <Separator />

            {/* ZFS & Resources */}
            <div className="space-y-4">
              <h4 className="font-medium flex items-center gap-2">
                <HardDrive className="h-4 w-4" /> ZFS & Resources
              </h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="zfs_pool_name">ZFS Pool Name</Label>
                  <Input
                    id="zfs_pool_name"
                    value={config.zfs_pool_name}
                    onChange={(e) => setConfig({ ...config, zfs_pool_name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zfs_disk_gb">ZFS Disk Size (GB)</Label>
                  <Input
                    id="zfs_disk_gb"
                    type="number"
                    min={50}
                    value={config.zfs_disk_gb}
                    onChange={(e) => setConfig({ ...config, zfs_disk_gb: parseInt(e.target.value) || 500 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nfs_network">NFS Network (CIDR)</Label>
                  <Input
                    id="nfs_network"
                    value={config.nfs_network}
                    onChange={(e) => setConfig({ ...config, nfs_network: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="cpu_count" className="flex items-center gap-1">
                    <Cpu className="h-3 w-3" /> CPUs
                  </Label>
                  <Input
                    id="cpu_count"
                    type="number"
                    min={1}
                    value={config.cpu_count}
                    onChange={(e) => setConfig({ ...config, cpu_count: parseInt(e.target.value) || 2 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="memory_gb" className="flex items-center gap-1">
                    <MemoryStick className="h-3 w-3" /> Memory (GB)
                  </Label>
                  <Input
                    id="memory_gb"
                    type="number"
                    min={1}
                    value={config.memory_gb}
                    onChange={(e) => setConfig({ ...config, memory_gb: parseInt(e.target.value) || 8 })}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Deployment Summary</CardTitle>
              </CardHeader>
              <CardContent className="py-3">
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                  <div className="text-muted-foreground">Template</div>
                  <div className="font-medium">{selectedTemplate?.name}</div>
                  
                  <div className="text-muted-foreground">VM Name</div>
                  <div className="font-medium">{config.vm_name}</div>
                  
                  <div className="text-muted-foreground">Hostname</div>
                  <div className="font-medium">{config.hostname || config.vm_name}</div>
                  
                  <div className="text-muted-foreground">Network</div>
                  <div className="font-medium flex items-center gap-2">
                    {config.network_name}
                    {config.vlan_id && (
                      <Badge variant="outline" className="text-xs">VLAN {config.vlan_id}</Badge>
                    )}
                  </div>
                  
                  <div className="text-muted-foreground">IP Configuration</div>
                  <div className="font-medium">
                    {config.use_dhcp ? (
                      <span className="flex items-center gap-1">
                        <Wifi className="h-3 w-3" /> DHCP
                      </span>
                    ) : (
                      config.ip_address
                    )}
                  </div>
                  
                  {!config.use_dhcp && (
                    <>
                      <div className="text-muted-foreground">Gateway</div>
                      <div className="font-medium">{config.gateway}</div>
                    </>
                  )}
                  
                  <div className="text-muted-foreground">ZFS Pool</div>
                  <div className="font-medium">{config.zfs_pool_name}</div>
                  
                  <div className="text-muted-foreground">ZFS Disk Size</div>
                  <div className="font-medium">{config.zfs_disk_gb} GB</div>
                  
                  <div className="text-muted-foreground">NFS Network</div>
                  <div className="font-medium">{config.nfs_network}</div>
                  
                  <div className="text-muted-foreground">Resources</div>
                  <div className="font-medium">{config.cpu_count} vCPU, {config.memory_gb} GB RAM</div>
                </div>
              </CardContent>
            </Card>
            
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg text-sm">
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
              <span>The deployment will clone the template, configure networking, create ZFS pool, and set up NFS exports.</span>
            </div>
          </div>
        )}

        {/* Step 4: Progress */}
        {step === 4 && (
          <div className="space-y-4">
            {/* Status Header */}
            <div className="text-center pb-2">
              {jobStatus?.status === 'completed' ? (
                <div className="flex items-center justify-center gap-2 text-green-500">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">Deployment Complete!</span>
                </div>
              ) : jobStatus?.status === 'failed' ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="h-5 w-5" />
                    <span className="font-medium">Deployment Failed</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {(jobStatus.details as Record<string, unknown>)?.error as string || 'An error occurred during deployment'}
                  </p>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 text-primary">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="font-medium">Deploying ZFS Target...</span>
                </div>
              )}
            </div>

            {/* Progress Bar */}
            <div className="space-y-1">
              <Progress value={getJobProgress()} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Progress</span>
                <span>{getJobProgress()}%</span>
              </div>
            </div>

            {/* Phase Timeline */}
            <div className="grid grid-cols-5 gap-1 text-xs">
              {DEPLOYMENT_PHASES.slice(0, 5).map((phase) => {
                const status = getPhaseStatus(phase.id);
                const Icon = phase.icon;
                return (
                  <div
                    key={phase.id}
                    className={cn(
                      'flex flex-col items-center gap-1 p-2 rounded-lg transition-colors',
                      status === 'completed' && 'text-green-500',
                      status === 'running' && 'text-primary bg-primary/10',
                      status === 'pending' && 'text-muted-foreground'
                    )}
                  >
                    {status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : status === 'running' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Circle className="h-4 w-4" />
                    )}
                    <span className="text-center leading-tight">{phase.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-5 gap-1 text-xs">
              {DEPLOYMENT_PHASES.slice(5, 10).map((phase) => {
                const status = getPhaseStatus(phase.id);
                const Icon = phase.icon;
                return (
                  <div
                    key={phase.id}
                    className={cn(
                      'flex flex-col items-center gap-1 p-2 rounded-lg transition-colors',
                      status === 'completed' && 'text-green-500',
                      status === 'running' && 'text-primary bg-primary/10',
                      status === 'pending' && 'text-muted-foreground'
                    )}
                  >
                    {status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : status === 'running' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Circle className="h-4 w-4" />
                    )}
                    <span className="text-center leading-tight">{phase.label}</span>
                  </div>
                );
              })}
            </div>

            {/* Console Output */}
            <DeploymentConsole
              jobId={deployedJobId}
              isRunning={jobStatus?.status === 'running' || jobStatus?.status === 'pending'}
            />
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-between mt-6">
          {step < 4 ? (
            <>
              <Button 
                variant="outline" 
                onClick={step === 1 ? handleClose : () => setStep(step - 1)}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                {step === 1 ? 'Cancel' : 'Back'}
              </Button>
              <Button 
                onClick={step === 3 ? handleDeploy : () => setStep(step + 1)}
                disabled={!canProceed() || isDeploying}
              >
                {isDeploying ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Deploying...
                  </>
                ) : step === 3 ? (
                  <>
                    <Rocket className="h-4 w-4 mr-2" />
                    Deploy
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </>
          ) : (
            <div className="w-full flex justify-end">
              <Button 
                onClick={() => {
                  if (jobStatus?.status === 'completed') {
                    onSuccess?.();
                  }
                  handleClose();
                }}
              >
                {jobStatus?.status === 'completed' ? 'Done' : 'Close'}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
