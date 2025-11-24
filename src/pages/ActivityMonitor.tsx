import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ActivityStatsBar } from "@/components/activity/ActivityStatsBar";
import { FilterToolbar } from "@/components/activity/FilterToolbar";
import { CommandsTable } from "@/components/activity/CommandsTable";
import { CommandDetailsSidebar } from "@/components/activity/CommandDetailsSidebar";
import { ActiveJobsBanner } from "@/components/activity/ActiveJobsBanner";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";

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
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isDetailsSheetOpen, setIsDetailsSheetOpen] = useState(false);
  
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

  // Fetch active jobs for live view
  const { data: activeJobsData, refetch: refetchActiveJobs } = useQuery({
    queryKey: ['active-jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Job[];
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

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
    if (activeJobsData) {
      setJobs(activeJobsData);
    }
  }, [activeJobsData]);

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
    }
  };

  const handleCloseDetails = () => {
    setSelectedCommand(null);
    setIsDetailsSheetOpen(false);
  };

  const calculateSuccessRate = () => {
    if (commands.length === 0) return 0;
    const successCount = commands.filter(c => c.success).length;
    return (successCount / commands.length) * 100;
  };

  const handleExport = () => {
    const csv = [
      ['Timestamp', 'Operation', 'Endpoint', 'Type', 'Status', 'Server', 'Response Time (ms)'].join(','),
      ...filteredCommands.map(cmd => [
        cmd.timestamp,
        cmd.operation_type,
        cmd.endpoint,
        cmd.command_type,
        cmd.success ? 'Success' : 'Failed',
        cmd.servers?.hostname || cmd.servers?.ip_address || 'N/A',
        cmd.response_time_ms?.toString() || 'N/A'
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-log-${new Date().toISOString()}.csv`;
    a.click();
    toast.success('Activity log exported');
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
    <div className="flex h-full w-full justify-center overflow-hidden">
      <div className="flex h-full w-full max-w-screen-2xl flex-col overflow-hidden">
        {/* Top: Compact Stats Bar */}
        <div className="px-4 pt-4 lg:px-6">
          <ActivityStatsBar
            totalCommands={commands.length}
            successRate={calculateSuccessRate()}
            activeJobs={jobs.length}
            failedCount={commands.filter(c => !c.success).length}
            liveStatus={realtimeStatus}
            onRefresh={handleManualRefresh}
            onExport={handleExport}
          />
        </div>
      
        {/* Active Jobs Banner (conditional) */}
        {jobs.length > 0 && (
          <div className="px-4 pt-4 lg:px-6">
            <ActiveJobsBanner jobs={jobs} />
          </div>
        )}

        {/* Main: Two Column Layout */}
        <div className="flex-1 overflow-hidden px-4 pb-6 pt-4 lg:px-6">
          <div className="grid h-full min-h-[70vh] gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(380px,1fr)] xl:items-start">
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
                <div className="border-b bg-muted/40 px-4 py-3">
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

                <div className="flex-1 overflow-hidden p-2 sm:p-3">
                  <CommandsTable
                    commands={filteredCommands}
                    selectedId={selectedCommand?.id}
                    onRowClick={handleRowClick}
                    isLive={realtimeStatus === 'connected'}
                  />
                </div>
              </div>
            </div>

            <div className="min-h-[320px] overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="hidden xl:block">
                <div className="sticky top-[96px]">
                  <CommandDetailsSidebar
                    command={selectedCommand}
                    onClose={handleCloseDetails}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <Sheet open={isDetailsSheetOpen && !isDesktop} onOpenChange={setIsDetailsSheetOpen}>
          <SheetContent side="bottom" className="h-[85vh] overflow-hidden p-0">
            <CommandDetailsSidebar
              command={selectedCommand}
              onClose={handleCloseDetails}
            />
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
