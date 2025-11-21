import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu";
import { useAuth } from "@/hooks/useAuth";
import {
  CheckCircle,
  Clock,
  FileText,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  XCircle,
  Filter,
  BarChart3,
  AlertCircle,
  Calendar,
  Zap,
  Trash2,
  Activity,
  Loader2
} from "lucide-react";
import { format, formatDistanceToNow, differenceInHours, isFuture } from "date-fns";

interface Job {
  id: string;
  job_type: string;
  status: string;
  target_scope: any;
  details: any;
  created_by: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  schedule_at: string | null;
  parent_job_id: string | null;
}

interface MaintenanceWindow {
  id: string;
  title: string;
  description: string | null;
  planned_start: string;
  planned_end: string;
  status: string;
  maintenance_type: string;
  cluster_ids: string[] | null;
  server_group_ids: string[] | null;
  server_ids: string[] | null;
  auto_execute: boolean;
  notify_before_hours: number | null;
  details: any;
  created_by: string | null;
  job_ids: string[] | null;
}

interface TimelineItem {
  type: 'job' | 'maintenance_window';
  id: string;
  title: string;
  status: 'planned' | 'active' | 'completed' | 'failed';
  timestamp: Date;
  data: Job | MaintenanceWindow;
}

interface OperationsTimelineProps {
  onJobClick?: (job: Job) => void;
  onWindowDelete?: (windowId: string) => void;
  onCreateOperation?: (type: 'job' | 'maintenance') => void;
}

