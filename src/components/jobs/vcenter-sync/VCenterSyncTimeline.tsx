import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  Info, 
  Terminal,
  Clock,
  Zap,
  Database
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo, useRef, useEffect } from "react";

interface VCenterSyncTimelineProps {
  consoleLogs: string[];
  isRunning: boolean;
}

interface ParsedLogEntry {
  timestamp?: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'success';
  message: string;
  category?: string;
  raw: string;
}

/**
 * Parse a console log entry into structured data
 */
function parseLogEntry(log: string): ParsedLogEntry {
  // Extract timestamp if present (format: [HH:MM:SS] or YYYY-MM-DD HH:MM:SS)
  const timestampMatch = log.match(/^\[?(\d{2}:\d{2}:\d{2})\]?\s*/);
  const timestamp = timestampMatch ? timestampMatch[1] : undefined;
  const messageWithoutTimestamp = timestamp ? log.slice(timestampMatch![0].length) : log;
  
  // Determine log level
  let level: ParsedLogEntry['level'] = 'info';
  let message = messageWithoutTimestamp;
  
  if (log.toLowerCase().includes('error') || log.toLowerCase().includes('failed')) {
    level = 'error';
  } else if (log.toLowerCase().includes('warning') || log.toLowerCase().includes('warn')) {
    level = 'warn';
  } else if (log.toLowerCase().includes('debug')) {
    level = 'debug';
  } else if (
    log.toLowerCase().includes('completed') || 
    log.toLowerCase().includes('success') ||
    log.toLowerCase().includes('synced') ||
    log.toLowerCase().includes('connected')
  ) {
    level = 'success';
  }
  
  // Determine category
  let category: string | undefined;
  if (log.toLowerCase().includes('propertycollector')) {
    category = 'PropertyCollector';
  } else if (log.toLowerCase().includes('cluster')) {
    category = 'Clusters';
  } else if (log.toLowerCase().includes('host')) {
    category = 'Hosts';
  } else if (log.toLowerCase().includes('datastore')) {
    category = 'Datastores';
  } else if (log.toLowerCase().includes('network')) {
    category = 'Networks';
  } else if (log.toLowerCase().includes('vm') || log.toLowerCase().includes('virtual machine')) {
    category = 'VMs';
  } else if (log.toLowerCase().includes('alarm')) {
    category = 'Alarms';
  } else if (log.toLowerCase().includes('connect')) {
    category = 'Connection';
  }
  
  return { timestamp, level, message, category, raw: log };
}

export const VCenterSyncTimeline = ({ consoleLogs, isRunning }: VCenterSyncTimelineProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const parsedLogs = useMemo(() => {
    return consoleLogs.map(parseLogEntry);
  }, [consoleLogs]);
  
  // Auto-scroll to bottom when running
  useEffect(() => {
    if (isRunning && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [consoleLogs, isRunning]);
  
  const getLevelIcon = (level: ParsedLogEntry['level']) => {
    switch (level) {
      case 'success':
        return <CheckCircle className="h-3.5 w-3.5 text-success" />;
      case 'warn':
        return <AlertTriangle className="h-3.5 w-3.5 text-warning" />;
      case 'error':
        return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case 'debug':
        return <Terminal className="h-3.5 w-3.5 text-muted-foreground" />;
      default:
        return <Info className="h-3.5 w-3.5 text-primary" />;
    }
  };
  
  const getCategoryIcon = (category?: string) => {
    if (!category) return null;
    switch (category) {
      case 'PropertyCollector':
        return <Zap className="h-3 w-3" />;
      case 'Connection':
        return <Database className="h-3 w-3" />;
      default:
        return null;
    }
  };

  if (parsedLogs.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center">
        <Terminal className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          {isRunning ? 'Waiting for console output...' : 'No console logs available'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Console Timeline</span>
        </div>
        <Badge variant="outline" className="text-xs">
          {parsedLogs.length} entries
        </Badge>
      </div>
      
      <ScrollArea className="h-[300px]" ref={scrollRef}>
        <div className="p-2 space-y-0.5">
          {parsedLogs.map((log, index) => (
            <div 
              key={index}
              className={cn(
                "flex items-start gap-3 px-3 py-2 rounded-md text-sm font-mono transition-colors",
                log.level === 'error' && "bg-destructive/10 text-destructive",
                log.level === 'warn' && "bg-warning/10",
                log.level === 'success' && "bg-success/5",
                log.level === 'debug' && "opacity-60",
                log.level === 'info' && "hover:bg-muted/50"
              )}
            >
              {/* Timeline indicator */}
              <div className="flex flex-col items-center gap-1 pt-0.5">
                {getLevelIcon(log.level)}
                {index < parsedLogs.length - 1 && (
                  <div className="w-px h-full min-h-[8px] bg-border" />
                )}
              </div>
              
              {/* Content */}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {log.timestamp && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {log.timestamp}
                    </span>
                  )}
                  {log.category && (
                    <Badge variant="secondary" className="text-xs h-5 flex items-center gap-1">
                      {getCategoryIcon(log.category)}
                      {log.category}
                    </Badge>
                  )}
                </div>
                <p className={cn(
                  "text-xs break-all",
                  log.level === 'error' && "text-destructive",
                  log.level === 'warn' && "text-warning",
                  log.level === 'debug' && "text-muted-foreground"
                )}>
                  {log.message}
                </p>
              </div>
            </div>
          ))}
          
          {/* Running indicator */}
          {isRunning && (
            <div className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="italic">Waiting for more output...</span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
