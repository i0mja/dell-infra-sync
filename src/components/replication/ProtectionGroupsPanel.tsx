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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Shield, 
  Plus, 
  Play, 
  Trash2, 
  Clock,
  Server,
  ChevronRight,
  CheckCircle2,
  HardDrive,
  Pencil,
  Pause,
  PlayCircle,
  AlertTriangle,
  XCircle,
  AlertCircle,
  ArrowRight,
  Target,
  Info,
} from "lucide-react";
import { useProtectionGroups, useProtectedVMs, useReplicationTargets, ProtectionGroup } from "@/hooks/useReplication";
import { useVCenters } from "@/hooks/useVCenters";
import { useAccessibleDatastores, AccessibleDatastore } from "@/hooks/useAccessibleDatastores";
import { formatDistanceToNow, differenceInDays } from "date-fns";
import { ProtectedVMsTable } from "./ProtectedVMsTable";
import { EditProtectionGroupDialog } from "./EditProtectionGroupDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "N/A";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1024) {
    return `${(gb / 1024).toFixed(1)} TB`;
  }
  return `${gb.toFixed(1)} GB`;
}

function StatusBadge({ group }: { group: ProtectionGroup }) {
  const status = group.status || (group.is_enabled ? 'meeting_sla' : 'paused');
  
  switch (status) {
    case 'meeting_sla':
      return (
        <Badge variant="outline" className="text-green-600 border-green-500/30">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Meeting SLA
        </Badge>
      );
    case 'not_meeting_sla':
      return (
        <Badge variant="outline" className="text-amber-600 border-amber-500/30">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Not Meeting SLA
        </Badge>
      );
    case 'paused':
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <Pause className="h-3 w-3 mr-1" />
          Paused
        </Badge>
      );
    case 'error':
      return (
        <Badge variant="outline" className="text-red-600 border-red-500/30">
          <XCircle className="h-3 w-3 mr-1" />
          Error
        </Badge>
      );
    case 'syncing':
      return (
        <Badge variant="outline" className="text-blue-600 border-blue-500/30">
          <Play className="h-3 w-3 mr-1 animate-pulse" />
          Syncing
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          {group.is_enabled ? 'Active' : 'Paused'}
        </Badge>
      );
  }
}

function PriorityBadge({ priority }: { priority?: string }) {
  switch (priority) {
    case 'critical':
      return <Badge className="bg-red-500 hover:bg-red-600">Critical</Badge>;
    case 'high':
      return <Badge className="bg-amber-500 hover:bg-amber-600">High</Badge>;
    case 'medium':
      return <Badge className="bg-blue-500 hover:bg-blue-600">Medium</Badge>;
    case 'low':
      return <Badge variant="secondary">Low</Badge>;
    default:
      return null;
  }
}

