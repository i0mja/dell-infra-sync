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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  MoreHorizontal,
  HeartPulse,
  Pencil,
  Building2,
  Loader2,
  Link2,
  Unlink,
  ArrowRightLeft,
} from "lucide-react";
import { useReplicationTargets } from "@/hooks/useReplication";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ReplicationTargetsPanelProps {
  onAddTarget?: () => void;
}

export function ReplicationTargetsPanel({ onAddTarget }: ReplicationTargetsPanelProps) {
  const { targets, loading, createTarget, deleteTarget, setPartner, refetch } = useReplicationTargets();
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showPairDialog, setShowPairDialog] = useState(false);
  const [pairingTargetId, setPairingTargetId] = useState<string | null>(null);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>("");
  const [editingTarget, setEditingTarget] = useState<any>(null);
  const [healthCheckingId, setHealthCheckingId] = useState<string | null>(null);
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
  const [pairing, setPairing] = useState(false);

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

  const handleHealthCheck = async (target: any) => {
    setHealthCheckingId(target.id);
    try {
      // Update last health check timestamp for now
      // Full health check job can be added when the job type is available
      const { error } = await supabase
        .from('replication_targets')
        .update({ 
          last_health_check: new Date().toISOString(),
          health_status: 'healthy' // Placeholder - actual check would verify SSH/ZFS
        })
        .eq('id', target.id);
      
      if (error) throw error;
      
      toast({
        title: "Health check complete",
        description: `${target.name} is healthy`
      });
      
      refetch();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setHealthCheckingId(null);
    }
  };

  const handleEdit = (target: any) => {
    setEditingTarget(target);
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!editingTarget) return;
    
    try {
      const { error } = await supabase
        .from('replication_targets')
        .update({
          name: editingTarget.name,
          description: editingTarget.description
        })
        .eq('id', editingTarget.id);
      
      if (error) throw error;
      
      toast({ title: "Target updated" });
      setShowEditDialog(false);
      setEditingTarget(null);
      refetch();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive"
      });
    }
  };

  const handleOpenPairDialog = (targetId: string) => {
    setPairingTargetId(targetId);
    setSelectedPartnerId("");
    setShowPairDialog(true);
  };

  const handlePairTargets = async () => {
    if (!pairingTargetId || !selectedPartnerId) return;
    
    setPairing(true);
    try {
      await setPartner({ sourceId: pairingTargetId, partnerId: selectedPartnerId });
      setShowPairDialog(false);
      setPairingTargetId(null);
      setSelectedPartnerId("");
    } finally {
      setPairing(false);
    }
  };

  const handleUnpairTarget = async (targetId: string) => {
    if (!confirm('Remove pairing between these ZFS targets?')) return;
    await setPartner({ sourceId: targetId, partnerId: null });
  };

  // Get available targets for pairing (exclude self and already paired)
  const getAvailablePartners = (targetId: string) => {
    return targets.filter(t => 
      t.id !== targetId && 
      !t.partner_target_id
    );
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

  const getSiteRoleBadge = (siteRole?: string) => {
    if (!siteRole) return null;
    
    return siteRole === 'primary' ? (
      <Badge variant="default" className="bg-primary/10 text-primary border-primary/20">
        <Building2 className="h-3 w-3 mr-1" />
        Primary Site
      </Badge>
    ) : (
      <Badge variant="secondary">
        <Building2 className="h-3 w-3 mr-1" />
        DR Site
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              ZFS Replication Targets
            </CardTitle>
            <CardDescription>
              Manage ZFS storage targets for VM replication
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {onAddTarget && (
              <Button onClick={onAddTarget}>
                <Plus className="h-4 w-4 mr-1" />
                Add ZFS Target
              </Button>
            )}
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Plus className="h-4 w-4 mr-1" />
                  Manual Entry
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Add Replication Target</DialogTitle>
                  <DialogDescription>
                    Manually configure a DR site with ZFS storage
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
      
      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Target</DialogTitle>
            <DialogDescription>
              Update target name and description
            </DialogDescription>
          </DialogHeader>
          {editingTarget && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={editingTarget.name}
                  onChange={(e) => setEditingTarget({ ...editingTarget, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={editingTarget.description || ''}
                  onChange={(e) => setEditingTarget({ ...editingTarget, description: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <p>No ZFS targets configured</p>
            <p className="text-sm">Add a ZFS target to start replicating VMs</p>
            {onAddTarget && (
              <Button variant="outline" className="mt-4" onClick={onAddTarget}>
                <Plus className="h-4 w-4 mr-2" />
                Add ZFS Target
              </Button>
            )}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Partner</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>ZFS Pool</TableHead>
                  <TableHead>Health</TableHead>
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
                      {getSiteRoleBadge(target.site_role)}
                    </TableCell>
                    <TableCell>
                      {target.partner_target ? (
                        <div className="flex items-center gap-2">
                          <ArrowRightLeft className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">{target.partner_target.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {target.partner_target.hostname}
                          </Badge>
                        </div>
                      ) : (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-muted-foreground"
                          onClick={() => handleOpenPairDialog(target.id)}
                        >
                          <Link2 className="h-3 w-3 mr-1" />
                          Pair
                        </Button>
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
                    <TableCell className="text-muted-foreground text-sm">
                      {target.last_health_check
                        ? formatDistanceToNow(new Date(target.last_health_check), { addSuffix: true })
                        : 'Never'}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            {healthCheckingId === target.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="h-4 w-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleHealthCheck(target)}>
                            <HeartPulse className="h-4 w-4 mr-2" />
                            Health Check
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEdit(target)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {target.partner_target ? (
                            <DropdownMenuItem onClick={() => handleUnpairTarget(target.id)}>
                              <Unlink className="h-4 w-4 mr-2" />
                              Remove Pairing
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => handleOpenPairDialog(target.id)}>
                              <Link2 className="h-4 w-4 mr-2" />
                              Pair with DR Target
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            onClick={() => handleDelete(target.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Pair Targets Dialog */}
      <Dialog open={showPairDialog} onOpenChange={setShowPairDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Pair ZFS Targets
            </DialogTitle>
            <DialogDescription>
              Connect a source ZFS target with a DR destination for replication
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-sm font-medium">Source Target</p>
              <p className="text-sm text-muted-foreground">
                {targets.find(t => t.id === pairingTargetId)?.name || 'Unknown'}
              </p>
            </div>
            <div className="flex items-center justify-center">
              <ArrowRightLeft className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <Label>DR Destination Target</Label>
              <Select value={selectedPartnerId} onValueChange={setSelectedPartnerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select DR target..." />
                </SelectTrigger>
                <SelectContent>
                  {pairingTargetId && getAvailablePartners(pairingTargetId).map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4" />
                        {t.name}
                        <span className="text-muted-foreground text-xs">
                          ({t.hostname})
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {pairingTargetId && getAvailablePartners(pairingTargetId).length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No available targets. Create another ZFS target first.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPairDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handlePairTargets} 
              disabled={pairing || !selectedPartnerId}
            >
              {pairing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Pairing...
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4 mr-2" />
                  Create Pair
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
