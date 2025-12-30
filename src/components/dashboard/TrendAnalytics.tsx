import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, BarChart3 } from "lucide-react";
import { Link } from "react-router-dom";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import { format, subDays, startOfDay, endOfDay } from "date-fns";

export const TrendAnalytics = () => {
  const { data: jobTrends, isLoading } = useQuery({
    queryKey: ['job-trends-7day'],
    queryFn: async () => {
      const days: Array<{ date: string; success: number; failed: number; total: number }> = [];
      
      for (let i = 6; i >= 0; i--) {
        const date = subDays(new Date(), i);
        const start = startOfDay(date).toISOString();
        const end = endOfDay(date).toISOString();

        const { data: jobs } = await supabase
          .from('jobs')
          .select('status')
          .is('parent_job_id', null)
          .gte('created_at', start)
          .lte('created_at', end);

        const success = jobs?.filter(j => j.status === 'completed').length || 0;
        const failed = jobs?.filter(j => j.status === 'failed').length || 0;

        days.push({
          date: format(date, 'EEE'),
          success,
          failed,
          total: success + failed,
        });
      }

      return days;
    }
  });

  const { data: alertTrends } = useQuery({
    queryKey: ['alert-trends-7day'],
    queryFn: async () => {
      const days: Array<{ date: string; count: number }> = [];
      
      for (let i = 6; i >= 0; i--) {
        const date = subDays(new Date(), i);
        const start = startOfDay(date).toISOString();
        const end = endOfDay(date).toISOString();

        const { count } = await supabase
          .from('server_event_logs')
          .select('*', { count: 'exact', head: true })
          .in('severity', ['Critical', 'Error', 'Warning'])
          .gte('timestamp', start)
          .lte('timestamp', end);

        days.push({
          date: format(date, 'EEE'),
          count: count || 0,
        });
      }

      return days;
    }
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            7-Day Trends
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalSuccess = jobTrends?.reduce((sum, d) => sum + d.success, 0) || 0;
  const totalFailed = jobTrends?.reduce((sum, d) => sum + d.failed, 0) || 0;
  const successRate = totalSuccess + totalFailed > 0 
    ? Math.round((totalSuccess / (totalSuccess + totalFailed)) * 100) 
    : 100;

  const totalAlerts = alertTrends?.reduce((sum, d) => sum + d.count, 0) || 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            7-Day Trends
          </CardTitle>
          <Link to="/reports" className="text-xs text-muted-foreground hover:text-foreground">
            View Reports →
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {/* Job Success Trend */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Job Success Rate</span>
              <span className="text-sm font-bold text-green-500">{successRate}%</span>
            </div>
            <div className="h-16">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={jobTrends}>
                  <defs>
                    <linearGradient id="successGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-popover border rounded-lg px-2 py-1 text-xs shadow-md">
                            <div>{payload[0].payload.date}</div>
                            <div className="text-green-500">{payload[0].value} completed</div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="success"
                    stroke="hsl(142, 76%, 36%)"
                    fill="url(#successGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{totalSuccess} completed</span>
              <span>{totalFailed} failed</span>
            </div>
          </div>

          {/* Alert Volume Trend */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Alert Volume</span>
              <span className="text-sm font-bold">{totalAlerts}</span>
            </div>
            <div className="h-16">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={alertTrends}>
                  <defs>
                    <linearGradient id="alertGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(38, 92%, 50%)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(38, 92%, 50%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-popover border rounded-lg px-2 py-1 text-xs shadow-md">
                            <div>{payload[0].payload.date}</div>
                            <div className="text-amber-500">{payload[0].value} alerts</div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="hsl(38, 92%, 50%)"
                    fill="url(#alertGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="text-xs text-muted-foreground text-center">
              {alertTrends && alertTrends.length > 0 && 
                `Avg ${Math.round(totalAlerts / 7)}/day`
              }
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
