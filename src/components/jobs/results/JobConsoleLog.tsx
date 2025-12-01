import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Copy, Terminal } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface JobTask {
  id: string;
  status: string;
  log: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface ApiCommand {
  id: string;
  timestamp: string;
  command_type: string;
  endpoint: string;
  status_code: number | null;
  response_time_ms: number | null;
  success: boolean;
  error_message: string | null;
  operation_type: string;
}

interface ConsoleEntry {
  id: string;
  timestamp: string;
  type: 'task' | 'activity';
  status: string;
  message: string;
  details?: {
    endpoint?: string;
    response_time_ms?: number;
    command_type?: string;
    error_message?: string;
  };
}

interface JobConsoleLogProps {
  jobId: string;
}

type FilterType = 'all' | 'tasks' | 'activity' | 'errors';

export const JobConsoleLog = ({ jobId }: JobConsoleLogProps) => {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch job_tasks
      const { data: tasks, error: tasksError } = await supabase
        .from('job_tasks')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true });

      if (tasksError) throw tasksError;

      // Fetch idrac_commands (activity log)
      const { data: commands, error: commandsError } = await supabase
        .from('idrac_commands')
        .select('*')
        .eq('job_id', jobId)
        .order('timestamp', { ascending: true });

      if (commandsError) throw commandsError;

      // Merge and sort by timestamp
      const taskEntries: ConsoleEntry[] = (tasks || []).map((t: JobTask) => ({
        id: t.id,
        timestamp: t.started_at || t.created_at,
        type: 'task' as const,
        status: t.status,
        message: t.log || `Task ${t.status}`,
        details: {}
      }));

      const activityEntries: ConsoleEntry[] = (commands || []).map((c: ApiCommand) => ({
        id: c.id,
        timestamp: c.timestamp,
        type: 'activity' as const,
        status: c.success ? 'completed' : 'failed',
        message: `${c.command_type} - ${c.endpoint}`,
        details: {
          endpoint: c.endpoint,
          response_time_ms: c.response_time_ms,
          command_type: c.command_type,
          error_message: c.error_message
        }
      }));

      const merged = [...taskEntries, ...activityEntries].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      setEntries(merged);
    } catch (error) {
      console.error('Error fetching console data:', error);
      toast.error('Failed to load console logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [jobId]);

  // Subscribe to real-time updates
  useEffect(() => {
    const tasksChannel = supabase
      .channel(`console-tasks-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_tasks',
          filter: `job_id=eq.${jobId}`
        },
        (payload) => {
          const task = payload.new as JobTask;
          const newEntry: ConsoleEntry = {
            id: task.id,
            timestamp: task.started_at || task.created_at,
            type: 'task',
            status: task.status,
            message: task.log || `Task ${task.status}`,
            details: {}
          };
          setEntries((prev) => {
            const filtered = prev.filter(e => e.id !== task.id);
            return [...filtered, newEntry].sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
          });
        }
      )
      .subscribe();

    const activityChannel = supabase
      .channel(`console-activity-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'idrac_commands',
          filter: `job_id=eq.${jobId}`
        },
        (payload) => {
          const cmd = payload.new as ApiCommand;
          const newEntry: ConsoleEntry = {
            id: cmd.id,
            timestamp: cmd.timestamp,
            type: 'activity',
            status: cmd.success ? 'completed' : 'failed',
            message: `${cmd.command_type} - ${cmd.endpoint}`,
            details: {
              endpoint: cmd.endpoint,
              response_time_ms: cmd.response_time_ms,
              command_type: cmd.command_type,
              error_message: cmd.error_message
            }
          };
          setEntries((prev) => [...prev, newEntry].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          ));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(tasksChannel);
      supabase.removeChannel(activityChannel);
    };
  }, [jobId]);

  // Auto-scroll to bottom when new entries are added
  useEffect(() => {
    if (scrollRef.current) {
      const scrollElement = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [entries]);

  const formatTimestamp = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getStatusSymbol = (entry: ConsoleEntry): string => {
    if (entry.type === 'task') {
      switch (entry.status) {
        case 'completed': return '✓';
        case 'failed': return '✗';
        case 'running': return '⟳';
        default: return '○';
      }
    } else {
      return entry.status === 'completed' ? '→' : '✗';
    }
  };

  const getStatusColor = (entry: ConsoleEntry): string => {
    if (entry.type === 'task') {
      switch (entry.status) {
        case 'completed': return 'text-green-400';
        case 'failed': return 'text-red-400';
        case 'running': return 'text-blue-400';
        default: return 'text-muted-foreground';
      }
    } else {
      return entry.status === 'completed' ? 'text-muted-foreground/80' : 'text-red-400';
    }
  };

  const copyToClipboard = () => {
    const logText = filteredEntries
      .map(e => `[${formatTimestamp(e.timestamp)}] ${getStatusSymbol(e)} ${e.message}`)
      .join('\n');
    navigator.clipboard.writeText(logText);
    toast.success('Console log copied to clipboard');
  };

  const filteredEntries = entries.filter(entry => {
    switch (filter) {
      case 'tasks':
        return entry.type === 'task';
      case 'activity':
        return entry.type === 'activity';
      case 'errors':
        return entry.status === 'failed' || entry.details?.error_message;
      default:
        return true;
    }
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            <CardTitle>Console Log</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <Button
                variant={filter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter('all')}
              >
                All
              </Button>
              <Button
                variant={filter === 'tasks' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter('tasks')}
              >
                Phases
              </Button>
              <Button
                variant={filter === 'activity' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter('activity')}
              >
                API Calls
              </Button>
              <Button
                variant={filter === 'errors' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter('errors')}
              >
                Errors
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={copyToClipboard} disabled={entries.length === 0}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea 
          ref={scrollRef}
          className="h-[400px] font-mono text-sm bg-[hsl(0,0%,4%)] rounded-md p-4"
        >
          {loading ? (
            <div className="text-muted-foreground/60 italic">Loading console...</div>
          ) : filteredEntries.length === 0 ? (
            <div className="text-muted-foreground/60 italic">
              {filter === 'all' ? 'No console output yet...' : `No ${filter} to display`}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={cn(
                    "leading-relaxed",
                    entry.type === 'activity' && 'pl-4 opacity-90 text-xs'
                  )}
                >
                  <span className="text-muted-foreground/60">
                    [{formatTimestamp(entry.timestamp)}]
                  </span>
                  {' '}
                  <span className={cn(getStatusColor(entry))}>
                    {getStatusSymbol(entry)}
                  </span>
                  {' '}
                  <span className={cn(
                    getStatusColor(entry),
                    entry.type === 'task' && 'font-semibold'
                  )}>
                    {entry.type === 'task' && 'Phase: '}
                    {entry.message}
                    {entry.details?.response_time_ms && (
                      <span className="text-muted-foreground/60 ml-2">
                        ({entry.details.response_time_ms}ms)
                      </span>
                    )}
                  </span>
                  {entry.details?.error_message && (
                    <div className="text-red-400 mt-0.5 text-xs pl-6">
                      Error: {entry.details.error_message}
                    </div>
                  )}
                </div>
              ))}
              
              {/* Show running cursor if any entry is running */}
              {entries.some(e => e.status === 'running') && (
                <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-1">▌</span>
              )}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};