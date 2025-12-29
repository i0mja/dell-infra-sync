import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  XCircle, 
  AlertTriangle, 
  Power, 
  RefreshCw, 
  ChevronDown,
  Server,
  Cpu,
  HardDrive,
  Layers,
  Zap,
  Clock
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatVCenterError } from "@/lib/vcenter-errors";
export interface BlockingVM {
  name: string;
  reason: string;
  drs_fault?: string;
  power_off_eligible?: boolean;
}

export interface FailedHost {
  host_name: string;
  error_type: string;
  stalled_duration?: number;
  blocking_vms?: BlockingVM[];
  error_message?: string;
  remediation_options?: Array<{
    action: string;
    label: string;
    auto_applicable?: boolean;
  }>;
}

interface MaintenanceFailureDetailsProps {
  failedHosts: FailedHost[];
  jobId: string;
  onRetry?: () => void;
}

const getReasonIcon = (reason: string) => {
  switch (reason) {
    case 'drs_no_destination':
      return <Server className="h-4 w-4" />;
    case 'drs_resource_constraint':
      return <Cpu className="h-4 w-4" />;
    case 'drs_anti_affinity':
      return <Layers className="h-4 w-4" />;
    case 'drs_evc_incompatible':
      return <Zap className="h-4 w-4" />;
    case 'local_storage':
      return <HardDrive className="h-4 w-4" />;
    default:
      return <AlertTriangle className="h-4 w-4" />;
  }
};

