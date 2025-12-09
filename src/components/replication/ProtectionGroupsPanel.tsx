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
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [newGroupDatastore, setNewGroupDatastore] = useState("");
  const [newGroupRpoMinutes, setNewGroupRpoMinutes] = useState(60);
  const [selectedVCenterId, setSelectedVCenterId] = useState("");
  const [creating, setCreating] = useState(false);
  const [runningReplication, setRunningReplication] = useState<string | null>(null);
  const [pausingGroup, setPausingGroup] = useState<string | null>(null);

  const { data: datastores = [], isLoading: loadingDatastores } = useAccessibleDatastores(
    selectedVCenterId || undefined
  );

  const { vms, loading: vmsLoading, refetch: refetchVMs, addVMs, removeVM, batchMigrate } = useProtectedVMs(
    selectedGroupId || undefined
  );

  const selectedGroup = groups.find(g => g.id === selectedGroupId);

  // Get the selected datastore's linked replication info
  const selectedDatastoreInfo = datastores.find(ds => ds.name === newGroupDatastore);
  const linkedTarget = selectedDatastoreInfo?.replication_target;
  const drPartner = linkedTarget?.partner_target;

  // Group datastores by their linked ZFS target
  const datastoresByTarget = datastores.reduce<Record<string, AccessibleDatastore[]>>((acc, ds) => {
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

  const handleCreate = async () => {
    if (!newGroupName.trim() || !selectedVCenterId || !newGroupDatastore) return;
    
    setCreating(true);
    try {
      await createGroup({
        name: newGroupName,
        description: newGroupDescription,
        protection_datastore: newGroupDatastore,
        source_vcenter_id: selectedVCenterId,
        rpo_minutes: newGroupRpoMinutes,
        // Auto-set target_id if datastore is linked to a ZFS target
        target_id: linkedTarget?.id,
      });
      setShowCreateDialog(false);
      setNewGroupName("");
      setNewGroupDescription("");
      setNewGroupDatastore("");
      setNewGroupRpoMinutes(60);
      setSelectedVCenterId("");
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

  const handleSaveEdit = async (id: string, updates: Partial<ProtectionGroup>) => {
    await updateGroup({ id, updates });
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
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  New
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Protection Group</DialogTitle>
                  <DialogDescription>
                    Create a new group to protect related VMs together
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Group Name</Label>
                    <Input
                      id="name"
                      placeholder="e.g., Production Databases"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      placeholder="Optional description..."
                      value={newGroupDescription}
                      onChange={(e) => setNewGroupDescription(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rpo">RPO Target (minutes)</Label>
                    <Input
                      id="rpo"
                      type="number"
                      min={1}
                      max={1440}
                      value={newGroupRpoMinutes}
                      onChange={(e) => setNewGroupRpoMinutes(parseInt(e.target.value) || 60)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Maximum acceptable data loss in minutes
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vcenter">Source vCenter</Label>
                    <Select 
                      value={selectedVCenterId} 
                      onValueChange={(val) => {
                        setSelectedVCenterId(val);
                        setNewGroupDatastore("");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select vCenter" />
                      </SelectTrigger>
                      <SelectContent>
                        {vcenters.map((vc) => (
                          <SelectItem key={vc.id} value={vc.id}>
                            {vc.name} ({vc.host})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="datastore">Protection Datastore</Label>
                    <Select
                      value={newGroupDatastore}
                      onValueChange={setNewGroupDatastore}
                      disabled={!selectedVCenterId || loadingDatastores}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={
                          !selectedVCenterId 
                            ? "Select vCenter first" 
                            : loadingDatastores 
                              ? "Loading datastores..." 
                              : "Select datastore"
                        } />
                      </SelectTrigger>
                      <SelectContent>
                        {/* Group datastores by ZFS target */}
                        {Object.entries(datastoresByTarget).map(([targetName, dsList]) => (
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
                                Unlinked Datastores
                              </div>
                            )}
                            {dsList.map((ds) => (
                              <SelectItem key={ds.id} value={ds.name}>
                                <div className="flex items-center gap-2">
                                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                                  <span>{ds.name}</span>
                                  <span className="text-muted-foreground text-xs">
                                    ({formatBytes(ds.free_bytes)} free)
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </div>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      VMs will be moved here before replication (via Storage vMotion)
                    </p>
                  </div>

                  {/* DR Destination Info - Auto-detected */}
                  {newGroupDatastore && (
                    <div className="space-y-2 pt-2 border-t">
                      <Label className="flex items-center gap-2">
                        <ArrowRight className="h-4 w-4" />
                        DR Destination
                      </Label>
                      {linkedTarget ? (
                        <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                          <div className="flex items-center gap-2">
                            <Target className="h-4 w-4 text-primary" />
                            <span className="font-medium">{linkedTarget.name}</span>
                            <Badge variant="outline" className={
                              linkedTarget.health_status === 'healthy' 
                                ? 'text-green-600 border-green-500/30' 
                                : 'text-amber-600 border-amber-500/30'
                            }>
                              {linkedTarget.health_status}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {linkedTarget.hostname} • {linkedTarget.zfs_pool}
                          </p>
                          {drPartner ? (
                            <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                              <span className="text-sm">DR: {drPartner.name}</span>
                              <span className="text-xs text-muted-foreground">
                                ({drPartner.hostname})
                              </span>
                            </div>
                          ) : (
                            <Alert className="mt-2">
                              <AlertTriangle className="h-4 w-4" />
                              <AlertDescription className="text-xs">
                                No DR partner configured for this ZFS target
                              </AlertDescription>
                            </Alert>
                          )}
                        </div>
                      ) : (
                        <Alert>
                          <Info className="h-4 w-4" />
                          <AlertDescription className="text-xs">
                            Datastore not linked to a ZFS appliance. Configure datastore linking for automatic DR detection.
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreate} disabled={creating || !newGroupName.trim() || !selectedVCenterId || !newGroupDatastore}>
                    {creating ? 'Creating...' : 'Create Group'}
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
