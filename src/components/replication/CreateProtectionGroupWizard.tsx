/**
 * Create Protection Group Wizard
 * 
 * Multi-step wizard that handles protection group creation with inline appliance deployment.
 * Each protection group gets its own dedicated ZFS appliance for independent RPO/SLA management.
 * 
 * Flow:
 * 1. Group Settings (name, description, RPO, priority)
 * 2. Source Site (vCenter, cluster, network) 
 * 3. Appliance Setup (select existing or deploy new via OnboardZfsTargetWizard inline)
 * 4. Review & Create
 */

import { useState, useEffect } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Shield,
  Server,
  HardDrive,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  Plus,
  Clock,
  Target,
  AlertTriangle,
  Rocket,
  Settings,
  Info,
} from "lucide-react";
import { useVCenters } from "@/hooks/useVCenters";
import { useReplicationTargets, useProtectionGroups } from "@/hooks/useReplication";
import { useAccessibleDatastores } from "@/hooks/useAccessibleDatastores";
import { useVCenterData } from "@/hooks/useVCenterData";
import { useQuickRefresh } from "@/hooks/useQuickRefresh";
import { RefreshIndicator } from "@/components/ui/RefreshIndicator";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { useToast } from "@/hooks/use-toast";
import { OnboardZfsTargetWizard } from "./OnboardZfsTargetWizard";

interface CreateProtectionGroupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const WIZARD_STEPS = [
  { id: 1, label: 'Group', icon: Shield },
  { id: 2, label: 'Source', icon: Server },
  { id: 3, label: 'Appliance', icon: HardDrive },
  { id: 4, label: 'Review', icon: CheckCircle2 },
];

const RPO_PRESETS = [
  { value: 15, label: '15 minutes', tier: 'Mission Critical' },
  { value: 60, label: '1 hour', tier: 'Business Critical' },
  { value: 240, label: '4 hours', tier: 'Standard' },
  { value: 1440, label: '24 hours', tier: 'Best Effort' },
];

const PRIORITY_OPTIONS = [
  { value: 'critical', label: 'Critical', color: 'bg-red-500' },
  { value: 'high', label: 'High', color: 'bg-amber-500' },
  { value: 'medium', label: 'Medium', color: 'bg-blue-500' },
  { value: 'low', label: 'Low', color: 'bg-muted' },
];

type ApplianceMode = 'existing' | 'deploy_new';

