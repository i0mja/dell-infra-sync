import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, FileWarning } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

export const SystemEventLogWidget = () => {
  const { data: events, isLoading } = useQuery({
    queryKey: ['recent-sel-events'],
    queryFn: async () => {
      const { data } = await supabase
        .from('server_event_logs')
        .select('*, servers!inner(hostname, ip_address)')
        .in('severity', ['Critical', 'Warning'])
        .order('timestamp', { ascending: false })
        .limit(10);
      return data || [];
    },
    refetchInterval: 60000 // Refresh every minute
  });

  const criticalEvents = events?.filter(e => e.severity === 'Critical') || [];
  const warningEvents = events?.filter(e => e.severity === 'Warning') || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileWarning className="h-5 w-5 text-destructive" />
          System Event Log Alerts
        </CardTitle>
        <CardDescription>
          Recent critical and warning events from SEL
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <div className="text-sm text-muted-foreground">Critical</div>
                <div className="text-2xl font-bold">{criticalEvents.length}</div>
              </div>
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg">
                <div className="text-sm text-muted-foreground">Warnings</div>
                <div className="text-2xl font-bold">{warningEvents.length}</div>
              </div>
            </div>

            {events && events.length > 0 ? (
              <div className="space-y-2">
                <div className="text-sm font-medium">Recent Events</div>
                {events.slice(0, 5).map((event: any) => (
                  <div key={event.id} className="p-2 bg-muted/50 rounded text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {event.servers?.hostname || event.servers?.ip_address}
                      </span>
                      <Badge variant={event.severity === 'Critical' ? 'destructive' : 'secondary'}>
                        {event.severity}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground truncate">{event.message}</div>
                    <div className="text-muted-foreground">
                      {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                No critical events in recent logs
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
