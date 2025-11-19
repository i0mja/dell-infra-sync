import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer, ReferenceArea } from "recharts";
import { format } from "date-fns";
import { TrendingUp } from "lucide-react";

interface ClusterSafetyTrendChartProps {
  data: {
    date: string;
    [cluster: string]: number | string;
  }[];
  clusters: string[];
  maintenanceWindows?: {
    id: string;
    title: string;
    planned_start: string;
    planned_end: string;
  }[];
}

const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))'
];

export function ClusterSafetyTrendChart({ 
  data, 
  clusters,
  maintenanceWindows = []
}: ClusterSafetyTrendChartProps) {
  
  const chartConfig = Object.fromEntries(
    clusters.map((cluster, idx) => [
      cluster,
      { 
        label: cluster, 
        color: CHART_COLORS[idx % CHART_COLORS.length]
      }
    ])
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Cluster Safety Trends
        </CardTitle>
        <CardDescription>
          Historical view of cluster health over time (100 = safe, 0 = unsafe)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(value) => format(new Date(value), 'MMM dd')}
                className="text-xs"
              />
              <YAxis 
                domain={[0, 100]}
                label={{ value: 'Safety Score', angle: -90, position: 'insideLeft' }}
                className="text-xs"
              />
              <ChartTooltip 
                content={<ChartTooltipContent />}
                labelFormatter={(value) => format(new Date(value), 'MMM dd, yyyy')}
              />
              <Legend />
              
              {/* Maintenance windows as vertical bands */}
              {maintenanceWindows.map((window, idx) => (
                <ReferenceArea
                  key={window.id}
                  x1={format(new Date(window.planned_start), 'yyyy-MM-dd')}
                  x2={format(new Date(window.planned_end), 'yyyy-MM-dd')}
                  fill="hsl(var(--primary))"
                  fillOpacity={0.1}
                  label={{
                    value: window.title,
                    position: 'top',
                    fontSize: 10
                  }}
                />
              ))}
              
              {clusters.map((cluster, idx) => (
                <Line 
                  key={cluster}
                  type="monotone"
                  dataKey={cluster}
                  stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
