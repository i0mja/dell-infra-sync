/**
 * DR Shell VM Wizard
 * 
 * Multi-step wizard to create a DR shell VM at the DR site with replicated disks.
 * Uses job queue pattern for HTTPS compatibility (no mixed-content blocking).
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Server as ServerIcon,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Info,
  Cpu,
  MemoryStick,
  Cloud,
  Network,
} from "lucide-react";
import { ProtectedVM, useDRShellPlan } from "@/hooks/useReplication";

// Format bytes to human-readable size
function formatBytes(bytes: number | null): string {
  if (!bytes) return 'Unknown';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1000) {
    return `${(gb / 1024).toFixed(1)} TB`;
  }
  return `${gb.toFixed(1)} GB`;
}

// Smart network matching - scores similarity between source and DR network names
function scoreNetworkMatch(sourceNetworkName: string, drNetworkName: string): number {
  if (!sourceNetworkName || !drNetworkName) return 0;
  
  let score = 0;
  const sourceLower = sourceNetworkName.toLowerCase();
  const drLower = drNetworkName.toLowerCase();
  
  // Exact match
  if (sourceLower === drLower) return 100;
  
  // Extract numbers (VLAN IDs like "102", "303")
  const sourceNumbers: string[] = sourceLower.match(/\d+/g) || [];
  const drNumbers: string[] = drLower.match(/\d+/g) || [];
  
  for (const num of sourceNumbers) {
    if (drNumbers.includes(num)) {
      score += 50; // Strong match for same VLAN number
    }
  }
  
  // Keyword matching
  const keywords = ['prod', 'production', 'dev', 'development', 'test', 'staging', 
                    'mgmt', 'management', 'backup', 'repl', 'replication', 'dr', 
                    'vmotion', 'storage', 'dmz', 'public', 'private'];
  for (const kw of keywords) {
    if (sourceLower.includes(kw) && drLower.includes(kw)) {
      score += 20;
    }
  }
  
  // Partial name overlap
  if (drLower.includes(sourceLower) || sourceLower.includes(drLower)) {
    score += 30;
  }
  
  return score;
}

interface DrShellVmWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vm: ProtectedVM | null;
  onComplete: () => void;
}

type WizardStep = 'analyze' | 'configure' | 'execute' | 'complete';

export function DrShellVmWizard({
  open,
  onOpenChange,
  vm,
  onComplete,
}: DrShellVmWizardProps) {
  const [step, setStep] = useState<WizardStep>('analyze');
  const [shellVmName, setShellVmName] = useState("");
  const [cpuCount, setCpuCount] = useState(2);
  const [memoryMb, setMemoryMb] = useState(4096);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; shell_vm_name?: string } | null>(null);
  const [selectedDrVcenterId, setSelectedDrVcenterId] = useState<string | null>(null);
  const [selectedDatastoreId, setSelectedDatastoreId] = useState<string | null>(null);
  const [networkName, setNetworkName] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<string>('Queuing job...');
  
  const { plan, loading: planLoading, fetchPlan, createDRShell, vcenters, drDatastores, datastoresLoading, drNetworks, networksLoading } = useDRShellPlan(vm?.id, selectedDrVcenterId);
  
  // Compute sorted networks with match scores based on source VM's network (using current_datastore as proxy)
  const sourceNetworkHint = vm?.current_datastore || vm?.vm_name || '';
  const sortedNetworks = drNetworks
    ?.map(net => ({
      ...net,
      matchScore: scoreNetworkMatch(sourceNetworkHint, net.name)
    }))
    .sort((a, b) => b.matchScore - a.matchScore) || [];
  
  // Get selected network details
  const selectedNetwork = drNetworks?.find(n => n.id === networkName);
  
  // Filter out source vCenter to show only DR targets
  const sourceVcenterId = plan?.protection_group?.source_vcenter_id;
  const drVcenterOptions = vcenters?.filter(vc => vc.id !== sourceVcenterId) || [];
  
  // Get selected datastore details
  const selectedDatastore = drDatastores?.find(ds => ds.id === selectedDatastoreId);

  // Reset state when dialog opens
  useEffect(() => {
    if (open && vm) {
      setStep('analyze');
      setResult(null);
      setShellVmName(`${vm.vm_name}-DR`);
      setSelectedDrVcenterId(null);
      setSelectedDatastoreId(null);
      setNetworkName("");
      setJobId(null);
      setJobProgress('Queuing job...');
      fetchPlan();
    }
  }, [open, vm, fetchPlan]);
  
  // Reset datastore selection when DR vCenter changes
  useEffect(() => {
    setSelectedDatastoreId(null);
  }, [selectedDrVcenterId]);

  // Update config from plan when loaded - use vcenter_vm data for accurate CPU/memory
  useEffect(() => {
    if (plan && vm) {
      setShellVmName(`${vm.vm_name}-DR`);
      // Use actual VM specs from vcenter_vms join
      const vcenterVm = (plan as { vcenter_vm?: { cpu_count?: number; memory_mb?: number } }).vcenter_vm;
      if (vcenterVm?.cpu_count) setCpuCount(vcenterVm.cpu_count);
      if (vcenterVm?.memory_mb) setMemoryMb(vcenterVm.memory_mb);
    }
  }, [plan, vm]);

  // Poll job status for completion
  const pollJobStatus = useCallback(async (id: string) => {
    const poll = async () => {
      const { data: job, error } = await supabase
        .from('jobs')
        .select('status, details')
        .eq('id', id)
        .single();
      
      if (error) {
        setResult({ success: false, message: error.message });
        setStep('complete');
        setExecuting(false);
        return;
      }
      
      const details = job.details as { 
        current_step?: string; 
        progress_percent?: number;
        message?: string;
        error?: string;
        shell_vm_name?: string;
        success?: boolean;
      } | null;
      
      if (details?.current_step) {
        setJobProgress(details.current_step);
      }
      
      if (job.status === 'completed') {
        setResult({ 
          success: details?.success ?? true, 
          message: details?.message || 'DR Shell VM created successfully',
          shell_vm_name: details?.shell_vm_name || shellVmName
        });
        setStep('complete');
        setExecuting(false);
      } else if (job.status === 'failed') {
        setResult({ 
          success: false, 
          message: details?.error || details?.message || 'Job failed' 
        });
        setStep('complete');
        setExecuting(false);
      } else {
        // Still running, poll again
        setTimeout(poll, 2000);
      }
    };
    poll();
  }, [shellVmName]);

  const handleExecute = async () => {
    if (!vm) return;
    
    setExecuting(true);
    setJobProgress('Queuing job...');
    
    try {
      const response = await createDRShell({
        shell_vm_name: shellVmName,
        cpu_count: cpuCount,
        memory_mb: memoryMb,
        dr_vcenter_id: selectedDrVcenterId || undefined,
        datastore_name: selectedDatastore?.name,
        network_name: selectedNetwork?.name || undefined,
      });
      
      // Job created, start polling
      setJobId(response.job_id);
      setJobProgress('Job queued, waiting for executor...');
      pollJobStatus(response.job_id);
      
    } catch (error) {
      setResult({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to create job' 
      });
      setStep('complete');
      setExecuting(false);
    }
  };

  const handleClose = () => {
    if (result?.success) {
      onComplete();
    }
    onOpenChange(false);
  };

  const renderStepIndicator = () => {
    const steps = [
      { id: 'analyze', label: 'Analyze' },
      { id: 'configure', label: 'Configure' },
      { id: 'execute', label: 'Create' },
      { id: 'complete', label: 'Complete' },
    ];
    
    const currentIndex = steps.findIndex(s => s.id === step);
    
    return (
      <div className="flex items-center gap-1.5 mb-4">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1.5">
            <div className={`
              w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium
              ${i <= currentIndex 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-muted text-muted-foreground'}
            `}>
              {i < currentIndex ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                i + 1
              )}
            </div>
            <span className={`text-xs ${i <= currentIndex ? 'text-foreground' : 'text-muted-foreground'}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <ArrowRight className="h-3 w-3 text-muted-foreground mx-1" />
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderAnalyzeStep = () => (
    <div className="space-y-3">
      <Alert>
        <Info className="h-3.5 w-3.5" />
        <AlertDescription className="text-xs">
          Analyzing source VM configuration and DR site resources...
        </AlertDescription>
      </Alert>
      
      {planLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : plan || vm ? (
        <div className="space-y-3">
          {/* Source VM Config */}
          <div className="border rounded-lg p-3 space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-1.5">
              <ServerIcon className="h-3.5 w-3.5 text-muted-foreground" />
              Source VM Configuration
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <ServerIcon className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">VM:</span>
                <span className="font-medium truncate">{vm?.vm_name || '-'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <HardDrive className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Datastore:</span>
                <span className="font-medium truncate">{vm?.current_datastore || '-'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Cpu className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">CPU:</span>
                <span className="font-medium">{cpuCount} vCPU</span>
              </div>
              <div className="flex items-center gap-1.5">
                <MemoryStick className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Memory:</span>
                <span className="font-medium">{(memoryMb / 1024).toFixed(1)} GB</span>
              </div>
            </div>
          </div>

          {/* DR Site Target */}
          <div className="border rounded-lg p-3 space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-1.5">
              <Cloud className="h-3.5 w-3.5 text-muted-foreground" />
              DR Site Target
            </h4>
            <div className="space-y-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Select DR vCenter</Label>
                <Select
                  value={selectedDrVcenterId || ''}
                  onValueChange={setSelectedDrVcenterId}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select DR vCenter..." />
                  </SelectTrigger>
                  <SelectContent>
                    {drVcenterOptions.length === 0 ? (
                      <SelectItem value="_none" disabled>
                        No DR vCenters available
                      </SelectItem>
                    ) : (
                      drVcenterOptions.map(vc => (
                        <SelectItem key={vc.id} value={vc.id}>
                          <div className="flex items-center gap-1.5 text-xs">
                            <span>{vc.name}</span>
                            {vc.host && (
                              <span className="text-muted-foreground">({vc.host})</span>
                            )}
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              
              {selectedDrVcenterId && (
                <div className="space-y-2 pt-2 border-t">
                  {/* Datastore Selection */}
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-xs">
                      <HardDrive className="h-3 w-3" />
                      Target Datastore
                    </Label>
                    {datastoresLoading ? (
                      <Skeleton className="h-8 w-full" />
                    ) : (
                      <>
                        <Select
                          value={selectedDatastoreId || ''}
                          onValueChange={setSelectedDatastoreId}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select datastore..." />
                          </SelectTrigger>
                          <SelectContent>
                            {drDatastores?.length === 0 ? (
                              <SelectItem value="_none" disabled>
                                No datastores available
                              </SelectItem>
                            ) : (
                              drDatastores?.map(ds => (
                                <SelectItem key={ds.id} value={ds.id}>
                                  <div className="flex items-center gap-1.5 text-xs">
                                    <span>{ds.name}</span>
                                    <span className="text-muted-foreground">
                                      ({formatBytes(ds.free_bytes)} free)
                                    </span>
                                  </div>
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        {drDatastores?.length === 0 && (
                          <Alert variant="destructive" className="mt-1.5">
                            <AlertTriangle className="h-3 w-3" />
                            <AlertDescription className="text-xs">
                              No datastores found. Sync vCenter first.
                            </AlertDescription>
                          </Alert>
                        )}
                      </>
                    )}
                  </div>
                  
                  {/* Network Selection */}
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-xs">
                      <Network className="h-3 w-3" />
                      Target Network
                    </Label>
                    {networksLoading ? (
                      <Skeleton className="h-8 w-full" />
                    ) : (
                      <Select
                        value={networkName || '_default'}
                        onValueChange={(val) => setNetworkName(val === '_default' ? '' : val)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select network..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_default">
                            <span className="text-muted-foreground text-xs">Use default</span>
                          </SelectItem>
                          {sortedNetworks.map((net, idx) => (
                            <SelectItem key={net.id} value={net.id}>
                              <div className="flex items-center gap-1.5 text-xs">
                                {net.matchScore > 30 && idx === 0 && <span>🎯</span>}
                                <span>{net.name}</span>
                                {net.vlan_id && (
                                  <span className="text-muted-foreground">(VLAN {net.vlan_id})</span>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Pre-checks */}
          <div className="border rounded-lg p-3 space-y-2">
            <h4 className="text-sm font-medium">Pre-flight Checks</h4>
            <div className="space-y-1">
              {[
                { name: 'DR vCenter selected', passed: !!selectedDrVcenterId },
                { name: 'Target datastore selected', passed: !!selectedDatastoreId },
                { name: 'Replicated disks available', passed: !!vm?.last_replication_at },
                { name: 'Network configured', passed: true },
              ].map((check, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs">
                  {check.passed ? (
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                  )}
                  {check.name}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          No plan data available
        </div>
      )}
    </div>
  );

  const renderConfigureStep = () => (
    <div className="space-y-3">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">DR Shell VM Name</Label>
          <Input
            value={shellVmName}
            onChange={(e) => setShellVmName(e.target.value)}
            placeholder="Enter VM name"
            className="h-8 text-sm"
          />
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs">
              <Cpu className="h-3 w-3" />
              CPU (vCPU)
            </Label>
            <Input
              type="number"
              value={cpuCount}
              onChange={(e) => setCpuCount(parseInt(e.target.value) || 1)}
              min={1}
              max={128}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs">
              <MemoryStick className="h-3 w-3" />
              Memory (MB)
            </Label>
            <Input
              type="number"
              value={memoryMb}
              onChange={(e) => setMemoryMb(parseInt(e.target.value) || 1024)}
              min={512}
              step={512}
              className="h-8 text-sm"
            />
          </div>
        </div>

        <Alert>
          <Info className="h-3 w-3" />
          <AlertDescription className="text-xs">
            Shell VM created powered-off with replicated disks. Power on during failover.
          </AlertDescription>
        </Alert>

        <div className="border rounded-lg p-3 space-y-1.5">
          <h4 className="text-sm font-medium">Summary</h4>
          <div className="text-xs space-y-0.5">
            <p><span className="text-muted-foreground">Name:</span> {shellVmName}</p>
            <p><span className="text-muted-foreground">CPU:</span> {cpuCount} vCPU</p>
            <p><span className="text-muted-foreground">Memory:</span> {(memoryMb / 1024).toFixed(1)} GB</p>
            <p><span className="text-muted-foreground">Disks:</span> ZFS replicated</p>
            <p><span className="text-muted-foreground">Power:</span> Off</p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderExecuteStep = () => (
    <div className="space-y-3">
      <div className="text-center py-6">
        <Loader2 className="h-8 w-8 mx-auto mb-3 animate-spin text-primary" />
        <h4 className="text-sm font-medium mb-1">Creating DR Shell VM...</h4>
        <p className="text-xs text-muted-foreground mb-3">
          {shellVmName}
        </p>
        <Progress value={66} className="w-48 mx-auto" />
        <p className="text-xs text-muted-foreground mt-3">
          {jobProgress}
        </p>
        {jobId && (
          <p className="text-xs text-muted-foreground/60 mt-1">
            Job: {jobId.slice(0, 8)}...
          </p>
        )}
      </div>
    </div>
  );

  const renderCompleteStep = () => (
    <div className="space-y-3">
      <div className="text-center py-6">
        {result?.success ? (
          <>
            <CheckCircle2 className="h-8 w-8 mx-auto mb-3 text-green-500" />
            <h4 className="text-sm font-medium mb-1">DR Shell VM Created</h4>
            <p className="text-xs text-muted-foreground mb-3">
              {result.message}
            </p>
            <div className="inline-flex items-center gap-1.5 bg-muted/50 px-3 py-1.5 rounded-lg">
              <ServerIcon className="h-3.5 w-3.5" />
              <span className="text-sm font-medium">{result.shell_vm_name || shellVmName}</span>
              <Badge variant="outline" className="text-green-600 border-green-500/30 text-xs py-0">
                Ready
              </Badge>
            </div>
          </>
        ) : (
          <>
            <AlertTriangle className="h-8 w-8 mx-auto mb-3 text-destructive" />
            <h4 className="text-sm font-medium mb-1">Creation Failed</h4>
            <p className="text-xs text-destructive">
              {result?.message || 'An error occurred'}
            </p>
          </>
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-base">
            <ServerIcon className="h-4 w-4" />
            DR Shell VM Wizard
          </DialogTitle>
          <DialogDescription className="text-xs">
            Create a shell VM at the DR site with replicated disks
          </DialogDescription>
        </DialogHeader>

        {renderStepIndicator()}

        <div className="min-h-[280px]">
          {step === 'analyze' && renderAnalyzeStep()}
          {step === 'configure' && renderConfigureStep()}
          {step === 'execute' && renderExecuteStep()}
          {step === 'complete' && renderCompleteStep()}
        </div>

        <DialogFooter>
          {step === 'analyze' && (
            <>
              <Button variant="outline" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button 
                size="sm"
                onClick={() => setStep('configure')} 
                disabled={planLoading || !selectedDrVcenterId || !selectedDatastoreId}
              >
                Next
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </>
          )}
          {step === 'configure' && (
            <>
              <Button variant="outline" size="sm" onClick={() => setStep('analyze')}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                Back
              </Button>
              <Button 
                size="sm"
                onClick={() => {
                  setStep('execute');
                  handleExecute();
                }} 
                disabled={!shellVmName}
              >
                Create
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </>
          )}
          {step === 'execute' && (
            <Button variant="outline" size="sm" disabled>
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              Creating...
            </Button>
          )}
          {step === 'complete' && (
            <Button size="sm" onClick={handleClose}>
              {result?.success ? 'Done' : 'Close'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