export function OperationsTimeline({ 
  onJobClick, 
  onWindowDelete,
  onCreateOperation 
}: OperationsTimelineProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [windows, setWindows] = useState<MaintenanceWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'all' | 'active' | 'planned' | 'completed' | 'failed'>('all');
  const [selectedType, setSelectedType] = useState('all');
  const [staleThresholds, setStaleThresholds] = useState({ pending: 24, running: 48 });
  const [subJobCounts, setSubJobCounts] = useState<Record<string, number>>({});
  const { toast } = useToast();
  const { userRole } = useAuth();

  const canManage = userRole === 'admin' || userRole === 'operator';

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch jobs
      const { data: jobsData, error: jobsError } = await supabase
        .from("jobs")
        .select("*")
        .is("parent_job_id", null)
        .order("created_at", { ascending: false });

      if (jobsError) throw jobsError;
      setJobs(jobsData || []);

      // Fetch sub-job counts
      const fullUpdateJobs = (jobsData || []).filter(j => j.job_type === 'full_server_update');
      if (fullUpdateJobs.length > 0) {
        const counts: Record<string, number> = {};
        for (const job of fullUpdateJobs) {
          const { count } = await supabase
            .from("jobs")
            .select("*", { count: 'exact', head: true })
            .eq("parent_job_id", job.id);
          counts[job.id] = count || 0;
        }
        setSubJobCounts(counts);
      }

      // Fetch maintenance windows
      const { data: windowsData, error: windowsError } = await supabase
        .from('maintenance_windows')
        .select('*')
        .order('planned_start', { ascending: false });
      
      if (windowsError) throw windowsError;
      setWindows(windowsData || []);

    } catch (error: any) {
      toast({
        title: "Error loading data",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchStaleThresholds = async () => {
    try {
      const { data } = await supabase
        .from('activity_settings')
        .select('stale_pending_hours, stale_running_hours')
        .limit(1)
        .maybeSingle();

      if (data) {
        setStaleThresholds({
          pending: data.stale_pending_hours || 24,
          running: data.stale_running_hours || 48
        });
      }
    } catch (error) {
      console.error('Error fetching stale thresholds:', error);
    }
  };

  useEffect(() => {
    fetchData();
    fetchStaleThresholds();

    const jobsChannel = supabase
      .channel('jobs-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, fetchData)
      .subscribe();

    const windowsChannel = supabase
      .channel('windows-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_windows' }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(jobsChannel);
      supabase.removeChannel(windowsChannel);
    };
  }, []);

  // Helper functions - must be defined before useMemo
  const getJobTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      firmware_update: "Firmware Update",
      discovery_scan: "Discovery Scan",
      vcenter_sync: "vCenter Sync",
      full_server_update: "Full Server Update",
      cluster_safety_check: "Safety Check",
    };
    return labels[type] || type;
  };

  const isJobStale = (job: Job): boolean => {
    if (job.status === 'pending') {
      const hoursOld = (new Date().getTime() - new Date(job.created_at).getTime()) / (1000 * 60 * 60);
      return hoursOld > staleThresholds.pending;
    }
    if (job.status === 'running' && job.started_at) {
      const hoursOld = (new Date().getTime() - new Date(job.started_at).getTime()) / (1000 * 60 * 60);
      return hoursOld > staleThresholds.running;
    }
    return false;
  };

  const getJobAge = (job: Job): string => {
    const referenceDate = job.status === 'running' && job.started_at
      ? new Date(job.started_at)
      : new Date(job.created_at);

    const hoursOld = (new Date().getTime() - referenceDate.getTime()) / (1000 * 60 * 60);
    const daysOld = Math.floor(hoursOld / 24);

    if (daysOld > 0) return `${daysOld}d`;
    return `${Math.floor(hoursOld)}h`;
  };

  const getStatusIcon = (status: TimelineItem['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-success" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'active':
        return <PlayCircle className="h-4 w-4 text-primary animate-pulse" />;
      case 'planned':
        return <Clock className="h-4 w-4 text-warning" />;
    }
  };

  const getStatusBadge = (status: TimelineItem['status']) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      completed: "secondary",
      failed: "destructive",
      active: "default",
      planned: "outline",
    };
    return <Badge variant={variants[status]}>{status.toUpperCase()}</Badge>;
  };

  // Map statuses to unified timeline statuses
  const mapJobStatus = (job: Job): TimelineItem['status'] => {
    if (job.status === 'completed') return 'completed';
    if (job.status === 'failed' || job.status === 'cancelled') return 'failed';
    if (job.status === 'running') return 'active';
    if (job.status === 'pending' && job.schedule_at) return 'planned';
    return 'active'; // pending without schedule = queued = active
  };

  const mapWindowStatus = (window: MaintenanceWindow): TimelineItem['status'] => {
    if (window.status === 'completed') return 'completed';
    if (window.status === 'failed' || window.status === 'cancelled') return 'failed';
    if (window.status === 'in_progress') return 'active';
    return 'planned';
  };

  // Convert to unified timeline items
  const timelineItems = useMemo<TimelineItem[]>(() => {
    const jobItems: TimelineItem[] = jobs.map(j => ({
      type: 'job',
      id: j.id,
      title: getJobTypeLabel(j.job_type),
      status: mapJobStatus(j),
      timestamp: new Date(j.started_at || j.created_at),
      data: j
    }));

    const windowItems: TimelineItem[] = windows.map(w => ({
      type: 'maintenance_window',
      id: w.id,
      title: w.title,
      status: mapWindowStatus(w),
      timestamp: new Date(w.planned_start),
      data: w
    }));

    const all = [...jobItems, ...windowItems];
    
    // Sort by relevance: active → planned → recent completed/failed
    return all.sort((a, b) => {
      const statusOrder = { active: 0, planned: 1, completed: 2, failed: 3 };
      const aOrder = statusOrder[a.status];
      const bOrder = statusOrder[b.status];
      
      if (aOrder !== bOrder) return aOrder - bOrder;
      return b.timestamp.getTime() - a.timestamp.getTime();
    });
  }, [jobs, windows]);

  const filterItems = (items: TimelineItem[]) => {
    let filtered = items;

    if (view !== 'all') {
      filtered = filtered.filter(item => item.status === view);
    }

    if (selectedType !== 'all') {
      if (selectedType === 'maintenance') {
        filtered = filtered.filter(item => item.type === 'maintenance_window');
      } else {
        filtered = filtered.filter(item => 
          item.type === 'job' && (item.data as Job).job_type === selectedType
        );
      }
    }

    return filtered;
  };

  const handleCancelJob = async (jobId: string) => {
    if (!canManage) {
      toast({
        title: "Permission denied",
        description: "You don't have permission to cancel jobs",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase.functions.invoke('update-job', {
        body: { job: { id: jobId, status: 'cancelled', completed_at: new Date().toISOString() } }
      });

      if (error) throw error;
      toast({ title: "Job cancelled" });
      fetchData();
    } catch (error: any) {
      toast({ title: "Error cancelling job", description: error.message, variant: "destructive" });
    }
  };

  const handleRetryJob = async (job: Job) => {
    if (!canManage) {
      toast({ title: "Permission denied", variant: "destructive" });
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: result, error } = await supabase.functions.invoke('create-job', {
        body: {
          job_type: job.job_type as any,
          created_by: user?.id,
          target_scope: job.target_scope,
          details: job.details
        }
      });

      if (error) throw error;
      if (!result?.success) throw new Error(result?.error || 'Failed to create job');

      toast({ title: "Job retried" });
      fetchData();
    } catch (error: any) {
      toast({ title: "Error retrying job", description: error.message, variant: "destructive" });
    }
  };

  const filteredItems = useMemo(() => filterItems(timelineItems), [timelineItems, view, selectedType]);

  // Calculate stats
  const activeCount = timelineItems.filter(i => i.status === 'active').length;
  const plannedCount = timelineItems.filter(i => i.status === 'planned').length;
  const completedCount = timelineItems.filter(i => i.status === 'completed').length;
  const failedCount = timelineItems.filter(i => i.status === 'failed').length;

  const renderJobItem = (item: TimelineItem) => {
    const job = item.data as Job;
    const isStale = isJobStale(job);

    return (
      <ContextMenu key={item.id}>
        <ContextMenuTrigger asChild>
          <Card
            className="hover:border-primary/50 transition-colors cursor-pointer border-l-4 border-l-blue-500"
            onClick={() => onJobClick?.(job)}
          >
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-blue-500" />
                  {getStatusIcon(item.status)}
                  <div>
                    <h4 className="font-semibold flex items-center gap-2">
                      {item.title}
                      {job.status === 'running' && (
                        <Badge variant="secondary" className="animate-pulse">Live</Badge>
                      )}
                      {isStale && (
                        <Badge variant="destructive">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Stale
                        </Badge>
                      )}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(job.created_at), 'MMM dd, HH:mm')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(item.status)}
                  <Badge variant="outline">
                    <BarChart3 className="h-3 w-3 mr-1" />
                    {getJobAge(job)}
                  </Badge>
                </div>
              </div>

              {job.details?.error && job.status === 'failed' && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    {job.details.error.substring(0, 100)}...
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Started:</span>
                  <p className="font-medium">
                    {job.started_at ? format(new Date(job.started_at), 'MMM dd, HH:mm') : 'Pending'}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Target:</span>
                  <p className="font-medium">
                    {job.job_type === 'full_server_update'
                      ? `${subJobCounts[job.id] || 0} components`
                      : job.target_scope?.server_ids
                        ? `${job.target_scope.server_ids.length} servers`
                        : job.target_scope?.cluster_name || 'N/A'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onClick={() => onJobClick?.(job)}>
            <FileText className="mr-2 h-4 w-4" />
            View Details
          </ContextMenuItem>
          {canManage && ['pending', 'running'].includes(job.status) && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => handleCancelJob(job.id)} className="text-destructive">
                <XCircle className="mr-2 h-4 w-4" />
                Cancel Job
              </ContextMenuItem>
            </>
          )}
          {canManage && job.status === 'failed' && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => handleRetryJob(job)}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Retry Job
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const renderWindowItem = (item: TimelineItem) => {
    const window = item.data as MaintenanceWindow;
    const duration = differenceInHours(new Date(window.planned_end), new Date(window.planned_start));

    return (
      <ContextMenu key={item.id}>
        <ContextMenuTrigger asChild>
          <Card className="hover:border-primary/50 transition-colors cursor-pointer border-l-4 border-l-purple-500">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-purple-500" />
                  {getStatusIcon(item.status)}
                  <div>
                    <h4 className="font-semibold flex items-center gap-2">
                      {item.title}
                      {window.status === 'in_progress' && (
                        <Badge variant="secondary">
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          EXECUTING
                        </Badge>
                      )}
                      {window.auto_execute && (
                        <Badge variant="outline" className="border-primary text-primary">
                          <Zap className="h-3 w-3 mr-1" />
                          Auto
                        </Badge>
                      )}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(window.planned_start), 'MMM dd, HH:mm')} - {format(new Date(window.planned_end), 'HH:mm')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(item.status)}
                  <Badge variant="outline">{duration}h</Badge>
                </div>
              </div>

              {window.description && (
                <p className="text-sm text-muted-foreground">{window.description}</p>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Type:</span>
                  <p className="font-medium">{window.maintenance_type.replace('_', ' ')}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Target:</span>
                  <p className="font-medium">
                    {window.cluster_ids?.length || 0} clusters, {window.server_group_ids?.length || 0} groups
                  </p>
                </div>
              </div>

              {window.status === 'planned' && isFuture(new Date(window.planned_start)) && (
                <div className="pt-2 border-t text-xs text-muted-foreground">
                  Starts {formatDistanceToNow(new Date(window.planned_start), { addSuffix: true })}
                </div>
              )}
            </CardContent>
          </Card>
        </ContextMenuTrigger>

        <ContextMenuContent>
          {canManage && onWindowDelete && (
            <ContextMenuItem onClick={() => onWindowDelete(window.id)} className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Operations & Maintenance</CardTitle>
            <CardDescription>
              Monitor and manage all server operations and maintenance windows
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchData}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={() => onCreateOperation?.('job')}>
              <Plus className="mr-2 h-4 w-4" />
              New Operation
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Tabs value={view} onValueChange={(v) => setView(v as any)}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">
              Active {activeCount > 0 && <Badge variant="secondary" className="ml-1">{activeCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="planned">
              Planned {plannedCount > 0 && <Badge variant="outline" className="ml-1">{plannedCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="failed">
              Failed {failedCount > 0 && <Badge variant="destructive" className="ml-1">{failedCount}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* Stats cards */}
          <div className="grid grid-cols-4 gap-4 mt-4">
            <div className="border rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <PlayCircle className="h-4 w-4" />
                Active
              </div>
              <div className="text-2xl font-bold">{activeCount}</div>
            </div>
            <div className="border rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <Clock className="h-4 w-4" />
                Planned
              </div>
              <div className="text-2xl font-bold">{plannedCount}</div>
            </div>
            <div className="border rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <CheckCircle className="h-4 w-4" />
                Completed
              </div>
              <div className="text-2xl font-bold">{completedCount}</div>
            </div>
            <div className="border rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <XCircle className="h-4 w-4" />
                Failed
              </div>
              <div className="text-2xl font-bold">{failedCount}</div>
            </div>
          </div>

          {/* Type filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="maintenance">Maintenance Windows</SelectItem>
                <SelectItem value="firmware_update">Firmware Update</SelectItem>
                <SelectItem value="discovery_scan">Discovery Scan</SelectItem>
                <SelectItem value="vcenter_sync">vCenter Sync</SelectItem>
                <SelectItem value="full_server_update">Full Server Update</SelectItem>
              </SelectContent>
            </Select>
            {selectedType !== 'all' && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedType('all')}>
                Clear
              </Button>
            )}
          </div>

          {/* Timeline */}
          <TabsContent value={view} className="mt-4 space-y-3">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium mb-1">No {view !== 'all' ? view : ''} operations</p>
                <p className="text-sm mb-4">Create a job or schedule maintenance to get started</p>
                <Button onClick={() => onCreateOperation?.('job')}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Operation
                </Button>
              </div>
            ) : (
              filteredItems.map(item => 
                item.type === 'job' ? renderJobItem(item) : renderWindowItem(item)
              )
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
