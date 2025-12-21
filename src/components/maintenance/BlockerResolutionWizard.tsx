import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  ChevronLeft, 
  ChevronRight, 
  Check, 
  AlertTriangle, 
  XCircle, 
  Server, 
  Usb, 
  HardDrive,
  Cpu,
  MonitorPlay,
  ShieldAlert,
  Loader2,
  GripVertical,
  Power,
  SkipForward,
  CheckCircle
} from "lucide-react";
import { 
  calculateHostPriorities, 
  getBlockersSummary,
  HostPriorityScore,
  MaintenanceBlocker,
  HostBlockerAnalysis 
} from "@/lib/host-priority-calculator";

interface BlockerResolutionWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostBlockers: Record<string, HostBlockerAnalysis>;
  maintenanceWindowId?: string;
  onComplete: (resolutions: HostResolutions, hostOrder: string[]) => void;
}

interface HostResolutions {
  [hostId: string]: {
    vms_to_power_off: string[];
    vms_acknowledged: string[];
    skip_host: boolean;
  };
}

interface WizardStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const WIZARD_STEPS: WizardStep[] = [
  { id: 'scan', title: 'Scanning Hosts', description: 'Analyzing maintenance blockers', icon: <Loader2 className="h-5 w-5" /> },
  { id: 'summary', title: 'Blockers Summary', description: 'Overview of detected issues', icon: <AlertTriangle className="h-5 w-5" /> },
  { id: 'passthrough', title: 'Passthrough Devices', description: 'USB/PCI passthrough VMs', icon: <Usb className="h-5 w-5" /> },
  { id: 'storage', title: 'Local Storage', description: 'VMs with local storage', icon: <HardDrive className="h-5 w-5" /> },
  { id: 'vcsa', title: 'vCenter Location', description: 'VCSA host ordering', icon: <Server className="h-5 w-5" /> },
  { id: 'critical', title: 'Critical Infrastructure', description: 'NSX, vROps, etc.', icon: <ShieldAlert className="h-5 w-5" /> },
  { id: 'affinity', title: 'Affinity Rules', description: 'DRS affinity constraints', icon: <Cpu className="h-5 w-5" /> },
  { id: 'order', title: 'Host Order', description: 'Recommended update sequence', icon: <GripVertical className="h-5 w-5" /> },
  { id: 'poweroff', title: 'Power-Off Confirmation', description: 'Review VMs to be shut down', icon: <Power className="h-5 w-5" /> },
  { id: 'complete', title: 'Summary & Proceed', description: 'Review and confirm', icon: <Check className="h-5 w-5" /> },
];

