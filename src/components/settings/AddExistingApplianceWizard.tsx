/**
 * AddExistingApplianceWizard
 * 
 * Smart discovery wizard for adding already-prepared ZFS templates to the library.
 * Auto-detects ZFS configuration, NFS exports, and VM specs via SSH inspection.
 * 
 * Steps:
 * 1. Select Template - Choose vCenter and template VM
 * 2. SSH Credentials - Provide authentication for inspection
 * 3. Discovery - Auto-detect ZFS config, NFS exports, VM specs
 * 4. Review & Customize - Review detected settings, override if needed
 * 5. Confirm - Final summary and add to library
 */

import { useState, useEffect, useMemo } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Server,
  Key,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Database,
  Network,
  Cpu,
  HardDrive,
  Settings,
  AlertTriangle,
  Check,
  X,
} from "lucide-react";
import { useVCenters } from "@/hooks/useVCenters";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useZfsTemplates } from "@/hooks/useZfsTemplates";
import { useSshKeys } from "@/hooks/useSshKeys";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AddExistingApplianceWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DiscoveryResult {
  ssh_connected: boolean;
  os_info?: {
    family: string;
    version: string;
    hostname: string;
  };
  zfs_status?: {
    installed: boolean;
    pool_name?: string;
    pool_size?: string;
    pool_free?: string;
    pool_health?: string;
    disk_device?: string;
  };
  nfs_exports?: {
    configured: boolean;
    network?: string;
  };
  vm_specs?: {
    cpu_count: number;
    memory_mb: number;
    disk_gb: number;
  };
  errors?: string[];
}

const WIZARD_STEPS = [
  { id: 1, label: 'Template', icon: Server },
  { id: 2, label: 'SSH', icon: Key },
  { id: 3, label: 'Discovery', icon: Search },
  { id: 4, label: 'Review', icon: Settings },
  { id: 5, label: 'Confirm', icon: CheckCircle2 },
];

