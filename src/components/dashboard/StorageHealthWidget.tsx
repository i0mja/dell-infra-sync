import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HardDrive, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

export const StorageHealthWidget = () => {
  const { data: drives, isLoading } = useQuery({
    queryKey: ['server-drives'],
    queryFn: async () => {
      const { data } = await supabase
        .from('server_drives')
        .select('*, servers!inner(hostname, ip_address)');
      return data || [];
    }
  });

  const healthyDrives = drives?.filter(d => d.health === 'OK' || d.health === 'Healthy') || [];
  const failingDrives = drives?.filter(d => 
    d.predicted_failure || d.health === 'Critical' || d.health === 'Warning'
  ) || [];
  const totalCapacityTB = drives?.reduce((sum, d) => sum + (d.capacity_gb || 0), 0) / 1024 || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-primary" />
          Storage Health & Capacity
        </CardTitle>
        <CardDescription>
          RAID status, drive health, and capacity
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
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-sm text-muted-foreground">Total Drives</div>
                <div className="text-2xl font-bold">{drives?.length || 0}</div>
              </div>
              <div className="p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg">
                <div className="text-sm text-muted-foreground">Healthy</div>
                <div className="text-2xl font-bold">{healthyDrives.length}</div>
              </div>
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <div className="text-sm text-muted-foreground">At Risk</div>
                <div className="text-2xl font-bold">{failingDrives.length}</div>
              </div>
            </div>

            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="text-sm text-muted-foreground">Total Capacity</div>
              <div className="text-2xl font-bold">{totalCapacityTB.toFixed(2)} TB</div>
            </div>

            {failingDrives.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  Drives Needing Attention
                </div>
                {failingDrives.slice(0, 3).map((drive: any) => (
                  <div key={drive.id} className="p-2 bg-destructive/10 rounded text-xs">
                    <div className="font-medium">
                      {drive.servers?.hostname || drive.servers?.ip_address}
                    </div>
                    <div className="text-muted-foreground">
                      {drive.slot} - {drive.model} ({(drive.capacity_gb / 1000).toFixed(1)}TB)
                    </div>
                    <Badge variant="destructive" className="mt-1">
                      {drive.predicted_failure ? 'Predicted Failure' : drive.health}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
