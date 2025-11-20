import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { MaintenanceCalendarView } from "@/components/maintenance/MaintenanceCalendarView";
import { OptimalWindowsSidebar } from "@/components/maintenance/OptimalWindowsSidebar";
import { CreateMaintenanceWindowDialog } from "@/components/maintenance/CreateMaintenanceWindowDialog";
import { MaintenanceWindowCard } from "@/components/maintenance/MaintenanceWindowCard";
import { ClusterSafetyTrendChart } from "@/components/maintenance/ClusterSafetyTrendChart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Calendar, Plus } from "lucide-react";
import { format, subMonths, addMonths, startOfMonth, endOfMonth } from "date-fns";

interface ClusterSafetyDay {
  date: Date;
  clusters: {
    [clusterName: string]: {
      safe: boolean;
      healthy_hosts: number;
      total_hosts: number;
    }
  };
  serverGroups?: {
    [groupId: string]: {
      safe: boolean;
      healthy_servers: number;
      total_servers: number;
    }
  };
  maintenanceWindows: any[];
  allClustersChecked: boolean;
  allClustersSafe: boolean;
  allTargetsChecked?: boolean;
  allTargetsSafe?: boolean;
}

export default function MaintenanceCalendar() {
  const { toast } = useToast();
  const location = useLocation();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [prefilledData, setPrefilledData] = useState<any>(null);

  // Handle navigation state for opening dialog with prefilled data
  useEffect(() => {
    if (location.state?.openDialog) {
      setCreateDialogOpen(true);
      if (location.state?.prefilledData) {
        setPrefilledData(location.state.prefilledData);
      }
      // Clear the state to prevent re-opening on refresh
      window.history.replaceState({}, document.title);
    }
  }, [location]);

  // Fetch maintenance windows
  const { data: maintenanceWindows, refetch: refetchWindows } = useQuery({
    queryKey: ['maintenance-windows'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('maintenance_windows')
        .select('*')
        .order('planned_start', { ascending: true });

      if (error) throw error;
      return data;
    }
  });

  // Fetch unique clusters from vcenter_hosts
  const { data: clusters = [] } = useQuery({
    queryKey: ['clusters-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vcenter_hosts')
        .select('cluster')
        .not('cluster', 'is', null);

      if (error) throw error;
      
      const uniqueClusters = Array.from(new Set(data.map(h => h.cluster)));
      return uniqueClusters as string[];
    }
  });

  // Fetch server groups
  const { data: serverGroups = [] } = useQuery({
    queryKey: ['server-groups-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('server_groups')
        .select('id, name');

      if (error) throw error;
      return data || [];
    }
  });

  // Fetch safety checks for calendar view
  const { data: safetyChecks = [] } = useQuery({
    queryKey: ['safety-checks-calendar', selectedDate],
    queryFn: async () => {
      const startDate = startOfMonth(subMonths(selectedDate, 1));
      const endDate = endOfMonth(addMonths(selectedDate, 1));

      const { data, error } = await supabase
        .from('cluster_safety_checks')
        .select('*')
        .gte('check_timestamp', startDate.toISOString())
        .lte('check_timestamp', endDate.toISOString())
        .order('check_timestamp', { ascending: false });

      if (error) throw error;
      return data;
    }
  });

  // Fetch server group safety checks for calendar view
  const { data: serverGroupSafetyChecks = [] } = useQuery({
    queryKey: ['server-group-safety-checks-calendar', selectedDate],
    queryFn: async () => {
      const startDate = startOfMonth(subMonths(selectedDate, 1));
      const endDate = endOfMonth(addMonths(selectedDate, 1));

      const { data, error } = await supabase
        .from('server_group_safety_checks')
        .select('*')
        .gte('check_timestamp', startDate.toISOString())
        .lte('check_timestamp', endDate.toISOString())
        .order('check_timestamp', { ascending: false });

      if (error) throw error;
      return data;
    }
  });

  // Analyze optimal windows
  const { data: analysisData, isLoading: analyzingWindows } = useQuery({
    queryKey: ['optimal-windows', selectedDate, clusters, serverGroups],
    queryFn: async () => {
      const startDate = new Date();
      const endDate = addMonths(startDate, 3);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-maintenance-windows`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            start_date: startDate.toISOString(),
            end_date: endDate.toISOString(),
            min_window_duration_hours: 4,
            clusters,
            server_groups: serverGroups.map(g => g.id)
          })
        }
      );

      if (!response.ok) {
        throw new Error('Failed to analyze maintenance windows');
      }

      return await response.json();
    },
    enabled: clusters.length > 0 || serverGroups.length > 0
  });

  // Process safety checks into daily status map
  const dailyStatus = new Map<string, ClusterSafetyDay>();
  for (const check of safetyChecks) {
    const dateKey = format(new Date(check.check_timestamp), 'yyyy-MM-dd');
    
    if (!dailyStatus.has(dateKey)) {
      dailyStatus.set(dateKey, {
        date: new Date(dateKey),
        clusters: {},
        serverGroups: {},
        maintenanceWindows: [],
        allClustersChecked: false,
        allClustersSafe: false
      });
    }
    
    const day = dailyStatus.get(dateKey)!;
    day.clusters[check.cluster_id] = {
      safe: check.safe_to_proceed,
      healthy_hosts: check.healthy_hosts,
      total_hosts: check.total_hosts
    };
  }

  // Process server group safety checks
  for (const check of serverGroupSafetyChecks) {
    const dateKey = format(new Date(check.check_timestamp), 'yyyy-MM-dd');
    
    if (!dailyStatus.has(dateKey)) {
      dailyStatus.set(dateKey, {
        date: new Date(dateKey),
        clusters: {},
        serverGroups: {},
        maintenanceWindows: [],
        allClustersChecked: false,
        allClustersSafe: false
      });
    }
    
    const day = dailyStatus.get(dateKey)!;
    if (!day.serverGroups) day.serverGroups = {};
    
    day.serverGroups[check.server_group_id] = {
      safe: check.safe_to_proceed,
      healthy_servers: check.healthy_servers,
      total_servers: check.total_servers
    };
  }

  // Add maintenance windows to daily status
  if (maintenanceWindows) {
    for (const window of maintenanceWindows) {
      const dateKey = format(new Date(window.planned_start), 'yyyy-MM-dd');
      if (dailyStatus.has(dateKey)) {
        dailyStatus.get(dateKey).maintenanceWindows.push(window);
      }
    }
  }

  // Calculate allTargetsSafe for each day (both clusters and server groups)
  for (const [_, day] of dailyStatus) {
    const clusterValues = Object.values(day.clusters) as any[];
    const serverGroupValues = Object.values(day.serverGroups || {}) as any[];
    
    const allValues = [...clusterValues, ...serverGroupValues];
    
    day.allTargetsChecked = allValues.length > 0;
    day.allTargetsSafe = allValues.length > 0 && allValues.every(v => v.safe);
    
    // Keep backward compatibility
    day.allClustersChecked = day.allTargetsChecked;
    day.allClustersSafe = day.allTargetsSafe;
  }

  // Prepare chart data for both clusters and server groups
  const chartData = Array.from(dailyStatus.values())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map(day => {
      const dataPoint: any = {
        date: format(day.date, 'yyyy-MM-dd')
      };
      
      // Add vCenter clusters
      for (const [cluster, status] of Object.entries(day.clusters) as any[]) {
        dataPoint[cluster] = status.safe ? 100 : 0;
      }
      
      // Add server groups
      for (const [groupId, status] of Object.entries(day.serverGroups || {}) as any[]) {
        const group = serverGroups.find(g => g.id === groupId);
        const groupName = group ? group.name : groupId.substring(0, 8);
        dataPoint[groupName] = (status as any).safe ? 100 : 0;
      }
      
      return dataPoint;
    });

  const handleScheduleWindow = (window: any) => {
    setPrefilledData({
      start: new Date(window.start),
      end: new Date(window.end),
      clusters: window.affected_clusters
    });
    setCreateDialogOpen(true);
  };

  const selectedDayKey = format(selectedDate, 'yyyy-MM-dd');
  const selectedDayStatus = dailyStatus.get(selectedDayKey);
  const selectedDayWindows = maintenanceWindows?.filter(w =>
    format(new Date(w.planned_start), 'yyyy-MM-dd') === selectedDayKey
  ) || [];

  const safeDays = Array.from(dailyStatus.values()).filter(day => day.allTargetsSafe).length;
  const totalWindows = maintenanceWindows?.length || 0;
  const recommendationCount = analysisData?.optimal_windows?.length || 0;

  const handleDeleteWindow = async (windowId: string) => {
    try {
      const { error } = await supabase
        .from('maintenance_windows')
        .delete()
        .eq('id', windowId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Maintenance window deleted"
      });

      refetchWindows();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const upcomingWindows = maintenanceWindows?.filter(w => 
    w.status === 'planned' && new Date(w.planned_start) >= new Date()
  ) || [];

  const pastWindows = maintenanceWindows?.filter(w => 
    w.status !== 'planned' || new Date(w.planned_start) < new Date()
  ) || [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-primary/5 via-background to-background p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">Scheduling hub</p>
            <h1 className="text-3xl font-bold flex items-center gap-2 mt-1">
              <Calendar className="h-8 w-8" />
              Maintenance Calendar
            </h1>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              Track cluster and server group readiness, review planned work, and quickly schedule maintenance during safe windows.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setSelectedDate(new Date())}>
              Jump to today
            </Button>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Schedule Maintenance
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Days marked safe</CardDescription>
            <CardTitle className="text-3xl">{safeDays}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Days where all clusters or server groups reported green checks.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Planned windows</CardDescription>
            <CardTitle className="text-3xl">{totalWindows}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Includes all planned and historical maintenance windows.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Upcoming this month</CardDescription>
            <CardTitle className="text-3xl">{upcomingWindows.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Quickly scan the next planned activities at a glance.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Optimal suggestions</CardDescription>
            <CardTitle className="text-3xl">{recommendationCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            AI-driven safe windows to minimize disruption.
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <MaintenanceCalendarView
            date={selectedDate}
            onDateChange={(date) => date && setSelectedDate(date)}
            dailyStatus={dailyStatus}
            onDayClick={(_, clickedDate) => setSelectedDate(clickedDate)}
          />

          <Card>
            <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-xl">Day insights</CardTitle>
                <CardDescription>{format(selectedDate, 'EEEE, MMMM do yyyy')}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedDayStatus?.allTargetsSafe ? (
                  <Badge className="bg-green-500/20 text-green-800 dark:text-green-100" variant="secondary">All clear</Badge>
                ) : selectedDayStatus?.allTargetsChecked ? (
                  <Badge className="bg-yellow-500/20 text-yellow-900" variant="secondary">Attention needed</Badge>
                ) : (
                  <Badge variant="outline">No safety data</Badge>
                )}
                <Badge variant="outline">{selectedDayWindows.length} windows</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedDayWindows.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Scheduled maintenance on this date:</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {selectedDayWindows.map(window => (
                      <MaintenanceWindowCard
                        key={window.id}
                        window={window}
                        onDelete={handleDeleteWindow}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-start justify-between gap-3 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground sm:flex-row sm:items-center">
                  <div>
                    No maintenance is scheduled for this day yet.
                  </div>
                  <Button size="sm" onClick={() => {
                    setPrefilledData({
                      start: selectedDate,
                      end: selectedDate,
                      clusters: []
                    });
                    setCreateDialogOpen(true);
                  }}>
                    Plan maintenance
                  </Button>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <Card className="border-dashed">
                  <CardHeader>
                    <CardTitle className="text-base">Cluster safety checks</CardTitle>
                    <CardDescription>Latest checks for this date</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {selectedDayStatus && Object.keys(selectedDayStatus.clusters).length > 0 ? (
                      Object.entries(selectedDayStatus.clusters).map(([cluster, status]) => (
                        <div key={cluster} className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
                          <span className="font-medium">{cluster}</span>
                          <Badge variant={status.safe ? "secondary" : "destructive"}>
                            {status.safe ? 'Safe' : 'Blocked'}
                          </Badge>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground">No cluster checks recorded.</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-dashed">
                  <CardHeader>
                    <CardTitle className="text-base">Server group readiness</CardTitle>
                    <CardDescription>Health per group</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {selectedDayStatus && selectedDayStatus.serverGroups && Object.keys(selectedDayStatus.serverGroups).length > 0 ? (
                      Object.entries(selectedDayStatus.serverGroups).map(([groupId, status]) => {
                        const groupName = serverGroups.find(g => g.id === groupId)?.name || groupId.substring(0, 8);
                        return (
                          <div key={groupId} className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
                            <span className="font-medium">{groupName}</span>
                            <Badge variant={status.safe ? "secondary" : "destructive"}>
                              {status.safe ? 'Safe' : 'Blocked'}
                            </Badge>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-muted-foreground">No server group checks recorded.</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="upcoming" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upcoming">Upcoming ({upcomingWindows.length})</TabsTrigger>
              <TabsTrigger value="past">Past ({pastWindows.length})</TabsTrigger>
            </TabsList>
            
            <TabsContent value="upcoming" className="space-y-4 mt-4">
              {upcomingWindows.length === 0 ? (
                <Card>
                  <CardContent className="text-center py-8">
                    <p className="text-muted-foreground">No upcoming maintenance scheduled</p>
                    <Button 
                      variant="outline" 
                      className="mt-4"
                      onClick={() => setCreateDialogOpen(true)}
                    >
                      Schedule Maintenance
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                upcomingWindows.map(window => (
                  <MaintenanceWindowCard
                    key={window.id}
                    window={window}
                    onDelete={handleDeleteWindow}
                  />
                ))
              )}
            </TabsContent>
            
            <TabsContent value="past" className="space-y-4 mt-4">
              {pastWindows.length === 0 ? (
                <Card>
                  <CardContent className="text-center py-8">
                    <p className="text-muted-foreground">No past maintenance windows</p>
                  </CardContent>
                </Card>
              ) : (
                pastWindows.map(window => (
                  <MaintenanceWindowCard
                    key={window.id}
                    window={window}
                  />
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-6">
          <OptimalWindowsSidebar
            windows={analysisData?.optimal_windows || []}
            onSchedule={handleScheduleWindow}
            loading={analyzingWindows}
          />

          {analysisData?.recommendations && analysisData.recommendations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recommendations</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {analysisData.recommendations.map((rec: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-primary">•</span>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {chartData.length > 0 && (clusters.length > 0 || serverGroups.length > 0) && (
        <ClusterSafetyTrendChart
          data={chartData}
          clusters={[...clusters, ...serverGroups.map(g => g.name)]}
          maintenanceWindows={maintenanceWindows?.filter(w => w.status === 'planned') || []}
        />
      )}

      <CreateMaintenanceWindowDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        clusters={clusters}
        serverGroups={serverGroups}
        prefilledData={prefilledData}
        onSuccess={() => {
          refetchWindows();
          setPrefilledData(null);
        }}
      />
    </div>
  );
}
