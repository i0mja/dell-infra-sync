import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Activity, AlertTriangle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ExecutorHeartbeat {
  id: string;
  executor_id: string;
  hostname: string | null;
  ip_address: string | null;
  version: string | null;
  last_seen_at: string;
  poll_count: number;
  jobs_processed: number;
  startup_time: string | null;
  last_error: string | null;
}

type ExecutorStatus = 'online' | 'idle' | 'offline' | 'unknown';

export function ExecutorStatusIndicator() {
  const [status, setStatus] = useState<ExecutorStatus>('unknown');

  const { data: heartbeat, isLoading, refetch } = useQuery({
    queryKey: ['executor-heartbeat'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('executor_heartbeats')
        .select('*')
        .order('last_seen_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      return data as ExecutorHeartbeat | null;
    },
    refetchInterval: 10000, // Poll every 10 seconds
  });

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel('executor-heartbeat-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'executor_heartbeats'
        },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [refetch]);

  // Calculate status based on last_seen_at
  useEffect(() => {
    if (!heartbeat) {
      setStatus('unknown');
      return;
    }

    const lastSeen = new Date(heartbeat.last_seen_at);
    const now = new Date();
    const diffSeconds = (now.getTime() - lastSeen.getTime()) / 1000;

    if (diffSeconds < 30) {
      setStatus('online');
    } else if (diffSeconds < 120) {
      setStatus('idle');
    } else {
      setStatus('offline');
    }
  }, [heartbeat]);

  const getStatusConfig = () => {
    switch (status) {
      case 'online':
        return {
          icon: CheckCircle2,
          label: 'Connected',
          className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
          dotClass: 'bg-emerald-500 animate-pulse'
        };
      case 'idle':
        return {
          icon: Activity,
          label: 'Idle',
          className: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
          dotClass: 'bg-amber-500'
        };
      case 'offline':
        return {
          icon: XCircle,
          label: 'Offline',
          className: 'bg-destructive/10 text-destructive border-destructive/20',
          dotClass: 'bg-destructive'
        };
      default:
        return {
          icon: AlertTriangle,
          label: 'Unknown',
          className: 'bg-muted text-muted-foreground border-border',
          dotClass: 'bg-muted-foreground'
        };
    }
  };

  if (isLoading) {
    return (
      <Badge variant="outline" className="gap-1.5 px-2 py-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-xs">Checking...</span>
      </Badge>
    );
  }

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={`gap-1.5 px-2 py-1 cursor-help ${config.className}`}
          >
            <span className={`h-2 w-2 rounded-full ${config.dotClass}`} />
            <span className="text-xs font-medium">Job Executor: {config.label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1.5 text-xs">
            {heartbeat ? (
              <>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Last seen:</span>
                  <span className="font-medium">
                    {formatDistanceToNow(new Date(heartbeat.last_seen_at), { addSuffix: true })}
                  </span>
                </div>
                {heartbeat.hostname && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Host:</span>
                    <span className="font-medium">{heartbeat.hostname}</span>
                  </div>
                )}
                {heartbeat.ip_address && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">IP:</span>
                    <span className="font-medium font-mono">{heartbeat.ip_address}</span>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Jobs processed:</span>
                  <span className="font-medium">{heartbeat.jobs_processed}</span>
                </div>
                {heartbeat.startup_time && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Uptime:</span>
                    <span className="font-medium">
                      {formatDistanceToNow(new Date(heartbeat.startup_time))}
                    </span>
                  </div>
                )}
                {heartbeat.last_error && (
                  <div className="pt-1 border-t border-border">
                    <span className="text-destructive">Last error: {heartbeat.last_error}</span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">
                No job executor has connected yet. Start the executor on your local network to process jobs.
              </p>
            )}
            {status === 'offline' && heartbeat && (
              <p className="pt-1 border-t border-border text-destructive">
                Executor appears offline. Check if job-executor.py is running.
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
