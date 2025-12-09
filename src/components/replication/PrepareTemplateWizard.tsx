/**
 * PrepareTemplateWizard
 * 
 * 5-step wizard to prepare a baseline ZFS appliance template:
 * Step 1: Select VM - Choose existing VM to convert to template
 * Step 2: Connect - SSH to VM, verify connectivity
 * Step 3: Configure - Install packages, create user, set up SSH key
 * Step 4: Clean - Clear machine-id, SSH host keys, cloud-init
 * Step 5: Convert - Power off, convert to VMware template
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  PowerOff,
  Plug,
  Package,
  Trash2,
  FileBox,
  Terminal,
} from "lucide-react";
import { useVCenters } from "@/hooks/useVCenters";
import { useVCenterVMs } from "@/hooks/useVCenterVMs";
import { useSshKeys } from "@/hooks/useSshKeys";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface PrepareTemplateWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedVCenterId?: string;
}

const WIZARD_STEPS = [
  { id: 1, label: 'Select', icon: Server },
  { id: 2, label: 'Connect', icon: Plug },
  { id: 3, label: 'Configure', icon: Package },
  { id: 4, label: 'Clean', icon: Trash2 },
  { id: 5, label: 'Convert', icon: FileBox },
];

const DEFAULT_PACKAGES = [
  { name: 'zfsutils-linux', description: 'ZFS filesystem utilities', required: true },
  { name: 'nfs-kernel-server', description: 'NFS server for datastore exports', required: true },
  { name: 'open-vm-tools', description: 'VMware Tools for guest integration', required: true },
  { name: 'parted', description: 'Disk partitioning utility', required: false },
  { name: 'htop', description: 'System monitoring utility', required: false },
];

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
  
  // Step 1: Select VM
  const [selectedVCenterId, setSelectedVCenterId] = useState(preselectedVCenterId || "");
  const [selectedVMId, setSelectedVMId] = useState("");
  const [templateName, setTemplateName] = useState("");
  
  // Step 2: Connect
  const [selectedSshKeyId, setSelectedSshKeyId] = useState("");
  const [rootPassword, setRootPassword] = useState("");
  const [sshTestResult, setSshTestResult] = useState<'success' | 'failed' | null>(null);
  const [testingSsh, setTestingSsh] = useState(false);
  
  // Step 3: Configure
  const [installPackages, setInstallPackages] = useState(true);
  const [selectedPackages, setSelectedPackages] = useState<string[]>(
    DEFAULT_PACKAGES.filter(p => p.required).map(p => p.name)
  );
  const [createUser, setCreateUser] = useState(true);
  const [username, setUsername] = useState("zfsadmin");
  const [deployKey, setDeployKey] = useState(true);
  
  // Step 4: Clean
  const [clearMachineId, setClearMachineId] = useState(true);
  const [clearSshHostKeys, setClearSshHostKeys] = useState(true);
  const [cleanCloudInit, setCleanCloudInit] = useState(true);
  
  // Step 5: Convert
  const [convertToTemplate, setConvertToTemplate] = useState(true);
  const [powerOffFirst, setPowerOffFirst] = useState(true);
  
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
      setSelectedVCenterId(preselectedVCenterId || "");
      setSelectedVMId("");
      setTemplateName("");
      setSelectedSshKeyId("");
      setRootPassword("");
      setSshTestResult(null);
      setTestingSsh(false);
      setInstallPackages(true);
      setSelectedPackages(DEFAULT_PACKAGES.filter(p => p.required).map(p => p.name));
      setCreateUser(true);
      setUsername("zfsadmin");
      setDeployKey(true);
      setClearMachineId(true);
      setClearSshHostKeys(true);
      setCleanCloudInit(true);
      setConvertToTemplate(true);
      setPowerOffFirst(true);
    }
  }, [open, preselectedVCenterId]);
  
  // Auto-populate template name from VM
  useEffect(() => {
    if (selectedVM && !templateName) {
      setTemplateName(`zfs-appliance-template-${selectedVM.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`);
    }
  }, [selectedVM, templateName]);
  
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
          job_type: 'test_ssh_connection',
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
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'prepare_zfs_template' as const,
          status: 'pending',
          created_by: user?.user?.id,
          target_scope: { 
            vcenter_id: selectedVCenterId,
            vm_id: selectedVMId 
          },
          details: {
            template_name: templateName,
            vm_moref: (selectedVM as any)?.vcenter_id || selectedVM?.id,
            install_packages: installPackages,
            packages: selectedPackages,
            create_user: createUser,
            username: username,
            ssh_key_id: deployKey ? selectedSshKeyId : undefined,
            root_password: rootPassword,
            cleanup: {
              clear_machine_id: clearMachineId,
              clear_ssh_host_keys: clearSshHostKeys,
              clean_cloud_init: cleanCloudInit,
            },
            power_off_first: powerOffFirst,
            convert_to_template: convertToTemplate,
          }
        })
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
        
        if (jobResult?.status === 'completed') {
          clearInterval(pollInterval);
          toast({ title: 'Template preparation complete', description: 'VM is now ready as a ZFS appliance template' });
        } else if (jobResult?.status === 'failed') {
          clearInterval(pollInterval);
          toast({ 
            title: 'Template preparation failed', 
            description: (jobResult?.details as Record<string, unknown>)?.error as string || 'Unknown error',
            variant: 'destructive' 
          });
        } else if (attempts >= 120) { // 4 minute timeout
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
        return !!selectedVCenterId && !!selectedVMId && !!templateName;
      case 2: 
        return !!rootPassword && sshTestResult === 'success';
      case 3: 
        return !installPackages || selectedPackages.length > 0;
      case 4: 
        return true; // All optional
      case 5: 
        return !jobId || jobStatus === 'completed' || jobStatus === 'failed';
      default: 
        return false;
    }
  };
  
  const isJobRunning = jobStatus === 'running' || jobStatus === 'pending';
  const isJobComplete = jobStatus === 'completed';
  
  const handleNext = () => {
    if (currentStep < 5 && canProceedFromStep(currentStep)) {
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
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileBox className="h-5 w-5" />
            Prepare ZFS Appliance Template
          </DialogTitle>
          <DialogDescription>
            Configure a VM as a baseline ZFS appliance template for rapid deployment
          </DialogDescription>
        </DialogHeader>
        
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-1 py-3 border-b shrink-0">
          {WIZARD_STEPS.map((step, index) => {
            const Icon = step.icon;
            const isActive = currentStep === step.id;
            const isComplete = currentStep > step.id || isJobComplete;
            
            return (
              <div key={step.id} className="flex items-center">
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
                  <span className="hidden sm:inline">{step.label}</span>
                </div>
                {index < WIZARD_STEPS.length - 1 && (
                  <div className={`w-4 h-0.5 mx-0.5 ${
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
                <p className="text-xs text-muted-foreground">
                  Only powered-on VMs can be prepared as templates
                </p>
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
              
              <div className="space-y-2">
                <Label>Template Name</Label>
                <Input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g., zfs-appliance-template-v1"
                />
              </div>
            </div>
          )}
          
          {/* Step 2: Connect */}
          {currentStep === 2 && (
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
          
          {/* Step 3: Configure */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="install-packages"
                  checked={installPackages}
                  onCheckedChange={(checked) => setInstallPackages(!!checked)}
                />
                <Label htmlFor="install-packages">Install ZFS/NFS packages</Label>
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
                    <span className="text-muted-foreground ml-2">(select key in Step 2)</span>
                  )}
                </Label>
              </div>
            </div>
          )}
          
          {/* Step 4: Clean */}
          {currentStep === 4 && (
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
              </div>
            </div>
          )}
          
          {/* Step 5: Convert */}
          {currentStep === 5 && (
            <div className="space-y-4">
              <div className="space-y-3">
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
                  <p><span className="text-muted-foreground">Template Name:</span> {templateName}</p>
                  <p><span className="text-muted-foreground">Source VM:</span> {selectedVM?.name}</p>
                  <p><span className="text-muted-foreground">Packages:</span> {selectedPackages.length} selected</p>
                  <p><span className="text-muted-foreground">Service User:</span> {createUser ? username : 'Not creating'}</p>
                </div>
              </div>
              
              {/* Job status */}
              {jobId && (
                <div className="p-4 rounded-lg border space-y-2">
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
                </div>
              )}
              
              {!jobId && (
                <Button 
                  onClick={startPreparation} 
                  className="w-full"
                  disabled={!canProceedFromStep(4)}
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
              {currentStep < 5 && (
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
