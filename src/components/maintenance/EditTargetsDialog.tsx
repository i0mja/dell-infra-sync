import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

interface EditTargetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  window: any;
}

export function EditTargetsDialog({ open, onOpenChange, window }: EditTargetsDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  
  // Determine current target type
  const getCurrentTargetType = () => {
    if (window.server_ids?.length || window.details?.server_ids?.length) return 'servers';
    if (window.cluster_ids?.length) return 'cluster';
    if (window.server_group_ids?.length) return 'group';
    return 'servers';
  };

  const [targetType, setTargetType] = useState<'cluster' | 'group' | 'servers'>(getCurrentTargetType());
  const [clusters, setClusters] = useState<string[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [servers, setServers] = useState<any[]>([]);
  
  const [selectedCluster, setSelectedCluster] = useState<string>(window.cluster_ids?.[0] || '');
  const [selectedGroup, setSelectedGroup] = useState<string>(window.server_group_ids?.[0] || '');
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>(
    window.server_ids || window.details?.server_ids || []
  );

  useEffect(() => {
    if (open) {
      loadOptions();
    }
  }, [open, targetType]);

  const loadOptions = async () => {
    if (targetType === 'cluster') {
      const { data } = await supabase
        .from("vcenter_hosts")
        .select("cluster")
        .not("cluster", "is", null);
      if (data) {
        const uniqueClusters = [...new Set(data.map(h => h.cluster).filter(Boolean))];
        setClusters(uniqueClusters as string[]);
      }
    } else if (targetType === 'group') {
      const { data } = await supabase
        .from("server_groups")
        .select("*")
        .order("name");
      if (data) {
        setGroups(data);
      }
    } else if (targetType === 'servers') {
      const { data } = await supabase
        .from("servers")
        .select("id, hostname, ip_address, connection_status")
        .order("hostname");
      if (data) {
        setServers(data);
      }
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const updates: any = {
        cluster_ids: targetType === 'cluster' ? [selectedCluster] : null,
        server_group_ids: targetType === 'group' ? [selectedGroup] : null,
        server_ids: targetType === 'servers' ? selectedServerIds : null,
      };

      // Also update details field for backward compatibility
      const currentDetails = window.details || {};
      updates.details = {
        ...currentDetails,
        target_type: targetType,
        server_ids: targetType === 'servers' ? selectedServerIds : undefined,
      };

      const { error } = await supabase
        .from('maintenance_windows')
        .update(updates)
        .eq('id', window.id);

      if (error) throw error;

      toast({
        title: "Targets updated",
        description: "Maintenance window targets have been updated successfully."
      });

      queryClient.invalidateQueries({ queryKey: ['maintenance-windows'] });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error updating targets",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleServer = (serverId: string) => {
    setSelectedServerIds(prev =>
      prev.includes(serverId)
        ? prev.filter(id => id !== serverId)
        : [...prev, serverId]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Targets</DialogTitle>
          <DialogDescription>
            Change which servers, clusters, or groups this maintenance window targets.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Target Type</Label>
            <RadioGroup value={targetType} onValueChange={(v: any) => setTargetType(v)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="servers" id="servers" />
                <Label htmlFor="servers">Specific Servers</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="cluster" id="cluster" />
                <Label htmlFor="cluster">vCenter Cluster</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="group" id="group" />
                <Label htmlFor="group">Server Group</Label>
              </div>
            </RadioGroup>
          </div>

          {targetType === 'cluster' && (
            <div className="space-y-2">
              <Label>Select Cluster</Label>
              <Select value={selectedCluster} onValueChange={setSelectedCluster}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose cluster..." />
                </SelectTrigger>
                <SelectContent>
                  {clusters.map(cluster => (
                    <SelectItem key={cluster} value={cluster}>
                      {cluster}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {targetType === 'group' && (
            <div className="space-y-2">
              <Label>Select Server Group</Label>
              <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose group..." />
                </SelectTrigger>
                <SelectContent>
                  {groups.map(group => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {targetType === 'servers' && (
            <div className="space-y-2">
              <Label>Select Servers ({selectedServerIds.length} selected)</Label>
              <div className="border rounded-md max-h-64 overflow-y-auto">
                {servers.map(server => (
                  <div
                    key={server.id}
                    className="flex items-center space-x-2 p-3 border-b last:border-b-0 hover:bg-accent"
                  >
                    <Checkbox
                      id={server.id}
                      checked={selectedServerIds.includes(server.id)}
                      onCheckedChange={() => toggleServer(server.id)}
                    />
                    <Label
                      htmlFor={server.id}
                      className="flex-1 cursor-pointer font-normal"
                    >
                      <div className="font-medium">{server.ip_address}</div>
                      {server.hostname && (
                        <div className="text-sm text-muted-foreground">{server.hostname}</div>
                      )}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