export function BlockerResolutionWizard({
  open,
  onOpenChange,
  hostBlockers,
  maintenanceWindowId,
  onComplete
}: BlockerResolutionWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [resolutions, setResolutions] = useState<HostResolutions>({});
  const [hostOrder, setHostOrder] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<HostPriorityScore[]>([]);
  const [scanning, setScanning] = useState(true);

  // Initialize resolutions and calculate priorities
  useEffect(() => {
    if (open && hostBlockers) {
      // Initialize empty resolutions for each host
      const initialResolutions: HostResolutions = {};
      for (const hostId of Object.keys(hostBlockers)) {
        initialResolutions[hostId] = {
          vms_to_power_off: [],
          vms_acknowledged: [],
          skip_host: false,
        };
      }
      setResolutions(initialResolutions);
      
      // Calculate initial priorities
      const initialPriorities = calculateHostPriorities(hostBlockers);
      setPriorities(initialPriorities);
      setHostOrder(initialPriorities.map(p => p.hostId));
      
      // Simulate scanning
      setScanning(true);
      setTimeout(() => setScanning(false), 1500);
    }
  }, [open, hostBlockers]);

  // Recalculate priorities when resolutions change
  useEffect(() => {
    if (Object.keys(resolutions).length > 0) {
      const newPriorities = calculateHostPriorities(hostBlockers, resolutions);
      setPriorities(newPriorities);
      setHostOrder(newPriorities.filter(p => !resolutions[p.hostId]?.skip_host).map(p => p.hostId));
    }
  }, [resolutions, hostBlockers]);

  const summary = getBlockersSummary(hostBlockers);

  // Get blockers by type
  const getBlockersByReason = (reason: string): Array<{ hostId: string; hostName: string; blocker: MaintenanceBlocker }> => {
    const results: Array<{ hostId: string; hostName: string; blocker: MaintenanceBlocker }> = [];
    for (const [hostId, analysis] of Object.entries(hostBlockers)) {
      for (const blocker of analysis.blockers) {
        if (blocker.reason === reason) {
          results.push({ hostId, hostName: analysis.host_name, blocker });
        }
      }
    }
    return results;
  };

  const passthroughBlockers = getBlockersByReason('passthrough');
  const localStorageBlockers = getBlockersByReason('local_storage');
  const vcsaBlockers = getBlockersByReason('vcsa');
  const criticalBlockers = getBlockersByReason('critical_infra');
  const affinityBlockers = getBlockersByReason('affinity');
  const ftBlockers = getBlockersByReason('fault_tolerance');
  const vgpuBlockers = getBlockersByReason('vgpu');

  // Toggle VM for power-off
  const toggleVmPowerOff = (hostId: string, vmId: string) => {
    setResolutions(prev => {
      const hostRes = prev[hostId] || { vms_to_power_off: [], vms_acknowledged: [], skip_host: false };
      const isSelected = hostRes.vms_to_power_off.includes(vmId);
      return {
        ...prev,
        [hostId]: {
          ...hostRes,
          vms_to_power_off: isSelected
            ? hostRes.vms_to_power_off.filter(id => id !== vmId)
            : [...hostRes.vms_to_power_off, vmId],
        },
      };
    });
  };

  // Toggle VM acknowledgement
  const toggleVmAcknowledged = (hostId: string, vmId: string) => {
    setResolutions(prev => {
      const hostRes = prev[hostId] || { vms_to_power_off: [], vms_acknowledged: [], skip_host: false };
      const isSelected = hostRes.vms_acknowledged.includes(vmId);
      return {
        ...prev,
        [hostId]: {
          ...hostRes,
          vms_acknowledged: isSelected
            ? hostRes.vms_acknowledged.filter(id => id !== vmId)
            : [...hostRes.vms_acknowledged, vmId],
        },
      };
    });
  };

  // Toggle skip host
  const toggleSkipHost = (hostId: string) => {
    setResolutions(prev => {
      const hostRes = prev[hostId] || { vms_to_power_off: [], vms_acknowledged: [], skip_host: false };
      return {
        ...prev,
        [hostId]: {
          ...hostRes,
          skip_host: !hostRes.skip_host,
        },
      };
    });
  };

  // Get all VMs marked for power-off
  const getAllPowerOffVms = () => {
    const vms: Array<{ hostId: string; hostName: string; vmId: string; vmName: string; reason: string }> = [];
    for (const [hostId, res] of Object.entries(resolutions)) {
      const analysis = hostBlockers[hostId];
      if (!analysis) continue;
      for (const vmId of res.vms_to_power_off) {
        const blocker = analysis.blockers.find(b => b.vm_id === vmId);
        if (blocker) {
          vms.push({
            hostId,
            hostName: analysis.host_name,
            vmId,
            vmName: blocker.vm_name,
            reason: blocker.reason,
          });
        }
      }
    }
    return vms;
  };

  const handleNext = () => {
    if (currentStep < WIZARD_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    onComplete(resolutions, hostOrder);
    onOpenChange(false);
  };

  // Check if current step should be skipped (no relevant blockers)
  const shouldSkipStep = (stepId: string): boolean => {
    switch (stepId) {
      case 'passthrough':
        return passthroughBlockers.length === 0 && vgpuBlockers.length === 0;
      case 'storage':
        return localStorageBlockers.length === 0;
      case 'vcsa':
        return vcsaBlockers.length === 0;
      case 'critical':
        return criticalBlockers.length === 0;
      case 'affinity':
        return affinityBlockers.length === 0 && ftBlockers.length === 0;
      default:
        return false;
    }
  };

  const getActiveSteps = () => {
    return WIZARD_STEPS.filter(step => !shouldSkipStep(step.id));
  };

  const activeSteps = getActiveSteps();
  const activeStepIndex = activeSteps.findIndex(s => s.id === WIZARD_STEPS[currentStep].id);
  const progressPercent = ((activeStepIndex + 1) / activeSteps.length) * 100;

  const renderStepContent = () => {
    const step = WIZARD_STEPS[currentStep];

    switch (step.id) {
      case 'scan':
        return (
          <div className="space-y-6 py-8">
            <div className="flex flex-col items-center justify-center space-y-4">
              {scanning ? (
                <>
                  <Loader2 className="h-12 w-12 animate-spin text-primary" />
                  <p className="text-lg font-medium">Scanning hosts for maintenance blockers...</p>
                  <Progress value={65} className="w-64" />
                </>
              ) : (
                <>
                  <CheckCircle className="h-12 w-12 text-green-500" />
                  <p className="text-lg font-medium">Scan complete</p>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold">{summary.totalHosts}</div>
                      <div className="text-sm text-muted-foreground">Hosts</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-green-500">{summary.cleanHosts}</div>
                      <div className="text-sm text-muted-foreground">Clean</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-yellow-500">{summary.hostsWithBlockers}</div>
                      <div className="text-sm text-muted-foreground">With Blockers</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        );

      case 'summary':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Critical Blockers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-destructive">{summary.criticalBlockers}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Warnings</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-yellow-500">{summary.warningBlockers}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Blocker Types Found</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(summary.blockerTypes).map(([type, count]) => (
                    <Badge key={type} variant="secondary">
                      {type.replace('_', ' ')}: {count}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            {summary.vcsaHost && (
              <Alert>
                <Server className="h-4 w-4" />
                <AlertDescription>
                  vCenter Server Appliance detected on {hostBlockers[summary.vcsaHost]?.host_name}. 
                  This host will be scheduled for update last.
                </AlertDescription>
              </Alert>
            )}
          </div>
        );

      case 'passthrough':
        const allPassthrough = [...passthroughBlockers, ...vgpuBlockers];
        return (
          <div className="space-y-4">
            <Alert className="border-yellow-500">
              <Usb className="h-4 w-4" />
              <AlertDescription>
                These VMs have USB/PCI passthrough or vGPU devices attached. They <strong>cannot</strong> be migrated 
                and must be powered off before the host can enter maintenance mode.
              </AlertDescription>
            </Alert>

            <ScrollArea className="h-[300px]">
              <div className="space-y-3">
                {allPassthrough.map(({ hostId, hostName, blocker }) => (
                  <Card key={`${hostId}-${blocker.vm_id}`} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={resolutions[hostId]?.vms_to_power_off.includes(blocker.vm_id)}
                          onCheckedChange={() => toggleVmPowerOff(hostId, blocker.vm_id)}
                        />
                        <div>
                          <div className="font-medium">{blocker.vm_name}</div>
                          <div className="text-sm text-muted-foreground">Host: {hostName}</div>
                          <div className="text-sm text-muted-foreground">{blocker.details}</div>
                        </div>
                      </div>
                      <Badge variant="destructive">
                        {blocker.reason === 'vgpu' ? 'vGPU' : 'Passthrough'}
                      </Badge>
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>

            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Power className="h-5 w-5 text-yellow-500" />
              <span className="text-sm">
                {resolutions[Object.keys(resolutions)[0]]?.vms_to_power_off.length || 0} VMs selected for power-off
              </span>
            </div>
          </div>
        );

      case 'storage':
        return (
          <div className="space-y-4">
            <Alert className="border-yellow-500">
              <HardDrive className="h-4 w-4" />
              <AlertDescription>
                These VMs use local storage (non-shared datastores). They cannot be migrated via vMotion.
                You can power them off or perform storage vMotion beforehand.
              </AlertDescription>
            </Alert>

            <ScrollArea className="h-[300px]">
              <div className="space-y-3">
                {localStorageBlockers.map(({ hostId, hostName, blocker }) => (
                  <Card key={`${hostId}-${blocker.vm_id}`} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={resolutions[hostId]?.vms_to_power_off.includes(blocker.vm_id)}
                          onCheckedChange={() => toggleVmPowerOff(hostId, blocker.vm_id)}
                        />
                        <div>
                          <div className="font-medium">{blocker.vm_name}</div>
                          <div className="text-sm text-muted-foreground">Host: {hostName}</div>
                          <div className="text-sm text-muted-foreground">{blocker.details}</div>
                        </div>
                      </div>
                      <Badge variant="secondary">Local Storage</Badge>
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>
        );

      case 'vcsa':
        return (
          <div className="space-y-4">
            <Alert>
              <Server className="h-4 w-4" />
              <AlertDescription>
                The vCenter Server Appliance manages vMotion operations. The host running VCSA should be 
                updated <strong>last</strong> after VCSA has been migrated to an already-updated host.
              </AlertDescription>
            </Alert>

            {vcsaBlockers.map(({ hostId, hostName, blocker }) => (
              <Card key={`${hostId}-${blocker.vm_id}`} className="border-primary">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="h-5 w-5 text-primary" />
                    {blocker.vm_name}
                  </CardTitle>
                  <CardDescription>Running on: {hostName}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">{blocker.remediation}</p>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm">This host will be updated last automatically</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        );

      case 'critical':
        return (
          <div className="space-y-4">
            <Alert className="border-yellow-500">
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription>
                These VMs are identified as critical infrastructure (NSX, vROps, vRA, etc.). 
                Consider manual migration or careful scheduling.
              </AlertDescription>
            </Alert>

            <ScrollArea className="h-[300px]">
              <div className="space-y-3">
                {criticalBlockers.map(({ hostId, hostName, blocker }) => (
                  <Card key={`${hostId}-${blocker.vm_id}`} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={resolutions[hostId]?.vms_acknowledged.includes(blocker.vm_id)}
                          onCheckedChange={() => toggleVmAcknowledged(hostId, blocker.vm_id)}
                        />
                        <div>
                          <div className="font-medium">{blocker.vm_name}</div>
                          <div className="text-sm text-muted-foreground">Host: {hostName}</div>
                          <div className="text-sm text-muted-foreground">{blocker.details}</div>
                        </div>
                      </div>
                      <Badge variant="secondary">Critical Infra</Badge>
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>
        );

      case 'affinity':
        const allAffinity = [...affinityBlockers, ...ftBlockers];
        return (
          <div className="space-y-4">
            <Alert className="border-yellow-500">
              <Cpu className="h-4 w-4" />
              <AlertDescription>
                These VMs have affinity rules or Fault Tolerance enabled. DRS may have difficulty 
                migrating them automatically.
              </AlertDescription>
            </Alert>

            <ScrollArea className="h-[300px]">
              <div className="space-y-3">
                {allAffinity.map(({ hostId, hostName, blocker }) => (
                  <Card key={`${hostId}-${blocker.vm_id}`} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={resolutions[hostId]?.vms_acknowledged.includes(blocker.vm_id)}
                          onCheckedChange={() => toggleVmAcknowledged(hostId, blocker.vm_id)}
                        />
                        <div>
                          <div className="font-medium">{blocker.vm_name}</div>
                          <div className="text-sm text-muted-foreground">Host: {hostName}</div>
                          <div className="text-sm text-muted-foreground">{blocker.details}</div>
                        </div>
                      </div>
                      <Badge variant="secondary">
                        {blocker.reason === 'fault_tolerance' ? 'Fault Tolerance' : 'Affinity'}
                      </Badge>
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>
        );

      case 'order':
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Based on your selections, here is the recommended host update order. 
              Hosts with no blockers are updated first, VCSA host is updated last.
            </p>

            <ScrollArea className="h-[350px]">
              <div className="space-y-2">
                {priorities.map((priority, index) => {
                  const isSkipped = resolutions[priority.hostId]?.skip_host;
                  return (
                    <Card 
                      key={priority.hostId} 
                      className={`p-4 ${isSkipped ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                            isSkipped ? 'bg-muted text-muted-foreground' :
                            priority.priority <= 10 ? 'bg-green-500 text-white' :
                            priority.priority <= 50 ? 'bg-yellow-500 text-white' :
                            priority.priority >= 100 ? 'bg-blue-500 text-white' :
                            'bg-orange-500 text-white'
                          }`}>
                            {isSkipped ? '—' : index + 1}
                          </div>
                          <div>
                            <div className="font-medium">{priority.hostName}</div>
                            <div className="text-xs text-muted-foreground">
                              {priority.reasons.slice(0, 2).join(' • ')}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {priority.blockerSummary.powerOffRequired > 0 && (
                            <Badge variant="secondary">
                              <Power className="h-3 w-3 mr-1" />
                              {priority.blockerSummary.powerOffRequired} power-off
                            </Badge>
                          )}
                          <Button
                            variant={isSkipped ? "default" : "outline"}
                            size="sm"
                            onClick={() => toggleSkipHost(priority.hostId)}
                          >
                            {isSkipped ? 'Include' : 'Skip'}
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        );

      case 'poweroff':
        const powerOffVms = getAllPowerOffVms();
        return (
          <div className="space-y-4">
            {powerOffVms.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                <p className="text-lg font-medium">No VMs need to be powered off</p>
                <p className="text-sm text-muted-foreground">All blockers can be resolved through migration or acknowledgement</p>
              </div>
            ) : (
              <>
                <Alert className="border-yellow-500">
                  <Power className="h-4 w-4" />
                  <AlertDescription>
                    The following VMs will be <strong>automatically powered off</strong> when their host 
                    enters maintenance mode. They will be powered back on after the host update completes.
                  </AlertDescription>
                </Alert>

                <ScrollArea className="h-[300px]">
                  <div className="space-y-2">
                    {powerOffVms.map((vm) => (
                      <Card key={`${vm.hostId}-${vm.vmId}`} className="p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">{vm.vmName}</div>
                            <div className="text-sm text-muted-foreground">
                              {vm.hostName} • {vm.reason.replace('_', ' ')}
                            </div>
                          </div>
                          <Badge variant="destructive">
                            <Power className="h-3 w-3 mr-1" />
                            Will Power Off
                          </Badge>
                        </div>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>

                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm font-medium">
                    Total: {powerOffVms.length} VM(s) will be powered off during maintenance
                  </p>
                </div>
              </>
            )}
          </div>
        );

      case 'complete':
        const finalPowerOffVms = getAllPowerOffVms();
        const skippedHosts = Object.entries(resolutions).filter(([_, r]) => r.skip_host).length;
        return (
          <div className="space-y-4">
            <div className="text-center py-4">
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold">Ready to Proceed</h3>
              <p className="text-muted-foreground">Review your maintenance configuration</p>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Hosts to Update</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {summary.totalHosts - skippedHosts}
                  </div>
                  {skippedHosts > 0 && (
                    <p className="text-xs text-muted-foreground">{skippedHosts} skipped</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">VMs to Power Off</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-yellow-500">
                    {finalPowerOffVms.length}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Update Order</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {hostOrder.map((hostId, idx) => {
                    const analysis = hostBlockers[hostId];
                    return (
                      <Badge key={hostId} variant="outline">
                        {idx + 1}. {analysis?.host_name || hostId}
                      </Badge>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {finalPowerOffVms.length > 0 && (
              <Alert>
                <Power className="h-4 w-4" />
                <AlertDescription>
                  {finalPowerOffVms.length} VM(s) will be powered off during maintenance and 
                  automatically powered back on after completion.
                </AlertDescription>
              </Alert>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {WIZARD_STEPS[currentStep].icon}
            Step {activeStepIndex + 1} of {activeSteps.length}: {WIZARD_STEPS[currentStep].title}
          </DialogTitle>
          <DialogDescription>
            {WIZARD_STEPS[currentStep].description}
          </DialogDescription>
        </DialogHeader>

        <Progress value={progressPercent} className="h-2" />

        <div className="min-h-[400px]">
          {renderStepContent()}
        </div>

        <DialogFooter className="flex justify-between">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>

          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {currentStep === WIZARD_STEPS.length - 1 ? (
              <Button onClick={handleComplete}>
                <Check className="h-4 w-4 mr-1" />
                Confirm & Proceed
              </Button>
            ) : (
              <Button onClick={handleNext} disabled={scanning && currentStep === 0}>
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
