import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Copy, Terminal, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

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

interface BlockerDetail {
  vm_name: string;
  vm_id?: string;
  reason: string;
  severity?: string;
  remediation?: string;
  details?: string;
  auto_fixable?: boolean;
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
    blocker_details?: BlockerDetail[];
    remediation_summary?: {
      vms_to_power_off?: Array<{ vm: string; reason: string; action: string }>;
      vms_to_migrate_manually?: Array<{ vm: string; action: string }>;
    };
    human_readable_error?: string;
  };
}

interface ExecutorLogEntry {
  id: string;
  timestamp: string;
  level: string;
  message: string;
}

interface StepResult {
  step: string;
  status: string;
  message: string;
  timestamp?: string;
}

interface JobConsoleLogProps {
  jobId: string;
}

type FilterType = 'all' | 'tasks' | 'activity' | 'errors' | 'executor';

export const JobConsoleLog = ({ jobId }: JobConsoleLogProps) => {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [executorLogs, setExecutorLogs] = useState<ExecutorLogEntry[]>([]);
  const [stepResults, setStepResults] = useState<StepResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Helper to detect time-only format (HH:MM:SS)
  const isTimeOnly = (ts: string) => /^\d{2}:\d{2}:\d{2}$/.test(ts);

  const parseExecutorLog = (logLine: string, idx: number): ExecutorLogEntry | null => {
    // Format 1: [HH:MM:SS] [LEVEL] message
    let match = logLine.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*\[(\w+)\]\s*(.+)$/);
    if (match) {
      return {
        id: `exec-${idx}`,
        timestamp: match[1],
        level: match[2],
        message: match[3]
      };
    }
    
    // Format 2: [HH:MM:SS] LEVEL: message (Python handler format)
    match = logLine.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(\w+):\s*(.+)$/);
    if (match) {
      return {
        id: `exec-${idx}`,
        timestamp: match[1],
        level: match[2].toUpperCase(),
        message: match[3]
      };
    }
    
    // Format 3: Plain message with timestamp prefix
    match = logLine.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(.+)$/);
    if (match) {
      return {
        id: `exec-${idx}`,
        timestamp: match[1],
        level: 'INFO',
        message: match[2]
      };
    }
    
    return null;
  };

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

      // Fetch job details for console_log
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .select('details')
        .eq('id', jobId)
        .single();

      if (!jobError && jobData?.details) {
        const details = jobData.details as Record<string, unknown>;
        if (details.console_log && Array.isArray(details.console_log)) {
          const parsed = (details.console_log as string[])
            .map((line, idx) => parseExecutorLog(line, idx))
            .filter((e): e is ExecutorLogEntry => e !== null);
          setExecutorLogs(parsed);
        }
        // Parse step_results
        if (details.step_results && Array.isArray(details.step_results)) {
          setStepResults(details.step_results as StepResult[]);
        }
      }

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

    // Subscribe to job details updates for executor logs
    const jobChannel = supabase
      .channel(`console-job-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `id=eq.${jobId}`
        },
        (payload) => {
          const job = payload.new as { details?: Record<string, unknown> };
          setLastUpdate(new Date());
          if (job.details?.console_log && Array.isArray(job.details.console_log)) {
            const parsed = (job.details.console_log as string[])
              .map((line, idx) => parseExecutorLog(line, idx))
              .filter((e): e is ExecutorLogEntry => e !== null);
            setExecutorLogs(parsed);
          }
          // Update step_results
          if (job.details?.step_results && Array.isArray(job.details.step_results)) {
            setStepResults(job.details.step_results as StepResult[]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(tasksChannel);
      supabase.removeChannel(activityChannel);
      supabase.removeChannel(jobChannel);
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

  // Get friendly message for firmware-related entries
  const getFirmwareFriendlyMessage = (errorMessage: string | null | undefined): { message: string; severity: 'error' | 'warning' | 'success' | 'info' } | null => {
    if (!errorMessage) return null;
    
    const msg = errorMessage.toLowerCase();
    
    // SUP029 - Server is up-to-date (success, not error)
    if (msg.includes('sup029') || msg.includes('same version installed') || msg.includes('firmware versions on server match')) {
      return {
        message: 'Server is already up-to-date - no firmware updates needed',
        severity: 'success'
      };
    }
    
    // Unsupported firmware packages (warning)
    if (msg.includes('unsupported firmware packages') || msg.includes('sup030')) {
      return {
        message: 'Catalog does not contain compatible firmware for this server model',
        severity: 'warning'
      };
    }
    
    // No applicable updates (success)
    if (msg.includes('no applicable updates') || msg.includes('up to date')) {
      return {
        message: 'Server firmware is current - no updates available',
        severity: 'success'
      };
    }
    
    return null;
  };

  // Get human-readable blocker reason label
  const getBlockerReasonLabel = (reason: string): string => {
    const labels: Record<string, string> = {
      'passthrough': 'PCI Passthrough (cannot migrate)',
      'local_storage': 'Local Storage (cannot migrate)',
      'vgpu': 'vGPU (cannot migrate)',
      'fault_tolerance': 'Fault Tolerance (cannot migrate)',
      'vcsa': 'vCenter Appliance (migrate last)',
      'affinity': 'VM Affinity Rule',
      'anti_affinity': 'Anti-Affinity Rule',
      'critical': 'Critical Infrastructure'
    };
    return labels[reason] || reason;
  };

  // Get severity color for blockers
  const getBlockerSeverityColor = (severity?: string): string => {
    switch (severity) {
      case 'critical': return 'text-red-400';
      case 'warning': return 'text-yellow-400';
      case 'info': return 'text-blue-400';
      default: return 'text-orange-400';
    }
  };

  // Render maintenance blocker details
  const renderBlockerDetails = (entry: ConsoleEntry): JSX.Element | null => {
    const blockers = entry.details?.blocker_details;
    if (!blockers || blockers.length === 0) return null;

    return (
      <div className="mt-2 ml-6 p-2 bg-destructive/10 border border-destructive/20 rounded text-xs space-y-1">
        <div className="font-medium text-destructive">
          Maintenance Blockers ({blockers.length} VM{blockers.length > 1 ? 's' : ''}):
        </div>
        {blockers.slice(0, 5).map((blocker, idx) => (
          <div key={idx} className="flex flex-col gap-0.5 pl-2 border-l-2 border-destructive/30">
            <div className="flex items-center gap-2">
              <span className={cn("font-mono", getBlockerSeverityColor(blocker.severity))}>
                {blocker.vm_name}
              </span>
              <span className="text-muted-foreground">
                ({getBlockerReasonLabel(blocker.reason)})
              </span>
            </div>
            {blocker.remediation && (
              <div className="text-muted-foreground pl-2">
                → {blocker.remediation}
              </div>
            )}
          </div>
        ))}
        {blockers.length > 5 && (
          <div className="text-muted-foreground pl-2">
            ... and {blockers.length - 5} more
          </div>
        )}
      </div>
    );
  };

  const getStatusSymbol = (entry: ConsoleEntry): string => {
    // Check for friendly firmware message first
    const friendly = getFirmwareFriendlyMessage(entry.details?.error_message);
    if (friendly) {
      switch (friendly.severity) {
        case 'success': return '✓';
        case 'warning': return '⚠';
        case 'info': return 'ℹ';
        default: return '✗';
      }
    }
    
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
    // Check for friendly firmware message first
    const friendly = getFirmwareFriendlyMessage(entry.details?.error_message);
    if (friendly) {
      switch (friendly.severity) {
        case 'success': return 'text-green-400';
        case 'warning': return 'text-yellow-400';
        case 'info': return 'text-blue-400';
        default: return 'text-red-400';
      }
    }
    
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

  // Convert executor logs to console entries for unified display
  const executorAsConsoleEntries: ConsoleEntry[] = executorLogs.map((log) => ({
    id: log.id,
    timestamp: log.timestamp, // Time-only format
    type: 'task' as const,
    status: log.level === 'ERROR' ? 'failed' : log.level === 'WARN' ? 'pending' : 'completed',
    message: log.message,
    details: {}
  }));

  // Convert step_results to console entries
  const stepResultEntries: ConsoleEntry[] = stepResults.map((sr, idx) => ({
    id: `step-${idx}`,
    timestamp: sr.timestamp || new Date().toISOString(),
    type: 'task' as const,
    status: sr.status === 'success' ? 'completed' : sr.status === 'failed' ? 'failed' : sr.status === 'warning' ? 'pending' : 'running',
    message: `${sr.step.replace(/_/g, ' ')}: ${sr.message}`,
    details: {}
  }));

  const filteredEntries = (() => {
    switch (filter) {
      case 'tasks':
        return entries.filter(e => e.type === 'task');
      case 'activity':
        return entries.filter(e => e.type === 'activity');
      case 'errors':
        return [...entries, ...executorAsConsoleEntries].filter(
          e => e.status === 'failed' || e.details?.error_message
        );
      case 'executor':
        return []; // Handled separately with executor-specific rendering
      case 'all':
      default:
        // For "All" view, show executor logs and step results
        // Prefer executor logs if available (more detailed), otherwise show step results
        if (executorLogs.length > 0) {
          return executorAsConsoleEntries;
        }
        if (stepResults.length > 0) {
          return stepResultEntries;
        }
        // Fallback to task/activity entries
        return entries;
    }
  })();

  const getExecutorLogColor = (level: string): string => {
    switch (level.toUpperCase()) {
      case 'ERROR': return 'text-red-400';
      case 'WARN': return 'text-yellow-400';
      case 'INFO': return 'text-blue-400';
      case 'DEBUG': return 'text-muted-foreground/60';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            <CardTitle>Console Log</CardTitle>
            {lastUpdate && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <RefreshCw className="h-3 w-3" />
                {formatDistanceToNow(lastUpdate, { addSuffix: true })}
              </span>
            )}
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
                variant={filter === 'executor' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter('executor')}
                disabled={executorLogs.length === 0}
              >
                Executor {executorLogs.length > 0 && `(${executorLogs.length})`}
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
          ) : filter === 'executor' ? (
            // Show executor logs
            executorLogs.length === 0 ? (
              <div className="text-muted-foreground/60 italic">No executor logs available</div>
            ) : (
              <div className="space-y-0.5">
                {executorLogs.map((log, idx) => (
                  <div key={idx} className="leading-relaxed text-xs">
                    <span className="text-muted-foreground/60">[{isTimeOnly(log.timestamp) ? log.timestamp : formatTimestamp(log.timestamp)}]</span>
                    {' '}
                    <span className={cn(getExecutorLogColor(log.level), 'font-medium')}>
                      [{log.level}]
                    </span>
                    {' '}
                    <span className={getExecutorLogColor(log.level)}>
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            )
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
                    [{isTimeOnly(entry.timestamp) ? entry.timestamp : formatTimestamp(entry.timestamp)}]
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
                  {/* Render blocker details if present */}
                  {entry.details?.blocker_details && renderBlockerDetails(entry)}
                  
                  {/* Render error messages */}
                  {entry.details?.error_message && (() => {
                    const friendly = getFirmwareFriendlyMessage(entry.details.error_message);
                    if (friendly) {
                      return (
                        <div className={cn(
                          "mt-0.5 text-xs pl-6",
                          friendly.severity === 'success' && 'text-green-400',
                          friendly.severity === 'warning' && 'text-yellow-400',
                          friendly.severity === 'info' && 'text-blue-400',
                          friendly.severity === 'error' && 'text-red-400'
                        )}>
                          {friendly.severity === 'success' ? '✓' : friendly.severity === 'warning' ? '⚠' : 'ℹ'} {friendly.message}
                        </div>
                      );
                    }
                    return (
                      <div className="text-red-400 mt-0.5 text-xs pl-6">
                        Error: {entry.details.error_message}
                      </div>
                    );
                  })()}
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