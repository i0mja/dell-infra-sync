import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { 
  AlertTriangle, 
  Network, 
  HardDrive, 
  XCircle,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";

interface VCenterSyncWarningsPanelProps {
  details: any;
  consoleLogs: string[];
}

interface Warning {
  type: 'network' | 'orphaned' | 'sync_failure' | 'error';
  title: string;
  description: string;
  severity: 'warning' | 'error';
  count?: number;
  items?: string[];
}

export const VCenterSyncWarningsPanel = ({ details, consoleLogs }: VCenterSyncWarningsPanelProps) => {
  const [isExpanded, setIsExpanded] = useState(true);
  
  const warnings = useMemo(() => {
    const result: Warning[] = [];
    
    // Check for network sync warning
    const hosts = details?.hosts_synced || details?.updated_hosts || details?.hosts || 0;
    const networks = details?.networks_synced || details?.networks || 0;
    if (networks === 0 && hosts > 0) {
      result.push({
        type: 'network',
        title: 'No Networks Synced',
        description: `Network collection returned 0 results while ${hosts} hosts were synced. This may indicate a vCenter permissions issue.`,
        severity: 'warning'
      });
    }
    
    // Check for orphaned entities in console logs
    const orphanedDatastores = consoleLogs.filter(log => 
      log.toLowerCase().includes('datastore') && 
      log.toLowerCase().includes('no longer found')
    );
    if (orphanedDatastores.length > 0) {
      result.push({
        type: 'orphaned',
        title: 'Orphaned Datastores Detected',
        description: `${orphanedDatastores.length} datastore(s) were previously synced but are no longer found in vCenter.`,
        severity: 'warning',
        count: orphanedDatastores.length,
        items: orphanedDatastores.slice(0, 5)
      });
    }
    
    // Check for sync failures in console logs
    const syncFailures = consoleLogs.filter(log => 
      log.toLowerCase().includes('failed to') ||
      log.toLowerCase().includes('error upserting') ||
      log.toLowerCase().includes('sync failed')
    );
    if (syncFailures.length > 0) {
      result.push({
        type: 'sync_failure',
        title: 'Sync Failures Detected',
        description: `${syncFailures.length} operation(s) failed during sync.`,
        severity: 'error',
        count: syncFailures.length,
        items: syncFailures.slice(0, 5)
      });
    }
    
    // Check for explicit errors in details
    if (details?.errors && Array.isArray(details.errors) && details.errors.length > 0) {
      result.push({
        type: 'error',
        title: 'Sync Errors',
        description: `${details.errors.length} error(s) occurred during sync.`,
        severity: 'error',
        count: details.errors.length,
        items: details.errors.slice(0, 5)
      });
    }
    
    return result;
  }, [details, consoleLogs]);
  
  if (warnings.length === 0) {
    return null;
  }
  
  const errorCount = warnings.filter(w => w.severity === 'error').length;
  const warningCount = warnings.filter(w => w.severity === 'warning').length;
  
  const getWarningIcon = (type: Warning['type']) => {
    switch (type) {
      case 'network':
        return <Network className="h-4 w-4" />;
      case 'orphaned':
        return <HardDrive className="h-4 w-4" />;
      case 'sync_failure':
      case 'error':
        return <XCircle className="h-4 w-4" />;
      default:
        return <AlertTriangle className="h-4 w-4" />;
    }
  };

  return (
    <Alert 
      variant={errorCount > 0 ? "destructive" : "default"}
      className={cn(
        "transition-all",
        errorCount === 0 && "border-warning bg-warning/10"
      )}
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <span className="flex items-center gap-2">
          Issues Detected
          <Badge variant="outline" className="text-xs">
            {errorCount > 0 && `${errorCount} error${errorCount > 1 ? 's' : ''}`}
            {errorCount > 0 && warningCount > 0 && ', '}
            {warningCount > 0 && `${warningCount} warning${warningCount > 1 ? 's' : ''}`}
          </Badge>
        </span>
        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </AlertTitle>
      
      {isExpanded && (
        <AlertDescription className="mt-3 space-y-3">
          {warnings.map((warning, index) => (
            <div 
              key={index}
              className={cn(
                "rounded-md p-3 space-y-2",
                warning.severity === 'error' ? "bg-destructive/10" : "bg-warning/10"
              )}
            >
              <div className="flex items-center gap-2">
                {getWarningIcon(warning.type)}
                <span className="font-medium text-sm">{warning.title}</span>
                {warning.count && (
                  <Badge variant="secondary" className="text-xs">
                    {warning.count}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{warning.description}</p>
              
              {warning.items && warning.items.length > 0 && (
                <div className="text-xs font-mono space-y-1 mt-2 pt-2 border-t border-border/50">
                  {warning.items.map((item, idx) => (
                    <p key={idx} className="truncate opacity-80">• {item}</p>
                  ))}
                  {warning.count && warning.count > 5 && (
                    <p className="text-muted-foreground italic">
                      ...and {warning.count - 5} more
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </AlertDescription>
      )}
    </Alert>
  );
};
