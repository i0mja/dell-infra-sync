import { AlertCircle, Thermometer, HardDrive, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Link } from "react-router-dom";

export const AlertSummaryBanner = () => {
  const [dismissed, setDismissed] = useState(false);

  const { data: criticalEvents } = useQuery({
    queryKey: ['critical-sel-events'],
    queryFn: async () => {
      const { data } = await supabase
        .from('server_event_logs')
        .select('*, servers!inner(hostname, ip_address)')
        .eq('severity', 'Critical')
        .gte('timestamp', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('timestamp', { ascending: false })
        .limit(3);
      return data || [];
    }
  });

  const { data: hotServers } = useQuery({
    queryKey: ['hot-servers'],
    queryFn: async () => {
      const { data } = await supabase
        .from('server_health')
        .select('*, servers!inner(hostname, ip_address)')
        .gt('avg_temp', 35)
        .order('created_at', { ascending: false })
        .limit(20);
      
      // Get unique servers
      const uniqueServers = new Map();
      data?.forEach(entry => {
        if (!uniqueServers.has(entry.server_id)) {
          uniqueServers.set(entry.server_id, entry);
        }
      });
      
      return Array.from(uniqueServers.values()).slice(0, 3);
    }
  });

  const { data: failingDrives } = useQuery({
    queryKey: ['failing-drives'],
    queryFn: async () => {
      const { data } = await supabase
        .from('server_drives')
        .select('*, servers!inner(hostname, ip_address)')
        .or('predicted_failure.eq.true,health.eq.Critical,health.eq.Warning')
        .limit(3);
      return data || [];
    }
  });

  const hasCriticalEvents = (criticalEvents?.length || 0) > 0;
  const hasHotServers = (hotServers?.length || 0) > 0;
  const hasFailingDrives = (failingDrives?.length || 0) > 0;
  const hasAlerts = hasCriticalEvents || hasHotServers || hasFailingDrives;

  if (!hasAlerts || dismissed) return null;

  return (
    <div className="border-l-4 border-destructive bg-destructive/5 p-4 rounded-lg">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <h3 className="font-semibold text-destructive">Active Infrastructure Alerts</h3>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {hasCriticalEvents && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AlertCircle className="h-4 w-4" />
                  Critical Events ({criticalEvents?.length})
                </div>
                {criticalEvents?.slice(0, 2).map(event => (
                  <div key={event.id} className="text-xs text-muted-foreground">
                    {event.servers?.hostname || event.servers?.ip_address}: {event.message?.substring(0, 40)}...
                  </div>
                ))}
              </div>
            )}

            {hasHotServers && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Thermometer className="h-4 w-4" />
                  Hot Servers ({hotServers?.length})
                </div>
                {hotServers?.slice(0, 2).map(server => (
                  <div key={server.id} className="text-xs text-muted-foreground">
                    {server.servers?.hostname || server.servers?.ip_address}: {server.avg_temp}°C
                  </div>
                ))}
              </div>
            )}

            {hasFailingDrives && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <HardDrive className="h-4 w-4" />
                  Failing Drives ({failingDrives?.length})
                </div>
                {failingDrives?.slice(0, 2).map(drive => (
                  <div key={drive.id} className="text-xs text-muted-foreground">
                    {drive.servers?.hostname || drive.servers?.ip_address}: {drive.slot}
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button asChild variant="outline" size="sm">
            <Link to="/servers">View Details</Link>
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDismissed(true)}
          className="shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
