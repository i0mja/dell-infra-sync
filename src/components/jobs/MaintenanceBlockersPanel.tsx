import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  AlertTriangle, 
  XCircle, 
  ChevronDown, 
  HardDrive, 
  Usb, 
  Server, 
  Disc,
  Cpu,
  Power,
  Info,
  CheckCircle
} from "lucide-react";
import { useState } from "react";

interface MaintenanceBlocker {
  vm_name: string;
  vm_id: string;
  reason: 'local_storage' | 'passthrough' | 'affinity' | 'connected_media' | 'vcsa' | 'critical_infra' | 'drs_no_destination' | 'drs_resource_constraint' | 'drs_anti_affinity' | 'drs_evc_incompatible';
  severity: 'critical' | 'warning';
  details: string;
  remediation: string;
  auto_fixable: boolean;
  power_off_eligible?: boolean;
}

interface HostBlockerAnalysis {
  host_id: string;
  host_name: string;
  can_enter_maintenance: boolean;
  blockers: MaintenanceBlocker[];
  warnings: string[];
  total_powered_on_vms: number;
  migratable_vms: number;
  blocked_vms: number;
  estimated_evacuation_time: number;
}

interface MaintenanceBlockersPanelProps {
  blockers: Record<string, HostBlockerAnalysis>;
  onSkipHost?: (hostId: string) => void;
  onAcknowledge?: (hostId: string, vmName: string) => void;
  onPowerOffVM?: (hostId: string, vmName: string) => void;
  onAddToPowerOffList?: (hostId: string, vmName: string) => void;
}

const getReasonIcon = (reason: string) => {
  switch (reason) {
    case 'local_storage':
      return <HardDrive className="h-4 w-4" />;
    case 'passthrough':
      return <Usb className="h-4 w-4" />;
    case 'vcsa':
    case 'critical_infra':
      return <Server className="h-4 w-4" />;
    case 'connected_media':
      return <Disc className="h-4 w-4" />;
    case 'affinity':
      return <Cpu className="h-4 w-4" />;
    case 'drs_no_destination':
    case 'drs_resource_constraint':
      return <Server className="h-4 w-4" />;
    case 'drs_anti_affinity':
      return <AlertTriangle className="h-4 w-4" />;
    case 'drs_evc_incompatible':
      return <Cpu className="h-4 w-4" />;
    default:
      return <Info className="h-4 w-4" />;
  }
};

const getReasonLabel = (reason: string) => {
  switch (reason) {
    case 'local_storage':
      return 'Local Storage';
    case 'passthrough':
      return 'Passthrough Device';
    case 'vcsa':
      return 'vCenter Server';
    case 'critical_infra':
      return 'Critical Infrastructure';
    case 'connected_media':
      return 'Connected Media';
    case 'affinity':
      return 'CPU/Memory Affinity';
    case 'drs_no_destination':
      return 'No DRS Destination';
    case 'drs_resource_constraint':
      return 'Resource Constraint';
    case 'drs_anti_affinity':
      return 'Anti-Affinity Rule';
    case 'drs_evc_incompatible':
      return 'EVC Incompatible';
    default:
      return 'Unknown';
  }
};

