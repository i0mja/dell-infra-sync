import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ActivityStatsBar } from "@/components/activity/ActivityStatsBar";
import { FilterToolbar } from "@/components/activity/FilterToolbar";
import { CommandsTable } from "@/components/activity/CommandsTable";
import { CommandDetailsSidebar } from "@/components/activity/CommandDetailsSidebar";
import { CommandDetailDialog } from "@/components/activity/CommandDetailDialog";
import { ActiveJobsBanner } from "@/components/activity/ActiveJobsBanner";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useActiveJobs } from "@/hooks/useActiveJobs";

interface IdracCommand {
  id: string;
  timestamp: string;
  server_id: string | null;
  job_id: string | null;
  task_id: string | null;
  command_type: string;
  endpoint: string;
  full_url: string;
  request_headers: any;
  request_body: any;
  status_code: number | null;
  response_time_ms: number;
  response_body: any;
  success: boolean;
  error_message: string | null;
  initiated_by: string | null;
  source: string;
  operation_type: 'idrac_api' | 'vcenter_api' | 'openmanage_api';
  servers?: { hostname: string | null; ip_address: string };
}

interface Job {
  id: string;
  job_type: string;
  status: string;
  target_scope: any;
  details: any;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export default function ActivityMonitor() {
  const [commands, setCommands] = useState<IdracCommand[]>([]);
  const [selectedCommand, setSelectedCommand] = useState<IdracCommand | null>(null);
  const [isDetailsSheetOpen, setIsDetailsSheetOpen] = useState(false);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  
  // Filters
  const [serverFilter, setServerFilter] = useState<string>("all");
  const [commandTypeFilter, setCommandTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [operationTypeFilter, setOperationTypeFilter] = useState<string>("all");
  const [commandSource, setCommandSource] = useState<string>("all");
  const [timeRangeFilter, setTimeRangeFilter] = useState<string>("24h");
  const [searchTerm, setSearchTerm] = useState("");

  // Connection state
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  const isDesktop = useMediaQuery('(min-width: 1280px)');

  // Fetch servers for filter dropdown
  const { data: servers } = useQuery({
    queryKey: ['servers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('servers')
        .select('id, hostname, ip_address')
        .order('hostname');
      if (error) throw error;
      return data;
    },
  });

  // Fetch active jobs for live view with real-time updates
  const { activeJobs, refetch: refetchActiveJobs } = useActiveJobs();

  // Calculate time range
  const getTimeRangeDate = () => {
    const now = new Date();
    switch (timeRangeFilter) {
      case '1h': return new Date(now.getTime() - 60 * 60 * 1000);
      case '6h': return new Date(now.getTime() - 6 * 60 * 60 * 1000);
      case '24h': return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case '7d': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case 'all': return new Date(0);
      default: return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
  };

  // Fetch commands
  const { data: commandsData, refetch, isError, error } = useQuery({
    queryKey: ['idrac-commands', serverFilter, commandTypeFilter, statusFilter, operationTypeFilter, commandSource, timeRangeFilter],
    queryFn: async () => {
      let query = supabase
        .from('idrac_commands')
        .select('*, servers(hostname, ip_address)')
        .order('timestamp', { ascending: false })
        .limit(500);

      if (timeRangeFilter !== 'all') {
        query = query.gte('timestamp', getTimeRangeDate().toISOString());
      }

      if (serverFilter !== 'all') {
        query = query.eq('server_id', serverFilter);
      }
      if (commandTypeFilter !== 'all') {
        query = query.eq('command_type', commandTypeFilter);
      }
      if (statusFilter !== 'all') {
        query = query.eq('success', statusFilter === 'success');
      }
      if (operationTypeFilter !== 'all') {
        query = query.eq('operation_type', operationTypeFilter as 'idrac_api' | 'vcenter_api' | 'openmanage_api');
      }
      
      if (commandSource === 'manual') {
        query = query.is('job_id', null).eq('source', 'manual');
      } else if (commandSource === 'job_executor') {
        query = query.eq('source', 'job_executor');
      } else if (commandSource === 'edge_function') {
        query = query.eq('source', 'edge_function');
      }

      const { data, error } = await query;
      if (error) {
        console.error('Error fetching commands:', error);
        throw error;
      }
      return data as unknown as IdracCommand[];
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (commandsData) {
      setCommands(commandsData);
    }
  }, [commandsData]);

  useEffect(() => {
    if (isError) {
      toast.error('Failed to load activity logs', {
        description: error instanceof Error ? error.message : 'Please try refreshing the page'
      });
    }
  }, [isError, error]);

  // Set up realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('idrac-commands-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'idrac_commands'
        },
        async (payload) => {
          const { data } = await supabase
            .from('idrac_commands')
            .select('*, servers(hostname, ip_address)')
            .eq('id', payload.new.id)
            .single();

          if (data) {
            setCommands(prev => [data as IdracCommand, ...prev].slice(0, 500));
            
            if (!data.success) {
              toast.error(`Command Failed: ${data.error_message}`);
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeStatus('disconnected');
        }
      });

    return () => {
      channel.unsubscribe();
    };
  }, []);

  // Helper functions
  const handleManualRefresh = () => {
    refetch();
    refetchActiveJobs();
  };

  const handleRowClick = (cmd: IdracCommand) => {
    setSelectedCommand(cmd);
    if (!isDesktop) {
      setIsDetailsSheetOpen(true);
    } else {
      setIsDetailsDialogOpen(true);
    }
  };

  const handleCloseDetails = () => {
    setSelectedCommand(null);
    setIsDetailsSheetOpen(false);
    setIsDetailsDialogOpen(false);
  };

  const calculateSuccessRate = () => {
    if (commands.length === 0) return 0;
    const successCount = commands.filter(c => c.success).length;
    return (successCount / commands.length) * 100;
  };

  const handleExportCSV = () => {
    const stringifyField = (value: unknown) => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(
          value,
          (_key, val) => (typeof val === 'bigint' ? val.toString() : val),
          2
        );
      } catch {
        return String(value);
      }
    };

