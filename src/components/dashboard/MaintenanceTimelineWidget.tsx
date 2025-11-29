import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { format, formatDistanceToNow, isFuture } from "date-fns";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

export const MaintenanceTimelineWidget = () => {
  const { data: windows, isLoading } = useQuery({
    queryKey: ['upcoming-maintenance'],
    queryFn: async () => {
      const { data } = await supabase
        .from('maintenance_windows')
        .select('*')
        .eq('status', 'planned')
        .order('planned_start', { ascending: true })
        .limit(5);
      return data || [];
    }
  });

  const upcomingWindows = windows?.filter(w => 
    isFuture(new Date(w.planned_start))
  ) || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          Maintenance Timeline
        </CardTitle>
        <CardDescription>
          Upcoming scheduled maintenance windows
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : upcomingWindows.length > 0 ? (
          <div className="space-y-3">
            {upcomingWindows.map(window => (
              <div key={window.id} className="p-3 bg-muted/50 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{window.title}</span>
                  <Badge variant="secondary">{window.maintenance_type}</Badge>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>
                    {format(new Date(window.planned_start), 'MMM d, HH:mm')} - 
                    {format(new Date(window.planned_end), 'HH:mm')}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Starts {formatDistanceToNow(new Date(window.planned_start), { addSuffix: true })}
                </div>
                {window.auto_execute && (
                  <Badge variant="outline" className="text-xs">Auto-execute</Badge>
                )}
              </div>
            ))}
            <Button asChild variant="outline" className="w-full" size="sm">
              <Link to="/maintenance-planner">View All</Link>
            </Button>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            No upcoming maintenance windows scheduled
          </div>
        )}
      </CardContent>
    </Card>
  );
};
