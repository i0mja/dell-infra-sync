import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { 
  Info, 
  Plus, 
  X, 
  Loader2, 
  CheckCircle, 
  AlertTriangle,
  Server,
  Clock,
  Shield
} from "lucide-react";
import { WorkflowExecutionViewer } from "./WorkflowExecutionViewer";

interface ClusterUpdateWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preSelectedCluster?: string;
}

interface FirmwareUpdate {
  component: string;
  version: string;
  image_uri: string;
  reboot_required: boolean;
}

interface ClusterInfo {
  name: string;
  totalHosts: number;
  linkedServers: number;
  connectedHosts: number;
}

const STEPS = [
  { id: 1, name: 'Cluster Selection', icon: Server },
  { id: 2, name: 'Firmware Selection', icon: Shield },
  { id: 3, name: 'Configuration', icon: Clock },
  { id: 4, name: 'Review & Confirm', icon: CheckCircle },
  { id: 5, name: 'Execution', icon: Loader2 },
];

export const ClusterUpdateWizard = ({
  open,
  onOpenChange,
  preSelectedCluster
}: ClusterUpdateWizardProps) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [clusters, setClusters] = useState<string[]>([]);
  
  // Step 1: Cluster Selection
  const [selectedCluster, setSelectedCluster] = useState(preSelectedCluster || '');
  const [clusterInfo, setClusterInfo] = useState<ClusterInfo | null>(null);
  const [safetyCheckLoading, setSafetyCheckLoading] = useState(false);
  const [safetyCheckPassed, setSafetyCheckPassed] = useState(false);
  
  // Step 2: Firmware Selection
  const [firmwareUpdates, setFirmwareUpdates] = useState<any[]>([{
    component: '',
    version: '',
    image_uri: '',
    reboot_required: true
  }]);
  
  // Step 3: Configuration
  const [backupScp, setBackupScp] = useState(true);
  const [minHealthyHosts, setMinHealthyHosts] = useState(2);
  const [maxParallel, setMaxParallel] = useState(1);
  const [verifyAfterEach, setVerifyAfterEach] = useState(true);
  const [continueOnFailure, setContinueOnFailure] = useState(false);
  
  // Step 4: Review
  const [confirmed, setConfirmed] = useState(false);
  
  // Step 5: Execution
  const [jobId, setJobId] = useState<string | null>(null);

  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (open) {
      fetchClusters();
      if (preSelectedCluster) {
        setSelectedCluster(preSelectedCluster);
      }
    }
  }, [open, preSelectedCluster]);

  useEffect(() => {
    if (selectedCluster) {
      fetchClusterInfo();
    }
  }, [selectedCluster]);

  const fetchClusters = async () => {
    const { data } = await supabase
      .from("vcenter_hosts")
      .select("cluster")
      .not("cluster", "is", null);
    
    if (data) {
      const uniqueClusters = [...new Set(data.map(h => h.cluster).filter(Boolean))];
      setClusters(uniqueClusters as string[]);
    }
  };

  const fetchClusterInfo = async () => {
    const { data: hosts } = await supabase
      .from("vcenter_hosts")
      .select("id, server_id, status")
      .eq("cluster", selectedCluster);
    
    if (hosts) {
      setClusterInfo({
        name: selectedCluster,
        totalHosts: hosts.length,
        linkedServers: hosts.filter(h => h.server_id).length,
        connectedHosts: hosts.filter(h => h.status === 'connected').length
      });
    }
  };

  const runSafetyCheck = async () => {
    setSafetyCheckLoading(true);
    try {
      // Simulate safety check - in real implementation this would call an edge function
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (clusterInfo && clusterInfo.connectedHosts >= minHealthyHosts) {
        setSafetyCheckPassed(true);
        toast({
          title: "Safety check passed",
          description: `Cluster has ${clusterInfo.connectedHosts} healthy hosts.`,
        });
      } else {
        throw new Error(`Insufficient healthy hosts. Found ${clusterInfo?.connectedHosts}, need ${minHealthyHosts}`);
      }
    } catch (error: any) {
      toast({
        title: "Safety check failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSafetyCheckLoading(false);
    }
  };

  const addFirmwareUpdate = () => {
    setFirmwareUpdates([...firmwareUpdates, {
      component: '',
      version: '',
      image_uri: '',
      reboot_required: true
    }]);
  };

  const removeFirmwareUpdate = (index: number) => {
    setFirmwareUpdates(firmwareUpdates.filter((_, i) => i !== index));
  };

  const updateFirmware = (index: number, field: keyof FirmwareUpdate, value: any) => {
    const updated = [...firmwareUpdates];
    updated[index][field] = value;
    setFirmwareUpdates(updated);
  };

  const canProceedToNextStep = () => {
    switch (currentStep) {
      case 1:
        return selectedCluster && clusterInfo && safetyCheckPassed;
      case 2:
        return firmwareUpdates.length > 0 && 
               firmwareUpdates.every(f => f.component && f.version && f.image_uri);
      case 3:
        return true;
      case 4:
        return confirmed;
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (currentStep < 5) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleExecute = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("jobs")
        .insert([{
          job_type: 'rolling_cluster_update' as any,
          created_by: user?.id!,
          target_scope: { cluster_id: selectedCluster } as any,
          details: {
            cluster_id: selectedCluster,
            firmware_updates: firmwareUpdates,
            backup_scp: backupScp,
            min_healthy_hosts: minHealthyHosts,
            max_parallel: maxParallel,
            verify_after_each: verifyAfterEach,
            continue_on_failure: continueOnFailure
          } as any,
          status: 'pending'
        }])
        .select()
        .single();

      if (error) throw error;

      setJobId(data.id);
      setCurrentStep(5);
      
      toast({
        title: "Rolling update started",
        description: "The cluster update workflow has been initiated.",
      });
    } catch (error: any) {
      toast({
        title: "Error starting update",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const estimatedTime = () => {
    if (!clusterInfo) return 0;
    const hostsToUpdate = Math.ceil(clusterInfo.linkedServers / maxParallel);
    const timePerHost = firmwareUpdates.length * 15; // 15 min per firmware update
    return hostsToUpdate * timePerHost;
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Select Cluster</Label>
              <Select value={selectedCluster} onValueChange={setSelectedCluster}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a cluster" />
                </SelectTrigger>
                <SelectContent>
                  {clusters.map(cluster => (
                    <SelectItem key={cluster} value={cluster}>
                      {cluster}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {clusterInfo && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Cluster Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Total Hosts:</span>
                    <Badge>{clusterInfo.totalHosts}</Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Linked Servers:</span>
                    <Badge>{clusterInfo.linkedServers}</Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Connected Hosts:</span>
                    <Badge variant={clusterInfo.connectedHosts >= minHealthyHosts ? "default" : "destructive"}>
                      {clusterInfo.connectedHosts}
                    </Badge>
                  </div>
                  <Separator className="my-3" />
                  <Button 
                    onClick={runSafetyCheck} 
                    disabled={safetyCheckLoading || safetyCheckPassed}
                    className="w-full"
                  >
                    {safetyCheckLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {safetyCheckPassed ? (
                      <>
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Safety Check Passed
                      </>
                    ) : (
                      'Run Safety Check'
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Firmware Updates</Label>
              <Button type="button" variant="outline" size="sm" onClick={addFirmwareUpdate}>
                <Plus className="h-4 w-4 mr-1" />
                Add Firmware
              </Button>
            </div>

            {firmwareUpdates.map((firmware, index) => (
              <Card key={index}>
                <CardContent className="pt-6 space-y-3">
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <Input
                      placeholder="Component (e.g., BIOS, iDRAC)"
                      value={firmware.component}
                      onChange={(e) => updateFirmware(index, 'component', e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFirmwareUpdate(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <Input
                    placeholder="Version"
                    value={firmware.version}
                    onChange={(e) => updateFirmware(index, 'version', e.target.value)}
                  />
                  <Input
                    placeholder="Firmware Image URI (HTTP/HTTPS)"
                    value={firmware.image_uri}
                    onChange={(e) => updateFirmware(index, 'image_uri', e.target.value)}
                  />
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id={`reboot-${index}`}
                      checked={firmware.reboot_required}
                      onCheckedChange={(checked) => updateFirmware(index, 'reboot_required', checked)}
                    />
                    <Label htmlFor={`reboot-${index}`} className="font-normal">
                      Reboot required
                    </Label>
                  </div>
                </CardContent>
              </Card>
            ))}

            {firmwareUpdates.length === 0 && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Add at least one firmware update to proceed.
                </AlertDescription>
              </Alert>
            )}
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="backup"
                checked={backupScp}
                onCheckedChange={(checked) => setBackupScp(checked as boolean)}
              />
              <Label htmlFor="backup">Create SCP backup for each host before update</Label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="minHealthy">Minimum Healthy Hosts</Label>
                <Input
                  id="minHealthy"
                  type="number"
                  min={1}
                  value={minHealthyHosts}
                  onChange={(e) => setMinHealthyHosts(parseInt(e.target.value) || 1)}
                />
                <p className="text-xs text-muted-foreground">
                  Updates will pause if cluster drops below this threshold
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxParallel">Max Parallel Updates</Label>
                <Input
                  id="maxParallel"
                  type="number"
                  min={1}
                  max={5}
                  value={maxParallel}
                  onChange={(e) => setMaxParallel(parseInt(e.target.value) || 1)}
                />
                <p className="text-xs text-muted-foreground">
                  How many hosts to update simultaneously
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="verify"
                checked={verifyAfterEach}
                onCheckedChange={(checked) => setVerifyAfterEach(checked as boolean)}
              />
              <Label htmlFor="verify">Verify each host after update</Label>
            </div>

            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Advanced Option</AlertTitle>
              <AlertDescription>
                <div className="mt-2 flex items-center space-x-2">
                  <Checkbox
                    id="continueOnFail"
                    checked={continueOnFailure}
                    onCheckedChange={(checked) => setContinueOnFailure(checked as boolean)}
                  />
                  <Label htmlFor="continueOnFail" className="font-normal">
                    Continue updating other hosts even if one fails
                  </Label>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        );

      case 4:
        return (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cluster</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name:</span>
                    <span className="font-medium">{selectedCluster}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Hosts to update:</span>
                    <span className="font-medium">{clusterInfo?.linkedServers}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Firmware Updates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {firmwareUpdates.map((fw, index) => (
                  <div key={index} className="text-sm flex justify-between">
                    <span>{fw.component}</span>
                    <Badge variant="outline">{fw.version}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Configuration</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <div className="flex justify-between">
                  <span>SCP Backups:</span>
                  <span>{backupScp ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Min Healthy Hosts:</span>
                  <span>{minHealthyHosts}</span>
                </div>
                <div className="flex justify-between">
                  <span>Max Parallel:</span>
                  <span>{maxParallel}</span>
                </div>
                <div className="flex justify-between">
                  <span>Verify After Each:</span>
                  <span>{verifyAfterEach ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Estimated Time:</span>
                  <Badge>{estimatedTime()} minutes</Badge>
                </div>
              </CardContent>
            </Card>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Warning</AlertTitle>
              <AlertDescription>
                <div className="mt-2 flex items-center space-x-2">
                  <Checkbox
                    id="confirm"
                    checked={confirmed}
                    onCheckedChange={(checked) => setConfirmed(checked as boolean)}
                  />
                  <Label htmlFor="confirm" className="font-normal">
                    I understand this will cause host reboots and potential VM downtime
                  </Label>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        );

      case 5:
        return (
          <div className="space-y-4">
            {jobId && (
              <WorkflowExecutionViewer 
                jobId={jobId} 
                workflowType="rolling_cluster_update" 
              />
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rolling Cluster Update Wizard</DialogTitle>
          <DialogDescription>
            Guided workflow for orchestrating cluster-wide firmware updates
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center justify-between mb-6">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
                currentStep >= step.id 
                  ? 'border-primary bg-primary text-primary-foreground' 
                  : 'border-muted bg-background'
              }`}>
                {currentStep > step.id ? (
                  <CheckCircle className="h-5 w-5" />
                ) : (
                  <step.icon className="h-5 w-5" />
                )}
              </div>
              {index < STEPS.length - 1 && (
                <div className={`w-16 h-0.5 mx-2 ${
                  currentStep > step.id ? 'bg-primary' : 'bg-muted'
                }`} />
              )}
            </div>
          ))}
        </div>

        <div className="py-4">
          <h3 className="text-lg font-semibold mb-4">
            Step {currentStep}: {STEPS[currentStep - 1].name}
          </h3>
          {renderStepContent()}
        </div>

        {/* Navigation */}
        <div className="flex justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 1 || currentStep === 5}
          >
            Back
          </Button>

          <div className="flex gap-2">
            {currentStep < 4 && (
              <Button
                onClick={handleNext}
                disabled={!canProceedToNextStep()}
              >
                Next
              </Button>
            )}
            {currentStep === 4 && (
              <Button
                onClick={handleExecute}
                disabled={!canProceedToNextStep() || loading}
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Start Update
              </Button>
            )}
            {currentStep === 5 && (
              <Button onClick={() => onOpenChange(false)}>
                Close
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