    const escapeCsv = (value: unknown) => {
      const formatted = stringifyField(value).replace(/"/g, '""').replace(/\r?\n/g, '\\n');
      return `"${formatted}"`;
    };

    const csv = [
      [
        'Timestamp',
        'Operation',
        'Endpoint',
        'Full URL',
        'Type',
        'Status',
        'Status Code',
        'Server',
        'Response Time (ms)',
        'Request Headers',
        'Request Body',
        'Response Body',
        'Error Message'
      ].join(','),
      ...filteredCommands.map(cmd => [
        escapeCsv(cmd.timestamp),
        escapeCsv(cmd.operation_type),
        escapeCsv(cmd.endpoint),
        escapeCsv(cmd.full_url),
        escapeCsv(cmd.command_type),
        escapeCsv(cmd.success ? 'Success' : 'Failed'),
        escapeCsv(cmd.status_code ?? ''),
        escapeCsv(cmd.servers?.hostname || cmd.servers?.ip_address || 'N/A'),
        escapeCsv(cmd.response_time_ms ?? ''),
        escapeCsv(cmd.request_headers),
        escapeCsv(cmd.request_body),
        escapeCsv(cmd.response_body),
        escapeCsv(cmd.error_message ?? '')
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-log-${new Date().toISOString()}.csv`;
    a.click();
    toast.success('Activity log exported as CSV');
  };

  const handleExportJSON = () => {
    const exportData = filteredCommands.map(cmd => ({
      id: cmd.id,
      timestamp: cmd.timestamp,
      operation_type: cmd.operation_type,
      command_type: cmd.command_type,
      endpoint: cmd.endpoint,
      full_url: cmd.full_url,
      status_code: cmd.status_code,
      success: cmd.success,
      response_time_ms: cmd.response_time_ms,
      server: cmd.servers?.hostname || cmd.servers?.ip_address || null,
      server_id: cmd.server_id,
      job_id: cmd.job_id,
      task_id: cmd.task_id,
      source: cmd.source,
      initiated_by: cmd.initiated_by,
      request_headers: cmd.request_headers,
      request_body: cmd.request_body,
      response_body: cmd.response_body,
      error_message: cmd.error_message
    }));

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
      type: 'application/json' 
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-log-${new Date().toISOString()}.json`;
    a.click();
    toast.success('Activity log exported as JSON');
  };

  // Filter commands based on search
  const filteredCommands = commands.filter(cmd => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      cmd.endpoint.toLowerCase().includes(search) ||
      cmd.full_url.toLowerCase().includes(search) ||
      cmd.error_message?.toLowerCase().includes(search) ||
      cmd.servers?.hostname?.toLowerCase().includes(search) ||
      cmd.servers?.ip_address?.toLowerCase().includes(search)
    );
  });

  return (
    <div className="flex flex-col gap-4 pb-10">
      <ActivityStatsBar
        totalCommands={commands.length}
        successRate={calculateSuccessRate()}
        activeJobs={activeJobs.length}
        failedCount={commands.filter(c => !c.success).length}
        liveStatus={realtimeStatus}
        onRefresh={handleManualRefresh}
        onExportCSV={handleExportCSV}
        onExportJSON={handleExportJSON}
      />

      <div className="space-y-4 px-4 pt-4 sm:px-6 lg:px-8">
        {activeJobs.length > 0 && (
          <div className="rounded-xl border bg-muted/30 px-4 py-3 shadow-sm sm:px-6">
            <ActiveJobsBanner jobs={activeJobs} />
          </div>
        )}

        <div className="rounded-xl border bg-card shadow-sm">
          <div className="flex flex-col gap-2 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Filter and search activity</h2>
              <p className="text-sm text-muted-foreground">
                Narrow the feed by source, timeframe, and status to focus on the events that matter.
              </p>
            </div>
            <div
              className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-1 text-xs font-medium ${
                realtimeStatus === 'connected'
                  ? 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/30'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
              {realtimeStatus === 'connected' ? 'Live updates' : 'Realtime paused'}
            </div>
          </div>
          <div className="px-4 pb-5 pt-3 sm:px-6">
            <FilterToolbar
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              operationType={operationTypeFilter}
              onOperationTypeChange={setOperationTypeFilter}
              selectedServer={serverFilter}
              onServerChange={setServerFilter}
              commandType={commandTypeFilter}
              onCommandTypeChange={setCommandTypeFilter}
              status={statusFilter}
              onStatusChange={setStatusFilter}
              source={commandSource}
              onSourceChange={setCommandSource}
              timeRange={timeRangeFilter}
              onTimeRangeChange={setTimeRangeFilter}
              servers={servers || []}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 sm:px-6">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">Recent activity</h3>
                <p className="text-sm text-muted-foreground">
                  Newest commands appear first. Click any row to inspect the request and response.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-muted px-3 py-1 font-medium text-foreground">
                  {filteredCommands.length} shown
                </span>
                <span
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1 font-medium ${
                    realtimeStatus === 'connected'
                      ? 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/30'
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-current" />
                  {realtimeStatus === 'connected' ? 'Live' : 'Paused'}
                </span>
              </div>
            </div>
            <div className="px-2 pb-2 pt-1 sm:px-3">
              <CommandsTable
                commands={filteredCommands}
                selectedId={selectedCommand?.id}
                onRowClick={handleRowClick}
                isLive={realtimeStatus === 'connected'}
                className="border-0 bg-transparent shadow-none"
              />
            </div>
          </div>
        </div>
      </div>

      <Sheet
        open={isDetailsSheetOpen && !isDesktop}
        onOpenChange={(open) => {
          setIsDetailsSheetOpen(open);
          if (!open) {
            setSelectedCommand(null);
          }
        }}
      >
        <SheetContent side="bottom" className="h-[85vh] overflow-hidden p-0">
          <CommandDetailsSidebar
            command={selectedCommand}
            onClose={handleCloseDetails}
            className="h-full"
          />
        </SheetContent>
      </Sheet>

      <CommandDetailDialog
        command={selectedCommand}
        open={isDetailsDialogOpen}
        onOpenChange={(open) => {
          setIsDetailsDialogOpen(open);
          if (!open) {
            setSelectedCommand(null);
          }
        }}
      />
    </div>
  );
}
