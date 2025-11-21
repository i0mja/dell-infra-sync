import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, AlertTriangle, Calendar } from "lucide-react";
import { format } from "date-fns";

interface ClusterSafetyDay {
  date: Date;
  clusters: { [key: string]: { safe: boolean; healthy: number; total: number } };
  serverGroups: { [key: string]: { safe: boolean; healthy: number; total: number } };
  maintenanceWindows: any[];
  allTargetsChecked: boolean;
  allTargetsSafe: boolean;
}

interface DayDetailsPanelProps {
  date: Date;
  status: ClusterSafetyDay | null;
}

export function DayDetailsPanel({ date, status }: DayDetailsPanelProps) {
  if (!status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Day Details - {format(date, 'MMMM dd, yyyy')}</CardTitle>
          <CardDescription>No safety check data available for this date</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const clusterEntries = Object.entries(status.clusters);
  const groupEntries = Object.entries(status.serverGroups);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Day Details - {format(date, 'MMMM dd, yyyy')}</span>
          {status.allTargetsSafe ? (
            <Badge className="bg-green-500">
              <CheckCircle className="mr-1 h-3 w-3" />
              All Safe
            </Badge>
          ) : (
            <Badge variant="destructive">
              <AlertTriangle className="mr-1 h-3 w-3" />
              Warnings
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {clusterEntries.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Cluster Safety Status
            </h3>
            <div className="grid gap-3">
              {clusterEntries.map(([clusterId, data]) => (
                <div key={clusterId} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    {data.safe ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                    <div>
                      <p className="font-medium">{clusterId}</p>
                      <p className="text-sm text-muted-foreground">
                        {data.healthy} of {data.total} hosts healthy
                      </p>
                    </div>
                  </div>
                  <Badge variant={data.safe ? "secondary" : "destructive"}>
                    {data.safe ? 'Safe' : 'Unsafe'}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {groupEntries.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Server Group Status
            </h3>
            <div className="grid gap-3">
              {groupEntries.map(([groupId, data]) => (
                <div key={groupId} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    {data.safe ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                    <div>
                      <p className="font-medium">{groupId}</p>
                      <p className="text-sm text-muted-foreground">
                        {data.healthy} of {data.total} servers healthy
                      </p>
                    </div>
                  </div>
                  <Badge variant={data.safe ? "secondary" : "destructive"}>
                    {data.safe ? 'Ready' : 'Not Ready'}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {status.maintenanceWindows.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold">Scheduled Maintenance</h3>
            <div className="grid gap-2">
              {status.maintenanceWindows.map((window) => (
                <div key={window.id} className="p-3 border rounded-lg">
                  <p className="font-medium">{window.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(window.planned_start), 'HH:mm')} - {format(new Date(window.planned_end), 'HH:mm')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
