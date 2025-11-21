import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertTriangle, XCircle } from "lucide-react";

interface ClusterStatus {
  cluster: string;
  totalTargets: number;
  healthyTargets: number;
  isSafe: boolean;
  hasWarnings: boolean;
}

interface SafetyStatusTableProps {
  clusters: ClusterStatus[];
  serverGroups: any[];
}

export function SafetyStatusTable({ clusters, serverGroups }: SafetyStatusTableProps) {
  if (clusters.length === 0 && serverGroups.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-sm">No safety data available for this date</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {clusters.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Clusters</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cluster</TableHead>
                <TableHead className="text-right">Healthy</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clusters.map((cluster) => (
                <TableRow key={cluster.cluster}>
                  <TableCell className="font-medium">{cluster.cluster}</TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm">
                      {cluster.healthyTargets}/{cluster.totalTargets}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {cluster.isSafe ? (
                      <Badge variant="secondary" className="gap-1">
                        <CheckCircle className="h-3 w-3" />
                        SAFE
                      </Badge>
                    ) : cluster.hasWarnings ? (
                      <Badge variant="outline" className="gap-1 border-warning text-warning">
                        <AlertTriangle className="h-3 w-3" />
                        WARN
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <XCircle className="h-3 w-3" />
                        UNSAFE
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {serverGroups.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Server Groups</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group</TableHead>
                <TableHead className="text-right">Healthy</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {serverGroups.map((group: any) => (
                <TableRow key={group.id}>
                  <TableCell className="font-medium">{group.name}</TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm">
                      {group.healthyServers}/{group.totalServers}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {group.isSafe ? (
                      <Badge variant="secondary" className="gap-1">
                        <CheckCircle className="h-3 w-3" />
                        SAFE
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <XCircle className="h-3 w-3" />
                        UNSAFE
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
