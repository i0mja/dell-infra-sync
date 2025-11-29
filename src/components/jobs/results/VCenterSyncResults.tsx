import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Server, HardDrive, AlertTriangle, Plus } from "lucide-react";

interface VCenterSyncResultsProps {
  details: any;
}

export const VCenterSyncResults = ({ details }: VCenterSyncResultsProps) => {
  const hostsSynced = details?.hosts_synced || details?.updated_hosts || 0;
  const hostsNew = details?.hosts_new || details?.new_hosts || 0;
  const vmsSynced = details?.vms_synced || details?.vms_processed || 0;
  const alarms = details?.alarms_synced || 0;
  const autoLinked = details?.auto_linked || 0;
  const errors = details?.errors || 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Server className="h-4 w-4" />
            Hosts Synced
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{hostsSynced}</div>
          <p className="text-xs text-muted-foreground mt-1">Total hosts updated</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Plus className="h-4 w-4" />
            New Hosts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-success">{hostsNew}</div>
          <p className="text-xs text-muted-foreground mt-1">Newly discovered</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <HardDrive className="h-4 w-4" />
            VMs Synced
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{vmsSynced}</div>
          <p className="text-xs text-muted-foreground mt-1">Virtual machines</p>
        </CardContent>
      </Card>

      {autoLinked > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Server className="h-4 w-4" />
              Auto-Linked
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{autoLinked}</div>
            <p className="text-xs text-muted-foreground mt-1">Servers matched</p>
          </CardContent>
        </Card>
      )}

      {vmsSynced > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              VMs Synced
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{vmsSynced}</div>
            <p className="text-xs text-muted-foreground mt-1">Virtual machines</p>
          </CardContent>
        </Card>
      )}

      {alarms > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Alarms
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{alarms}</div>
            <p className="text-xs text-muted-foreground mt-1">Active alarms</p>
          </CardContent>
        </Card>
      )}

      {errors > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Errors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{errors}</div>
            <p className="text-xs text-muted-foreground mt-1">Failed operations</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
