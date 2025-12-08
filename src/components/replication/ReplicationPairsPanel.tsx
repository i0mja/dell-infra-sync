import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
  ArrowRight,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Database,
  Lock,
  Zap,
} from "lucide-react";
import { useReplicationPairs, ReplicationPair } from "@/hooks/useReplicationPairs";
import { useReplicationTargets } from "@/hooks/useReplication";
import { useVCenters } from "@/hooks/useVCenters";
import { formatDistanceToNow } from "date-fns";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function ConnectionStatusBadge({ status }: { status?: string }) {
  switch (status) {
    case "healthy":
      return (
        <Badge variant="outline" className="text-green-600 border-green-500/30">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Healthy
        </Badge>
      );
    case "degraded":
      return (
        <Badge variant="outline" className="text-amber-600 border-amber-500/30">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Degraded
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="outline" className="text-red-600 border-red-500/30">
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <HelpCircle className="h-3 w-3 mr-1" />
          Unknown
        </Badge>
      );
  }
}

export function ReplicationPairsPanel() {
  const { pairs, loading, createPair, deletePair, testConnection, isTestingConnection } = useReplicationPairs();
  const { targets } = useReplicationTargets();
  const { vcenters } = useVCenters();
  
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [testingPairId, setTestingPairId] = useState<string | null>(null);
  
  // Form state
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [sourceVcenterId, setSourceVcenterId] = useState("");
  const [destVcenterId, setDestVcenterId] = useState("");
  const [sourceTargetId, setSourceTargetId] = useState("");
  const [destTargetId, setDestTargetId] = useState("");
  const [sourceDataset, setSourceDataset] = useState("");
  const [destDataset, setDestDataset] = useState("");
  const [useCompression, setUseCompression] = useState(true);
  const [useEncryption, setUseEncryption] = useState(true);

  const resetForm = () => {
    setNewName("");
    setNewDescription("");
    setSourceVcenterId("");
    setDestVcenterId("");
    setSourceTargetId("");
    setDestTargetId("");
    setSourceDataset("");
    setDestDataset("");
    setUseCompression(true);
    setUseEncryption(true);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    
    setCreating(true);
    try {
      await createPair({
        name: newName,
        description: newDescription,
        source_vcenter_id: sourceVcenterId || undefined,
        destination_vcenter_id: destVcenterId || undefined,
        source_target_id: sourceTargetId || undefined,
        destination_target_id: destTargetId || undefined,
        source_dataset: sourceDataset,
        destination_dataset: destDataset,
        use_compression: useCompression,
        use_encryption: useEncryption,
      });
      setShowCreateDialog(false);
      resetForm();
    } finally {
      setCreating(false);
    }
  };

  const handleTestConnection = async (pairId: string) => {
    setTestingPairId(pairId);
    try {
      await testConnection(pairId);
    } finally {
      setTestingPairId(null);
    }
  };

  const handleDelete = async (pairId: string) => {
    if (!confirm("Delete this replication pair? Protection groups using it will need to be reconfigured.")) return;
    await deletePair(pairId);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Replication Pairs
            </CardTitle>
            <CardDescription>
              Source to destination ZFS/vCenter connections
            </CardDescription>
          </div>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Add Pair
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Replication Pair</DialogTitle>
                <DialogDescription>
                  Define a source-to-destination connection for replication
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
                <div className="space-y-2">
                  <Label htmlFor="pair-name">Pair Name</Label>
                  <Input
                    id="pair-name"
                    placeholder="e.g., NYC → DR West"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pair-description">Description</Label>
                  <Input
                    id="pair-description"
                    placeholder="Optional description..."
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                  />
                </div>
                
                <div className="border-t pt-4">
                  <h4 className="font-medium mb-3">Source</h4>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>Source vCenter</Label>
                      <Select value={sourceVcenterId} onValueChange={setSourceVcenterId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select source vCenter" />
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
                      <Label>Source ZFS Target</Label>
                      <Select value={sourceTargetId} onValueChange={setSourceTargetId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select source ZFS" />
                        </SelectTrigger>
                        <SelectContent>
                          {targets.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name} ({t.hostname})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Source Dataset</Label>
                      <Input
                        placeholder="e.g., tank/vms"
                        value={sourceDataset}
                        onChange={(e) => setSourceDataset(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                
                <div className="border-t pt-4">
                  <h4 className="font-medium mb-3">Destination</h4>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>Destination vCenter</Label>
                      <Select value={destVcenterId} onValueChange={setDestVcenterId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select destination vCenter" />
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
                      <Label>Destination ZFS Target</Label>
                      <Select value={destTargetId} onValueChange={setDestTargetId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select destination ZFS" />
                        </SelectTrigger>
                        <SelectContent>
                          {targets.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name} ({t.hostname})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Destination Dataset</Label>
                      <Input
                        placeholder="e.g., tank/dr"
                        value={destDataset}
                        onChange={(e) => setDestDataset(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                
                <div className="border-t pt-4 space-y-3">
                  <h4 className="font-medium">Options</h4>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-muted-foreground" />
                      <Label htmlFor="compression">Use Compression</Label>
                    </div>
                    <Switch
                      id="compression"
                      checked={useCompression}
                      onCheckedChange={setUseCompression}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      <Label htmlFor="encryption">Use Encryption</Label>
                    </div>
                    <Switch
                      id="encryption"
                      checked={useEncryption}
                      onCheckedChange={setUseEncryption}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
                  {creating ? "Creating..." : "Create Pair"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : pairs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Database className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No replication pairs configured</p>
            <p className="text-sm">Create a pair to connect source and DR sites</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pairs.map((pair) => (
              <div
                key={pair.id}
                className="p-4 border rounded-lg"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="font-medium">{pair.name}</span>
                      <ConnectionStatusBadge status={pair.connection_status} />
                      {!pair.is_enabled && (
                        <Badge variant="secondary">Disabled</Badge>
                      )}
                    </div>
                    
                    {/* Visual diagram */}
                    <div className="flex items-center gap-3 py-3 px-2 bg-muted/30 rounded-lg">
                      <div className="text-center min-w-[120px]">
                        <div className="text-xs text-muted-foreground mb-1">Source</div>
                        <div className="font-mono text-sm">
                          {pair.source_target_name || pair.source_vcenter_name || "Not set"}
                        </div>
                        {pair.source_dataset && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {pair.source_dataset}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <div className="h-px w-8 bg-border" />
                        <ArrowRight className="h-4 w-4" />
                        <div className="h-px w-8 bg-border" />
                      </div>
                      
                      <div className="text-center min-w-[120px]">
                        <div className="text-xs text-muted-foreground mb-1">Destination</div>
                        <div className="font-mono text-sm">
                          {pair.destination_target_name || pair.destination_vcenter_name || "Not set"}
                        </div>
                        {pair.destination_dataset && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {pair.destination_dataset}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                      <span>Transferred: {formatBytes(pair.bytes_transferred_total || 0)}</span>
                      {pair.use_compression && (
                        <span className="flex items-center gap-1">
                          <Zap className="h-3 w-3" />
                          Compressed
                        </span>
                      )}
                      {pair.use_encryption && (
                        <span className="flex items-center gap-1">
                          <Lock className="h-3 w-3" />
                          Encrypted
                        </span>
                      )}
                      {pair.last_connection_test && (
                        <span>
                          Tested {formatDistanceToNow(new Date(pair.last_connection_test), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 ml-4">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleTestConnection(pair.id)}
                      disabled={testingPairId === pair.id}
                    >
                      <RefreshCw className={`h-4 w-4 mr-1 ${testingPairId === pair.id ? 'animate-spin' : ''}`} />
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => handleDelete(pair.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
