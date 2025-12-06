import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  RefreshCw, 
  Server, 
  Search, 
  CheckCircle2, 
  XCircle,
  MonitorPlay,
  Cpu,
  HardDrive
} from "lucide-react";
import { useReplicationVCenters, useVCenterVMs } from "@/hooks/useReplication";
import { formatDistanceToNow } from "date-fns";

export function VCenterPanel() {
  const { vcenters, loading, syncVCenter } = useReplicationVCenters();
  const [selectedVCenterId, setSelectedVCenterId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [vmSearch, setVmSearch] = useState("");
  
  const { vms, loading: vmsLoading } = useVCenterVMs(selectedVCenterId || undefined);

  const handleSync = async (id: string) => {
    setSyncing(id);
    try {
      await syncVCenter(id);
    } finally {
      setSyncing(null);
    }
  };

  const filteredVMs = vms.filter(vm => 
    vm.name.toLowerCase().includes(vmSearch.toLowerCase()) ||
    vm.guest_os?.toLowerCase().includes(vmSearch.toLowerCase())
  );

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* vCenter List */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            vCenter Connections
          </CardTitle>
          <CardDescription>
            Available vCenter servers for DR protection
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : vcenters.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Server className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No vCenter connections found</p>
              <p className="text-sm">Configure vCenters in Settings → Infrastructure</p>
            </div>
          ) : (
            <div className="space-y-2">
              {vcenters.map((vc) => (
                <div
                  key={vc.id}
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedVCenterId === vc.id 
                      ? 'border-primary bg-primary/5' 
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setSelectedVCenterId(vc.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{vc.host}</span>
                    </div>
                    {vc.sync_enabled ? (
                      <Badge variant="outline" className="text-green-600 border-green-500/30">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Connected
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        <XCircle className="h-3 w-3 mr-1" />
                        Disabled
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-muted-foreground">
                      {vc.last_sync 
                        ? `Synced ${formatDistanceToNow(new Date(vc.last_sync), { addSuffix: true })}`
                        : 'Never synced'}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSync(vc.id);
                      }}
                      disabled={syncing === vc.id}
                    >
                      <RefreshCw className={`h-3 w-3 ${syncing === vc.id ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* VM Inventory */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MonitorPlay className="h-5 w-5" />
                VM Inventory
              </CardTitle>
              <CardDescription>
                {selectedVCenterId 
                  ? `${filteredVMs.length} VMs available for protection`
                  : 'Select a vCenter to view VMs'}
              </CardDescription>
            </div>
            {selectedVCenterId && (
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search VMs..."
                  value={vmSearch}
                  onChange={(e) => setVmSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!selectedVCenterId ? (
            <div className="text-center py-12 text-muted-foreground">
              <MonitorPlay className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Select a vCenter to view its VM inventory</p>
            </div>
          ) : vmsLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredVMs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MonitorPlay className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No VMs found</p>
              <p className="text-sm">Sync the vCenter to populate VM inventory</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>VM Name</TableHead>
                    <TableHead>Power</TableHead>
                    <TableHead>Guest OS</TableHead>
                    <TableHead>Resources</TableHead>
                    <TableHead>Cluster</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVMs.slice(0, 20).map((vm) => (
                    <TableRow key={vm.id}>
                      <TableCell className="font-medium">{vm.name}</TableCell>
                      <TableCell>
                        <Badge 
                          variant={vm.power_state === 'poweredOn' ? 'default' : 'secondary'}
                          className={vm.power_state === 'poweredOn' ? 'bg-green-500' : ''}
                        >
                          {vm.power_state === 'poweredOn' ? 'On' : 'Off'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {vm.guest_os || 'Unknown'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Cpu className="h-3 w-3" />
                            {vm.cpu_count || 0}
                          </span>
                          <span className="flex items-center gap-1">
                            <HardDrive className="h-3 w-3" />
                            {Math.round((vm.memory_mb || 0) / 1024)}GB
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {vm.cluster_name || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
