import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, ChevronLeft } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ServerGroup {
  id: string;
  name: string;
  color: string;
  icon: string;
}

interface BulkManageGroupsDialogProps {
  serverIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GROUP_COLORS = [
  { name: "Blue", value: "#3b82f6" },
  { name: "Green", value: "#22c55e" },
  { name: "Purple", value: "#a855f7" },
  { name: "Orange", value: "#f97316" },
  { name: "Red", value: "#ef4444" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Pink", value: "#ec4899" },
  { name: "Yellow", value: "#eab308" },
];

export function BulkManageGroupsDialog({ serverIds, open, onOpenChange }: BulkManageGroupsDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingChanges, setPendingChanges] = useState<Map<string, 'add' | 'remove'>>(new Map());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0].value);
  const [saving, setSaving] = useState(false);

  // Fetch all server groups
  const { data: serverGroups, isLoading: groupsLoading } = useQuery({
    queryKey: ['server-groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('server_groups')
        .select('id, name, color, icon')
        .order('name');
      if (error) throw error;
      return data as ServerGroup[];
    },
    enabled: open,
  });

  // Fetch current memberships for all selected servers
  const { data: memberships, isLoading: membershipsLoading } = useQuery({
    queryKey: ['bulk-server-group-memberships', serverIds],
    queryFn: async () => {
      if (serverIds.length === 0) return [];
      const { data, error } = await supabase
        .from('server_group_members')
        .select('server_id, server_group_id')
        .in('server_id', serverIds);
      if (error) throw error;
      return data;
    },
    enabled: open && serverIds.length > 0,
  });

  // Calculate membership counts per group
  const groupMembershipCounts = useMemo(() => {
    if (!memberships) return new Map<string, number>();
    const counts = new Map<string, number>();
    memberships.forEach(m => {
      counts.set(m.server_group_id, (counts.get(m.server_group_id) || 0) + 1);
    });
    return counts;
  }, [memberships]);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setPendingChanges(new Map());
      setShowCreateForm(false);
      setNewGroupName("");
      setNewGroupColor(GROUP_COLORS[0].value);
    }
  }, [open]);

  // Get the effective state of a group (considering pending changes)
  const getGroupState = (groupId: string): 'none' | 'partial' | 'all' => {
    const currentCount = groupMembershipCounts.get(groupId) || 0;
    const pending = pendingChanges.get(groupId);
    
    if (pending === 'add') return 'all';
    if (pending === 'remove') return 'none';
    
    if (currentCount === 0) return 'none';
    if (currentCount === serverIds.length) return 'all';
    return 'partial';
  };

  const handleToggleGroup = (groupId: string) => {
    const currentState = getGroupState(groupId);
    const newChanges = new Map(pendingChanges);
    
    if (currentState === 'all') {
      // If currently all in, toggle to remove
      newChanges.set(groupId, 'remove');
    } else {
      // If none or partial, toggle to add all
      newChanges.set(groupId, 'add');
    }
    
    // If the change brings us back to original state, remove the pending change
    const originalCount = groupMembershipCounts.get(groupId) || 0;
    const pendingAction = newChanges.get(groupId);
    if (pendingAction === 'add' && originalCount === serverIds.length) {
      newChanges.delete(groupId);
    } else if (pendingAction === 'remove' && originalCount === 0) {
      newChanges.delete(groupId);
    }
    
    setPendingChanges(newChanges);
  };

  // Create new group mutation
  const createGroupMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('server_groups')
        .insert({
          name: newGroupName.trim(),
          color: newGroupColor,
          icon: 'folder',
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id;
    },
  });

  const handleCreateAndAdd = async () => {
    if (!newGroupName.trim()) {
      toast({ title: "Enter group name", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      // Create the group
      const groupId = await createGroupMutation.mutateAsync();
      
      // Add all servers to the new group
      const membersToAdd = serverIds.map(serverId => ({
        server_id: serverId,
        server_group_id: groupId,
      }));
      
      const { error } = await supabase
        .from('server_group_members')
        .insert(membersToAdd);
      
      if (error) throw error;
      
      toast({
        title: "Group created",
        description: `Created "${newGroupName}" and added ${serverIds.length} server${serverIds.length > 1 ? 's' : ''}`,
      });
      
      queryClient.invalidateQueries({ queryKey: ['server-groups'] });
      queryClient.invalidateQueries({ queryKey: ['server-group-memberships'] });
      queryClient.invalidateQueries({ queryKey: ['server-group-members'] });
      queryClient.invalidateQueries({ queryKey: ['bulk-server-group-memberships'] });
      
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveChanges = async () => {
    if (pendingChanges.size === 0) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    try {
      for (const [groupId, action] of pendingChanges) {
        if (action === 'add') {
          // Get servers not already in the group
          const existingMembers = new Set(
            memberships?.filter(m => m.server_group_id === groupId).map(m => m.server_id) || []
          );
          const serversToAdd = serverIds.filter(id => !existingMembers.has(id));
          
          if (serversToAdd.length > 0) {
            const { error } = await supabase
              .from('server_group_members')
              .insert(serversToAdd.map(serverId => ({
                server_id: serverId,
                server_group_id: groupId,
              })));
            if (error) throw error;
          }
        } else if (action === 'remove') {
          const { error } = await supabase
            .from('server_group_members')
            .delete()
            .eq('server_group_id', groupId)
            .in('server_id', serverIds);
          if (error) throw error;
        }
      }

      toast({
        title: "Groups updated",
        description: `Updated group memberships for ${serverIds.length} server${serverIds.length > 1 ? 's' : ''}`,
      });
      
      queryClient.invalidateQueries({ queryKey: ['server-group-memberships'] });
      queryClient.invalidateQueries({ queryKey: ['server-group-members'] });
      queryClient.invalidateQueries({ queryKey: ['bulk-server-group-memberships'] });
      
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const isLoading = groupsLoading || membershipsLoading;
  const hasChanges = pendingChanges.size > 0;

  if (showCreateForm) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Group</DialogTitle>
            <DialogDescription>
              Create a group and add {serverIds.length} server{serverIds.length > 1 ? 's' : ''} to it
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="group-name">Group Name</Label>
              <Input
                id="group-name"
                placeholder="e.g., Production Cluster"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label>Color</Label>
              <Select value={newGroupColor} onValueChange={setNewGroupColor}>
                <SelectTrigger>
                  <SelectValue>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-4 h-4 rounded-full" 
                        style={{ backgroundColor: newGroupColor }} 
                      />
                      {GROUP_COLORS.find(c => c.value === newGroupColor)?.name}
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {GROUP_COLORS.map((color) => (
                    <SelectItem key={color.value} value={color.value}>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-4 h-4 rounded-full" 
                          style={{ backgroundColor: color.value }} 
                        />
                        {color.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="ghost" 
              onClick={() => setShowCreateForm(false)}
              disabled={saving}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
            <Button onClick={handleCreateAndAdd} disabled={saving || !newGroupName.trim()}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                `Create & Add ${serverIds.length} Server${serverIds.length > 1 ? 's' : ''}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Groups</DialogTitle>
          <DialogDescription>
            {serverIds.length} server{serverIds.length > 1 ? 's' : ''} selected
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : serverGroups && serverGroups.length > 0 ? (
          <div className="space-y-3 py-4 max-h-[300px] overflow-y-auto">
            {serverGroups.map((group) => {
              const state = getGroupState(group.id);
              const currentCount = groupMembershipCounts.get(group.id) || 0;
              const hasPendingChange = pendingChanges.has(group.id);
              
              return (
                <div 
                  key={group.id} 
                  className={`flex items-center justify-between p-2 rounded-md border ${
                    hasPendingChange ? 'border-primary bg-primary/5' : 'border-transparent'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id={group.id}
                      checked={state === 'all'}
                      // @ts-ignore - indeterminate is valid but not in types
                      ref={(el) => {
                        if (el) {
                          (el as any).indeterminate = state === 'partial';
                        }
                      }}
                      onCheckedChange={() => handleToggleGroup(group.id)}
                      disabled={saving}
                    />
                    <Label
                      htmlFor={group.id}
                      className="flex items-center gap-2 cursor-pointer flex-1"
                    >
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: group.color }}
                      />
                      <span>{group.name}</span>
                    </Label>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">
                    {hasPendingChange ? (
                      pendingChanges.get(group.id) === 'add' ? (
                        <span className="text-success">+{serverIds.length - currentCount}</span>
                      ) : (
                        <span className="text-destructive">−{currentCount}</span>
                      )
                    ) : currentCount > 0 ? (
                      `${currentCount} of ${serverIds.length}`
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        <Button
          variant="outline"
          className="w-full"
          onClick={() => setShowCreateForm(true)}
          disabled={saving}
        >
          <Plus className="mr-2 h-4 w-4" />
          Create New Group
        </Button>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSaveChanges} disabled={saving || !hasChanges}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : hasChanges ? (
              `Save Changes`
            ) : (
              'Done'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
