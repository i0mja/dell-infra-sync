import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Package } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

export const FirmwareComplianceWidget = () => {
  const { data: servers, isLoading } = useQuery({
    queryKey: ['servers-firmware'],
    queryFn: async () => {
      const { data } = await supabase
        .from('servers')
        .select('id, hostname, ip_address, idrac_firmware, bios_version, model');
      return data || [];
    }
  });

  const { data: packages } = useQuery({
    queryKey: ['firmware-packages'],
    queryFn: async () => {
      const { data } = await supabase
        .from('firmware_packages')
        .select('*')
        .order('dell_version', { ascending: false });
      return data || [];
    }
  });

  const serversWithFirmware = servers?.filter(s => s.idrac_firmware) || [];
  const serversWithoutFirmware = servers?.filter(s => !s.idrac_firmware) || [];
  const complianceRate = servers?.length ? 
    (serversWithFirmware.length / servers.length) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          Firmware Compliance
        </CardTitle>
        <CardDescription>
          Version tracking and drift detection
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
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted-foreground">Compliance Rate</span>
                <span className="font-medium">{complianceRate.toFixed(0)}%</span>
              </div>
              <Progress value={complianceRate} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium">Tracked</span>
                </div>
                <div className="text-2xl font-bold">{serversWithFirmware.length}</div>
              </div>
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <span className="text-sm font-medium">Unknown</span>
                </div>
                <div className="text-2xl font-bold">{serversWithoutFirmware.length}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Firmware Packages Available</div>
              <div className="text-2xl font-bold">{packages?.length || 0}</div>
              <div className="text-xs text-muted-foreground">
                Available in local firmware library
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
