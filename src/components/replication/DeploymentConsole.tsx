/**
 * Deployment Console Component
 * 
 * Displays real-time SSH command output and deployment logs during ZFS target deployment.
 * Subscribes to job.details.console_log updates via Supabase real-time.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Copy, Check, Terminal, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConsoleEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'ssh';
  message: string;
}

interface DeploymentConsoleProps {
  jobId: string | null;
  isRunning?: boolean;
  className?: string;
}

export function DeploymentConsole({ jobId, isRunning = false, className }: DeploymentConsoleProps) {
  const [copied, setCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Fetch console log from job details
  const { data: consoleLog } = useQuery({
    queryKey: ['deployment-console', jobId],
    queryFn: async () => {
      if (!jobId) return [];
      
      const { data, error } = await supabase
        .from('jobs')
        .select('details')
        .eq('id', jobId)
        .single();
      
      if (error) throw error;
      
      const details = data?.details as Record<string, unknown> | null;
      const log = details?.console_log;
      
      if (Array.isArray(log)) {
        return log as ConsoleEntry[];
      }
      
      return [];
    },
    enabled: !!jobId,
    refetchInterval: isRunning ? 1000 : false, // Poll every second while running
  });

  // Subscribe to real-time updates
  useEffect(() => {
    if (!jobId) return;

    const channel = supabase
      .channel(`deployment-console-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `id=eq.${jobId}`
        },
        () => {
          // Trigger refetch on any update
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId]);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [consoleLog, autoScroll]);

  const handleCopy = async () => {
    if (!consoleLog?.length) return;
    
    const text = consoleLog
      .map(entry => `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`)
      .join('\n');
    
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getLevelStyles = (level: ConsoleEntry['level']) => {
    switch (level) {
      case 'error':
        return 'text-destructive';
      case 'warn':
        return 'text-yellow-500';
      case 'debug':
        return 'text-muted-foreground';
      case 'ssh':
        return 'text-emerald-400 font-mono';
      default:
        return 'text-foreground';
    }
  };

  const getLevelBadge = (level: ConsoleEntry['level']) => {
    switch (level) {
      case 'error':
        return <Badge variant="destructive" className="text-[10px] px-1 py-0">ERR</Badge>;
      case 'warn':
        return <Badge className="bg-yellow-500/20 text-yellow-500 text-[10px] px-1 py-0 hover:bg-yellow-500/20">WARN</Badge>;
      case 'debug':
        return <Badge variant="secondary" className="text-[10px] px-1 py-0">DBG</Badge>;
      case 'ssh':
        return <Badge className="bg-emerald-500/20 text-emerald-500 text-[10px] px-1 py-0 hover:bg-emerald-500/20">SSH</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px] px-1 py-0">INFO</Badge>;
    }
  };

  const isSSHCommand = (message: string | null | undefined) => {
    if (!message) return false;
    return message.startsWith('$') || 
           message.includes('sudo ') || 
           message.includes('zpool ') || 
           message.includes('zfs ') ||
           message.includes('exportfs ') ||
           message.includes('systemctl ');
  };

  const formatMessage = (entry: ConsoleEntry) => {
    const message = entry.message ?? '';
    
    if (!message) {
      return <span className="text-muted-foreground italic">[empty]</span>;
    }
    
    // Highlight SSH commands
    if (entry.level === 'ssh' || isSSHCommand(message)) {
      return (
        <span className="font-mono text-emerald-400">
          {message.startsWith('$') ? message : `$ ${message}`}
        </span>
      );
    }
    
    // Highlight success messages
    if (message.includes('✓') || message.toLowerCase().includes('success')) {
      return <span className="text-green-500">{message}</span>;
    }
    
    return message;
  };

  const entries = consoleLog || [];

  return (
    <div className={cn('rounded-lg border bg-card overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Console Output</span>
          {isRunning && (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-muted-foreground">Live</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setAutoScroll(!autoScroll)}
          >
            {autoScroll ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={handleCopy}
            disabled={!entries.length}
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      {/* Console content */}
      <ScrollArea className="h-[200px] bg-background/50" ref={scrollRef}>
        <div className="p-3 font-mono text-xs space-y-1">
          {entries.length === 0 ? (
            <div className="text-muted-foreground text-center py-8">
              {isRunning ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground animate-pulse" />
                  Waiting for output...
                </span>
              ) : (
                'No console output available'
              )}
            </div>
          ) : (
            entries.map((entry, index) => (
              <div
                key={index}
                className={cn(
                  'flex items-start gap-2 leading-relaxed',
                  getLevelStyles(entry.level)
                )}
              >
                <span className="text-muted-foreground shrink-0 w-16">
                  {entry.timestamp}
                </span>
                {getLevelBadge(entry.level)}
                <span className="flex-1 break-all">
                  {formatMessage(entry)}
                </span>
              </div>
            ))
          )}
          
          {/* Running cursor */}
          {isRunning && entries.length > 0 && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="w-16" />
              <span className="h-4 w-2 bg-primary animate-pulse" />
            </div>
          )}
          
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