const BlockerCard = ({ 
  blocker, 
  onAcknowledge,
  onPowerOff,
  onAddToPowerOffList
}: { 
  blocker: MaintenanceBlocker; 
  onAcknowledge?: () => void;
  onPowerOff?: () => void;
  onAddToPowerOffList?: () => void;
}) => {
  const isCritical = blocker.severity === 'critical';
  const canPowerOff = blocker.power_off_eligible !== false && 
    ['drs_no_destination', 'drs_resource_constraint', 'drs_anti_affinity', 'local_storage'].includes(blocker.reason);
  
  return (
    <div className={`p-3 rounded-lg border ${isCritical ? 'border-destructive/50 bg-destructive/5' : 'border-yellow-500/50 bg-yellow-500/5'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {isCritical ? (
            <XCircle className="h-4 w-4 text-destructive shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
          )}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{blocker.vm_name}</span>
              <Badge variant={isCritical ? "destructive" : "secondary"} className="text-xs">
                {getReasonIcon(blocker.reason)}
                <span className="ml-1">{getReasonLabel(blocker.reason)}</span>
              </Badge>
              {canPowerOff && (
                <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-700 dark:text-orange-400">
                  Power-off eligible
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{blocker.details}</p>
          </div>
        </div>
      </div>
      
      <div className="mt-2 pl-6">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Remediation:</span> {blocker.remediation}
        </div>
        
        <div className="flex flex-wrap gap-2 mt-2">
          {blocker.auto_fixable && (
            <Button 
              variant="outline" 
              size="sm" 
              className="h-7 text-xs"
              onClick={onAcknowledge}
            >
              <Power className="h-3 w-3 mr-1" />
              Auto-Fix Available
            </Button>
          )}
          
          {canPowerOff && onPowerOff && (
            <Button 
              variant="outline" 
              size="sm" 
              className="h-7 text-xs text-orange-700 dark:text-orange-400 border-orange-500/50 hover:bg-orange-500/10"
              onClick={onPowerOff}
            >
              <Power className="h-3 w-3 mr-1" />
              Power Off Now
            </Button>
          )}
          
          {canPowerOff && onAddToPowerOffList && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-7 text-xs"
              onClick={onAddToPowerOffList}
            >
              Add to Auto Power-Off List
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export const MaintenanceBlockersPanel = ({ 
  blockers, 
  onSkipHost,
  onAcknowledge,
  onPowerOffVM,
  onAddToPowerOffList
}: MaintenanceBlockersPanelProps) => {
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set());
  
  const hostEntries = Object.entries(blockers);
  
  if (hostEntries.length === 0) {
    return null;
  }
  
  const totalCriticalBlockers = hostEntries.reduce((sum, [_, analysis]) => 
    sum + analysis.blockers.filter(b => b.severity === 'critical').length, 0);
  
  const totalWarningBlockers = hostEntries.reduce((sum, [_, analysis]) => 
    sum + analysis.blockers.filter(b => b.severity === 'warning').length, 0);
  
  const toggleHost = (hostId: string) => {
    setExpandedHosts(prev => {
      const next = new Set(prev);
      if (next.has(hostId)) {
        next.delete(hostId);
      } else {
        next.add(hostId);
      }
      return next;
    });
  };
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-yellow-500" />
          Maintenance Mode Blockers
        </h4>
        <div className="flex items-center gap-2">
          {totalCriticalBlockers > 0 && (
            <Badge variant="destructive">{totalCriticalBlockers} Critical</Badge>
          )}
          {totalWarningBlockers > 0 && (
            <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-400">
              {totalWarningBlockers} Warning
            </Badge>
          )}
        </div>
      </div>
      
      {totalCriticalBlockers > 0 && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            <span className="font-semibold">{totalCriticalBlockers} VM(s)</span> have issues that will 
            prevent maintenance mode entry. These must be resolved or acknowledged before proceeding.
          </AlertDescription>
        </Alert>
      )}
      
      <div className="space-y-3">
        {hostEntries.map(([serverId, analysis]) => {
          const isExpanded = expandedHosts.has(serverId);
          const criticalCount = analysis.blockers.filter(b => b.severity === 'critical').length;
          const warningCount = analysis.blockers.filter(b => b.severity === 'warning').length;
          
          return (
            <Card key={serverId} className="overflow-hidden">
              <Collapsible open={isExpanded} onOpenChange={() => toggleHost(serverId)}>
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      <div className="text-left">
                        <div className="font-medium">{analysis.host_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {analysis.total_powered_on_vms} VMs • {analysis.migratable_vms} migratable • 
                          ~{Math.ceil(analysis.estimated_evacuation_time / 60)} min evacuation
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {analysis.can_enter_maintenance ? (
                        <Badge className="bg-green-500/20 text-green-700 dark:text-green-400">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Can Proceed
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <XCircle className="h-3 w-3 mr-1" />
                          Blocked
                        </Badge>
                      )}
                      
                      {criticalCount > 0 && (
                        <Badge variant="destructive" className="text-xs">
                          {criticalCount} critical
                        </Badge>
                      )}
                      {warningCount > 0 && (
                        <Badge variant="secondary" className="text-xs bg-yellow-500/20 text-yellow-700 dark:text-yellow-400">
                          {warningCount} warning
                        </Badge>
                      )}
                    </div>
                  </div>
                </CollapsibleTrigger>
                
                <CollapsibleContent>
                  <div className="px-4 pb-4 space-y-3 border-t pt-3">
                    {analysis.blockers.length === 0 ? (
                      <div className="text-sm text-muted-foreground flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        No blocking VMs detected - maintenance mode should succeed
                      </div>
                    ) : (
                      <>
                        {analysis.blockers.map((blocker, idx) => (
                          <BlockerCard 
                            key={`${blocker.vm_id}-${idx}`}
                            blocker={blocker}
                            onAcknowledge={onAcknowledge ? () => onAcknowledge(analysis.host_id, blocker.vm_name) : undefined}
                            onPowerOff={onPowerOffVM ? () => onPowerOffVM(analysis.host_id, blocker.vm_name) : undefined}
                            onAddToPowerOffList={onAddToPowerOffList ? () => onAddToPowerOffList(analysis.host_id, blocker.vm_name) : undefined}
                          />
                        ))}
                        
                        {onSkipHost && !analysis.can_enter_maintenance && (
                          <div className="flex justify-end pt-2">
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => onSkipHost(analysis.host_id)}
                            >
                              Skip This Host
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