export function CreateProtectionGroupWizard({ open, onOpenChange }: CreateProtectionGroupWizardProps) {
  const { toast } = useToast();
  const { vcenters } = useVCenters();
  const { targets, refetch: refetchTargets } = useReplicationTargets();
  const { createGroup } = useProtectionGroups();
  
  const [currentStep, setCurrentStep] = useState(1);
  const [creating, setCreating] = useState(false);
  
  // Step 1: Group Settings
  const [groupName, setGroupName] = useState("");
  const [description, setDescription] = useState("");
  const [rpoMinutes, setRpoMinutes] = useState(60);
  const [priority, setPriority] = useState("medium");
  
  // Step 2: Source Site
  const [sourceVCenterId, setSourceVCenterId] = useState("");
  const [sourceCluster, setSourceCluster] = useState("all");
  
  // Step 3: Appliance
  const [applianceMode, setApplianceMode] = useState<ApplianceMode>('deploy_new');
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [selectedDatastore, setSelectedDatastore] = useState("");
  const [showDeployWizard, setShowDeployWizard] = useState(false);
  
  // Hooks for data
  const { clusters } = useVCenterData(sourceVCenterId || null);
  const { data: datastores = [] } = useAccessibleDatastores(sourceVCenterId || undefined);
  
  // Quick refresh for vCenter data
  const quickRefresh = useQuickRefresh(sourceVCenterId || null);
  
  // Filter targets for the selected vCenter
  const availableTargets = targets.filter(t => {
    // Find datastores linked to this target that are in the selected vCenter
    const linkedDatastores = datastores.filter(ds => ds.replication_target?.id === t.id);
    return linkedDatastores.length > 0 || !sourceVCenterId;
  });
  
  // Get datastores linked to selected target
  const targetDatastores = datastores.filter(
    ds => ds.replication_target?.id === selectedTargetId
  );
  
  const selectedTarget = targets.find(t => t.id === selectedTargetId);
  
  // Reset form on close
  useEffect(() => {
    if (!open) {
      setCurrentStep(1);
      setGroupName("");
      setDescription("");
      setRpoMinutes(60);
      setPriority("medium");
      setSourceVCenterId("");
      setSourceCluster("all");
      setApplianceMode('deploy_new');
      setSelectedTargetId("");
      setSelectedDatastore("");
    }
  }, [open]);
  
  // Auto-refresh datastores when vCenter is selected
  useEffect(() => {
    if (open && sourceVCenterId) {
      quickRefresh.triggerQuickRefresh(['datastores']);
    }
  }, [open, sourceVCenterId]);
  
  // Auto-select datastore when target is selected (for existing appliance mode)
  useEffect(() => {
    if (selectedTargetId && !selectedDatastore) {
      // First, check if target has a datastore_name set directly
      const target = targets.find(t => t.id === selectedTargetId);
      if (target?.datastore_name) {
        setSelectedDatastore(target.datastore_name);
        return;
      }
      // Otherwise, find the linked datastore from vcenter_datastores
      const linkedDs = datastores.find(ds => ds.replication_target?.id === selectedTargetId);
      if (linkedDs) {
        setSelectedDatastore(linkedDs.name);
      }
    }
  }, [selectedTargetId, targets, datastores, selectedDatastore]);
  
  // Validate current step
  const isStepValid = (step: number): boolean => {
    switch (step) {
      case 1:
        return groupName.trim().length > 0;
      case 2:
        return !!sourceVCenterId;
      case 3:
        if (applianceMode === 'existing') {
          return !!selectedTargetId && !!selectedDatastore;
        }
        // For deploy_new, they must have deployed (we check if target was created)
        return !!selectedTargetId && !!selectedDatastore;
      case 4:
        return true;
      default:
        return false;
    }
  };
  
  const canProceed = isStepValid(currentStep);
  
  const handleNext = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };
  
  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };
  
  // Called when deploy wizard closes for any reason
  const handleDeployWizardClose = (open: boolean) => {
    if (!open) {
      setShowDeployWizard(false);
      // Don't auto-select anything - only onSuccess should set the target
    }
  };
  
  // Called ONLY when deployment actually succeeds with the new target ID
  const handleDeploySuccess = async (newTargetId: string) => {
    await refetchTargets();
    setSelectedTargetId(newTargetId);
    
    // Wait for datastores to refresh, then auto-select linked datastore
    setTimeout(() => {
      const linkedDs = datastores.find(ds => ds.replication_target?.id === newTargetId);
      if (linkedDs) {
        setSelectedDatastore(linkedDs.name);
      }
    }, 1000);
    
    toast({
      title: "Appliance deployed",
      description: "Your ZFS appliance is ready.",
    });
  };
  
  // Handle appliance mode change - clear selections when switching
  const handleApplianceModeChange = (mode: ApplianceMode) => {
    setApplianceMode(mode);
    // Clear selections when switching modes
    setSelectedTargetId("");
    setSelectedDatastore("");
  };
  
  const handleCreate = async () => {
    if (!groupName.trim() || !sourceVCenterId || !selectedTargetId) {
      toast({
        title: "Missing required fields",
        description: "Please complete all required fields",
        variant: "destructive",
      });
      return;
    }
    
    setCreating(true);
    try {
      await createGroup({
        name: groupName,
        description,
        source_vcenter_id: sourceVCenterId,
        protection_datastore: selectedDatastore,
        target_id: selectedTargetId,
        rpo_minutes: rpoMinutes,
        priority,
        is_enabled: true,
      });
      
      toast({
        title: "Protection group created",
        description: `${groupName} is ready for VMs to be added`,
      });
      
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Failed to create protection group",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };
  
  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-6">
      {WIZARD_STEPS.map((step, idx) => {
        const Icon = step.icon;
        const isActive = currentStep === step.id;
        const isCompleted = currentStep > step.id;
        
        return (
          <div key={step.id} className="flex items-center">
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
                isActive 
                  ? 'bg-primary text-primary-foreground' 
                  : isCompleted 
                    ? 'bg-primary/20 text-primary' 
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{step.label}</span>
            </div>
            {idx < WIZARD_STEPS.length - 1 && (
              <ArrowRight className="h-4 w-4 mx-1 text-muted-foreground" />
            )}
          </div>
        );
      })}
    </div>
  );
  
  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="text-center pb-4">
        <h3 className="text-lg font-semibold">Group Settings</h3>
        <p className="text-sm text-muted-foreground">
          Define the protection group and its SLA requirements
        </p>
      </div>
      
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Group Name *</Label>
          <Input
            placeholder="e.g., Production Databases"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            autoFocus
          />
        </div>
        
        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea
            placeholder="Purpose and scope of this protection group..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        
        <div className="space-y-3">
          <Label>Recovery Point Objective (RPO)</Label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {RPO_PRESETS.map((preset) => (
              <Card 
                key={preset.value}
                className={`cursor-pointer transition-all hover:border-primary ${
                  rpoMinutes === preset.value ? 'border-primary bg-primary/5' : ''
                }`}
                onClick={() => setRpoMinutes(preset.value)}
              >
                <CardContent className="p-3 text-center">
                  <div className="font-medium">{preset.label}</div>
                  <div className="text-xs text-muted-foreground">{preset.tier}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm">Custom:</Label>
            <Input
              type="number"
              min={1}
              max={1440}
              value={rpoMinutes}
              onChange={(e) => setRpoMinutes(parseInt(e.target.value) || 60)}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">minutes</span>
          </div>
        </div>
        
        <div className="space-y-3">
          <Label>Priority</Label>
          <div className="flex gap-2 flex-wrap">
            {PRIORITY_OPTIONS.map((opt) => (
              <Badge
                key={opt.value}
                variant={priority === opt.value ? "default" : "outline"}
                className={`cursor-pointer ${priority === opt.value ? opt.color : ''}`}
                onClick={() => setPriority(opt.value)}
              >
                {opt.label}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
  
  const renderStep2 = () => (
    <div className="space-y-6">
      <div className="text-center pb-4">
        <h3 className="text-lg font-semibold">Source Site</h3>
        <p className="text-sm text-muted-foreground">
          Select the vCenter where your VMs are located
        </p>
      </div>
      
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Source vCenter *</Label>
          <Select value={sourceVCenterId} onValueChange={setSourceVCenterId}>
            <SelectTrigger>
              <SelectValue placeholder="Select vCenter" />
            </SelectTrigger>
            <SelectContent>
              {vcenters.map((vc) => (
                <SelectItem key={vc.id} value={vc.id}>
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4" />
                    <span>{vc.name}</span>
                    {vc.datacenter_location && (
                      <span className="text-xs text-muted-foreground">
                        ({vc.datacenter_location})
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        {sourceVCenterId && clusters.length > 0 && (
          <div className="space-y-2">
            <Label>Cluster (optional)</Label>
            <Select value={sourceCluster} onValueChange={setSourceCluster}>
              <SelectTrigger>
                <SelectValue placeholder="All clusters" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clusters</SelectItem>
                {clusters.map((cluster) => (
                  <SelectItem key={cluster.id} value={cluster.cluster_name}>
                    {cluster.cluster_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Optionally limit this protection group to VMs in a specific cluster
            </p>
          </div>
        )}
        
        {sourceVCenterId && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              VMs will be selected after the protection group is created. The appliance
              will be deployed to serve this vCenter's workloads.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
  
  const renderStep3 = () => (
    <div className="space-y-6">
      <div className="text-center pb-4">
        <h3 className="text-lg font-semibold">ZFS Appliance</h3>
        <p className="text-sm text-muted-foreground">
          Each protection group needs its own ZFS appliance for independent SLA management
        </p>
      </div>
      
      <RadioGroup value={applianceMode} onValueChange={(v) => handleApplianceModeChange(v as ApplianceMode)}>
        <div className="grid gap-4">
          {/* Deploy New Option */}
          <Card 
            className={`cursor-pointer transition-all ${
              applianceMode === 'deploy_new' ? 'border-primary bg-primary/5' : ''
            }`}
            onClick={() => setApplianceMode('deploy_new')}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <RadioGroupItem value="deploy_new" id="deploy_new" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="deploy_new" className="text-base font-medium cursor-pointer flex items-center gap-2">
                    <Rocket className="h-4 w-4 text-primary" />
                    Deploy New Appliance
                    <Badge variant="secondary" className="ml-2">Recommended</Badge>
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Deploy a dedicated ZFS appliance specifically for this protection group.
                    Ensures isolated resources and independent SLA management.
                  </p>
                  
                  {applianceMode === 'deploy_new' && (
                    <div className="mt-4">
                      {!selectedTargetId ? (
                        <Button onClick={() => setShowDeployWizard(true)}>
                          <Plus className="h-4 w-4 mr-2" />
                          Launch Appliance Wizard
                        </Button>
                      ) : (
                        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                          <div className="flex items-center gap-2 text-green-600">
                            <CheckCircle2 className="h-4 w-4" />
                            <span className="font-medium">Appliance Ready</span>
                          </div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {selectedTarget?.name} • {selectedTarget?.hostname}
                          </div>
                          {selectedDatastore && (
                            <div className="text-sm text-muted-foreground">
                              Datastore: {selectedDatastore}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Use Existing Option */}
          <Card 
            className={`cursor-pointer transition-all ${
              applianceMode === 'existing' ? 'border-primary bg-primary/5' : ''
            }`}
            onClick={() => setApplianceMode('existing')}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <RadioGroupItem value="existing" id="existing" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="existing" className="text-base font-medium cursor-pointer flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Use Existing Appliance
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Select an existing ZFS appliance. Note: Sharing appliances between
                    protection groups may affect SLA isolation.
                  </p>
                  
                  {applianceMode === 'existing' && (
                    <div className="mt-4 space-y-4">
                      {availableTargets.length === 0 ? (
                        <Alert>
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                            No existing appliances found for the selected vCenter.
                            Deploy a new appliance instead.
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <>
                          <div className="space-y-2">
                            <Label>ZFS Appliance</Label>
                            <Select value={selectedTargetId} onValueChange={setSelectedTargetId}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select appliance" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableTargets.map((target) => (
                                  <SelectItem key={target.id} value={target.id}>
                                    <div className="flex items-center gap-2">
                                      <Target className="h-4 w-4" />
                                      <span>{target.name}</span>
                                      <span className="text-xs text-muted-foreground">
                                        ({target.hostname})
                                      </span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          
                          {selectedTargetId && targetDatastores.length > 0 && (
                            <div className="space-y-2">
                              <Label>Protection Datastore</Label>
                              <Select value={selectedDatastore} onValueChange={setSelectedDatastore}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select datastore" />
                                </SelectTrigger>
                                <SelectContent>
                                  {targetDatastores.map((ds) => (
                                    <SelectItem key={ds.id} value={ds.name}>
                                      <div className="flex items-center gap-2">
                                        <HardDrive className="h-4 w-4" />
                                        <span>{ds.name}</span>
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </RadioGroup>
    </div>
  );
  
  const renderStep4 = () => (
    <div className="space-y-6">
      <div className="text-center pb-4">
        <h3 className="text-lg font-semibold">Review & Create</h3>
        <p className="text-sm text-muted-foreground">
          Confirm your protection group settings
        </p>
      </div>
      
      <div className="space-y-4">
        {/* Group Summary */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b">
              <Shield className="h-4 w-4 text-primary" />
              <span className="font-medium">Protection Group</span>
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Name</div>
                <div className="font-medium">{groupName}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Priority</div>
                <Badge className={PRIORITY_OPTIONS.find(p => p.value === priority)?.color}>
                  {PRIORITY_OPTIONS.find(p => p.value === priority)?.label}
                </Badge>
              </div>
              <div>
                <div className="text-muted-foreground">RPO Target</div>
                <div className="font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {rpoMinutes} minutes
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">SLA Tier</div>
                <div className="font-medium">
                  {RPO_PRESETS.find(p => p.value === rpoMinutes)?.tier || 'Custom'}
                </div>
              </div>
            </div>
            
            {description && (
              <div className="text-sm pt-2 border-t">
                <div className="text-muted-foreground mb-1">Description</div>
                <div>{description}</div>
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* Source Site */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b">
              <Server className="h-4 w-4" />
              <span className="font-medium">Source Site</span>
            </div>
            
            <div className="text-sm">
              <div className="text-muted-foreground">vCenter</div>
              <div className="font-medium">
                {vcenters.find(v => v.id === sourceVCenterId)?.name || sourceVCenterId}
              </div>
            </div>
            
            {sourceCluster && (
              <div className="text-sm">
                <div className="text-muted-foreground">Cluster</div>
                <div className="font-medium">{sourceCluster}</div>
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* Appliance */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b">
              <HardDrive className="h-4 w-4" />
              <span className="font-medium">ZFS Appliance</span>
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Appliance</div>
                <div className="font-medium">{selectedTarget?.name || 'Not selected'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Host</div>
                <div className="font-medium">{selectedTarget?.hostname || '-'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Pool</div>
                <div className="font-medium">{selectedTarget?.zfs_pool || '-'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Datastore</div>
                <div className="font-medium">{selectedDatastore || '-'}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            After creation, you can add VMs to this protection group and configure
            replication schedules from the Protection Groups panel.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
  
  const renderCurrentStep = () => {
    switch (currentStep) {
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      case 4: return renderStep4();
      default: return null;
    }
  };
  
  return (
    <>
      <Dialog open={open && !showDeployWizard} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Create Protection Group
            </DialogTitle>
            <DialogDescription>
              Configure a new protection group with dedicated replication infrastructure
            </DialogDescription>
          </DialogHeader>
          
          {renderStepIndicator()}
          
          <div className="min-h-[400px]">
            {renderCurrentStep()}
          </div>
          
          <div className="flex items-center justify-between pt-4 border-t">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={currentStep === 1}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            
            {currentStep < 4 ? (
              <Button onClick={handleNext} disabled={!canProceed}>
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button onClick={handleCreate} disabled={creating || !canProceed}>
                {creating ? 'Creating...' : 'Create Protection Group'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Inline Appliance Deployment Wizard */}
      <OnboardZfsTargetWizard
        open={showDeployWizard}
        onOpenChange={handleDeployWizardClose}
        onSuccess={handleDeploySuccess}
        preselectedVCenterId={sourceVCenterId}
      />
    </>
  );
}
