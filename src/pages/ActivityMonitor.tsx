import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ActivityStatsBar } from "@/components/activity/ActivityStatsBar";
import { JobsFilterToolbar } from "@/components/activity/JobsFilterToolbar";
import { CommandsFilterToolbar } from "@/components/activity/CommandsFilterToolbar";
import { CommandsTable } from "@/components/activity/CommandsTable";
import { CommandDetailsSidebar } from "@/components/activity/CommandDetailsSidebar";
import { CommandDetailDialog } from "@/components/activity/CommandDetailDialog";
import { JobsTable } from "@/components/activity/JobsTable";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Columns3, Download } from "lucide-react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useActiveJobs } from "@/hooks/useActiveJobs";
import { useJobsWithProgress } from "@/hooks/useJobsWithProgress";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { exportToCSV, ExportColumn } from "@/lib/csv-export";

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
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedCommand, setSelectedCommand] = useState<IdracCommand | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [isDetailsSheetOpen, setIsDetailsSheetOpen] = useState(false);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("operations");
  
  // Jobs filters
  const [jobsSearch, setJobsSearch] = useState("");
  const [jobsStatusFilter, setJobsStatusFilter] = useState("all");
  const [jobsTypeFilter, setJobsTypeFilter] = useState("all");
  const [jobsTimeRange, setJobsTimeRange] = useState("24h");
  
  // Commands filters
  const [serverFilter, setServerFilter] = useState<string>("all");
  const [commandTypeFilter, setCommandTypeFilter] = useState<string>("all");
  const [commandStatusFilter, setCommandStatusFilter] = useState<string>("all");
  const [operationTypeFilter, setOperationTypeFilter] = useState<string>("all");
  const [commandSource, setCommandSource] = useState<string>("all");
  const [commandTimeRange, setCommandTimeRange] = useState<string>("24h");
  const [commandSearchTerm, setCommandSearchTerm] = useState("");

  // Connection state
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  const isDesktop = useMediaQuery('(min-width: 1280px)');

  // Column visibility for jobs
  const { visibleColumns: jobsColumns, isColumnVisible: isJobColVisible, toggleColumn: toggleJobColumn } = useColumnVisibility(
    "jobs-table-columns",
    ["job_type", "status", "duration", "target", "started", "progress"]
  );

  // Column visibility for commands
  const { visibleColumns: commandsColumns, isColumnVisible: isCommandColVisible, toggleColumn: toggleCommandColumn } = useColumnVisibility(
    "commands-table-columns",
    ["time", "operation", "endpoint", "type", "status", "response"]
  );

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

  // Fetch jobs with progress
  const { data: jobsWithProgress } = useJobsWithProgress();

  useEffect(() => {
    if (jobsWithProgress) {
      setJobs(jobsWithProgress as Job[]);
    }
  }, [jobsWithProgress]);

  // Calculate time range
  const getTimeRangeDate = (filter: string) => {
    const now = new Date();
    switch (filter) {
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
    queryKey: ['idrac-commands', serverFilter, commandTypeFilter, commandStatusFilter, operationTypeFilter, commandSource, commandTimeRange],
    queryFn: async () => {
      let query = supabase
        .from('idrac_commands')
        .select('*, servers(hostname, ip_address)')
        .order('timestamp', { ascending: false })
        .limit(500);

      if (commandTimeRange !== 'all') {
        query = query.gte('timestamp', getTimeRangeDate(commandTimeRange).toISOString());
      }

      if (serverFilter !== 'all') {
        query = query.eq('server_id', serverFilter);
      }
      if (commandTypeFilter !== 'all') {
        query = query.eq('command_type', commandTypeFilter);
      }
      if (commandStatusFilter !== 'all') {
        query = query.eq('success', commandStatusFilter === 'success');
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
      } else if (commandSource === 'instant_api') {
        query = query.eq('source', 'instant_api');
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
    }
    // On desktop, sidebar shows inline automatically
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

  const handleJobClick = (job: Job) => {
    setExpandedJobId(expandedJobId === job.id ? null : job.id);
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSelectedCommand(null);
    setExpandedJobId(null);
  };

  const handleExportJobsCSV = () => {
    const columns: ExportColumn<Job>[] = [
      { key: "job_type", label: "Job Type" },
      { key: "status", label: "Status" },
      { key: "created_at", label: "Created" },
      { key: "started_at", label: "Started" },
      { key: "completed_at", label: "Completed" },
    ];
    exportToCSV(filteredJobs, columns, "jobs");
    toast.success(`Exported ${filteredJobs.length} jobs`);
  };

  const handleExportCommandsCSV = () => {
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
    if (!commandSearchTerm) return true;
    const search = commandSearchTerm.toLowerCase();
    return (
      cmd.endpoint.toLowerCase().includes(search) ||
      cmd.full_url.toLowerCase().includes(search) ||
      cmd.error_message?.toLowerCase().includes(search) ||
      cmd.servers?.hostname?.toLowerCase().includes(search) ||
      cmd.servers?.ip_address?.toLowerCase().includes(search)
    );
  });

  // Filter jobs based on search and filters
  const filteredJobs = jobs.filter(job => {
    if (jobsStatusFilter !== "all" && job.status !== jobsStatusFilter) return false;
    if (jobsTypeFilter !== "all" && job.job_type !== jobsTypeFilter) return false;
    if (jobsSearch) {
      const search = jobsSearch.toLowerCase();
      if (!job.job_type.toLowerCase().includes(search)) return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ActivityStatsBar
        totalCommands={commands.length}
        successRate={calculateSuccessRate()}
        activeJobs={activeJobs.length}
        failedCount={commands.filter(c => !c.success).length}
        liveStatus={realtimeStatus}
        onRefresh={handleManualRefresh}
        onExportCSV={handleExportCommandsCSV}
        onExportJSON={handleExportJSON}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Scrollable tabs/table area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="h-full flex flex-col">
            {/* Tab bar with Columns/Export buttons */}
            <div className="flex items-center border-b bg-card px-4">
              <TabsList className="h-auto p-0 bg-transparent gap-2">
                <TabsTrigger 
                  value="operations"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
                >
                  All Jobs
                </TabsTrigger>
                <TabsTrigger 
                  value="api-log"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
                >
                  API Calls
                </TabsTrigger>
              </TabsList>
            
            {activeJobs.length > 0 && activeTab === "operations" && (
              <>
                <div className="w-px h-6 bg-border mx-2" />
                <div className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-blue-500/10 text-blue-600 text-xs">
                  <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                  {activeJobs.length} running
                </div>
              </>
            )}

            <div className="flex-1" />

            <div
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                realtimeStatus === 'connected'
                  ? 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/30'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
              {realtimeStatus === 'connected' ? 'Live' : 'Paused'}
            </div>

            {/* Columns dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 ml-2">
                  <Columns3 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end">
                <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {activeTab === "operations" ? (
                  <>
                    <DropdownMenuCheckboxItem checked={isJobColVisible("job_type")} onCheckedChange={() => toggleJobColumn("job_type")}>
                      Job Type
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={isJobColVisible("status")} onCheckedChange={() => toggleJobColumn("status")}>
                      Status
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={isJobColVisible("duration")} onCheckedChange={() => toggleJobColumn("duration")}>
                      Duration
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={isJobColVisible("target")} onCheckedChange={() => toggleJobColumn("target")}>
                      Target
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={isJobColVisible("started")} onCheckedChange={() => toggleJobColumn("started")}>
                      Started
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={isJobColVisible("progress")} onCheckedChange={() => toggleJobColumn("progress")}>
                      Progress
                    </DropdownMenuCheckboxItem>
                  </>
                ) : (
                  <>
                    <DropdownMenuCheckboxItem checked={isCommandColVisible("time")} onCheckedChange={() => toggleCommandColumn("time")}>
                      Time
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={isCommandColVisible("operation")} onCheckedChange={() => toggleCommandColumn("operation")}>
                      Operation
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={isCommandColVisible("endpoint")} onCheckedChange={() => toggleCommandColumn("endpoint")}>
                      Endpoint
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={isCommandColVisible("type")} onCheckedChange={() => toggleCommandColumn("type")}>
                      Type
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={isCommandColVisible("status")} onCheckedChange={() => toggleCommandColumn("status")}>
                      Status
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={isCommandColVisible("response")} onCheckedChange={() => toggleCommandColumn("response")}>
                      Response
                    </DropdownMenuCheckboxItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Export button */}
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 ml-1" 
              onClick={activeTab === "operations" ? handleExportJobsCSV : handleExportCommandsCSV}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>

          {/* Filter toolbar - contextual per tab */}
          {activeTab === "operations" && (
            <JobsFilterToolbar
              searchTerm={jobsSearch}
              onSearchChange={setJobsSearch}
              statusFilter={jobsStatusFilter}
              onStatusFilterChange={setJobsStatusFilter}
              jobTypeFilter={jobsTypeFilter}
              onJobTypeFilterChange={setJobsTypeFilter}
              timeRangeFilter={jobsTimeRange}
              onTimeRangeFilterChange={setJobsTimeRange}
            />
          )}
          {activeTab === "api-log" && (
            <CommandsFilterToolbar
              searchTerm={commandSearchTerm}
              onSearchChange={setCommandSearchTerm}
              operationTypeFilter={operationTypeFilter}
              onOperationTypeFilterChange={setOperationTypeFilter}
              serverFilter={serverFilter}
              onServerFilterChange={setServerFilter}
              commandTypeFilter={commandTypeFilter}
              onCommandTypeFilterChange={setCommandTypeFilter}
              statusFilter={commandStatusFilter}
              onStatusFilterChange={setCommandStatusFilter}
              sourceFilter={commandSource}
              onSourceFilterChange={setCommandSource}
              timeRangeFilter={commandTimeRange}
              onTimeRangeFilterChange={setCommandTimeRange}
              servers={servers || []}
            />
          )}

          {/* Tab content */}
          <TabsContent value="operations" className="flex-1 mt-0 overflow-hidden">
            <JobsTable
              jobs={filteredJobs}
              onJobClick={handleJobClick}
              expandedJobId={expandedJobId}
              visibleColumns={jobsColumns}
              onToggleColumn={toggleJobColumn}
              onExport={handleExportJobsCSV}
            />
          </TabsContent>

          <TabsContent value="api-log" className="flex-1 mt-0 overflow-hidden">
            <CommandsTable
              commands={filteredCommands}
              selectedId={selectedCommand?.id}
              onRowClick={handleRowClick}
              isLive={realtimeStatus === 'connected'}
              visibleColumns={commandsColumns}
              onToggleColumn={toggleCommandColumn}
            />
          </TabsContent>
          </Tabs>
        </div>

        {/* Inline sidebar - shows when command selected on desktop */}
        {selectedCommand && isDesktop && (
          <CommandDetailsSidebar
            command={selectedCommand}
            onClose={handleCloseDetails}
            onExpand={() => setIsDetailsDialogOpen(true)}
          />
        )}
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
