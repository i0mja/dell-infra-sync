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
  Shield, 
  Plus, 
  Play, 
  Trash2, 
  Clock,
  Server,
  ChevronRight,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { useProtectionGroups, useProtectedVMs } from "@/hooks/useReplication";
import { formatDistanceToNow } from "date-fns";
import { ProtectedVMsTable } from "./ProtectedVMsTable";

export function ProtectionGroupsPanel() {
  const { groups, loading, createGroup, deleteGroup, runReplicationNow, refetch } = useProtectionGroups();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [newGroupDatastore, setNewGroupDatastore] = useState("");
  const [creating, setCreating] = useState(false);
  const [runningReplication, setRunningReplication] = useState<string | null>(null);

  const { vms, loading: vmsLoading, refetch: refetchVMs, addVM, removeVM } = useProtectedVMs(
    selectedGroupId || undefined
  );

  const selectedGroup = groups.find(g => g.id === selectedGroupId);

  const handleCreate = async () => {
    if (!newGroupName.trim()) return;
    
    setCreating(true);
    try {
      await createGroup({
        name: newGroupName,
        description: newGroupDescription,
        protection_datastore: newGroupDatastore || undefined,
      });
      setShowCreateDialog(false);
      setNewGroupName("");
      setNewGroupDescription("");
      setNewGroupDatastore("");
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

  const handleDelete = async (groupId: string) => {
    if (!confirm('Delete this protection group? All protected VMs will be removed.')) return;
    await deleteGroup(groupId);
    if (selectedGroupId === groupId) {
      setSelectedGroupId(null);
    }
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
                    <Label htmlFor="datastore">Protection Datastore</Label>
                    <Input
                      id="datastore"
                      placeholder="e.g., DR-Protected-DS"
                      value={newGroupDatastore}
                      onChange={(e) => setNewGroupDatastore(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      VMs will be moved here before replication (via Storage vMotion)
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreate} disabled={creating || !newGroupName.trim()}>
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
                <Skeleton key={i} className="h-20 w-full" />
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
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="secondary">
                      <Server className="h-3 w-3 mr-1" />
                      {group.vm_count || 0} VMs
                    </Badge>
                    {group.is_enabled ? (
                      <Badge variant="outline" className="text-green-600 border-green-500/30">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Paused
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      RPO: {group.rpo_minutes}m
                    </span>
                    {group.last_replication_at && (
                      <span>
                        {formatDistanceToNow(new Date(group.last_replication_at), { addSuffix: true })}
                      </span>
                    )}
                  </div>
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
                  onClick={() => handleRunNow(selectedGroup.id)}
                  disabled={runningReplication === selectedGroup.id || vms.length === 0}
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
              onAddVM={addVM}
              onRemoveVM={removeVM}
              protectionDatastore={selectedGroup.protection_datastore}
              onRefresh={refetchVMs}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
