import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Calendar, Clock, ArrowRight } from "lucide-react";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

export function NextMaintenanceWidget() {
  const navigate = useNavigate();

  const { data: nextMaintenance, isLoading } = useQuery({
    queryKey: ['next-maintenance'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('maintenance_windows')
        .select('*')
        .eq('status', 'planned')
        .gte('planned_start', new Date().toISOString())
        .order('planned_start', { ascending: true })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    }
  });

  const calculateReadiness = (window: any): number => {
    if (!window) return 0;
    
    const now = new Date().getTime();
    const start = new Date(window.planned_start).getTime();
    const notifyTime = start - (window.notify_before_hours * 60 * 60 * 1000);
    
    if (now < notifyTime) return 0;
    if (now >= start) return 100;
    
    const timeUntilStart = start - now;
    const notifyWindow = start - notifyTime;
    return Math.round(((notifyWindow - timeUntilStart) / notifyWindow) * 100);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Next Maintenance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-3 bg-muted rounded w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Next Maintenance
        </CardTitle>
      </CardHeader>
      <CardContent>
        {nextMaintenance ? (
          <div className="space-y-3">
            <div>
              <p className="font-medium">{nextMaintenance.title}</p>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                <Clock className="h-3 w-3" />
                <span>
                  {formatDistanceToNow(new Date(nextMaintenance.planned_start), { addSuffix: true })}
                </span>
              </div>
            </div>
            
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Readiness</span>
                <span>{calculateReadiness(nextMaintenance)}%</span>
              </div>
              <Progress value={calculateReadiness(nextMaintenance)} className="h-2" />
            </div>

            <div className="text-xs text-muted-foreground">
              {nextMaintenance.cluster_ids.length} cluster{nextMaintenance.cluster_ids.length > 1 ? 's' : ''} • {' '}
              {Math.round(differenceInHours(
                new Date(nextMaintenance.planned_end),
                new Date(nextMaintenance.planned_start)
              ))}h window
            </div>

            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => navigate('/maintenance-planner')}
            >
              Open Planner
              <ArrowRight className="ml-2 h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-3">
              No maintenance scheduled
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate('/maintenance-planner')}
            >
              Schedule Maintenance
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