export function ProtectionGroupsPanel() {
  const { groups, loading, createGroup, updateGroup, deleteGroup, pauseGroup, runReplicationNow, refetch } = useProtectionGroups();
  const { targets: replicationTargets } = useReplicationTargets();
  const { vcenters } = useVCenters();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [runningReplication, setRunningReplication] = useState<string | null>(null);
  const [pausingGroup, setPausingGroup] = useState<string | null>(null);

  // Form state for new protection group
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    rpoMinutes: 60,
    // Source site
    sourceVCenterId: "",
    sourceDatastore: "",
    // DR site
    drVCenterId: "",
    drDatastore: "",
  });

  // Get datastores for source vCenter
  const { data: sourceDatastores = [], isLoading: loadingSourceDatastores } = useAccessibleDatastores(
    formData.sourceVCenterId || undefined
  );
  
  // Get datastores for DR vCenter
  const { data: drDatastores = [], isLoading: loadingDrDatastores } = useAccessibleDatastores(
    formData.drVCenterId || undefined
  );

  const { vms, loading: vmsLoading, refetch: refetchVMs, addVMs, removeVM, batchMigrate } = useProtectedVMs(
    selectedGroupId || undefined
  );

  const selectedGroup = groups.find(g => g.id === selectedGroupId);

  // Get linked targets from selected datastores
  const sourceDatastoreInfo = sourceDatastores.find(ds => ds.name === formData.sourceDatastore);
  const drDatastoreInfo = drDatastores.find(ds => ds.name === formData.drDatastore);
  const sourceTarget = sourceDatastoreInfo?.replication_target;
  const drTarget = drDatastoreInfo?.replication_target;

  // Filter DR vCenters (exclude source)
  const drVCenterOptions = vcenters.filter(vc => vc.id !== formData.sourceVCenterId);

  // Group source datastores by their linked ZFS target
  const sourceDatastoresByTarget = sourceDatastores.reduce<Record<string, AccessibleDatastore[]>>((acc, ds) => {
    const key = ds.replication_target?.name || '_unlinked';
    if (!acc[key]) acc[key] = [];
    acc[key].push(ds);
    return acc;
  }, {});

  // Group DR datastores by their linked ZFS target  
  const drDatastoresByTarget = drDatastores.reduce<Record<string, AccessibleDatastore[]>>((acc, ds) => {
    const key = ds.replication_target?.name || '_unlinked';
    if (!acc[key]) acc[key] = [];
    acc[key].push(ds);
    return acc;
  }, {});

  // Check if test is overdue
  const isTestOverdue = (group: ProtectionGroup): boolean => {
    if (!group.test_reminder_days || !group.last_test_at) return false;
    const daysSinceTest = differenceInDays(new Date(), new Date(group.last_test_at));
    return daysSinceTest > group.test_reminder_days;
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      rpoMinutes: 60,
      sourceVCenterId: "",
      sourceDatastore: "",
      drVCenterId: "",
      drDatastore: "",
    });
  };

  const handleCreate = async () => {
    if (!formData.name.trim() || !formData.sourceVCenterId || !formData.sourceDatastore) return;
    
    setCreating(true);
    try {
      await createGroup({
        name: formData.name,
        description: formData.description,
        protection_datastore: formData.sourceDatastore,
        source_vcenter_id: formData.sourceVCenterId,
        rpo_minutes: formData.rpoMinutes,
        target_id: sourceTarget?.id,
        dr_datastore: formData.drDatastore || undefined,
      });
      setShowCreateDialog(false);
      resetForm();
    } finally {
      setCreating(false);
    }
  };

  const handleRunNow = async (groupId: string) => {
    setRunningReplication(groupId);
    try {
      await runReplicationNow(groupId);
      await refetchVMs();
    } finally {
      setRunningReplication(null);
    }
  };

  const handlePauseToggle = async (group: ProtectionGroup) => {
    setPausingGroup(group.id);
    try {
      const isPaused = !!group.paused_at;
      await pauseGroup({ id: group.id, paused: !isPaused });
    } finally {
      setPausingGroup(null);
    }
  };

  const handleDelete = async (groupId: string) => {
    if (!confirm('Delete this protection group? All protected VMs will be removed.')) return;
    await deleteGroup(groupId);
    if (selectedGroupId === groupId) {
      setSelectedGroupId(null);
    }
  };

  const handleSaveEdit = async (id: string, updates: Partial<ProtectionGroup>, originalGroup?: ProtectionGroup) => {
    await updateGroup({ id, updates, originalGroup });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Protection Groups List */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Protection Groups
              </CardTitle>
              <CardDescription>
                Groups of VMs replicated together
              </CardDescription>
            </div>
            <Dialog open={showCreateDialog} onOpenChange={(open) => { setShowCreateDialog(open); if (!open) resetForm(); }}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  New
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    Create Protection Group
                  </DialogTitle>
                  <DialogDescription>
                    Configure source site (Point A) and DR site (Point B) for VM replication
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 py-4">
                  {/* Basic Info */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Group Name *</Label>
                      <Input
                        placeholder="e.g., Production Databases"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>RPO Target (minutes)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={1440}
                        value={formData.rpoMinutes}
                        onChange={(e) => setFormData({ ...formData, rpoMinutes: parseInt(e.target.value) || 60 })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea
                      placeholder="Optional description..."
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    />
                  </div>

                  {/* Source and DR Sites */}
                  <div className="grid md:grid-cols-2 gap-6 pt-4">
                    {/* Source Site (Point A) */}
                    <div className="space-y-4 p-4 border rounded-lg bg-primary/5">
                      <div className="flex items-center gap-2 pb-2 border-b">
                        <Badge className="bg-primary">A</Badge>
                        <span className="font-semibold">Source Site</span>
                      </div>
                      
                      <div className="space-y-2">
                        <Label>vCenter *</Label>
                        <Select 
                          value={formData.sourceVCenterId} 
                          onValueChange={(val) => setFormData({ 
                            ...formData, 
                            sourceVCenterId: val, 
                            sourceDatastore: "",
                            // Reset DR if it was same as new source
                            drVCenterId: formData.drVCenterId === val ? "" : formData.drVCenterId,
                            drDatastore: formData.drVCenterId === val ? "" : formData.drDatastore,
                          })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select source vCenter" />
                          </SelectTrigger>
                          <SelectContent>
                            {vcenters.map((vc) => (
                              <SelectItem key={vc.id} value={vc.id}>
                                <div className="flex items-center gap-2">
                                  <Server className="h-4 w-4" />
                                  {vc.name}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Protection Datastore *</Label>
                        <Select
                          value={formData.sourceDatastore}
                          onValueChange={(val) => setFormData({ ...formData, sourceDatastore: val })}
                          disabled={!formData.sourceVCenterId || loadingSourceDatastores}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={
                              !formData.sourceVCenterId 
                                ? "Select vCenter first" 
                                : loadingSourceDatastores 
                                  ? "Loading..." 
                                  : "Select datastore"
                            } />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(sourceDatastoresByTarget).map(([targetName, dsList]) => (
                              <div key={targetName}>
                                {targetName !== '_unlinked' && (
                                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1">
                                    <Target className="h-3 w-3" />
                                    {targetName}
                                  </div>
                                )}
                                {targetName === '_unlinked' && dsList.length > 0 && (
                                  <div className="px-2 py-1.5 text-xs font-medium text-amber-600 flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3" />
                                    Unlinked
                                  </div>
                                )}
                                {dsList.map((ds) => (
                                  <SelectItem key={ds.id} value={ds.name}>
                                    <div className="flex items-center gap-2">
                                      <HardDrive className="h-3 w-3" />
                                      <span>{ds.name}</span>
                                      <span className="text-xs text-muted-foreground">
                                        ({formatBytes(ds.free_bytes)})
                                      </span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </div>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Show linked ZFS target info */}
                      {sourceTarget && (
                        <div className="p-2 bg-muted/50 rounded text-xs space-y-1">
                          <div className="flex items-center gap-1">
                            <Target className="h-3 w-3 text-primary" />
                            <span className="font-medium">{sourceTarget.name}</span>
                          </div>
                          <div className="text-muted-foreground">
                            {sourceTarget.hostname} • {sourceTarget.zfs_pool}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* DR Site (Point B) */}
                    <div className="space-y-4 p-4 border rounded-lg bg-secondary/30">
                      <div className="flex items-center gap-2 pb-2 border-b">
                        <Badge variant="secondary">B</Badge>
                        <span className="font-semibold">DR Site (Recovery)</span>
                      </div>
                      
                      <div className="space-y-2">
                        <Label>vCenter</Label>
                        <Select 
                          value={formData.drVCenterId} 
                          onValueChange={(val) => setFormData({ 
                            ...formData, 
                            drVCenterId: val, 
                            drDatastore: "" 
                          })}
                          disabled={!formData.sourceVCenterId}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={
                              !formData.sourceVCenterId 
                                ? "Select source first" 
                                : "Select DR vCenter"
                            } />
                          </SelectTrigger>
                          <SelectContent>
                            {drVCenterOptions.map((vc) => (
                              <SelectItem key={vc.id} value={vc.id}>
                                <div className="flex items-center gap-2">
                                  <Server className="h-4 w-4" />
                                  {vc.name}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>DR Datastore</Label>
                        <Select
                          value={formData.drDatastore}
                          onValueChange={(val) => setFormData({ ...formData, drDatastore: val })}
                          disabled={!formData.drVCenterId || loadingDrDatastores}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={
                              !formData.drVCenterId 
                                ? "Select DR vCenter first" 
                                : loadingDrDatastores 
                                  ? "Loading..." 
                                  : "Select datastore"
                            } />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(drDatastoresByTarget).map(([targetName, dsList]) => (
                              <div key={targetName}>
                                {targetName !== '_unlinked' && (
                                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1">
                                    <Target className="h-3 w-3" />
                                    {targetName}
                                  </div>
                                )}
                                {targetName === '_unlinked' && dsList.length > 0 && (
                                  <div className="px-2 py-1.5 text-xs font-medium text-amber-600 flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3" />
                                    Unlinked
                                  </div>
                                )}
                                {dsList.map((ds) => (
                                  <SelectItem key={ds.id} value={ds.name}>
                                    <div className="flex items-center gap-2">
                                      <HardDrive className="h-3 w-3" />
                                      <span>{ds.name}</span>
                                      <span className="text-xs text-muted-foreground">
                                        ({formatBytes(ds.free_bytes)})
                                      </span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </div>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Show linked ZFS target info */}
                      {drTarget && (
                        <div className="p-2 bg-muted/50 rounded text-xs space-y-1">
                          <div className="flex items-center gap-1">
                            <Target className="h-3 w-3 text-primary" />
                            <span className="font-medium">{drTarget.name}</span>
                          </div>
                          <div className="text-muted-foreground">
                            {drTarget.hostname} • {drTarget.zfs_pool}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Replication Flow Visualization */}
                  {formData.sourceDatastore && formData.drDatastore && (
                    <div className="flex items-center justify-center gap-4 py-3 px-4 bg-muted/50 rounded-lg">
                      <div className="text-center">
                        <div className="text-sm font-medium">{formData.sourceDatastore}</div>
                        <div className="text-xs text-muted-foreground">
                          {vcenters.find(v => v.id === formData.sourceVCenterId)?.name}
                        </div>
                        {sourceTarget && (
                          <div className="text-xs text-primary">{sourceTarget.name}</div>
                        )}
                      </div>
                      <ArrowRight className="h-5 w-5 text-muted-foreground" />
                      <div className="text-center">
                        <div className="text-sm font-medium">{formData.drDatastore}</div>
                        <div className="text-xs text-muted-foreground">
                          {vcenters.find(v => v.id === formData.drVCenterId)?.name}
                        </div>
                        {drTarget && (
                          <div className="text-xs text-primary">{drTarget.name}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Warnings */}
                  {formData.sourceDatastore && !sourceTarget && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-sm">
                        Source datastore is not linked to a ZFS appliance. Link it in ZFS Targets for automatic replication.
                      </AlertDescription>
                    </Alert>
                  )}

                  {sourceTarget && drTarget && sourceTarget.partner_target_id !== drTarget.id && (
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription className="text-sm">
                        Source and DR ZFS targets are not paired. Pair them in ZFS Targets for optimal configuration.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleCreate} 
                    disabled={creating || !formData.name.trim() || !formData.sourceVCenterId || !formData.sourceDatastore}
                  >
                    {creating ? 'Creating...' : 'Create Protection Group'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Shield className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No protection groups</p>
              <p className="text-sm">Create your first group to start protecting VMs</p>
            </div>
          ) : (
            <div className="space-y-2">
              {groups.map((group) => (
                <div
                  key={group.id}
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedGroupId === group.id 
                      ? 'border-primary bg-primary/5' 
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setSelectedGroupId(group.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-primary" />
                      <span className="font-medium">{group.name}</span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge variant="secondary">
                      <Server className="h-3 w-3 mr-1" />
                      {group.vm_count || 0} VMs
                    </Badge>
                    <StatusBadge group={group} />
                    <PriorityBadge priority={group.priority} />
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      RPO: {group.rpo_minutes}m
                      {group.current_rpo_seconds && (
                        <span className="ml-1">
                          (actual: {Math.round(group.current_rpo_seconds / 60)}m)
                        </span>
                      )}
                    </span>
                    {group.last_replication_at && (
                      <span>
                        {formatDistanceToNow(new Date(group.last_replication_at), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                  {isTestOverdue(group) && (
                    <div className="flex items-center gap-1 mt-2 text-xs text-amber-600">
                      <AlertCircle className="h-3 w-3" />
                      Test overdue ({differenceInDays(new Date(), new Date(group.last_test_at!))} days)
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Protected VMs Detail */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                {selectedGroup ? selectedGroup.name : 'Protected VMs'}
              </CardTitle>
              <CardDescription>
                {selectedGroup 
                  ? `${vms.length} VMs in this protection group`
                  : 'Select a protection group to view its VMs'}
              </CardDescription>
            </div>
            {selectedGroup && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowEditDialog(true)}
                >
                  <Pencil className="h-4 w-4 mr-1" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handlePauseToggle(selectedGroup)}
                  disabled={pausingGroup === selectedGroup.id}
                >
                  {selectedGroup.paused_at ? (
                    <>
                      <PlayCircle className="h-4 w-4 mr-1" />
                      Resume
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4 mr-1" />
                      Pause
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRunNow(selectedGroup.id)}
                  disabled={runningReplication === selectedGroup.id || vms.length === 0 || !!selectedGroup.paused_at}
                >
                  <Play className={`h-4 w-4 mr-1 ${runningReplication === selectedGroup.id ? 'animate-pulse' : ''}`} />
                  {runningReplication === selectedGroup.id ? 'Running...' : 'Run Now'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => handleDelete(selectedGroup.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!selectedGroup ? (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Select a protection group to manage its VMs</p>
            </div>
          ) : (
            <ProtectedVMsTable
              vms={vms}
              loading={vmsLoading}
              onAddVMs={addVMs}
              onRemoveVM={removeVM}
              onBatchMigrate={batchMigrate}
              protectionDatastore={selectedGroup.protection_datastore}
              sourceVCenterId={selectedGroup.source_vcenter_id || undefined}
              onRefresh={refetchVMs}
            />
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <EditProtectionGroupDialog
        group={selectedGroup || null}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onSave={handleSaveEdit}
      />
    </div>
  );
}
