import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Server, Key, Wifi, WifiOff, Database, Shield } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Link } from "react-router-dom";

export const ServerCoverageWidget = () => {
  const { data: serverStats, isLoading: serversLoading } = useQuery({
    queryKey: ['server-coverage-stats'],
    queryFn: async () => {
      const { data: servers } = await supabase
        .from('servers')
        .select('id, connection_status, credential_set_id');
      
      if (!servers) return null;
      
      const total = servers.length;
      const withCredentials = servers.filter(s => s.credential_set_id).length;
      const online = servers.filter(s => s.connection_status === 'online').length;
      const offline = servers.filter(s => s.connection_status === 'offline').length;
      
      return { total, withCredentials, online, offline };
    }
  });

  const { data: backupStats, isLoading: backupsLoading } = useQuery({
    queryKey: ['backup-coverage-stats'],
    queryFn: async () => {
      const { count: totalServers } = await supabase
        .from('servers')
        .select('*', { count: 'exact', head: true });
      
      // Use any cast to avoid deep type instantiation issues with scp_backups
      const client = supabase as any;
      const { data: backupData } = await client
        .from('scp_backups')
        .select('server_id')
        .not('exported_at', 'is', null);
      
      const serversWithBackup = new Set((backupData || []).map((b: any) => b.server_id).filter(Boolean)).size;
      
      return { totalServers: totalServers || 0, serversWithBackup };
    }
  });

  const { data: firmwareStats, isLoading: firmwareLoading } = useQuery({
    queryKey: ['firmware-coverage-stats'],
    queryFn: async () => {
      const { data: servers } = await supabase
        .from('servers')
        .select('id, bios_version');
      
      if (!servers) return null;
      
      const total = servers.length;
      const tracked = servers.filter(s => s.bios_version).length;
      
      return { total, tracked };
    }
  });

  const isLoading = serversLoading || backupsLoading || firmwareLoading;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4" />
            Server Coverage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const stats = [
    {
      icon: Key,
      label: 'Credentials',
      value: serverStats?.withCredentials || 0,
      total: serverStats?.total || 0,
      color: 'text-blue-500',
      link: '/servers'
    },
    {
      icon: Wifi,
      label: 'Connectivity',
      value: serverStats?.online || 0,
      total: serverStats?.total || 0,
      color: 'text-green-500',
      subtext: serverStats?.offline ? `${serverStats.offline} offline` : undefined,
      link: '/servers'
    },
    {
      icon: Database,
      label: 'SCP Backups',
      value: backupStats?.serversWithBackup || 0,
      total: backupStats?.totalServers || 0,
      color: 'text-amber-500',
      link: '/servers'
    },
    {
      icon: Shield,
      label: 'Firmware Tracked',
      value: firmwareStats?.tracked || 0,
      total: firmwareStats?.total || 0,
      color: 'text-purple-500',
      link: '/servers'
    }
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Server className="h-4 w-4" />
          Server Coverage
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {stats.map(stat => {
          const percentage = stat.total > 0 ? Math.round((stat.value / stat.total) * 100) : 0;
          const Icon = stat.icon;
          
          return (
            <Link
              key={stat.label}
              to={stat.link}
              className="block p-2 rounded-md hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 text-sm">
                  <Icon className={`h-4 w-4 ${stat.color}`} />
                  <span>{stat.label}</span>
                </div>
                <span className="text-sm font-medium">
                  {stat.value}/{stat.total}
                </span>
              </div>
              <Progress value={percentage} className="h-1.5" />
              {stat.subtext && (
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <WifiOff className="h-3 w-3" />
                  {stat.subtext}
                </div>
              )}
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
};
