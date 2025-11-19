import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Edit, Server, Users } from "lucide-react";
import * as Icons from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface ServerGroup {
  id: string;
  name: string;
  description: string | null;
  group_type: string;
  color: string;
  icon: string;
  min_healthy_servers: number;
  created_at: string;
}

interface ServerGroupMember {
  id: string;
  server_id: string;
  server_group_id: string;
  role: string | null;
  priority: number;
  servers: {
    id: string;
    hostname: string | null;
    ip_address: string;
    model: string | null;
    service_tag: string | null;
  };
}

export function ServerGroupsManagement() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ServerGroup | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    group_type: "application",
    color: "#3b82f6",
    icon: "Server",
    min_healthy_servers: 1,
  });

  // Fetch server groups
  const { data: serverGroups = [], isLoading } = useQuery({
    queryKey: ["server-groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("server_groups")
        .select("*")
        .order("name");
      
      if (error) throw error;
      return data as ServerGroup[];
    },
  });

  // Fetch group members for selected group
  const { data: groupMembers = [] } = useQuery({
    queryKey: ["server-group-members", selectedGroup],
    queryFn: async () => {
      if (!selectedGroup) return [];
      
      const { data, error } = await supabase
        .from("server_group_members")
        .select("*, servers(id, hostname, ip_address, model, service_tag)")
        .eq("server_group_id", selectedGroup)
        .order("priority");
      
      if (error) throw error;
      return data as ServerGroupMember[];
    },
    enabled: !!selectedGroup,
  });

  // Fetch available servers (not in selected group)
  const { data: availableServers = [] } = useQuery({
    queryKey: ["available-servers", selectedGroup],
    queryFn: async () => {
      const { data: allServers, error } = await supabase
        .from("servers")
        .select("id, hostname, ip_address, model, service_tag");
      
      if (error) throw error;
      
      // Filter out servers already in the group
      if (selectedGroup && groupMembers.length > 0) {
        const memberServerIds = groupMembers.map(m => m.server_id);
        return allServers.filter(s => !memberServerIds.includes(s.id));
      }
      
      return allServers;
    },
    enabled: !!selectedGroup,
  });

  // Create server group mutation
  const createGroupMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase
        .from("server_groups")
        .insert([{ ...data, created_by: user?.id }]);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["server-groups"] });
      toast.success("Server group created successfully");
      setCreateDialogOpen(false);
      resetForm();
    },
    onError: (error) => {
      toast.error(`Failed to create server group: ${error.message}`);
    },
  });

  // Update server group mutation
  const updateGroupMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof formData> }) => {
      const { error } = await supabase
        .from("server_groups")
        .update(data)
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["server-groups"] });
      toast.success("Server group updated successfully");
      setEditingGroup(null);
      resetForm();
    },
    onError: (error) => {
      toast.error(`Failed to update server group: ${error.message}`);
    },
  });

  // Delete server group mutation
  const deleteGroupMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("server_groups")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["server-groups"] });
      toast.success("Server group deleted successfully");
      if (selectedGroup === deleteGroupMutation.variables) {
        setSelectedGroup(null);
      }
    },
    onError: (error) => {
      toast.error(`Failed to delete server group: ${error.message}`);
    },
  });

  // Add server to group mutation
  const addServerMutation = useMutation({
    mutationFn: async ({ serverId, priority = 100 }: { serverId: string; priority?: number }) => {
      if (!selectedGroup) throw new Error("No group selected");
      
      const { error } = await supabase
        .from("server_group_members")
        .insert([{
          server_group_id: selectedGroup,
          server_id: serverId,
          priority,
        }]);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["server-group-members", selectedGroup] });
      queryClient.invalidateQueries({ queryKey: ["available-servers", selectedGroup] });
      toast.success("Server added to group");
    },
    onError: (error) => {
      toast.error(`Failed to add server: ${error.message}`);
    },
  });

  // Remove server from group mutation
  const removeServerMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from("server_group_members")
        .delete()
        .eq("id", memberId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["server-group-members", selectedGroup] });
      queryClient.invalidateQueries({ queryKey: ["available-servers", selectedGroup] });
      toast.success("Server removed from group");
    },
    onError: (error) => {
      toast.error(`Failed to remove server: ${error.message}`);
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      group_type: "application",
      color: "#3b82f6",
      icon: "Server",
      min_healthy_servers: 1,
    });
  };

  const handleCreateOrUpdate = () => {
    if (editingGroup) {
      updateGroupMutation.mutate({ id: editingGroup.id, data: formData });
    } else {
      createGroupMutation.mutate(formData);
    }
  };

  const handleEdit = (group: ServerGroup) => {
    setEditingGroup(group);
    setFormData({
      name: group.name,
      description: group.description || "",
      group_type: group.group_type,
      color: group.color,
      icon: group.icon,
      min_healthy_servers: group.min_healthy_servers,
    });
    setCreateDialogOpen(true);
  };

  const getIconComponent = (iconName: string) => {
    const IconComponent = Icons[iconName as keyof typeof Icons] as any;
    return IconComponent ? IconComponent : Server;
  };

  if (isLoading) {
    return <div>Loading server groups...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Server Groups</h2>
          <p className="text-muted-foreground">
            Organize standalone Dell servers into logical groups for maintenance scheduling
          </p>
        </div>
        
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditingGroup(null); resetForm(); }}>
              <Plus className="mr-2 h-4 w-4" />
              Create Group
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingGroup ? "Edit" : "Create"} Server Group</DialogTitle>
              <DialogDescription>
                {editingGroup ? "Update" : "Create a new"} server group for organizing your Dell servers
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Group Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., SQL Production Cluster"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="group_type">Group Type</Label>
                  <Select value={formData.group_type} onValueChange={(value) => setFormData({ ...formData, group_type: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="application">Application</SelectItem>
                      <SelectItem value="environment">Environment</SelectItem>
                      <SelectItem value="location">Location</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="min_healthy_servers">Min Healthy Servers</Label>
                  <Input
                    id="min_healthy_servers"
                    type="number"
                    min={1}
                    value={formData.min_healthy_servers}
                    onChange={(e) => setFormData({ ...formData, min_healthy_servers: parseInt(e.target.value) })}
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="color">Color</Label>
                  <Input
                    id="color"
                    type="color"
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="icon">Icon</Label>
                  <Select value={formData.icon} onValueChange={(value) => setFormData({ ...formData, icon: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Server">Server</SelectItem>
                      <SelectItem value="Database">Database</SelectItem>
                      <SelectItem value="Cloud">Cloud</SelectItem>
                      <SelectItem value="Cpu">CPU</SelectItem>
                      <SelectItem value="HardDrive">Hard Drive</SelectItem>
                      <SelectItem value="Network">Network</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => { setCreateDialogOpen(false); resetForm(); }}>
                Cancel
              </Button>
              <Button onClick={handleCreateOrUpdate}>
                {editingGroup ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Server Groups List */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Groups ({serverGroups.length})</h3>
          {serverGroups.map((group) => {
            const IconComponent = getIconComponent(group.icon);
            return (
              <Card
                key={group.id}
                className={`cursor-pointer transition-all ${
                  selectedGroup === group.id ? "ring-2 ring-primary" : ""
                }`}
                onClick={() => setSelectedGroup(group.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="p-2 rounded-lg"
                        style={{ backgroundColor: group.color + "20" }}
                      >
                        <IconComponent className="h-5 w-5" style={{ color: group.color }} />
                      </div>
                      <div>
                        <CardTitle className="text-base">{group.name}</CardTitle>
                        <Badge variant="secondary" className="text-xs mt-1">
                          {group.group_type}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(group);
                        }}
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete group "${group.name}"?`)) {
                            deleteGroupMutation.mutate(group.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {group.description && (
                  <CardContent className="pt-0 pb-3">
                    <p className="text-sm text-muted-foreground">{group.description}</p>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>

        {/* Group Members */}
        <div className="space-y-4">
          {selectedGroup ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">
                  <Users className="inline mr-2 h-5 w-5" />
                  Members ({groupMembers.length})
                </h3>
              </div>
              
              {/* Current members */}
              <div className="space-y-2">
                {groupMembers.map((member) => (
                  <Card key={member.id}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div>
                        <p className="font-medium">
                          {member.servers.hostname || member.servers.ip_address}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {member.servers.model} • {member.servers.service_tag}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm("Remove this server from the group?")) {
                            removeServerMutation.mutate(member.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
              
              {/* Add servers */}
              {availableServers.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Add Servers</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {availableServers.map((server) => (
                      <div
                        key={server.id}
                        className="flex items-center justify-between p-2 border rounded hover:bg-accent cursor-pointer"
                        onClick={() => addServerMutation.mutate({ serverId: server.id })}
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {server.hostname || server.ip_address}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {server.model}
                          </p>
                        </div>
                        <Plus className="h-4 w-4" />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <p className="text-muted-foreground">Select a group to manage members</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
