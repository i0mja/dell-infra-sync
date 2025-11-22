import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw, Thermometer, Fan, Zap, HardDrive, Cpu, MemoryStick, Network } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface ServerHealthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: {
    id: string;
    ip_address: string;
    hostname?: string;
    power_state?: string;
    overall_health?: string;
    last_health_check?: string;
  };
}

interface HealthData {
  power_state?: string;
  overall_health?: string;
  temperature_celsius?: number;
  fan_health?: string;
  psu_health?: string;
  storage_health?: string;
  memory_health?: string;
  network_health?: string;
  cpu_health?: string;
  timestamp: string;
  sensors?: Record<string, any> | null;
}

export function ServerHealthDialog({ open, onOpenChange, server }: ServerHealthDialogProps) {
  const [healthHistory, setHealthHistory] = useState<HealthData[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<HealthData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) {
      fetchHealthHistory();
    }
  }, [open, server.id]);

  const fetchHealthHistory = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('server_health')
        .select('*')
        .eq('server_id', server.id)
        .order('timestamp', { ascending: false })
        .limit(10);

      if (error && error.code !== 'PGRST116') throw error;
      const rows = (data as HealthData[]) || [];
      setHealthHistory(rows);
      setSelectedEntry(rows[0] || null);
    } catch (error: any) {
      console.error('Error fetching health data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'health_check',
          created_by: user.id,
          target_scope: {
            type: 'specific',
            server_ids: [server.id]
          }
        });

      if (jobError) throw jobError;

      toast.success('Health check initiated', {
        description: 'Results will be available shortly'
      });

      setTimeout(() => {
        fetchHealthHistory();
      }, 5000);
    } catch (error: any) {
      console.error('Error initiating health check:', error);
      toast.error('Failed to initiate health check', {
        description: error.message
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const getHealthBadge = (health?: string) => {
    if (!health) return <Badge variant="secondary">Unknown</Badge>;
    const variant = health === 'OK' ? 'default' : health === 'Warning' ? 'outline' : 'destructive';
    return <Badge variant={variant}>{health}</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Server Health Status
          </DialogTitle>
          <DialogDescription>
            {server.hostname || server.ip_address}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Refresh Button */}
          <div className="flex justify-end">
            <Button
              onClick={handleRefresh}
              disabled={isRefreshing}
              size="sm"
              variant="outline"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh Health
            </Button>
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading health data...
            </div>
          ) : !selectedEntry ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="mb-4">No health data available</p>
              <Button onClick={handleRefresh} disabled={isRefreshing}>
                Run Health Check
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Recent health checks</p>
                <div className="flex flex-col gap-2">
                  {healthHistory.map((entry) => (
                    <Button
                      key={entry.timestamp}
                      variant={selectedEntry.timestamp === entry.timestamp ? 'secondary' : 'ghost'}
                      className="w-full justify-start"
                      onClick={() => setSelectedEntry(entry)}
                    >
                      <div className="flex flex-col text-left">
                        <span className="text-sm font-semibold">{format(new Date(entry.timestamp), 'MMM d, HH:mm')}</span>
                        <span className="text-xs text-muted-foreground flex items-center gap-2">
                          {getHealthBadge(entry.overall_health)}
                          <span>• {entry.power_state || 'Unknown power'}</span>
                        </span>
                      </div>
                    </Button>
                  ))}
                  {healthHistory.length === 0 && (
                    <div className="text-xs text-muted-foreground">No historical results</div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Recorded</p>
                    <p className="text-lg font-semibold">{format(new Date(selectedEntry.timestamp), 'PPpp')}</p>
                  </div>
                  <Badge variant="outline">{selectedEntry.power_state || 'Unknown'}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg border bg-card">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Power State</span>
                      <Badge variant={selectedEntry.power_state === 'On' ? 'default' : 'outline'}>
                        {selectedEntry.power_state || 'Unknown'}
                      </Badge>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg border bg-card">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Overall Health</span>
                      {getHealthBadge(selectedEntry.overall_health)}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Component Health</h4>

                  {selectedEntry.temperature_celsius && (
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <Thermometer className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Temperature</span>
                      </div>
                      <Badge variant="outline">{selectedEntry.temperature_celsius}°C</Badge>
                    </div>
                  )}

                  {selectedEntry.fan_health && (
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <Fan className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Fans</span>
                      </div>
                      {getHealthBadge(selectedEntry.fan_health)}
                    </div>
                  )}

                  {selectedEntry.psu_health && (
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Power Supplies</span>
                      </div>
                      {getHealthBadge(selectedEntry.psu_health)}
                    </div>
                  )}

                  {selectedEntry.storage_health && (
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Storage</span>
                      </div>
                      {getHealthBadge(selectedEntry.storage_health)}
                    </div>
                  )}

                  {selectedEntry.memory_health && (
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <MemoryStick className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Memory</span>
                      </div>
                      {getHealthBadge(selectedEntry.memory_health)}
                    </div>
                  )}

                  {selectedEntry.network_health && (
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <Network className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Network</span>
                      </div>
                      {getHealthBadge(selectedEntry.network_health)}
                    </div>
                  )}

                  {selectedEntry.cpu_health && (
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Processors</span>
                      </div>
                      {getHealthBadge(selectedEntry.cpu_health)}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Full sensor payload</h4>
                  {selectedEntry.sensors ? (
                    <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
                      {JSON.stringify(selectedEntry.sensors, null, 2)}
                    </pre>
                  ) : (
                    <p className="text-sm text-muted-foreground">No sensor payload captured for this check.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
