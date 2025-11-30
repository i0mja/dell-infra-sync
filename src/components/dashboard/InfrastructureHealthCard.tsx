import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HardDrive, Thermometer, Package } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

export const InfrastructureHealthCard = () => {
  const { data: drives, isLoading: drivesLoading } = useQuery({
    queryKey: ['server-drives'],
    queryFn: async () => {
      const { data } = await supabase
        .from('server_drives')
        .select('*');
      return data || [];
    }
  });

  const { data: serverHealth, isLoading: healthLoading } = useQuery({
    queryKey: ['server-health-latest'],
    queryFn: async () => {
      const { data } = await supabase
        .from('server_health')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      return data || [];
    }
  });

  const { data: servers, isLoading: serversLoading } = useQuery({
    queryKey: ['servers-firmware'],
    queryFn: async () => {
      const { data } = await supabase
        .from('servers')
        .select('id, idrac_firmware');
      return data || [];
    }
  });

  const healthyDrives = drives?.filter(d => d.health === 'OK' || d.health === 'Healthy').length || 0;
  const totalDrives = drives?.length || 0;
  const failingDrives = drives?.filter(d => 
    d.predicted_failure || d.health === 'Critical' || d.health === 'Warning'
  ) || [];

  const uniqueServers = new Map();
  serverHealth?.forEach(entry => {
    if (!uniqueServers.has(entry.server_id)) {
      uniqueServers.set(entry.server_id, entry);
    }
  });
  const avgTemp = uniqueServers.size > 0
    ? Array.from(uniqueServers.values()).reduce((sum, s) => sum + (s.avg_temp || 0), 0) / uniqueServers.size
    : 0;
  const hotServers = Array.from(uniqueServers.values()).filter(s => (s.avg_temp || 0) > 35).length;

  const serversWithFirmware = servers?.filter(s => s.idrac_firmware).length || 0;
  const totalServers = servers?.length || 0;
  const complianceRate = totalServers > 0 ? (serversWithFirmware / totalServers) * 100 : 0;

  const isLoading = drivesLoading || healthLoading || serversLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Infrastructure Health</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <Tabs defaultValue="storage">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="storage">Storage</TabsTrigger>
              <TabsTrigger value="thermal">Thermal</TabsTrigger>
              <TabsTrigger value="firmware">Firmware</TabsTrigger>
            </TabsList>

            <TabsContent value="storage" className="space-y-3 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-muted/30 rounded-lg">
                  <div className="text-xs text-muted-foreground">Total Drives</div>
                  <div className="text-2xl font-bold">{totalDrives}</div>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg">
                  <div className="text-xs text-muted-foreground">Healthy</div>
                  <div className="text-2xl font-bold text-green-600">{healthyDrives}</div>
                </div>
              </div>
              {failingDrives.length > 0 && (
                <div className="p-3 bg-destructive/10 rounded-lg">
                  <div className="text-sm font-medium text-destructive mb-2">
                    {failingDrives.length} drive{failingDrives.length > 1 ? 's' : ''} need attention
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="thermal" className="space-y-3 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-muted/30 rounded-lg">
                  <div className="text-xs text-muted-foreground">Avg Temperature</div>
                  <div className="text-2xl font-bold">{avgTemp.toFixed(1)}°C</div>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg">
                  <div className="text-xs text-muted-foreground">Hot Servers</div>
                  <div className={`text-2xl font-bold ${hotServers > 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {hotServers}
                  </div>
                </div>
              </div>
              {hotServers > 0 && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
                  <div className="text-sm text-amber-900 dark:text-amber-200">
                    {hotServers} server{hotServers > 1 ? 's' : ''} above 35°C threshold
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="firmware" className="space-y-3 mt-4">
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Compliance Rate</span>
                  <span className="font-medium">{complianceRate.toFixed(0)}%</span>
                </div>
                <Progress value={complianceRate} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
                  <div className="text-xs text-muted-foreground">Tracked</div>
                  <div className="text-2xl font-bold">{serversWithFirmware}</div>
                </div>
                <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
                  <div className="text-xs text-muted-foreground">Unknown</div>
                  <div className="text-2xl font-bold">{totalServers - serversWithFirmware}</div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
};
