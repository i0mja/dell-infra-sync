import { Card, CardContent } from "@/components/ui/card";
import { Shield, Server, Target, Activity, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface ReplicationStatsBarProps {
  protectionGroupsCount: number;
  protectedVMsCount: number;
  activeTargetsCount: number;
  totalTargetsCount: number;
  runningJobsCount: number;
  recentFailuresCount: number;
  loading?: boolean;
}

export function ReplicationStatsBar({
  protectionGroupsCount,
  protectedVMsCount,
  activeTargetsCount,
  totalTargetsCount,
  runningJobsCount,
  recentFailuresCount,
  loading
}: ReplicationStatsBarProps) {
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const stats = [
    {
      label: "Protection Groups",
      value: protectionGroupsCount,
      subValue: `${protectedVMsCount} VMs`,
      icon: Shield,
      color: "text-blue-500"
    },
    {
      label: "DR Targets",
      value: `${activeTargetsCount}/${totalTargetsCount}`,
      subValue: "Healthy",
      icon: Target,
      color: activeTargetsCount > 0 ? "text-green-500" : "text-muted-foreground"
    },
    {
      label: "Running Jobs",
      value: runningJobsCount,
      subValue: "In progress",
      icon: Activity,
      color: runningJobsCount > 0 ? "text-amber-500" : "text-muted-foreground"
    },
    {
      label: "Recent Failures",
      value: recentFailuresCount,
      subValue: "Last 24h",
      icon: AlertTriangle,
      color: recentFailuresCount > 0 ? "text-destructive" : "text-green-500"
    }
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat, index) => (
        <Card key={index}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.subValue}</p>
              </div>
              <stat.icon className={`h-8 w-8 ${stat.color}`} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
