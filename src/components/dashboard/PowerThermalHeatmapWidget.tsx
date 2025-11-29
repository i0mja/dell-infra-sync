import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThermometerSun, Zap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

export const PowerThermalHeatmapWidget = () => {
  const { data: healthData, isLoading } = useQuery({
    queryKey: ['server-health-thermal'],
    queryFn: async () => {
      const { data } = await supabase
        .from('server_health')
        .select('*, servers!inner(hostname, ip_address)')
        .order('timestamp', { ascending: false })
        .limit(20);
      return data || [];
    },
    refetchInterval: 30000 // Refresh every 30s
  });

  const criticalServers = healthData?.filter(h => 
    h.temperature_celsius && h.temperature_celsius > 35
  ) || [];

  const avgTemp = healthData?.reduce((sum, h) => 
    sum + (h.temperature_celsius || 0), 0
  ) / (healthData?.length || 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ThermometerSun className="h-5 w-5 text-orange-500" />
          Power & Thermal Heatmap
        </CardTitle>
        <CardDescription>
          Real-time server temperatures and power states
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-muted/50 rounded-lg">
                <div className="text-sm text-muted-foreground">Average Temp</div>
                <div className="text-2xl font-bold">{avgTemp.toFixed(1)}°C</div>
              </div>
              <div className="p-4 bg-muted/50 rounded-lg">
                <div className="text-sm text-muted-foreground">Hot Servers</div>
                <div className="text-2xl font-bold">{criticalServers.length}</div>
              </div>
            </div>

            {criticalServers.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">Critical Thermal Alerts</div>
                {criticalServers.slice(0, 5).map((server: any) => (
                  <div key={server.id} className="flex items-center justify-between p-2 bg-destructive/10 rounded">
                    <div className="text-sm">
                      {server.servers?.hostname || server.servers?.ip_address}
                    </div>
                    <Badge variant="destructive">
                      {server.temperature_celsius}°C
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              <Zap className="h-3 w-3 inline mr-1" />
              Data from Dell Redfish /Thermal and /Power endpoints
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
