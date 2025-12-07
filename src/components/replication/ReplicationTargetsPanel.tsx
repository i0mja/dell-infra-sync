import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Target, 
  Plus, 
  Trash2, 
  CheckCircle2,
  XCircle,
  AlertCircle,
  HardDrive,
  Server,
  Rocket,
  ChevronDown
} from "lucide-react";
import { useReplicationTargets } from "@/hooks/useReplication";
import { useZfsTemplates } from "@/hooks/useZfsTemplates";
import { formatDistanceToNow } from "date-fns";
import { DeployZfsTargetWizard } from "./DeployZfsTargetWizard";

export function ReplicationTargetsPanel() {
  const { targets, loading, createTarget, deleteTarget, refetch } = useReplicationTargets();
  const { templates } = useZfsTemplates();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeployWizard, setShowDeployWizard] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    hostname: "",
    port: "22",
    zfs_pool: "",
    zfs_dataset_prefix: "",
    ssh_username: ""
  });
  const [creating, setCreating] = useState(false);
  
  const hasTemplates = templates.length > 0;

  const handleCreate = async () => {
    if (!formData.name.trim() || !formData.hostname.trim() || !formData.zfs_pool.trim()) return;
    
    setCreating(true);
    try {
      await createTarget({
        name: formData.name,
        description: formData.description || undefined,
        hostname: formData.hostname,
        port: parseInt(formData.port) || 22,
        zfs_pool: formData.zfs_pool,
        zfs_dataset_prefix: formData.zfs_dataset_prefix || undefined,
        ssh_username: formData.ssh_username || undefined,
      });
      setShowCreateDialog(false);
      setFormData({
        name: "",
        description: "",
        hostname: "",
        port: "22",
        zfs_pool: "",
        zfs_dataset_prefix: "",
        ssh_username: ""
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this replication target?')) return;
    await deleteTarget(id);
  };

  const getHealthBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return (
          <Badge variant="outline" className="text-green-600 border-green-500/30">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Healthy
          </Badge>
        );
      case 'degraded':
        return (
          <Badge variant="outline" className="text-amber-600 border-amber-500/30">
            <AlertCircle className="h-3 w-3 mr-1" />
            Degraded
          </Badge>
        );
      case 'offline':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Offline
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            Unknown
          </Badge>
        );
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Replication Targets
            </CardTitle>
            <CardDescription>
              DR sites with ZFS storage for replicated data
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {hasTemplates && (
              <Button variant="outline" onClick={() => setShowDeployWizard(true)}>
                <Rocket className="h-4 w-4 mr-1" />
                Deploy from Template
              </Button>
            )}
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Target
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Add Replication Target</DialogTitle>
                <DialogDescription>
                  Configure a DR site with ZFS storage
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="target-name">Name</Label>
                    <Input
                      id="target-name"
                      placeholder="e.g., DR-Site-West"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="target-hostname">Hostname / IP</Label>
                    <Input
                      id="target-hostname"
                      placeholder="e.g., dr-storage.local"
                      value={formData.hostname}
                      onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="zfs-pool">ZFS Pool</Label>
                    <Input
                      id="zfs-pool"
                      placeholder="e.g., tank/replicated"
                      value={formData.zfs_pool}
                      onChange={(e) => setFormData({ ...formData, zfs_pool: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ssh-port">SSH Port</Label>
                    <Input
                      id="ssh-port"
                      type="number"
                      placeholder="22"
                      value={formData.port}
                      onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="ssh-user">SSH Username</Label>
                    <Input
                      id="ssh-user"
                      placeholder="e.g., zfsrepl"
                      value={formData.ssh_username}
                      onChange={(e) => setFormData({ ...formData, ssh_username: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dataset-prefix">Dataset Prefix</Label>
                    <Input
                      id="dataset-prefix"
                      placeholder="e.g., dr-vms"
                      value={formData.zfs_dataset_prefix}
                      onChange={(e) => setFormData({ ...formData, zfs_dataset_prefix: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="target-desc">Description</Label>
                  <Textarea
                    id="target-desc"
                    placeholder="Optional description..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleCreate} 
                  disabled={creating || !formData.name.trim() || !formData.hostname.trim() || !formData.zfs_pool.trim()}
                >
                  {creating ? 'Creating...' : 'Add Target'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </div>
      </CardHeader>
      
      {/* Deploy from Template Wizard */}
      <DeployZfsTargetWizard 
        open={showDeployWizard} 
        onOpenChange={setShowDeployWizard}
        onSuccess={() => {
          refetch();
          setShowDeployWizard(false);
        }}
      />
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : targets.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Target className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No replication targets configured</p>
            <p className="text-sm">Add a DR site with ZFS storage to start replicating</p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>ZFS Pool</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Check</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {targets.map((target) => (
                  <TableRow key={target.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-primary" />
                        {target.name}
                      </div>
                      {target.description && (
                        <p className="text-xs text-muted-foreground">{target.description}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Server className="h-3 w-3 text-muted-foreground" />
                        {target.hostname}:{target.port}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-3 w-3 text-muted-foreground" />
                        {target.zfs_pool}
                      </div>
                    </TableCell>
                    <TableCell>
                      {getHealthBadge(target.health_status)}
                    </TableCell>
                    <TableCell>
                      {target.is_active ? (
                        <Badge variant="outline" className="text-green-600 border-green-500/30">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {target.last_health_check
                        ? formatDistanceToNow(new Date(target.last_health_check), { addSuffix: true })
                        : 'Never'}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        onClick={() => handleDelete(target.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
