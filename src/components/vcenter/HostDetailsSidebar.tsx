import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { X, Server, RefreshCcw, Link2, Unlink, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";

interface VCenterHost {
  id: string;
  name: string;
  cluster: string | null;
  vcenter_id: string | null;
  serial_number: string | null;
  server_id: string | null;
  esxi_version: string | null;
  status: string | null;
  maintenance_mode: boolean | null;
  last_sync: string | null;
}

interface ClusterGroup {
  name: string;
  hosts: VCenterHost[];
}

interface HostDetailsSidebarProps {
  selectedHost: VCenterHost | null;
  selectedCluster: ClusterGroup | null;
  onClusterUpdate: (clusterName?: string) => void;
  onClose: () => void;
}

export function HostDetailsSidebar({
  selectedHost,
  selectedCluster,
  onClusterUpdate,
  onClose,
}: HostDetailsSidebarProps) {
  const navigate = useNavigate();

  if (selectedHost) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-lg">{selectedHost.name}</CardTitle>
              <CardDescription className="text-xs mt-1">
                {selectedHost.cluster || 'Unclustered'}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2 mt-2">
            {selectedHost.maintenance_mode ? (
              <Badge variant="destructive" className="text-xs">Maintenance Mode</Badge>
            ) : selectedHost.status === 'connected' ? (
              <Badge variant="default" className="bg-success text-success-foreground text-xs">Connected</Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">{selectedHost.status || 'Unknown'}</Badge>
            )}
            {selectedHost.server_id && (
              <Badge variant="secondary" className="text-xs">Linked</Badge>
            )}
          </div>
        </CardHeader>

        <Separator />

        <CardContent className="flex-1 overflow-auto pt-4 space-y-4">
          <div>
            <h4 className="text-sm font-semibold mb-3">System Information</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">ESXi Version:</span>
                <span className="font-medium">{selectedHost.esxi_version || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Serial Number:</span>
                <span className="font-medium font-mono text-xs">{selectedHost.serial_number || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">vCenter ID:</span>
                <span className="font-medium font-mono text-xs">{selectedHost.vcenter_id || 'N/A'}</span>
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="text-sm font-semibold mb-3">Connection</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <span className="font-medium capitalize">{selectedHost.status || 'Unknown'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Sync:</span>
                <span className="font-medium">
                  {selectedHost.last_sync 
                    ? formatDistanceToNow(new Date(selectedHost.last_sync), { addSuffix: true })
                    : 'Never'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Maintenance Mode:</span>
                <span className="font-medium">{selectedHost.maintenance_mode ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="text-sm font-semibold mb-3">Physical Server Linking</h4>
            {selectedHost.server_id ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="secondary" className="text-xs">✓ Linked</Badge>
                  <span className="text-muted-foreground">Mapped to physical server</span>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1"
                    onClick={() => navigate(`/servers`)}
                  >
                    <Server className="mr-2 h-3 w-3" />
                    View Server
                  </Button>
                  <Button variant="outline" size="sm">
                    <Unlink className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="outline" className="text-xs">✗ Unlinked</Badge>
                  <span className="text-muted-foreground">No physical mapping</span>
                </div>
                <Button variant="outline" size="sm" className="w-full">
                  <Link2 className="mr-2 h-3 w-3" />
                  Link to Server
                </Button>
              </div>
            )}
          </div>
        </CardContent>

        <Separator />

        <div className="p-4 space-y-2">
          <Button variant="outline" size="sm" className="w-full">
            <RefreshCcw className="mr-2 h-3 w-3" />
            Sync This Host
          </Button>
        </div>
      </Card>
    );
  }

  if (selectedCluster) {
    const linkedCount = selectedCluster.hosts.filter(h => h.server_id).length;
    const connectedCount = selectedCluster.hosts.filter(h => h.status === 'connected').length;
    const maintenanceCount = selectedCluster.hosts.filter(h => h.maintenance_mode).length;
    const linkPercentage = Math.round((linkedCount / selectedCluster.hosts.length) * 100);

    // Count ESXi versions
    const versionCounts = selectedCluster.hosts.reduce((acc, host) => {
      const version = host.esxi_version || 'Unknown';
      acc[version] = (acc[version] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-lg">{selectedCluster.name}</CardTitle>
              <CardDescription className="text-xs mt-1">
                {selectedCluster.hosts.length} ESXi Hosts
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <Separator />

        <CardContent className="flex-1 overflow-auto pt-4 space-y-4">
          <div>
            <h4 className="text-sm font-semibold mb-3">Cluster Summary</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Hosts:</span>
                <span className="font-medium">{selectedCluster.hosts.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Linked Hosts:</span>
                <span className="font-medium">
                  {linkedCount} ({linkPercentage}%)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Connected:</span>
                <span className="font-medium text-success">
                  {connectedCount} ({Math.round((connectedCount / selectedCluster.hosts.length) * 100)}%)
                </span>
              </div>
              {maintenanceCount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">In Maintenance:</span>
                  <span className="font-medium text-warning">{maintenanceCount}</span>
                </div>
              )}
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="text-sm font-semibold mb-3">ESXi Versions</h4>
            <div className="space-y-2">
              {Object.entries(versionCounts).map(([version, count]) => (
                <div key={version} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{version}:</span>
                  <Badge variant="secondary" className="text-xs">
                    {count} host{count !== 1 ? 's' : ''}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </CardContent>

        <Separator />

        <div className="p-4 space-y-2">
          <Button 
            variant="default" 
            size="sm" 
            className="w-full"
            onClick={() => onClusterUpdate(selectedCluster.name)}
            disabled={linkedCount < 2 || selectedCluster.name === "Unclustered"}
          >
            <RefreshCcw className="mr-2 h-3 w-3" />
            Rolling Cluster Update
          </Button>
          <Button variant="outline" size="sm" className="w-full">
            <ExternalLink className="mr-2 h-3 w-3" />
            View in Maintenance Planner
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-lg">vCenter Overview</CardTitle>
        <CardDescription>Select a host or cluster to view details</CardDescription>
      </CardHeader>

      <Separator />

      <CardContent className="flex-1 overflow-auto pt-4 space-y-4">
        <div>
          <h4 className="text-sm font-semibold mb-3">Quick Actions</h4>
          <div className="space-y-2">
            <Button variant="outline" size="sm" className="w-full justify-start">
              <RefreshCcw className="mr-2 h-3 w-3" />
              Sync All Hosts
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full justify-start"
              onClick={() => navigate('/maintenance-planner?tab=jobs')}
            >
              <ExternalLink className="mr-2 h-3 w-3" />
              View Sync Jobs
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
