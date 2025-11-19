import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface ServerGroup {
  id: string;
  name: string;
  color: string;
  icon: string;
}

interface ManageServerGroupsDialogProps {
  server: {
    id: string;
    hostname: string | null;
    ip_address: string;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ManageServerGroupsDialog({ server, open, onOpenChange }: ManageServerGroupsDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());

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
  });

  // Fetch current memberships for this server
  const { data: memberships, isLoading: membershipsLoading } = useQuery({
    queryKey: ['server-group-memberships', server?.id],
    queryFn: async () => {
      if (!server) return [];
      const { data, error } = await supabase
        .from('server_group_members')
        .select('server_group_id')
        .eq('server_id', server.id);
      if (error) throw error;
      return data.map(m => m.server_group_id);
    },
    enabled: !!server,
  });

  // Initialize selected groups when memberships load
  useState(() => {
    if (memberships) {
      setSelectedGroups(new Set(memberships));
    }
  });

  // Add/remove membership mutation
  const membershipMutation = useMutation({
    mutationFn: async ({ groupId, action }: { groupId: string; action: 'add' | 'remove' }) => {
      if (!server) return;

      if (action === 'add') {
        const { error } = await supabase
          .from('server_group_members')
          .insert({ server_id: server.id, server_group_id: groupId });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('server_group_members')
          .delete()
          .eq('server_id', server.id)
          .eq('server_group_id', groupId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server-group-memberships'] });
      queryClient.invalidateQueries({ queryKey: ['server-group-members'] });
    },
  });

  const handleToggleGroup = async (groupId: string) => {
    const currentlySelected = selectedGroups.has(groupId);
    const newSelectedGroups = new Set(selectedGroups);

    if (currentlySelected) {
      newSelectedGroups.delete(groupId);
      setSelectedGroups(newSelectedGroups);
      
      try {
        await membershipMutation.mutateAsync({ groupId, action: 'remove' });
        toast({
          title: "Removed from group",
          description: "Server removed from group successfully",
        });
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
        // Revert on error
        newSelectedGroups.add(groupId);
        setSelectedGroups(newSelectedGroups);
      }
    } else {
      newSelectedGroups.add(groupId);
      setSelectedGroups(newSelectedGroups);

      try {
        await membershipMutation.mutateAsync({ groupId, action: 'add' });
        toast({
          title: "Added to group",
          description: "Server added to group successfully",
        });
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
        // Revert on error
        newSelectedGroups.delete(groupId);
        setSelectedGroups(newSelectedGroups);
      }
    }
  };

  const isLoading = groupsLoading || membershipsLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Group Membership</DialogTitle>
          <DialogDescription>
            {server ? `${server.hostname || server.ip_address}` : "Select groups for this server"}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : serverGroups && serverGroups.length > 0 ? (
          <div className="space-y-4 py-4">
            {serverGroups.map((group) => (
              <div key={group.id} className="flex items-center space-x-2">
                <Checkbox
                  id={group.id}
                  checked={selectedGroups.has(group.id)}
                  onCheckedChange={() => handleToggleGroup(group.id)}
                  disabled={membershipMutation.isPending}
                />
                <Label
                  htmlFor={group.id}
                  className="flex items-center gap-2 cursor-pointer flex-1"
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: group.color }}
                  />
                  <span>{group.name}</span>
                </Label>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            <p className="mb-4">No server groups created yet</p>
            <Button variant="outline" onClick={() => window.location.href = '/settings?tab=server-groups'}>
              Create Server Group
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