const getReasonLabel = (reason: string): string => {
  const labels: Record<string, string> = {
    'drs_no_destination': 'No DRS Destination',
    'drs_resource_constraint': 'Insufficient Resources',
    'drs_anti_affinity': 'Anti-Affinity Rule',
    'drs_evc_incompatible': 'EVC Incompatible',
    'local_storage': 'Local Storage',
    'passthrough': 'Passthrough Device',
    'affinity': 'CPU/Memory Affinity',
    'vcsa': 'vCenter Server',
    'connected_media': 'Connected Media',
    'critical_infra': 'Critical Infrastructure'
  };
  return labels[reason] || reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

const getReasonGuidance = (reason: string): string => {
  const guidance: Record<string, string> = {
    'drs_no_destination': 'DRS could not find a suitable host to migrate this VM. This typically occurs when all other hosts are at capacity or in maintenance.',
    'drs_resource_constraint': 'The cluster does not have enough CPU or memory capacity on other hosts to accommodate this VM.',
    'drs_anti_affinity': 'An anti-affinity rule prevents this VM from being placed on the same host as another VM, but no valid destination exists.',
    'drs_evc_incompatible': 'The VM requires CPU features not available on other hosts due to EVC mode restrictions.',
    'local_storage': 'This VM uses local storage that cannot be migrated via vMotion.',
    'passthrough': 'This VM has PCI or USB passthrough devices that prevent live migration.',
    'affinity': 'This VM has CPU or memory affinity rules that restrict placement.',
    'vcsa': 'This is the vCenter Server Appliance - it cannot migrate itself.',
    'connected_media': 'This VM has connected CD/DVD media from a client device.',
    'critical_infra': 'This is a critical infrastructure VM. Validate safe migration or plan a controlled shutdown.'
  };
  return guidance[reason] || 'This VM cannot be migrated automatically.';
};

export const MaintenanceFailureDetails = ({ 
  failedHosts, 
  jobId,
  onRetry 
}: MaintenanceFailureDetailsProps) => {
  const { toast } = useToast();
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set(failedHosts.map(h => h.host_name)));
  const [poweringOff, setPoweringOff] = useState<Set<string>>(new Set());

  const toggleHost = (hostName: string) => {
    setExpandedHosts(prev => {
      const next = new Set(prev);
      if (next.has(hostName)) {
        next.delete(hostName);
      } else {
        next.add(hostName);
      }
      return next;
    });
  };

  const handlePowerOffVM = async (hostName: string, vmName: string) => {
    const key = `${hostName}:${vmName}`;
    setPoweringOff(prev => new Set(prev).add(key));

    try {
      // Note: Power off VM is handled through vCenter operations
      // For now, show a toast with instructions
      toast({
        title: "Power Off Required",
        description: `Please power off VM "${vmName}" on host "${hostName}" manually via vCenter, then retry the maintenance operation.`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setPoweringOff(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const totalBlockingVMs = failedHosts.reduce(
    (sum, host) => sum + (host.blocking_vms?.length || 0), 
    0
  );

  return (
    <div className="space-y-4">
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>Maintenance Mode Failed</AlertTitle>
        <AlertDescription>
          {failedHosts.length} host(s) could not enter maintenance mode. 
          {totalBlockingVMs > 0 && ` ${totalBlockingVMs} VM(s) could not be evacuated.`}
        </AlertDescription>
      </Alert>

      <div className="space-y-3">
        {failedHosts.map((host) => {
          const isExpanded = expandedHosts.has(host.host_name);
          
          return (
            <Card key={host.host_name} className="border-destructive/50">
              <Collapsible open={isExpanded} onOpenChange={() => toggleHost(host.host_name)}>
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="flex flex-row items-center justify-between py-3 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      <div className="text-left">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Server className="h-4 w-4" />
                          {host.host_name}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          {host.error_type === 'vm_evacuation_failed' 
                            ? `${host.blocking_vms?.length || 0} VM(s) blocking evacuation`
                            : formatVCenterError(host.error_message) || 'Failed to enter maintenance mode'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {host.stalled_duration && (
                        <Badge variant="outline" className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Stalled {Math.floor(host.stalled_duration / 60)}m
                        </Badge>
                      )}
                      <Badge variant="destructive">Failed</Badge>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-4">
                    {/* Blocking VMs */}
                    {host.blocking_vms && host.blocking_vms.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-medium flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                          VMs Blocking Evacuation
                        </h4>
                        
                        <div className="space-y-2">
                          {host.blocking_vms.map((vm, idx) => (
                            <div 
                              key={`${vm.name}-${idx}`}
                              className="p-3 rounded-lg border border-destructive/30 bg-destructive/5"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-sm">{vm.name}</span>
                                    <Badge variant="secondary" className="text-xs flex items-center gap-1">
                                      {getReasonIcon(vm.reason)}
                                      {getReasonLabel(vm.reason)}
                                    </Badge>
                                  </div>
                                  
                                  <p className="text-xs text-muted-foreground">
                                    {getReasonGuidance(vm.reason)}
                                  </p>
                                  
                                  {vm.drs_fault && (
                                    <p className="text-xs text-destructive mt-1 font-mono">
                                      DRS: {vm.drs_fault}
                                    </p>
                                  )}
                                </div>

                                {vm.power_off_eligible !== false && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="shrink-0"
                                    disabled={poweringOff.has(`${host.host_name}:${vm.name}`)}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePowerOffVM(host.host_name, vm.name);
                                    }}
                                  >
                                    <Power className="h-3 w-3 mr-1" />
                                    {poweringOff.has(`${host.host_name}:${vm.name}`) 
                                      ? 'Powering Off...' 
                                      : 'Power Off'}
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Remediation Options */}
                    {host.remediation_options && host.remediation_options.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium">Recommended Actions</h4>
                        <div className="flex flex-wrap gap-2">
                          {host.remediation_options.map((option, idx) => (
                            <Button
                              key={idx}
                              variant={option.auto_applicable ? "default" : "outline"}
                              size="sm"
                              onClick={() => {
                                if (option.action === 'retry' && onRetry) {
                                  onRetry();
                                } else if (option.action === 'power_off') {
                                  // Power off all eligible VMs
                                  host.blocking_vms?.forEach(vm => {
                                    if (vm.power_off_eligible !== false) {
                                      handlePowerOffVM(host.host_name, vm.name);
                                    }
                                  });
                                }
                              }}
                            >
                              {option.action === 'power_off' && <Power className="h-3 w-3 mr-1" />}
                              {option.action === 'retry' && <RefreshCw className="h-3 w-3 mr-1" />}
                              {option.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}
      </div>

      {/* Global Actions */}
      <div className="flex justify-end gap-2 pt-2">
        {onRetry && (
          <Button onClick={onRetry} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry Maintenance
          </Button>
        )}
      </div>
    </div>
  );
};
