import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Database, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Clock,
  Server,
  Monitor,
  HardDrive
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VCenterSyncEntityCards } from "./VCenterSyncEntityCards";

interface MultiVCenterAccordionProps {
  vcenterResults: any[];
  totalVcenters: number;
  isRunning: boolean;
  currentVcenterIndex?: number;
}

export const MultiVCenterAccordion = ({ 
  vcenterResults, 
  totalVcenters,
  isRunning,
  currentVcenterIndex = 0
}: MultiVCenterAccordionProps) => {
  const completedCount = vcenterResults.filter(r => r?.status !== 'failed').length;
  const failedCount = vcenterResults.filter(r => r?.status === 'failed').length;
  
  const getResultStatus = (result: any) => {
    if (result?.status === 'failed') return 'failed';
    if (result?.status === 'completed_with_warnings') return 'warning';
    
    // Check for warnings like 0 networks
    const hosts = result?.hosts_synced || result?.hosts || 0;
    const networks = result?.networks_synced || result?.networks || 0;
    if (networks === 0 && hosts > 0) return 'warning';
    
    return 'success';
  };
  
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      default:
        return <CheckCircle className="h-4 w-4 text-success" />;
    }
  };
  
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'warning':
        return <Badge variant="outline" className="border-warning text-warning">Warnings</Badge>;
      default:
        return <Badge variant="secondary">Success</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary Header */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Server className="h-5 w-5 text-primary" />
            <div>
              <h4 className="font-semibold">Multi-vCenter Sync</h4>
              <p className="text-sm text-muted-foreground">
                {isRunning 
                  ? `Syncing ${currentVcenterIndex + 1} of ${totalVcenters}...`
                  : `${completedCount} of ${totalVcenters} completed`
                }
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {failedCount > 0 && (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" />
                {failedCount} Failed
              </Badge>
            )}
            <Badge variant={completedCount === totalVcenters ? "secondary" : "outline"}>
              {completedCount === totalVcenters ? (
                <>
                  <CheckCircle className="h-3 w-3 mr-1" />
                  All Complete
                </>
              ) : (
                `${completedCount}/${totalVcenters}`
              )}
            </Badge>
          </div>
        </div>
        
        {/* Overall progress */}
        <Progress 
          value={(vcenterResults.length / totalVcenters) * 100} 
          className="h-2" 
        />
      </div>
      
      {/* Per-vCenter Accordion */}
      <Accordion type="multiple" className="space-y-2">
        {vcenterResults.map((result, index) => {
          const status = getResultStatus(result);
          const vcenterName = result?.vcenter_name || result?.vcenter_host || `vCenter ${index + 1}`;
          const syncDuration = result?.sync_duration_seconds 
            ? `${result.sync_duration_seconds}s`
            : result?.sync_duration_ms
              ? `${(result.sync_duration_ms / 1000).toFixed(1)}s`
              : null;
          
          // Quick stats for summary
          const vms = result?.vms_synced || result?.vms || 0;
          const hosts = result?.hosts_synced || result?.hosts || 0;
          const datastores = result?.datastores_synced || result?.datastores || 0;
          
          return (
            <AccordionItem 
              key={result?.vcenter_id || index} 
              value={`vcenter-${index}`}
              className={cn(
                "border rounded-lg overflow-hidden",
                status === 'failed' && "border-destructive/50 bg-destructive/5",
                status === 'warning' && "border-warning/50 bg-warning/5"
              )}
            >
              <AccordionTrigger className="px-4 hover:no-underline">
                <div className="flex items-center justify-between w-full pr-2">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "p-2 rounded-lg",
                      status === 'failed' && "bg-destructive/10",
                      status === 'warning' && "bg-warning/10",
                      status === 'success' && "bg-success/10"
                    )}>
                      <Database className={cn(
                        "h-4 w-4",
                        status === 'failed' && "text-destructive",
                        status === 'warning' && "text-warning",
                        status === 'success' && "text-success"
                      )} />
                    </div>
                    
                    <div className="text-left">
                      <p className="font-medium">{vcenterName}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {syncDuration && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {syncDuration}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Server className="h-3 w-3" />
                          {hosts}
                        </span>
                        <span className="flex items-center gap-1">
                          <Monitor className="h-3 w-3" />
                          {vms}
                        </span>
                        <span className="flex items-center gap-1">
                          <HardDrive className="h-3 w-3" />
                          {datastores}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {getStatusBadge(status)}
                </div>
              </AccordionTrigger>
              
              <AccordionContent className="px-4 pb-4">
                {/* Error message for failed syncs */}
                {result?.error && (
                  <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                    <p className="text-sm text-destructive font-mono">{result.error}</p>
                  </div>
                )}
                
                <VCenterSyncEntityCards details={result} />
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
};
