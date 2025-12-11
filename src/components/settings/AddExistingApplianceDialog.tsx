import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useVCenters } from "@/hooks/useVCenters";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useZfsTemplates } from "@/hooks/useZfsTemplates";
import { Loader2, Server, Settings, Database } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AddExistingApplianceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const AddExistingApplianceDialog = ({ open, onOpenChange }: AddExistingApplianceDialogProps) => {
  const { vcenters } = useVCenters();
  const { createTemplate, isCreating } = useZfsTemplates();
  
  const [selectedVcenterId, setSelectedVcenterId] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [activeTab, setActiveTab] = useState("template");
  
  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    version: "",
    default_zfs_pool_name: "tank",
    default_zfs_disk_path: "/dev/sdb",
    default_nfs_network: "192.168.0.0/16",
    default_ssh_username: "root",
    ssh_private_key: "",
    default_cpu_count: 2,
    default_memory_gb: 4,
    default_zfs_disk_gb: 100,
    default_cluster: "",
    default_datastore: "",
    default_network: "",
    default_resource_pool: "",
  });

  // Fetch template VMs from selected vCenter
  const { data: templateVMs, isLoading: loadingTemplates } = useQuery({
    queryKey: ['vcenter-template-vms', selectedVcenterId],
    queryFn: async () => {
      if (!selectedVcenterId) return [];
      const { data, error } = await supabase
        .from('vcenter_vms')
        .select('*')
        .eq('source_vcenter_id', selectedVcenterId)
        .eq('is_template', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedVcenterId,
  });

  const selectedTemplate = templateVMs?.find(t => t.id === selectedTemplateId);

  const handleSubmit = async () => {
    if (!selectedVcenterId || !selectedTemplate) return;
    
    await createTemplate({
      name: formData.name || selectedTemplate.name,
      description: formData.description,
      vcenter_id: selectedVcenterId,
      template_moref: selectedTemplate.vcenter_id || '',
      template_name: selectedTemplate.name,
      default_zfs_pool_name: formData.default_zfs_pool_name,
      default_zfs_disk_path: formData.default_zfs_disk_path,
      default_nfs_network: formData.default_nfs_network,
      default_ssh_username: formData.default_ssh_username,
      ssh_private_key: formData.ssh_private_key || undefined,
      default_cpu_count: formData.default_cpu_count,
      default_memory_gb: formData.default_memory_gb,
      default_zfs_disk_gb: formData.default_zfs_disk_gb,
      default_cluster: formData.default_cluster || undefined,
      default_datastore: formData.default_datastore || undefined,
      default_network: formData.default_network || undefined,
      default_resource_pool: formData.default_resource_pool || undefined,
    });
    
    onOpenChange(false);
    resetForm();
  };

  const resetForm = () => {
    setSelectedVcenterId("");
    setSelectedTemplateId("");
    setActiveTab("template");
    setFormData({
      name: "",
      description: "",
      version: "",
      default_zfs_pool_name: "tank",
      default_zfs_disk_path: "/dev/sdb",
      default_nfs_network: "192.168.0.0/16",
      default_ssh_username: "root",
      ssh_private_key: "",
      default_cpu_count: 2,
      default_memory_gb: 4,
      default_zfs_disk_gb: 100,
      default_cluster: "",
      default_datastore: "",
      default_network: "",
      default_resource_pool: "",
    });
  };

  const canProceed = selectedVcenterId && selectedTemplateId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Add Existing ZFS Appliance</DialogTitle>
          <DialogDescription>
            Register an already-prepared ZFS template VM to the appliance library
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="template" className="flex items-center gap-2">
              <Server className="h-4 w-4" />
              Template
            </TabsTrigger>
            <TabsTrigger value="metadata" disabled={!canProceed} className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Metadata
            </TabsTrigger>
            <TabsTrigger value="defaults" disabled={!canProceed} className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Defaults
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[400px] mt-4">
            <TabsContent value="template" className="space-y-4 pr-4">
              <div className="space-y-2">
                <Label>vCenter</Label>
                <Select value={selectedVcenterId} onValueChange={(v) => {
                  setSelectedVcenterId(v);
                  setSelectedTemplateId("");
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select vCenter..." />
                  </SelectTrigger>
                  <SelectContent>
                    {vcenters?.map((vc) => (
                      <SelectItem key={vc.id} value={vc.id}>
                        {vc.name} ({vc.host})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedVcenterId && (
                <div className="space-y-2">
                  <Label>Template VM</Label>
                  {loadingTemplates ? (
                    <div className="flex items-center gap-2 text-muted-foreground py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading templates...
                    </div>
                  ) : templateVMs?.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">
                      No template VMs found in this vCenter
                    </p>
                  ) : (
                    <Select value={selectedTemplateId} onValueChange={(v) => {
                      setSelectedTemplateId(v);
                      const template = templateVMs?.find(t => t.id === v);
                      if (template) {
                        setFormData(prev => ({ ...prev, name: template.name }));
                      }
                    }}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select template VM..." />
                      </SelectTrigger>
                      <SelectContent>
                        {templateVMs?.map((vm) => (
                          <SelectItem key={vm.id} value={vm.id}>
                            {vm.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {selectedTemplate && (
                <div className="rounded-lg border p-4 bg-muted/30 space-y-2">
                  <h4 className="font-medium">Selected Template</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-muted-foreground">Name:</span> {selectedTemplate.name}</div>
                    <div><span className="text-muted-foreground">Guest OS:</span> {selectedTemplate.guest_os || 'Unknown'}</div>
                    <div><span className="text-muted-foreground">CPU:</span> {selectedTemplate.cpu_count || 'N/A'}</div>
                    <div><span className="text-muted-foreground">Memory:</span> {selectedTemplate.memory_mb ? `${selectedTemplate.memory_mb} MB` : 'N/A'}</div>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="metadata" className="space-y-4 pr-4">
              <div className="space-y-2">
                <Label htmlFor="name">Library Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., ZFS Appliance - Debian 12"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="version">Version Tag</Label>
                <Input
                  id="version"
                  value={formData.version}
                  onChange={(e) => setFormData(prev => ({ ...prev, version: e.target.value }))}
                  placeholder="e.g., v1.0, debian-12-zfs-2.2"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Describe this appliance template..."
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>SSH Username</Label>
                <Input
                  value={formData.default_ssh_username}
                  onChange={(e) => setFormData(prev => ({ ...prev, default_ssh_username: e.target.value }))}
                  placeholder="root"
                />
              </div>

              <div className="space-y-2">
                <Label>SSH Private Key (optional)</Label>
                <Textarea
                  value={formData.ssh_private_key}
                  onChange={(e) => setFormData(prev => ({ ...prev, ssh_private_key: e.target.value }))}
                  placeholder="Paste SSH private key for automated access..."
                  rows={4}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty if using password authentication
                </p>
              </div>
            </TabsContent>

            <TabsContent value="defaults" className="space-y-4 pr-4">
              <div className="space-y-4">
                <h4 className="font-medium text-sm">ZFS Configuration</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>ZFS Pool Name</Label>
                    <Input
                      value={formData.default_zfs_pool_name}
                      onChange={(e) => setFormData(prev => ({ ...prev, default_zfs_pool_name: e.target.value }))}
                      placeholder="tank"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Disk Path</Label>
                    <Input
                      value={formData.default_zfs_disk_path}
                      onChange={(e) => setFormData(prev => ({ ...prev, default_zfs_disk_path: e.target.value }))}
                      placeholder="/dev/sdb"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>NFS Export Network</Label>
                  <Input
                    value={formData.default_nfs_network}
                    onChange={(e) => setFormData(prev => ({ ...prev, default_nfs_network: e.target.value }))}
                    placeholder="192.168.0.0/16"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-medium text-sm">VM Sizing Defaults</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>CPU</Label>
                    <Input
                      type="number"
                      value={formData.default_cpu_count}
                      onChange={(e) => setFormData(prev => ({ ...prev, default_cpu_count: parseInt(e.target.value) || 2 }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Memory (GB)</Label>
                    <Input
                      type="number"
                      value={formData.default_memory_gb}
                      onChange={(e) => setFormData(prev => ({ ...prev, default_memory_gb: parseInt(e.target.value) || 4 }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Disk (GB)</Label>
                    <Input
                      type="number"
                      value={formData.default_zfs_disk_gb}
                      onChange={(e) => setFormData(prev => ({ ...prev, default_zfs_disk_gb: parseInt(e.target.value) || 100 }))}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-medium text-sm">Deployment Defaults (Optional)</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Default Cluster</Label>
                    <Input
                      value={formData.default_cluster}
                      onChange={(e) => setFormData(prev => ({ ...prev, default_cluster: e.target.value }))}
                      placeholder="Leave empty for any"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Default Datastore</Label>
                    <Input
                      value={formData.default_datastore}
                      onChange={(e) => setFormData(prev => ({ ...prev, default_datastore: e.target.value }))}
                      placeholder="Leave empty for any"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Default Network</Label>
                    <Input
                      value={formData.default_network}
                      onChange={(e) => setFormData(prev => ({ ...prev, default_network: e.target.value }))}
                      placeholder="Leave empty for any"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Resource Pool</Label>
                    <Input
                      value={formData.default_resource_pool}
                      onChange={(e) => setFormData(prev => ({ ...prev, default_resource_pool: e.target.value }))}
                      placeholder="Leave empty for default"
                    />
                  </div>
                </div>
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <div className="flex justify-between pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <div className="flex gap-2">
            {activeTab !== "template" && (
              <Button
                variant="outline"
                onClick={() => setActiveTab(activeTab === "defaults" ? "metadata" : "template")}
              >
                Back
              </Button>
            )}
            {activeTab !== "defaults" ? (
              <Button
                onClick={() => setActiveTab(activeTab === "template" ? "metadata" : "defaults")}
                disabled={!canProceed}
              >
                Next
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={isCreating || !formData.name}>
                {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Add to Library
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