export function AddExistingApplianceWizard({ open, onOpenChange }: AddExistingApplianceWizardProps) {
  const { toast } = useToast();
  const { vcenters } = useVCenters();
  const { createTemplate, isCreating } = useZfsTemplates();
  const { sshKeys = [] } = useSshKeys();
  
  // Wizard state
  const [currentStep, setCurrentStep] = useState(1);
  
  // Step 1: Select Template
  const [selectedVcenterId, setSelectedVcenterId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  
  // Step 2: SSH Credentials
  const [sshUsername, setSshUsername] = useState("root");
  const [authMethod, setAuthMethod] = useState<"password" | "key">("password");
  const [sshPassword, setSshPassword] = useState("");
  const [selectedSshKeyId, setSelectedSshKeyId] = useState("");
  
  // Step 3: Discovery
  const [discoveryJobId, setDiscoveryJobId] = useState<string | null>(null);
  const [discoveryStatus, setDiscoveryStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [discoveryProgress, setDiscoveryProgress] = useState(0);
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveryResult | null>(null);
  const [discoverySteps, setDiscoverySteps] = useState<Array<{ step: string; status: "pending" | "running" | "success" | "failed" }>>([]);
  
  // Step 4: Review & Customize
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    version: "1.0.0",
    default_zfs_pool_name: "tank",
    default_zfs_disk_path: "/dev/sdb",
    default_nfs_network: "192.168.0.0/16",
    default_ssh_username: "root",
    default_cpu_count: 2,
    default_memory_gb: 4,
    default_zfs_disk_gb: 100,
  });
  
  // Fetch template VMs from selected vCenter
  const { data: templateVMs, isLoading: loadingTemplates } = useQuery({
    queryKey: ['vcenter-template-vms', selectedVcenterId],
    queryFn: async () => {
      if (!selectedVcenterId) return [];
      const { data, error } = await supabase
        .from('vcenter_vms')
        .select('*')
        .eq('source_vcenter_id', selectedVcenterId)
        .eq('is_template', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedVcenterId,
  });

  const selectedTemplate = templateVMs?.find(t => t.id === selectedTemplateId);
  const activeSshKeys = useMemo(() => sshKeys.filter(k => k.status === 'active'), [sshKeys]);
  
  // Reset wizard when dialog opens
  useEffect(() => {
    if (open) {
      setCurrentStep(1);
      setSelectedVcenterId("");
      setSelectedTemplateId("");
      setSshUsername("root");
      setAuthMethod("password");
      setSshPassword("");
      setSelectedSshKeyId("");
      setDiscoveryJobId(null);
      setDiscoveryStatus("idle");
      setDiscoveryProgress(0);
      setDiscoveryResult(null);
      setDiscoverySteps([]);
      setFormData({
        name: "",
        description: "",
        version: "1.0.0",
        default_zfs_pool_name: "tank",
        default_zfs_disk_path: "/dev/sdb",
        default_nfs_network: "192.168.0.0/16",
        default_ssh_username: "root",
        default_cpu_count: 2,
        default_memory_gb: 4,
        default_zfs_disk_gb: 100,
      });
    }
  }, [open]);
  
  // Auto-populate form from template selection
  useEffect(() => {
    if (selectedTemplate) {
      setFormData(prev => ({
        ...prev,
        name: selectedTemplate.name,
        default_cpu_count: selectedTemplate.cpu_count || 2,
        default_memory_gb: Math.round((selectedTemplate.memory_mb || 4096) / 1024),
        default_zfs_disk_gb: Math.round(Number(selectedTemplate.disk_gb) || 100),
      }));
    }
  }, [selectedTemplate]);
  
  // Update form from discovery results
  useEffect(() => {
    if (discoveryResult) {
      setFormData(prev => ({
        ...prev,
        version: discoveryResult.os_info?.version || prev.version,
        default_zfs_pool_name: discoveryResult.zfs_status?.pool_name || prev.default_zfs_pool_name,
        default_zfs_disk_path: discoveryResult.zfs_status?.disk_device || prev.default_zfs_disk_path,
        default_nfs_network: discoveryResult.nfs_exports?.network || prev.default_nfs_network,
        default_cpu_count: discoveryResult.vm_specs?.cpu_count || prev.default_cpu_count,
        default_memory_gb: Math.round((discoveryResult.vm_specs?.memory_mb || prev.default_memory_gb * 1024) / 1024),
        default_zfs_disk_gb: discoveryResult.vm_specs?.disk_gb || prev.default_zfs_disk_gb,
      }));
    }
  }, [discoveryResult]);
  
  // Start discovery job
  const startDiscovery = async () => {
    if (!selectedTemplate) return;
    
    setDiscoveryStatus("running");
    setDiscoveryProgress(0);
    setDiscoveryResult(null);
    setDiscoverySteps([
      { step: "Connecting to vCenter", status: "running" },
      { step: "Powering on template", status: "pending" },
      { step: "Waiting for IP address", status: "pending" },
      { step: "Establishing SSH connection", status: "pending" },
      { step: "Detecting ZFS configuration", status: "pending" },
      { step: "Scanning NFS exports", status: "pending" },
      { step: "Reading VM specifications", status: "pending" },
    ]);
    
    try {
      const { data: user } = await supabase.auth.getUser();
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'inspect_zfs_appliance' as const,
          status: 'pending',
          created_by: user?.user?.id,
          target_scope: {
            vcenter_id: selectedVcenterId,
            template_id: selectedTemplateId,
          },
          details: {
            template_moref: selectedTemplate.vcenter_id,
            template_name: selectedTemplate.name,
            cluster_name: selectedTemplate.cluster_name,
            ssh_username: sshUsername,
            auth_method: authMethod,
            ssh_password: authMethod === 'password' ? sshPassword : undefined,
            ssh_key_id: authMethod === 'key' ? selectedSshKeyId : undefined,
          }
        })
        .select()
        .single();
      
      if (error) throw error;
      
      setDiscoveryJobId(job.id);
      
      // Poll for job completion
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        const { data: jobResult } = await supabase
          .from('jobs')
          .select('status, details')
          .eq('id', job.id)
          .single();
        
        const details = jobResult?.details as Record<string, unknown> | null;
        
        // Update progress
        if (details?.progress_percent) {
          setDiscoveryProgress(details.progress_percent as number);
        }
        
        // Update step statuses
        if (details?.current_step) {
          const currentStepName = details.current_step as string;
          setDiscoverySteps(prev => prev.map(s => ({
            ...s,
            status: s.step === currentStepName ? "running" : 
                   (details?.completed_steps as string[] || []).includes(s.step) ? "success" : 
                   s.status
          })));
        }
        
        if (jobResult?.status === 'completed') {
          clearInterval(pollInterval);
          setDiscoveryProgress(100);
          setDiscoveryStatus("completed");
          setDiscoverySteps(prev => prev.map(s => ({ ...s, status: "success" })));
          
          const result = details?.discovery_result as DiscoveryResult;
          setDiscoveryResult(result);
          
          // Auto-add to library after successful discovery
          const templateData = {
            name: selectedTemplate.name,
            description: `Auto-discovered from ${selectedTemplate.name}`,
            vcenter_id: selectedVcenterId,
            template_moref: selectedTemplate.vcenter_id || '',
            template_name: selectedTemplate.name,
            default_zfs_pool_name: result?.zfs_status?.pool_name || 'tank',
            default_zfs_disk_path: result?.zfs_status?.disk_device || '/dev/sdb',
            default_nfs_network: result?.nfs_exports?.network || '192.168.0.0/16',
            default_ssh_username: sshUsername,
            ssh_key_id: authMethod === 'key' ? selectedSshKeyId : undefined,
            default_cpu_count: result?.vm_specs?.cpu_count || selectedTemplate.cpu_count || 2,
            default_memory_gb: Math.round((result?.vm_specs?.memory_mb || selectedTemplate.memory_mb || 4096) / 1024),
            default_zfs_disk_gb: result?.vm_specs?.disk_gb || Math.round(Number(selectedTemplate.disk_gb) || 100),
            status: 'ready',
            version: result?.os_info?.version || '1.0.0',
          };
          
          try {
            await createTemplate(templateData);
            toast({ title: 'Appliance added to library', description: 'Discovery and registration completed successfully' });
            onOpenChange(false);
          } catch (err) {
            toast({ 
              title: 'Discovery succeeded but failed to add to library', 
              description: err instanceof Error ? err.message : 'Unknown error',
              variant: 'destructive' 
            });
          }
          
        } else if (jobResult?.status === 'failed' || attempts >= 90) {
          clearInterval(pollInterval);
          setDiscoveryStatus("failed");
          
          const errorMsg = details?.error as string || 'Discovery timeout';
          setDiscoveryResult({
            ssh_connected: false,
            errors: [errorMsg]
          });
          
          toast({ 
            title: 'Discovery failed', 
            description: errorMsg,
            variant: 'destructive' 
          });
        }
      }, 2000);
      
    } catch (err) {
      setDiscoveryStatus("failed");
      toast({ 
        title: 'Failed to start discovery', 
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive' 
      });
    }
  };
  
  // Submit to library
  const handleSubmit = async () => {
    if (!selectedVcenterId || !selectedTemplate) return;
    
    try {
      await createTemplate({
        name: formData.name,
        description: formData.description,
        vcenter_id: selectedVcenterId,
        template_moref: selectedTemplate.vcenter_id || '',
        template_name: selectedTemplate.name,
        default_zfs_pool_name: formData.default_zfs_pool_name,
        default_zfs_disk_path: formData.default_zfs_disk_path,
        default_nfs_network: formData.default_nfs_network,
        default_ssh_username: formData.default_ssh_username,
        ssh_key_id: authMethod === 'key' ? selectedSshKeyId : undefined,
        default_cpu_count: formData.default_cpu_count,
        default_memory_gb: formData.default_memory_gb,
        default_zfs_disk_gb: formData.default_zfs_disk_gb,
        status: 'ready', // Already-prepared appliances are ready to use
        version: formData.version,
      });
      
      toast({ title: 'Appliance added to library' });
      onOpenChange(false);
    } catch (err) {
      toast({ 
        title: 'Failed to add appliance', 
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive' 
      });
    }
  };
  
  // Navigation validation
  const canProceedFromStep = (step: number): boolean => {
    switch (step) {
      case 1: return !!selectedVcenterId && !!selectedTemplateId;
      case 2: return !!sshUsername && (authMethod === 'password' ? !!sshPassword : !!selectedSshKeyId);
      case 3: return discoveryStatus === 'completed';
      case 4: return !!formData.name;
      default: return true;
    }
  };
  
  const goNext = () => {
    if (currentStep === 2) {
      // Start discovery when moving from SSH step
      setCurrentStep(3);
      startDiscovery();
    } else if (currentStep < 5) {
      setCurrentStep(currentStep + 1);
    }
  };
  
  const goBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Add Existing ZFS Appliance</DialogTitle>
          <DialogDescription>
            Auto-discover and register an already-prepared ZFS template
          </DialogDescription>
        </DialogHeader>
        
        {/* Step Progress */}
        <div className="flex items-center justify-between px-2 py-4">
          {WIZARD_STEPS.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = currentStep === step.id;
            const isCompleted = currentStep > step.id;
            
            return (
              <div key={step.id} className="flex items-center">
                <div className={cn(
                  "flex items-center justify-center w-10 h-10 rounded-full transition-colors",
                  isActive && "bg-primary text-primary-foreground",
                  isCompleted && "bg-primary/20 text-primary",
                  !isActive && !isCompleted && "bg-muted text-muted-foreground"
                )}>
                  {isCompleted ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <StepIcon className="h-5 w-5" />
                  )}
                </div>
                <span className={cn(
                  "ml-2 text-sm font-medium hidden sm:block",
                  isActive && "text-foreground",
                  !isActive && "text-muted-foreground"
                )}>
                  {step.label}
                </span>
                {index < WIZARD_STEPS.length - 1 && (
                  <div className={cn(
                    "w-8 h-0.5 mx-2",
                    isCompleted ? "bg-primary" : "bg-muted"
                  )} />
                )}
              </div>
            );
          })}
        </div>
        
        <ScrollArea className="h-[350px] pr-4">
          {/* Step 1: Select Template */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>vCenter</Label>
                <Select value={selectedVcenterId} onValueChange={(v) => {
                  setSelectedVcenterId(v);
                  setSelectedTemplateId("");
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select vCenter..." />
                  </SelectTrigger>
                  <SelectContent>
                    {vcenters?.map((vc) => (
                      <SelectItem key={vc.id} value={vc.id}>
                        {vc.name} ({vc.host})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedVcenterId && (
                <div className="space-y-2">
                  <Label>Template VM</Label>
                  {loadingTemplates ? (
                    <div className="flex items-center gap-2 text-muted-foreground py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading templates...
                    </div>
                  ) : templateVMs?.length === 0 ? (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        No template VMs found. Make sure your ZFS appliance is marked as a template in vCenter.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select template VM..." />
                      </SelectTrigger>
                      <SelectContent>
                        {templateVMs?.map((vm) => (
                          <SelectItem key={vm.id} value={vm.id}>
                            {vm.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {selectedTemplate && (
                <div className="rounded-lg border p-4 bg-muted/30 space-y-2">
                  <h4 className="font-medium">Selected Template</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      {selectedTemplate.name}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">OS:</span>
                      {selectedTemplate.guest_os || 'Unknown'}
                    </div>
                    <div className="flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-muted-foreground" />
                      {selectedTemplate.cpu_count || 'N/A'} vCPU
                    </div>
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-muted-foreground" />
                      {selectedTemplate.memory_mb ? `${Math.round(selectedTemplate.memory_mb / 1024)} GB RAM` : 'N/A'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Step 2: SSH Credentials */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <Alert>
                <Key className="h-4 w-4" />
                <AlertDescription>
                  Provide SSH credentials to inspect the template. The wizard will power on the template temporarily to discover its configuration.
                </AlertDescription>
              </Alert>
              
              <div className="space-y-2">
                <Label>SSH Username</Label>
                <Input
                  value={sshUsername}
                  onChange={(e) => setSshUsername(e.target.value)}
                  placeholder="root"
                />
              </div>
              
              <div className="space-y-3">
                <Label>Authentication Method</Label>
                <RadioGroup value={authMethod} onValueChange={(v) => setAuthMethod(v as "password" | "key")}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="password" id="auth-password" />
                    <Label htmlFor="auth-password" className="font-normal">Password</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="key" id="auth-key" />
                    <Label htmlFor="auth-key" className="font-normal">SSH Key</Label>
                  </div>
                </RadioGroup>
              </div>
              
              {authMethod === "password" ? (
                <div className="space-y-2">
                  <Label>Root Password</Label>
                  <Input
                    type="password"
                    value={sshPassword}
                    onChange={(e) => setSshPassword(e.target.value)}
                    placeholder="Enter password..."
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>SSH Key</Label>
                  <Select value={selectedSshKeyId} onValueChange={setSelectedSshKeyId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select SSH key..." />
                    </SelectTrigger>
                    <SelectContent>
                      {activeSshKeys.map((key) => (
                        <SelectItem key={key.id} value={key.id}>
                          {key.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {activeSshKeys.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No SSH keys configured. Add one in Settings → SSH Keys.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          
          {/* Step 3: Discovery */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div className="text-center mb-4">
                <h3 className="text-lg font-medium">Inspecting Template</h3>
                <p className="text-sm text-muted-foreground">
                  Detecting ZFS configuration and VM specifications...
                </p>
              </div>
              
              <Progress value={discoveryProgress} className="h-2" />
              
              <div className="space-y-2">
                {discoverySteps.map((step, index) => (
                  <div key={index} className="flex items-center gap-3 py-2">
                    {step.status === "pending" && (
                      <div className="h-5 w-5 rounded-full border-2 border-muted" />
                    )}
                    {step.status === "running" && (
                      <Loader2 className="h-5 w-5 text-primary animate-spin" />
                    )}
                    {step.status === "success" && (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    )}
                    {step.status === "failed" && (
                      <X className="h-5 w-5 text-destructive" />
                    )}
                    <span className={cn(
                      "text-sm",
                      step.status === "running" && "font-medium",
                      step.status === "pending" && "text-muted-foreground"
                    )}>
                      {step.step}
                    </span>
                  </div>
                ))}
              </div>
              
              {discoveryStatus === "failed" && discoveryResult?.errors && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {discoveryResult.errors[0]}
                  </AlertDescription>
                </Alert>
              )}
              
              {discoveryStatus === "failed" && (
                <div className="flex justify-center">
                  <Button onClick={startDiscovery} variant="outline">
                    <Search className="h-4 w-4 mr-2" />
                    Retry Discovery
                  </Button>
                </div>
              )}
            </div>
          )}
          
          {/* Step 4: Review & Customize */}
          {currentStep === 4 && (
            <div className="space-y-4">
              {/* Discovery Results Summary */}
              {discoveryResult && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className={cn(
                    "rounded-lg border p-3 text-center",
                    discoveryResult.zfs_status?.installed ? "border-green-500/50 bg-green-500/10" : "border-destructive/50 bg-destructive/10"
                  )}>
                    <Database className="h-5 w-5 mx-auto mb-1" />
                    <div className="text-sm font-medium">ZFS</div>
                    <div className="text-xs text-muted-foreground">
                      {discoveryResult.zfs_status?.pool_name || 'Not detected'}
                    </div>
                  </div>
                  <div className={cn(
                    "rounded-lg border p-3 text-center",
                    discoveryResult.nfs_exports?.configured ? "border-green-500/50 bg-green-500/10" : "border-yellow-500/50 bg-yellow-500/10"
                  )}>
                    <Network className="h-5 w-5 mx-auto mb-1" />
                    <div className="text-sm font-medium">NFS</div>
                    <div className="text-xs text-muted-foreground">
                      {discoveryResult.nfs_exports?.configured ? 'Configured' : 'Not found'}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3 text-center border-primary/50 bg-primary/10">
                    <Cpu className="h-5 w-5 mx-auto mb-1" />
                    <div className="text-sm font-medium">Specs</div>
                    <div className="text-xs text-muted-foreground">
                      {discoveryResult.vm_specs?.cpu_count || formData.default_cpu_count} vCPU / {discoveryResult.vm_specs?.memory_mb ? Math.round(discoveryResult.vm_specs.memory_mb / 1024) : formData.default_memory_gb} GB
                    </div>
                  </div>
                </div>
              )}
              
              {/* Editable Form */}
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Library Name *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., ZFS Appliance - Debian 12"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Version</Label>
                    <Input
                      value={formData.version}
                      onChange={(e) => setFormData(prev => ({ ...prev, version: e.target.value }))}
                      placeholder="1.0.0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>SSH Username</Label>
                    <Input
                      value={formData.default_ssh_username}
                      onChange={(e) => setFormData(prev => ({ ...prev, default_ssh_username: e.target.value }))}
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Describe this appliance..."
                    rows={2}
                  />
                </div>
                
                <div className="pt-2 border-t">
                  <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    ZFS Configuration
                    {discoveryResult?.zfs_status?.installed && (
                      <Badge variant="outline" className="text-green-600">Auto-detected</Badge>
                    )}
                  </h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label className="text-xs">Pool Name</Label>
                      <Input
                        value={formData.default_zfs_pool_name}
                        onChange={(e) => setFormData(prev => ({ ...prev, default_zfs_pool_name: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Disk Path</Label>
                      <Input
                        value={formData.default_zfs_disk_path}
                        onChange={(e) => setFormData(prev => ({ ...prev, default_zfs_disk_path: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">NFS Network</Label>
                      <Input
                        value={formData.default_nfs_network}
                        onChange={(e) => setFormData(prev => ({ ...prev, default_nfs_network: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Step 5: Confirm */}
          {currentStep === 5 && (
            <div className="space-y-4">
              <div className="text-center mb-4">
                <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-2" />
                <h3 className="text-lg font-medium">Ready to Add</h3>
                <p className="text-sm text-muted-foreground">
                  Review the configuration below and confirm to add this appliance to your library.
                </p>
              </div>
              
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">{formData.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Template</span>
                  <span>{selectedTemplate?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Version</span>
                  <span>{formData.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ZFS Pool</span>
                  <span>{formData.default_zfs_pool_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">NFS Network</span>
                  <span>{formData.default_nfs_network}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Default Sizing</span>
                  <span>{formData.default_cpu_count} vCPU / {formData.default_memory_gb} GB / {formData.default_zfs_disk_gb} GB disk</span>
                </div>
              </div>
              
              {discoveryResult?.zfs_status?.pool_health && discoveryResult.zfs_status.pool_health !== 'ONLINE' && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    ZFS pool health is {discoveryResult.zfs_status.pool_health}. Consider fixing this before using the template.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </ScrollArea>
        
        {/* Footer Navigation */}
        <div className="flex justify-between pt-4 border-t">
          <Button variant="outline" onClick={() => currentStep === 1 ? onOpenChange(false) : goBack()}>
            {currentStep === 1 ? 'Cancel' : (
              <>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </>
            )}
          </Button>
          
          {currentStep < 5 ? (
            <Button 
              onClick={goNext} 
              disabled={!canProceedFromStep(currentStep) || (currentStep === 3 && discoveryStatus === 'running')}
            >
              {currentStep === 3 && discoveryStatus === 'running' ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Discovering...
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Add to Library
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
