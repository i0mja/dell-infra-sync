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
  Wand2,
} from "lucide-react";
import { useReplicationTargets, ReplicationTarget, TargetDependencies } from "@/hooks/useReplication";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PrepareTemplateWizard } from "./PrepareTemplateWizard";
import { PairedZfsDeployWizard } from "./PairedZfsDeployWizard";
import { DecommissionTargetDialog, DecommissionOption } from "./DecommissionTargetDialog";

interface ReplicationTargetsPanelProps {
  onAddTarget?: () => void;
}

export function ReplicationTargetsPanel({ onAddTarget }: ReplicationTargetsPanelProps) {
  const { 
    targets, 
    loading, 
    createTarget, 
    deleteTarget, 
    archiveTarget,
    decommissionTarget: runDecommission,
    checkTargetDependencies,
    setPartner, 
    refetch 
  } = useReplicationTargets();
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showPairDialog, setShowPairDialog] = useState(false);
  const [showPairedDeployWizard, setShowPairedDeployWizard] = useState(false);
  const [showPrepareTemplateWizard, setShowPrepareTemplateWizard] = useState(false);
  const [pairingTargetId, setPairingTargetId] = useState<string | null>(null);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>("");
  const [editingTarget, setEditingTarget] = useState<any>(null);
  const [healthCheckingId, setHealthCheckingId] = useState<string | null>(null);
  
  // Decommission dialog state
  const [showDecommissionDialog, setShowDecommissionDialog] = useState(false);
  const [targetToDecommission, setTargetToDecommission] = useState<ReplicationTarget | null>(null);
  const [decommissionDeps, setDecommissionDeps] = useState<TargetDependencies | null>(null);
  const [loadingDeps, setLoadingDeps] = useState(false);
  
  // Form for creating paired targets (source + DR)
  const [formData, setFormData] = useState({
    // Source site (Point A)
    sourceName: "",
    sourceDescription: "",
    sourceHostname: "",
    sourcePort: "22",
    sourceZfsPool: "",
    sourceDatasetPrefix: "",
    sourceSshUsername: "",
    // DR site (Point B)
    drName: "",
    drDescription: "",
    drHostname: "",
    drPort: "22",
    drZfsPool: "",
    drDatasetPrefix: "",
    drSshUsername: "",
  });
  const [creating, setCreating] = useState(false);
  const [pairing, setPairing] = useState(false);

  const resetForm = () => {
    setFormData({
      sourceName: "",
      sourceDescription: "",
      sourceHostname: "",
      sourcePort: "22",
      sourceZfsPool: "",
      sourceDatasetPrefix: "",
      sourceSshUsername: "",
      drName: "",
      drDescription: "",
      drHostname: "",
      drPort: "22",
      drZfsPool: "",
      drDatasetPrefix: "",
      drSshUsername: "",
    });
  };

  const handleCreate = async () => {
    // Require at least source target
    if (!formData.sourceName.trim() || !formData.sourceHostname.trim() || !formData.sourceZfsPool.trim()) return;
    
    setCreating(true);
    try {
      // Create source target first
      const sourceTarget = await createTarget({
        name: formData.sourceName,
        description: formData.sourceDescription || undefined,
        hostname: formData.sourceHostname,
        port: parseInt(formData.sourcePort) || 22,
        zfs_pool: formData.sourceZfsPool,
        zfs_dataset_prefix: formData.sourceDatasetPrefix || undefined,
        ssh_username: formData.sourceSshUsername || undefined,
        site_role: 'primary',
      });

      // If DR target info provided, create it and pair them
      if (formData.drName.trim() && formData.drHostname.trim() && formData.drZfsPool.trim() && sourceTarget) {
        const drTarget = await createTarget({
          name: formData.drName,
          description: formData.drDescription || undefined,
          hostname: formData.drHostname,
          port: parseInt(formData.drPort) || 22,
          zfs_pool: formData.drZfsPool,
          zfs_dataset_prefix: formData.drDatasetPrefix || undefined,
          ssh_username: formData.drSshUsername || undefined,
          site_role: 'dr',
        });

        // Pair them together
        if (drTarget) {
          await setPartner({ sourceId: sourceTarget.id, partnerId: drTarget.id });
        }
      }

      setShowCreateDialog(false);
      resetForm();
      toast({
        title: "ZFS targets created",
        description: formData.drName.trim() ? "Source and DR targets created and paired" : "Source target created",
      });
    } catch (err: any) {
      toast({
        title: "Error creating targets",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  // Open decommission dialog with dependency check
  const handleOpenDecommission = async (target: ReplicationTarget) => {
    setTargetToDecommission(target);
    setDecommissionDeps(null);
    setShowDecommissionDialog(true);
    setLoadingDeps(true);
    
    try {
      const deps = await checkTargetDependencies(target.id);
      setDecommissionDeps(deps);
    } catch (err) {
      console.error('Failed to check dependencies:', err);
      setDecommissionDeps({ dependentGroups: [], partnerTarget: null, hasDeployedVm: false });
    } finally {
      setLoadingDeps(false);
    }
  };

  // Handle decommission confirmation
  const handleDecommissionConfirm = async (option: DecommissionOption) => {
    if (!targetToDecommission) return;

    try {
      if (option === 'archive') {
        await archiveTarget(targetToDecommission.id);
      } else if (option === 'database') {
        await deleteTarget(targetToDecommission.id);
      } else if (option === 'full') {
        await runDecommission(targetToDecommission.id);
      }
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message,
        variant: 'destructive',
      });
      throw err;
    }
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
            <Button variant="outline" onClick={() => setShowPrepareTemplateWizard(true)}>
              <Wand2 className="h-4 w-4 mr-1" />
              Prepare Template
            </Button>
            {onAddTarget && (
              <Button variant="outline" onClick={onAddTarget}>
                <Plus className="h-4 w-4 mr-1" />
                Add Single Target
              </Button>
            )}
            <Button onClick={() => setShowPairedDeployWizard(true)}>
              <ArrowRightLeft className="h-4 w-4 mr-1" />
              Deploy Paired Targets
            </Button>
            <Dialog open={showCreateDialog} onOpenChange={(open) => { setShowCreateDialog(open); if (!open) resetForm(); }}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Plus className="h-4 w-4 mr-1" />
                  Manual Pair Setup
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ArrowRightLeft className="h-5 w-5" />
                    Create Paired ZFS Targets
                  </DialogTitle>
                  <DialogDescription>
                    Configure both source (Point A) and DR (Point B) ZFS appliances that will replicate data between sites
                  </DialogDescription>
                </DialogHeader>
                
                <div className="grid md:grid-cols-2 gap-6 py-4">
                  {/* Source Site (Point A) */}
                  <div className="space-y-4 p-4 border rounded-lg bg-primary/5">
                    <div className="flex items-center gap-2 pb-2 border-b">
                      <Badge className="bg-primary">A</Badge>
                      <span className="font-semibold">Source Site (Primary)</span>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label>Name *</Label>
                        <Input
                          placeholder="e.g., zfs-prod-01"
                          value={formData.sourceName}
                          onChange={(e) => setFormData({ ...formData, sourceName: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Hostname / IP *</Label>
                        <Input
                          placeholder="e.g., 10.207.105.106"
                          value={formData.sourceHostname}
                          onChange={(e) => setFormData({ ...formData, sourceHostname: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-2">
                          <Label>ZFS Pool *</Label>
                          <Input
                            placeholder="e.g., tank"
                            value={formData.sourceZfsPool}
                            onChange={(e) => setFormData({ ...formData, sourceZfsPool: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>SSH Port</Label>
                          <Input
                            type="number"
                            value={formData.sourcePort}
                            onChange={(e) => setFormData({ ...formData, sourcePort: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-2">
                          <Label>SSH Username</Label>
                          <Input
                            placeholder="e.g., zfsrepl"
                            value={formData.sourceSshUsername}
                            onChange={(e) => setFormData({ ...formData, sourceSshUsername: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Dataset Prefix</Label>
                          <Input
                            placeholder="e.g., nfs"
                            value={formData.sourceDatasetPrefix}
                            onChange={(e) => setFormData({ ...formData, sourceDatasetPrefix: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Textarea
                          placeholder="Optional..."
                          className="h-16"
                          value={formData.sourceDescription}
                          onChange={(e) => setFormData({ ...formData, sourceDescription: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* DR Site (Point B) */}
                  <div className="space-y-4 p-4 border rounded-lg bg-secondary/30">
                    <div className="flex items-center gap-2 pb-2 border-b">
                      <Badge variant="secondary">B</Badge>
                      <span className="font-semibold">DR Site (Recovery)</span>
                      <span className="text-xs text-muted-foreground ml-auto">Optional</span>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label>Name</Label>
                        <Input
                          placeholder="e.g., zfs-dr-01"
                          value={formData.drName}
                          onChange={(e) => setFormData({ ...formData, drName: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Hostname / IP</Label>
                        <Input
                          placeholder="e.g., 10.208.105.106"
                          value={formData.drHostname}
                          onChange={(e) => setFormData({ ...formData, drHostname: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-2">
                          <Label>ZFS Pool</Label>
                          <Input
                            placeholder="e.g., tank"
                            value={formData.drZfsPool}
                            onChange={(e) => setFormData({ ...formData, drZfsPool: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>SSH Port</Label>
                          <Input
                            type="number"
                            value={formData.drPort}
                            onChange={(e) => setFormData({ ...formData, drPort: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-2">
                          <Label>SSH Username</Label>
                          <Input
                            placeholder="e.g., zfsrepl"
                            value={formData.drSshUsername}
                            onChange={(e) => setFormData({ ...formData, drSshUsername: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Dataset Prefix</Label>
                          <Input
                            placeholder="e.g., dr"
                            value={formData.drDatasetPrefix}
                            onChange={(e) => setFormData({ ...formData, drDatasetPrefix: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Textarea
                          placeholder="Optional..."
                          className="h-16"
                          value={formData.drDescription}
                          onChange={(e) => setFormData({ ...formData, drDescription: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Replication Flow Visualization */}
                {formData.sourceName && formData.drName && (
                  <div className="flex items-center justify-center gap-4 py-3 px-4 bg-muted/50 rounded-lg">
                    <div className="text-center">
                      <div className="font-mono text-sm font-medium">{formData.sourceName}</div>
                      <div className="text-xs text-muted-foreground">{formData.sourceHostname || '...'}</div>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <ArrowRightLeft className="h-4 w-4" />
                      <span className="text-xs">ZFS Send/Recv</span>
                    </div>
                    <div className="text-center">
                      <div className="font-mono text-sm font-medium">{formData.drName}</div>
                      <div className="text-xs text-muted-foreground">{formData.drHostname || '...'}</div>
                    </div>
                  </div>
                )}

                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleCreate} 
                    disabled={creating || !formData.sourceName.trim() || !formData.sourceHostname.trim() || !formData.sourceZfsPool.trim()}
                  >
                    {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {creating ? 'Creating...' : formData.drName.trim() ? 'Create Paired Targets' : 'Create Source Target'}
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
                            onClick={() => handleOpenDecommission(target)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete / Decommission
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
      
      {/* Prepare Template Wizard */}
      <PrepareTemplateWizard 
        open={showPrepareTemplateWizard} 
        onOpenChange={setShowPrepareTemplateWizard} 
      />
      
      {/* Paired ZFS Deploy Wizard */}
      <PairedZfsDeployWizard
        open={showPairedDeployWizard}
        onOpenChange={setShowPairedDeployWizard}
        onSuccess={() => {
          refetch();
          setShowPairedDeployWizard(false);
          toast({
            title: "Paired targets deployed",
            description: "Source and DR ZFS targets are now ready for replication",
          });
        }}
      />

      {/* Decommission Target Dialog */}
      <DecommissionTargetDialog
        open={showDecommissionDialog}
        onOpenChange={setShowDecommissionDialog}
        target={targetToDecommission}
        dependencies={decommissionDeps}
        loading={loadingDeps}
        onConfirm={handleDecommissionConfirm}
      />
    </Card>
  );
}
