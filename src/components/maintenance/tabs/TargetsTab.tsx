import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Server, Users, Box, Edit } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface TargetsTabProps {
  window: any;
  onEdit?: () => void;
  canEdit?: boolean;
}

export function TargetsTab({ window, onEdit, canEdit }: TargetsTabProps) {
  const { data: servers } = useQuery({
    queryKey: ['maintenance-window-servers', window.id],
    queryFn: async () => {
      const serverIds = window.server_ids || window.details?.server_ids || [];
      if (serverIds.length === 0) return [];
      
      const { data } = await supabase
        .from('servers')
        .select('id, ip_address, hostname, model, service_tag, overall_health')
        .in('id', serverIds);
      
      return data || [];
    },
    enabled: !!(window.server_ids?.length || window.details?.server_ids?.length)
  });

  const { data: clusters } = useQuery({
    queryKey: ['maintenance-window-clusters', window.id],
    queryFn: async () => {
      if (!window.cluster_ids || window.cluster_ids.length === 0) return [];
      
      const { data } = await supabase
        .from('vcenter_clusters')
        .select('id, cluster_name, host_count, vm_count, overall_status')
        .in('cluster_name', window.cluster_ids);
      
      return data || [];
    },
    enabled: !!window.cluster_ids?.length
  });

  const { data: serverGroups } = useQuery({
    queryKey: ['maintenance-window-groups', window.id],
    queryFn: async () => {
      if (!window.server_group_ids || window.server_group_ids.length === 0) return [];
      
      const { data } = await supabase
        .from('server_groups')
        .select(`
          id, 
          name, 
          description,
          server_group_members(count)
        `)
        .in('id', window.server_group_ids);
      
      return data || [];
    },
    enabled: !!window.server_group_ids?.length
  });

  const getHealthBadge = (health: string | null) => {
    if (!health) return <Badge variant="outline">Unknown</Badge>;
    
    const colors: Record<string, string> = {
      'OK': 'bg-green-500/10 text-green-500 border-green-500/20',
      'Warning': 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
      'Critical': 'bg-red-500/10 text-red-500 border-red-500/20'
    };
    
    return <Badge className={colors[health] || ''}>{health}</Badge>;
  };

  return (
    <div className="space-y-4">
      {canEdit && onEdit && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Edit className="mr-2 h-4 w-4" />
            Edit Targets
          </Button>
        </div>
      )}

      {servers && servers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="w-4 h-4" />
              Servers ({servers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Hostname</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Service Tag</TableHead>
                  <TableHead>Health</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {servers.map((server) => (
                  <TableRow key={server.id}>
                    <TableCell className="font-mono text-sm">
                      {server.ip_address}
                    </TableCell>
                    <TableCell>{server.hostname || '-'}</TableCell>
                    <TableCell>{server.model || '-'}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {server.service_tag || '-'}
                    </TableCell>
                    <TableCell>{getHealthBadge(server.overall_health)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {clusters && clusters.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Box className="w-4 h-4" />
              Clusters ({clusters.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cluster Name</TableHead>
                  <TableHead>Hosts</TableHead>
                  <TableHead>VMs</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clusters.map((cluster) => (
                  <TableRow key={cluster.id}>
                    <TableCell className="font-medium">
                      {cluster.cluster_name}
                    </TableCell>
                    <TableCell>{cluster.host_count || 0}</TableCell>
                    <TableCell>{cluster.vm_count || 0}</TableCell>
                    <TableCell>{getHealthBadge(cluster.overall_status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {serverGroups && serverGroups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4" />
              Server Groups ({serverGroups.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Members</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {serverGroups.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell className="font-medium">{group.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {group.description || '-'}
                    </TableCell>
                    <TableCell>
                      {(group as any).server_group_members?.[0]?.count || 0} servers
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!servers?.length && !clusters?.length && !serverGroups?.length && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No targets configured for this maintenance window
          </CardContent>
        </Card>
      )}
    </div>
  );
}
