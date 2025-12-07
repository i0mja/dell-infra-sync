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
  AlertCircle
} from 'lucide-react';
import { useZfsTemplates, ZfsTargetTemplate } from '@/hooks/useZfsTemplates';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface DeployZfsTargetWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface DeploymentConfig {
  template_id: string;
  vm_name: string;
  ip_address: string;
  subnet_mask: string;
  gateway: string;
  dns_servers: string;
  hostname: string;
  zfs_pool_name: string;
  zfs_disk_gb: number;
  nfs_network: string;
  cpu_count: number;
  memory_gb: number;
}

const initialConfig: DeploymentConfig = {
  template_id: '',
  vm_name: '',
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

export function DeployZfsTargetWizard({ open, onOpenChange, onSuccess }: DeployZfsTargetWizardProps) {
  const { templates, loading: templatesLoading, deployFromTemplate, isDeploying } = useZfsTemplates();
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState<DeploymentConfig>(initialConfig);
  const [selectedTemplate, setSelectedTemplate] = useState<ZfsTargetTemplate | null>(null);
  const [deployedJobId, setDeployedJobId] = useState<string | null>(null);
  
  const activeTemplates = templates.filter(t => t.is_active);

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
        ip_address: config.ip_address,
        subnet_mask: config.subnet_mask,
        gateway: config.gateway,
        dns_servers: config.dns_servers ? config.dns_servers.split(',').map(s => s.trim()) : undefined,
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

  const canProceed = () => {
    switch (step) {
      case 1:
        return !!selectedTemplate;
      case 2:
        return config.vm_name && config.ip_address && config.subnet_mask && config.gateway;
      case 3:
        return true;
      default:
        return false;
    }
  };

  const getJobProgress = () => {
    if (!jobStatus) return 0;
    switch (jobStatus.status) {
      case 'pending': return 10;
      case 'running': return 50;
      case 'completed': return 100;
      case 'failed': return 100;
      default: return 0;
    }
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
                  
                  <div className="text-muted-foreground">IP Address</div>
                  <div className="font-medium">{config.ip_address}</div>
                  
                  <div className="text-muted-foreground">Gateway</div>
                  <div className="font-medium">{config.gateway}</div>
                  
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
          <div className="space-y-6 py-4">
            <div className="text-center">
              {jobStatus?.status === 'completed' ? (
                <>
                  <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">Deployment Complete!</h3>
                  <p className="text-muted-foreground">
                    The ZFS target has been deployed and registered.
                  </p>
                </>
              ) : jobStatus?.status === 'failed' ? (
                <>
                  <AlertCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">Deployment Failed</h3>
                  <p className="text-muted-foreground">
                    {(jobStatus.details as Record<string, unknown>)?.error as string || 'An error occurred during deployment'}
                  </p>
                </>
              ) : (
                <>
                  <Loader2 className="h-16 w-16 text-primary animate-spin mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">Deploying...</h3>
                  <p className="text-muted-foreground mb-4">
                    This may take several minutes
                  </p>
                  <Progress value={getJobProgress()} className="w-64 mx-auto" />
                  <p className="text-sm text-muted-foreground mt-2">
                    Status: {jobStatus?.status || 'Initializing...'}
                  </p>
                </>
              )}
            </div>
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
