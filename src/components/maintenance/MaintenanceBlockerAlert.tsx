import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  AlertTriangle, 
  ChevronDown, 
  ChevronRight, 
  Power, 
  ArrowRightLeft, 
  Check,
  Wand2,
  Server,
  Usb,
  HardDrive,
  Cpu,
  Disc
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BlockerDetail {
  vm_name: string;
  vm_id?: string;
  reason: string;
  severity: 'critical' | 'warning';
  details: string;
  remediation: string;
  auto_fixable?: boolean;
}

interface RemediationSummary {
  vms_to_power_off: Array<{ vm: string; reason: string; action: string; blocker_type: string }>;
  vms_to_migrate_manually: Array<{ vm: string; action: string; blocker_type: string }>;
  vms_acknowledged: Array<{ vm: string; action: string; blocker_type: string; auto_fixable: boolean }>;
  total_critical: number;
  total_warnings: number;
  can_proceed_with_power_off: boolean;
}

interface MaintenanceBlockerAlertProps {
  blockerDetails?: BlockerDetail[];
  remediationSummary?: RemediationSummary;
  maintenanceBlockers?: {
    host_name?: string;
    blockers?: BlockerDetail[];
  };
  onResolveBlockers?: () => void;
  className?: string;
}

const getBlockerIcon = (reason: string) => {
  switch (reason) {
    case 'passthrough':
    case 'vgpu':
      return <Usb className="h-4 w-4" />;
    case 'local_storage':
      return <HardDrive className="h-4 w-4" />;
    case 'fault_tolerance':
      return <Cpu className="h-4 w-4" />;
    case 'vcsa':
    case 'critical_infra':
      return <Server className="h-4 w-4" />;
    case 'connected_media':
      return <Disc className="h-4 w-4" />;
    default:
      return <AlertTriangle className="h-4 w-4" />;
  }
};

const getReasonLabel = (reason: string) => {
  const labels: Record<string, string> = {
    passthrough: 'USB/PCI Passthrough',
    vgpu: 'vGPU Attached',
    local_storage: 'Local Storage',
    fault_tolerance: 'Fault Tolerance',
    vcsa: 'vCenter Appliance',
    critical_infra: 'Critical Infrastructure',
    connected_media: 'Connected Media',
    affinity: 'CPU/Memory Affinity'
  };
  return labels[reason] || reason;
};

export const MaintenanceBlockerAlert = ({
  blockerDetails,
  remediationSummary,
  maintenanceBlockers,
  onResolveBlockers,
  className
}: MaintenanceBlockerAlertProps) => {
  const [isOpen, setIsOpen] = useState(true);
  
  // Get blockers from either source
  const blockers = blockerDetails || maintenanceBlockers?.blockers || [];
  
  if (blockers.length === 0) return null;
  
  const criticalCount = blockers.filter(b => b.severity === 'critical').length;
  const warningCount = blockers.filter(b => b.severity === 'warning').length;
  
  // Group blockers by reason
  const groupedBlockers = blockers.reduce((acc, blocker) => {
    const reason = blocker.reason;
    if (!acc[reason]) {
      acc[reason] = [];
    }
    acc[reason].push(blocker);
    return acc;
  }, {} as Record<string, BlockerDetail[]>);

  return (
    <Alert variant="destructive" className={cn("border-destructive/50", className)}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between">
        <span>
          Maintenance Blocked: {criticalCount > 0 && `${criticalCount} critical`}
          {criticalCount > 0 && warningCount > 0 && ', '}
          {warningCount > 0 && `${warningCount} warning`}
        </span>
        {onResolveBlockers && (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onResolveBlockers}
            className="ml-2"
          >
            <Wand2 className="h-3 w-3 mr-1" />
            Resolve
          </Button>
        )}
      </AlertTitle>
      <AlertDescription className="mt-3">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium mb-2 hover:underline">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {isOpen ? 'Hide Details' : 'Show Details'}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-3">
              {Object.entries(groupedBlockers).map(([reason, reasonBlockers]) => (
                <Card key={reason} className="border-border/50 bg-background/50">
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      {getBlockerIcon(reason)}
                      {getReasonLabel(reason)}
                      <Badge variant={reasonBlockers[0].severity === 'critical' ? 'destructive' : 'secondary'} className="text-xs">
                        {reasonBlockers.length} VM{reasonBlockers.length > 1 ? 's' : ''}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="py-2 px-3">
                    <div className="space-y-2">
                      {reasonBlockers.map((blocker, idx) => (
                        <div key={idx} className="text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium">{blocker.vm_name}</span>
                            <Badge variant="outline" className="text-xs">
                              {blocker.severity}
                            </Badge>
                          </div>
                          <p className="text-muted-foreground text-xs mt-1">{blocker.details}</p>
                          <div className="flex items-start gap-1 mt-1 text-xs text-primary">
                            <ArrowRightLeft className="h-3 w-3 mt-0.5 shrink-0" />
                            <span>{blocker.remediation}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
              
              {/* Remediation Summary */}
              {remediationSummary && (
                <Card className="border-primary/30 bg-primary/5">
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-sm">Recommended Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="py-2 px-3 space-y-2">
                    {remediationSummary.vms_to_power_off.length > 0 && (
                      <div className="flex items-start gap-2 text-sm">
                        <Power className="h-4 w-4 text-destructive mt-0.5" />
                        <div>
                          <span className="font-medium">Power off {remediationSummary.vms_to_power_off.length} VM(s):</span>
                          <span className="text-muted-foreground ml-1">
                            {remediationSummary.vms_to_power_off.map(v => v.vm).join(', ')}
                          </span>
                        </div>
                      </div>
                    )}
                    {remediationSummary.vms_to_migrate_manually.length > 0 && (
                      <div className="flex items-start gap-2 text-sm">
                        <ArrowRightLeft className="h-4 w-4 text-warning mt-0.5" />
                        <div>
                          <span className="font-medium">Manually migrate {remediationSummary.vms_to_migrate_manually.length} VM(s):</span>
                          <span className="text-muted-foreground ml-1">
                            {remediationSummary.vms_to_migrate_manually.map(v => v.vm).join(', ')}
                          </span>
                        </div>
                      </div>
                    )}
                    {remediationSummary.vms_acknowledged.length > 0 && (
                      <div className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <div>
                          <span className="font-medium">Acknowledge {remediationSummary.vms_acknowledged.length} VM(s):</span>
                          <span className="text-muted-foreground ml-1">
                            {remediationSummary.vms_acknowledged.map(v => v.vm).join(', ')}
                          </span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </AlertDescription>
    </Alert>
  );
};
