import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Activity, ChevronDown, ChevronRight, Search, RefreshCw, Filter, Wifi, WifiOff, Loader2, Briefcase, PlayCircle, Clock, CheckCircle, Terminal } from "lucide-react";
import { toast } from "sonner";
import { CommandDetailDialog } from "@/components/activity/CommandDetailDialog";
import { format } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { JobDetailDialog } from "@/components/jobs/JobDetailDialog";
import { Skeleton } from "@/components/ui/skeleton";

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
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [selectedCommand, setSelectedCommand] = useState<IdracCommand | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'activity' | 'jobs'>('activity');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  
  // Filters
  const [serverFilter, setServerFilter] = useState<string>("all");
  const [commandTypeFilter, setCommandTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [operationTypeFilter, setOperationTypeFilter] = useState<string>("all");
  const [commandSource, setCommandSource] = useState<string>("all");
  const [timeRangeFilter, setTimeRangeFilter] = useState<string>("24h");
  const [searchTerm, setSearchTerm] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Connection state
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [lastEventAt, setLastEventAt] = useState<Date>(new Date());
  const [isRunningTest, setIsRunningTest] = useState(false);

  // Detect deployment mode
  const isLocalMode = import.meta.env.VITE_SUPABASE_URL?.includes('localhost') || 
                      import.meta.env.VITE_SUPABASE_URL?.includes('127.0.0.1');

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
  const { data: activeJobsData, refetch: refetchActiveJobs, isFetching: isFetchingActiveJobs } = useQuery({
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
      case '24h': return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case '7d': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'all': return new Date(0); // Beginning of time
      default: return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
  };

  // Fetch commands
  const { data: commandsData, refetch, isError, error, isFetching } = useQuery({
    queryKey: ['idrac-commands', serverFilter, commandTypeFilter, statusFilter, operationTypeFilter, commandSource, timeRangeFilter],
    queryFn: async () => {
      let query = supabase
        .from('idrac_commands')
        .select('*, servers(hostname, ip_address)')
        .order('timestamp', { ascending: false })
        .limit(500);

      // Only apply time filter if not "all"
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
      
      // Apply command source filter
      if (commandSource === 'manual') {
        query = query.is('job_id', null);
      } else if (commandSource === 'jobs') {
        query = query.not('job_id', 'is', null);
      }

      const { data, error } = await query;
      if (error) {
        console.error('Error fetching commands:', error);
        throw error;
      }
      return data as unknown as IdracCommand[];
    },
    staleTime: 0, // Data immediately stale, always refetch when needed
    refetchOnWindowFocus: false, // Don't auto-refetch on window focus
  });

  useEffect(() => {
    if (commandsData) {
      setCommands(commandsData);
      setLastRefresh(new Date());
    }
  }, [commandsData]);

  useEffect(() => {
    if (activeJobsData) {
      setJobs(activeJobsData);
    }
  }, [activeJobsData]);

  // Handle query errors
  useEffect(() => {
    if (isError) {
      toast.error('Failed to load activity logs', {
        description: error instanceof Error ? error.message : 'Please try refreshing the page'
      });
    }
  }, [isError, error]);

  // Set up realtime subscription with connection tracking
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
          setLastEventAt(new Date());
          // Fetch the full record with server info
          const { data } = await supabase
            .from('idrac_commands')
            .select('*, servers(hostname, ip_address)')
            .eq('id', payload.new.id)
            .single();

          if (data) {
            setCommands(prev => [data as IdracCommand, ...prev].slice(0, 500));
            
            if (!data.success) {
              toast.error(`iDRAC Command Failed: ${data.error_message}`);
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeStatus('disconnected');
          toast.error('Realtime connection lost, using polling fallback');
        }
      });
    return () => {
      setRealtimeStatus('disconnected');
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'activity' | 'jobs')}
        className="space-y-6"
      >
        <TabsList className="w-full max-w-md justify-start overflow-x-auto">
          <TabsTrigger value="activity">Activity Feed</TabsTrigger>
          <TabsTrigger value="jobs">Active Jobs</TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="h-8 w-8 text-primary" />
              <div>
                <h1 className="text-3xl font-bold">Activity Monitor</h1>
                <p className="text-muted-foreground">
                  Unified activity log for iDRAC and vCenter operations
                  {isLocalMode && <Badge variant="outline" className="ml-2">Local Mode</Badge>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {realtimeStatus === 'connected' && (
                  <>
                    <Wifi className="h-4 w-4 text-green-600" />
                    <span className="text-xs text-green-600 font-medium">Live</span>
                  </>
                )}
                {realtimeStatus === 'connecting' && (
                  <>
                    <Loader2 className="h-4 w-4 text-yellow-600 animate-spin" />
                    <span className="text-xs text-yellow-600 font-medium">Connecting</span>
                  </>
                )}
                {realtimeStatus === 'disconnected' && (
                  <>
                    <WifiOff className="h-4 w-4 text-red-600" />
                    <span className="text-xs text-red-600 font-medium">Polling</span>
                  </>
                )}
              </div>

              <span className="text-xs text-muted-foreground">
                Last updated: {format(lastRefresh, 'HH:mm:ss')}
              </span>

              <Button
                onClick={runLiveTest}
                variant="outline"
                size="sm"
                disabled={isRunningTest}
              >
                {isRunningTest ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Activity className="h-4 w-4 mr-2" />
                )}
                Run Live Test
              </Button>

              <Button
                onClick={handleManualRefresh}
                variant="outline"
                size="sm"
                disabled={isFetching || isFetchingActiveJobs}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${(isFetching || isFetchingActiveJobs) ? 'animate-spin' : ''}`} />
                {isFetching ? 'Refreshing...' : 'Refresh'}
              </Button>
            </div>
          </div>

          <Card className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold">Filters</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search endpoint, error..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

              <Select value={operationTypeFilter} onValueChange={setOperationTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Operation Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Operations</SelectItem>
                  <SelectItem value="idrac_api">iDRAC API</SelectItem>
                  <SelectItem value="vcenter_api">vCenter API</SelectItem>
                  <SelectItem value="openmanage_api">OpenManage API</SelectItem>
                </SelectContent>
              </Select>

              <Select value={serverFilter} onValueChange={setServerFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Servers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Servers</SelectItem>
                  {servers?.map(server => (
                    <SelectItem key={server.id} value={server.id}>
                      {server.hostname || server.ip_address}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={commandTypeFilter} onValueChange={setCommandTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Command Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                  <SelectItem value="BIOS_READ">BIOS Read</SelectItem>
                  <SelectItem value="BIOS_WRITE">BIOS Write</SelectItem>
                  <SelectItem value="POWER_CONTROL">Power Control</SelectItem>
                  <SelectItem value="VCENTER_AUTH">vCenter Auth</SelectItem>
                  <SelectItem value="VCENTER_SYNC">vCenter Sync</SelectItem>
                  <SelectItem value="AUTHENTICATE">OpenManage Auth</SelectItem>
                  <SelectItem value="network_validation">Network Tests</SelectItem>
                  <SelectItem value="SCP_EXPORT">SCP Export</SelectItem>
                  <SelectItem value="SCP_IMPORT">SCP Import</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>

              <Select value={commandSource} onValueChange={setCommandSource}>
                <SelectTrigger>
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="manual">Manual Operations</SelectItem>
                  <SelectItem value="jobs">Job Operations</SelectItem>
                </SelectContent>
              </Select>

              <Select value={timeRangeFilter} onValueChange={setTimeRangeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Time Range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1h">Last Hour</SelectItem>
                  <SelectItem value="24h">Last 24 Hours</SelectItem>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="all">All Time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Card>

          <Card>
            {filteredCommands.length === 0 ? (
              <div className="p-12 text-center space-y-4">
                <Activity className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-semibold mb-2">No Activity Logs Found</h3>
                <p className="text-muted-foreground mb-4">
                  Activity logs are created when iDRAC operations are performed.
                </p>

                {isLocalMode && (
                  <Alert className="max-w-md mx-auto mb-4">
                    <AlertDescription className="space-y-2">
                      <div>
                        <strong>Local Mode Detected:</strong> Activity logs come from the Job Executor in local deployments.
                      </div>
                      <div className="text-sm">
                        If no updates appear, ensure the Job Executor is running. Check status in{' '}
                        <a href="/settings" className="underline">Settings → Diagnostics</a>.
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                <div>
                  <Button onClick={runLiveTest} disabled={isRunningTest}>
                    {isRunningTest ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Running Test...
                      </>
                    ) : (
                      <>
                        <Activity className="h-4 w-4 mr-2" />
                        Run Live Test
                      </>
                    )}
                  </Button>

                  <Button variant="outline" onClick={handleManualRefresh} className="ml-2">
                    <RefreshCw className={`h-4 w-4 mr-2 ${(isFetching || isFetchingActiveJobs) ? 'animate-spin' : ''}`} />
                    Refresh Now
                  </Button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex items-center justify-between p-4 border-b bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    <span className="text-sm text-muted-foreground">Realtime updates when Job Executor is connected</span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Wifi className="h-3 w-3 text-green-500" /> Live
                    </span>
                    <ChevronRight className="h-3 w-3" />
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Last refresh {format(lastRefresh, 'HH:mm:ss')}
                    </span>
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[220px]">Timestamp</TableHead>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Server</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Response</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCommands.map((command) => {
                      const operationBadge = getOperationTypeBadge(command.operation_type);
                      const statusBadge = getStatusBadge(command.success, command.status_code);
                      const commandTypeBadge = getCommandTypeBadge(command.command_type);

                      return (
                        <>
                          <TableRow
                            key={command.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => setExpandedRow(expandedRow === command.id ? null : command.id)}
                          >
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className={operationBadge.color}>{operationBadge.label}</Badge>
                                <div className="flex flex-col">
                                  <span className="font-medium">{format(new Date(command.timestamp), 'HH:mm:ss')}</span>
                                  <span className="text-xs text-muted-foreground">{format(new Date(command.timestamp), 'MMM d, yyyy')}</span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              <div className="flex items-center gap-2">
                                <span className="truncate max-w-[240px]">{command.endpoint}</span>
                                {command.task_id && (
                                  <Badge variant="outline" className="text-xs">Task {command.task_id.slice(0, 4)}</Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground truncate max-w-[240px]">
                                {command.full_url}
                              </div>
                            </TableCell>
                            <TableCell>
                              {command.servers ? (
                                <div className="space-y-1">
                                  <div className="font-medium flex items-center gap-2">
                                    <ServerIcon className="h-4 w-4" />
                                    <span>{command.servers.hostname || command.servers.ip_address}</span>
                                  </div>
                                  <div className="text-xs text-muted-foreground">{command.servers.ip_address}</div>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">N/A</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {commandTypeBadge}
                            </TableCell>
                            <TableCell>
                              {statusBadge}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-sm font-medium">{command.response_time_ms}ms</span>
                                <ChevronRight className={`h-4 w-4 transition-transform ${expandedRow === command.id ? 'rotate-90' : ''}`} />
                              </div>
                              {command.error_message && (
                                <div className="text-xs text-destructive mt-1">{command.error_message}</div>
                              )}
                            </TableCell>
                          </TableRow>

                          {expandedRow === command.id && (
                            <TableRow className="bg-muted/30">
                              <TableCell colSpan={6}>
                                <div className="space-y-4 p-4">
                                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                                    <Badge variant="outline">Source: {command.source}</Badge>
                                    {command.job_id && (
                                      <Badge variant="outline">Job: {command.job_id}</Badge>
                                    )}
                                    {command.task_id && (
                                      <Badge variant="outline">Task: {command.task_id}</Badge>
                                    )}
                                    <Badge variant="outline">Response Time: {command.response_time_ms}ms</Badge>
                                    <Badge variant="outline">Status Code: {command.status_code || 'N/A'}</Badge>
                                  </div>

                                  <div className="grid md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                      <h4 className="font-semibold text-sm">Request Details</h4>
                                      <pre className="bg-card border rounded-lg p-3 text-xs overflow-x-auto">
                                        {JSON.stringify(command.request_body, null, 2)}
                                      </pre>
                                    </div>
                                    <div className="space-y-2">
                                      <h4 className="font-semibold text-sm">Response Body</h4>
                                      <pre className="bg-card border rounded-lg p-3 text-xs overflow-x-auto">
                                        {JSON.stringify(command.response_body, null, 2)}
                                      </pre>
                                    </div>
                                  </div>

                                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-foreground">
                                    <span>Headers: {Object.keys(command.request_headers || {}).length} entries</span>
                                    <div className="flex items-center gap-2">
                                      <span>Initiated by: {command.initiated_by || 'System'}</span>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="gap-2"
                                        onClick={() => {
                                          setSelectedCommand(command);
                                          setDetailDialogOpen(true);
                                        }}
                                      >
                                        <Terminal className="h-4 w-4" />
                                        View Details
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="jobs" className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Briefcase className="h-8 w-8 text-primary" />
              <div>
                <h2 className="text-3xl font-bold">Active Jobs</h2>
                <p className="text-muted-foreground">
                  Monitor pending and running jobs without leaving the activity console.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{runningJobs} running</Badge>
              <Badge variant="outline" className="text-xs">{pendingJobs} pending</Badge>
              <Button variant="outline" size="sm" onClick={() => refetchActiveJobs()} disabled={isFetchingActiveJobs}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isFetchingActiveJobs ? 'animate-spin' : ''}`} />
                Refresh Jobs
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardDescription>Running</CardDescription>
                <CardTitle className="text-3xl flex items-center gap-2">
                  <PlayCircle className="h-5 w-5 text-primary" />
                  {runningJobs}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Pending</CardDescription>
                <CardTitle className="text-3xl flex items-center gap-2">
                  <Clock className="h-5 w-5 text-amber-600" />
                  {pendingJobs}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Tracked</CardDescription>
                <CardTitle className="text-3xl flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  {jobs.length}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <div className="grid gap-4">
            {isFetchingActiveJobs ? (
              Array.from({ length: 3 }).map((_, idx) => (
                <Card key={idx}>
                  <CardContent className="p-6 space-y-3">
                    <Skeleton className="h-5 w-1/4" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-full" />
                  </CardContent>
                </Card>
              ))
            ) : jobs.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center space-y-3">
                  <Briefcase className="h-10 w-10 text-muted-foreground mx-auto" />
                  <h3 className="text-lg font-semibold">No active jobs</h3>
                  <p className="text-muted-foreground text-sm">
                    Jobs will appear here while running or pending. Create or schedule them from the Maintenance Planner.
                  </p>
                  <Button variant="outline" asChild>
                    <a href="/maintenance-planner?tab=jobs">Open Maintenance Planner</a>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              jobs.map((job) => (
                <Card key={job.id} className="border-primary/20">
                  <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        {job.status === 'running' ? (
                          <PlayCircle className="h-5 w-5 text-primary" />
                        ) : (
                          <Clock className="h-5 w-5 text-amber-600" />
                        )}
                      </div>
                      <div>
                        <CardTitle className="text-lg">{getJobTypeLabel(job.job_type)}</CardTitle>
                        <CardDescription>{formatJobTiming(job)}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getJobStatusBadge(job.status)}
                      <Badge variant="outline" className="text-xs">{job.id.slice(0, 8)}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <ServerIcon className="h-4 w-4" />
                        {job.target_scope?.cluster_name || `${job.target_scope?.server_ids?.length || 0} servers`}
                      </span>
                      <span className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        {job.started_at ? 'In progress' : 'Queued'}
                      </span>
                    </div>

                    {job.details?.error && job.status === 'failed' && (
                      <div className="text-sm text-destructive bg-destructive/5 border border-destructive/20 p-3 rounded-lg">
                        {job.details.error}
                      </div>
                    )}

                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedJob(job);
                          setJobDialogOpen(true);
                        }}
                      >
                        View details
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      {selectedCommand && (
        <CommandDetailDialog
          command={selectedCommand}
          open={detailDialogOpen}
          onOpenChange={setDetailDialogOpen}
        />
      )}

      {selectedJob && (
        <JobDetailDialog
          job={selectedJob}
          open={jobDialogOpen}
          onOpenChange={setJobDialogOpen}
        />
      )}
    </div>
  );
}
