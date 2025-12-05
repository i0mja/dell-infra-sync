import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Activity, RefreshCw, Thermometer, Fan, Zap, HardDrive, Cpu, MemoryStick, Network } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { logActivityDirect } from "@/hooks/useActivityLog";
import { getServerHealth, checkApiHealth } from "@/lib/job-executor-api";

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
      // Try instant API first to get fresh data
      const apiAvailable = await checkApiHealth();
      if (apiAvailable) {
        try {
          const healthResult = await getServerHealth(server.id);
          if (healthResult.success) {
            // Insert new health record
            const newHealthData: HealthData = {
              power_state: healthResult.power_state,
              overall_health: healthResult.overall_health,
              temperature_celsius: healthResult.temperature_celsius,
              fan_health: healthResult.fan_health,
              psu_health: healthResult.psu_health,
              storage_health: healthResult.storage_health,
              network_health: healthResult.network_health,
              timestamp: new Date().toISOString(),
              sensors: healthResult.sensors,
            };
            
            // Insert to database
            await supabase.from('server_health').insert({
              server_id: server.id,
              ...newHealthData,
            });
          }
        } catch (apiError) {
          console.log('Instant API unavailable, falling back to database');
        }
      }
      
      // Fetch history from database
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
      // Try instant API first
      const apiAvailable = await checkApiHealth();
      if (apiAvailable) {
        const healthResult = await getServerHealth(server.id);
        if (healthResult.success) {
          // Insert new health record to database
          const newHealthData: HealthData = {
            power_state: healthResult.power_state,
            overall_health: healthResult.overall_health,
            temperature_celsius: healthResult.temperature_celsius,
            fan_health: healthResult.fan_health,
            psu_health: healthResult.psu_health,
            storage_health: healthResult.storage_health,
            network_health: healthResult.network_health,
            timestamp: new Date().toISOString(),
            sensors: healthResult.sensors,
          };
          
          await supabase.from('server_health').insert({
            server_id: server.id,
            ...newHealthData,
          });
          
          // Update local state
          setHealthHistory(prev => [newHealthData, ...prev.slice(0, 9)]);
          setSelectedEntry(newHealthData);
          
          toast.success('Health check complete', {
            description: `Status: ${healthResult.overall_health || 'Unknown'}`
          });
          
          logActivityDirect('health_check', 'server', server.hostname || server.ip_address, {}, { targetId: server.id, success: true });
          setIsRefreshing(false);
          return;
        }
      }
      
      // Fall back to job queue
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

      logActivityDirect('health_check', 'server', server.hostname || server.ip_address, {}, { targetId: server.id, success: true });

      setTimeout(() => {
        fetchHealthHistory();
      }, 5000);
    } catch (error: any) {
      console.error('Error initiating health check:', error);
      toast.error('Failed to initiate health check', {
        description: error.message
      });

      logActivityDirect('health_check', 'server', server.hostname || server.ip_address, {}, { targetId: server.id, success: false, error: error.message });
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
      <DialogContent className="sm:max-w-[720px] max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Server Health Status
          </DialogTitle>
          <DialogDescription>
            {server.hostname || server.ip_address}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
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

                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="sensors">
                    <AccordionTrigger className="text-sm font-medium">
                      Full sensor payload
                    </AccordionTrigger>
                    <AccordionContent>
                      {selectedEntry.sensors ? (
                        <ScrollArea className="h-72 w-full rounded-md border">
                          <pre className="bg-muted/40 p-3 text-xs">
                            {JSON.stringify(selectedEntry.sensors, null, 2)}
                          </pre>
                        </ScrollArea>
                      ) : (
                        <p className="text-sm text-muted-foreground">No sensor payload captured for this check.</p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            </div>
          )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
