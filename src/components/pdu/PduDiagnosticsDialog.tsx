import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle, Info, AlertTriangle, Copy, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import type { Pdu } from '@/types/pdu';

interface DiagnosticEntry {
  timestamp: string;
  level: string;
  operation: string;
  message: string;
  details?: Record<string, unknown>;
}

interface DiagnosticsData {
  collected_at: string;
  snmp_available: boolean;
  entries: DiagnosticEntry[];
}

interface PduDiagnosticsDialogProps {
  pdu: Pdu | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh?: () => void;
}

export function PduDiagnosticsDialog({
  pdu,
  open,
  onOpenChange,
  onRefresh,
}: PduDiagnosticsDialogProps) {
  const diagnostics = pdu?.last_sync_diagnostics as DiagnosticsData | null;

  const getLevelIcon = (level: string) => {
    switch (level?.toUpperCase()) {
      case 'ERROR':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      case 'WARN':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'INFO':
        return <Info className="h-4 w-4 text-blue-500" />;
      case 'DEBUG':
        return <CheckCircle className="h-4 w-4 text-muted-foreground" />;
      default:
        return <Info className="h-4 w-4" />;
    }
  };

  const getLevelBadgeVariant = (level: string): 'destructive' | 'outline' | 'secondary' | 'default' => {
    switch (level?.toUpperCase()) {
      case 'ERROR':
        return 'destructive';
      case 'WARN':
        return 'outline';
      case 'DEBUG':
        return 'secondary';
      default:
        return 'default';
    }
  };

  const handleCopyDiagnostics = () => {
    if (!diagnostics) return;
    
    const text = JSON.stringify(diagnostics, null, 2);
    navigator.clipboard.writeText(text);
    toast.success('Diagnostics copied to clipboard');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            PDU Diagnostics: {pdu?.name}
          </DialogTitle>
          <DialogDescription>
            Detailed diagnostic information from the last sync attempt
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary */}
          <div className="flex items-center justify-between gap-4 p-3 bg-muted/50 rounded-lg">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">SNMP Available:</span>
                {diagnostics?.snmp_available ? (
                  <Badge variant="default" className="bg-green-600">Yes</Badge>
                ) : (
                  <Badge variant="destructive">No</Badge>
                )}
              </div>
              {diagnostics?.collected_at && (
                <p className="text-xs text-muted-foreground">
                  Collected {formatDistanceToNow(new Date(diagnostics.collected_at), { addSuffix: true })}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleCopyDiagnostics}>
                <Copy className="h-4 w-4 mr-1" />
                Copy
              </Button>
              {onRefresh && (
                <Button variant="outline" size="sm" onClick={onRefresh}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Retry Sync
                </Button>
              )}
            </div>
          </div>

          {/* Entries */}
          <ScrollArea className="h-[400px] pr-4">
            {diagnostics?.entries && diagnostics.entries.length > 0 ? (
              <div className="space-y-3">
                {diagnostics.entries.map((entry, index) => (
                  <div
                    key={index}
                    className="p-3 border rounded-lg space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {getLevelIcon(entry.level)}
                        <Badge variant={getLevelBadgeVariant(entry.level)}>
                          {entry.level}
                        </Badge>
                        <Badge variant="secondary">{entry.operation}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    
                    <p className="text-sm font-medium">{entry.message}</p>
                    
                    {entry.details && Object.keys(entry.details).length > 0 && (
                      <div className="mt-2 p-2 bg-muted/50 rounded text-xs font-mono overflow-x-auto">
                        <pre className="whitespace-pre-wrap break-all">
                          {JSON.stringify(entry.details, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Info className="h-8 w-8 mb-2" />
                <p>No diagnostic data available</p>
                <p className="text-sm">Run a sync operation to capture diagnostics</p>
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
