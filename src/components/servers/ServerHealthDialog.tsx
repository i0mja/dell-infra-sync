import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw, Thermometer, Fan, Zap, HardDrive } from "lucide-react";
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
  timestamp: string;
}

export function ServerHealthDialog({ open, onOpenChange, server }: ServerHealthDialogProps) {
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) {
      fetchLatestHealth();
    }
  }, [open, server.id]);

  const fetchLatestHealth = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('server_health')
        .select('*')
        .eq('server_id', server.id)
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      setHealthData(data || null);
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
      <DialogContent className="sm:max-w-[600px]">
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
          ) : !healthData ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="mb-4">No health data available</p>
              <Button onClick={handleRefresh} disabled={isRefreshing}>
                Run Health Check
              </Button>
            </div>
          ) : (
            <>
              {/* Overall Status */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg border bg-card">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Power State</span>
                    <Badge variant={healthData.power_state === 'On' ? 'default' : 'outline'}>
                      {healthData.power_state || 'Unknown'}
                    </Badge>
                  </div>
                </div>

                <div className="p-4 rounded-lg border bg-card">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Overall Health</span>
                    {getHealthBadge(healthData.overall_health)}
                  </div>
                </div>
              </div>

              {/* Component Health */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium">Component Health</h4>

                {healthData.temperature_celsius && (
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-2">
                      <Thermometer className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Temperature</span>
                    </div>
                    <Badge variant="outline">{healthData.temperature_celsius}°C</Badge>
                  </div>
                )}

                {healthData.fan_health && (
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-2">
                      <Fan className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Fans</span>
                    </div>
                    {getHealthBadge(healthData.fan_health)}
                  </div>
                )}

                {healthData.psu_health && (
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Power Supplies</span>
                    </div>
                    {getHealthBadge(healthData.psu_health)}
                  </div>
                )}

                {healthData.storage_health && (
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Storage</span>
                    </div>
                    {getHealthBadge(healthData.storage_health)}
                  </div>
                )}
              </div>

              {/* Last Checked */}
              <div className="text-xs text-muted-foreground text-center pt-2">
                Last checked: {format(new Date(healthData.timestamp), 'PPpp')}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}