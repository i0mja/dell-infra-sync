import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Copy, Terminal } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface JobTask {
  id: string;
  status: string;
  log: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface JobConsoleLogProps {
  jobId: string;
}

export const JobConsoleLog = ({ jobId }: JobConsoleLogProps) => {
  const [tasks, setTasks] = useState<JobTask[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!jobId) return;

    const fetchTasks = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('job_tasks')
        .select('id, status, log, started_at, completed_at, created_at')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true });

      if (!error && data) {
        setTasks(data);
      }
      setLoading(false);
    };

    fetchTasks();

    // Subscribe to real-time task updates
    const channel = supabase
      .channel(`job-console-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_tasks',
          filter: `job_id=eq.${jobId}`
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setTasks(prev => [...prev, payload.new as JobTask]);
          } else if (payload.eventType === 'UPDATE') {
            setTasks(prev => prev.map(t => 
              t.id === payload.new.id ? payload.new as JobTask : t
            ));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId]);

  // Auto-scroll to bottom when new tasks arrive
  useEffect(() => {
    if (scrollRef.current) {
      const scrollElement = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [tasks]);

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getLogColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-400';
      case 'failed':
        return 'text-red-400';
      case 'running':
        return 'text-blue-400';
      default:
        return 'text-muted-foreground';
    }
  };

  const getStatusSymbol = (status: string) => {
    switch (status) {
      case 'completed':
        return '✓';
      case 'failed':
        return '✗';
      case 'running':
        return '⟳';
      default:
        return '○';
    }
  };

  const copyToClipboard = () => {
    const text = tasks
      .map(task => {
        const timestamp = formatTimestamp(task.created_at);
        const symbol = getStatusSymbol(task.status);
        const message = task.log || `Task ${task.status}`;
        return `[${timestamp}] ${symbol} ${message}`;
      })
      .join('\n');
    
    navigator.clipboard.writeText(text);
    toast.success('Console log copied to clipboard');
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          <CardTitle>Console Log</CardTitle>
        </div>
        <Button size="sm" variant="ghost" onClick={copyToClipboard} disabled={tasks.length === 0}>
          <Copy className="h-4 w-4 mr-2" />
          Copy
        </Button>
      </CardHeader>
      <CardContent>
        <ScrollArea 
          ref={scrollRef}
          className="h-[400px] font-mono text-sm bg-[hsl(0,0%,4%)] rounded-md p-4"
        >
          {loading ? (
            <div className="text-muted-foreground/60 italic">Loading console...</div>
          ) : tasks.length === 0 ? (
            <div className="text-muted-foreground/60 italic">No console output yet...</div>
          ) : (
            <div className="space-y-0.5">
              {tasks.map((task) => (
                <div key={task.id} className="leading-relaxed">
                  <span className="text-muted-foreground/60">
                    [{formatTimestamp(task.created_at)}]
                  </span>
                  {' '}
                  <span className={cn(getLogColor(task.status))}>
                    {getStatusSymbol(task.status)}
                  </span>
                  {' '}
                  <span className={cn(getLogColor(task.status))}>
                    {task.log || `Task ${task.status}`}
                  </span>
                </div>
              ))}
              
              {/* Show running cursor if any task is running */}
              {tasks.some(t => t.status === 'running') && (
                <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-1">▌</span>
              )}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
