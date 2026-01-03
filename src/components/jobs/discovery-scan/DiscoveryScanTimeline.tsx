import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { 
  CheckCircle2, 
  AlertCircle, 
  Info, 
  AlertTriangle,
  Terminal
} from "lucide-react";
import { translateDiscoveryMessage, type TranslatedMessage } from "@/lib/discovery-scan-messages";

interface DiscoveryScanTimelineProps {
  logs: string[];
  maxHeight?: string;
}

export function DiscoveryScanTimeline({ logs, maxHeight = "250px" }: DiscoveryScanTimelineProps) {
  const translatedLogs = useMemo(() => {
    return logs.map(log => translateDiscoveryMessage(log));
  }, [logs]);

  if (translatedLogs.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Terminal className="h-6 w-6 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Waiting for activity...</p>
      </div>
    );
  }

  const getLevelIcon = (level: TranslatedMessage['level']) => {
    switch (level) {
      case 'success':
        return <CheckCircle2 className="h-3.5 w-3.5 text-success flex-shrink-0" />;
      case 'error':
        return <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />;
      case 'warn':
        return <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0" />;
      default:
        return <Info className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />;
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          Activity Log
        </h4>
        <span className="text-xs text-muted-foreground">
          {translatedLogs.length} entries
        </span>
      </div>
      
      <ScrollArea className="border rounded-lg bg-muted/30" style={{ maxHeight }}>
        <div className="p-3 space-y-1.5">
          {translatedLogs.map((log, index) => (
            <div
              key={index}
              className={cn(
                "flex items-start gap-2 text-sm py-1 px-2 rounded",
                log.level === 'success' && "bg-success/10",
                log.level === 'error' && "bg-destructive/10",
                log.level === 'warn' && "bg-warning/10"
              )}
            >
              {getLevelIcon(log.level)}
              <span 
                className={cn(
                  "flex-1",
                  log.level === 'success' && "text-success",
                  log.level === 'error' && "text-destructive",
                  log.level === 'warn' && "text-warning"
                )}
                title={log.original}
              >
                {log.friendly}
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
