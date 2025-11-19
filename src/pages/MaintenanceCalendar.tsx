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
import { useToast } from "@/hooks/use-toast";
import { Calendar, Plus, TrendingUp } from "lucide-react";
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

  const handleDayClick = (day: any) => {
    setSelectedDate(day.date);
  };

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Calendar className="h-8 w-8" />
            Maintenance Calendar
          </h1>
          <p className="text-muted-foreground mt-1">
            Plan maintenance during optimal windows when all clusters are safe
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Schedule Maintenance
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <MaintenanceCalendarView
            date={selectedDate}
            onDateChange={(date) => date && setSelectedDate(date)}
            dailyStatus={dailyStatus}
            onDayClick={handleDayClick}
          />

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
