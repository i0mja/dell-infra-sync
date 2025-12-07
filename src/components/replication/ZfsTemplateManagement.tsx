/**
 * ZFS Template Management Panel
 * 
 * Allows admins to register and manage ZFS target templates
 * for automated deployment.
 */

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2, Edit, Server, HardDrive, Cpu, MemoryStick, Network, Key, CheckCircle2, XCircle, Search } from 'lucide-react';
import { useZfsTemplates, ZfsTemplateFormData } from '@/hooks/useZfsTemplates';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { VmTemplateSelector } from './VmTemplateSelector';

const initialFormData: ZfsTemplateFormData = {
  name: '',
  description: '',
  vcenter_id: '',
  template_moref: '',
  template_name: '',
  default_datacenter: '',
  default_cluster: '',
  default_datastore: '',
  default_network: '',
  default_resource_pool: '',
  default_zfs_pool_name: 'tank',
  default_zfs_disk_path: '/dev/sdb',
  default_nfs_network: '10.0.0.0/8',
  default_cpu_count: 2,
  default_memory_gb: 8,
  default_zfs_disk_gb: 500,
  default_ssh_username: 'zfsadmin',
  ssh_private_key: ''
};

export function ZfsTemplateManagement() {
  const { templates, loading, createTemplate, updateTemplate, deleteTemplate, toggleActive, isCreating } = useZfsTemplates();
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ZfsTemplateFormData>(initialFormData);
  const [activeTab, setActiveTab] = useState('basic');
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);

  // Fetch vCenters for dropdown (use vcenters table, not vcenter_settings)
  const { data: vcenters = [] } = useQuery({
    queryKey: ['vcenters-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vcenters')
        .select('id, name, host')
        .order('name');
      if (error) throw error;
      return data;
    }
  });

  // Fetch clusters for the selected vCenter
  const { data: clusters = [] } = useQuery({
    queryKey: ['vcenter-clusters', formData.vcenter_id],
    queryFn: async () => {
      if (!formData.vcenter_id) return [];
      const { data, error } = await supabase
        .from('vcenter_clusters')
        .select('cluster_name')
        .eq('source_vcenter_id', formData.vcenter_id)
        .order('cluster_name');
      if (error) throw error;
      return data;
    },
    enabled: !!formData.vcenter_id
  });

  // Fetch datastores for the selected vCenter
  const { data: datastores = [] } = useQuery({
    queryKey: ['vcenter-datastores', formData.vcenter_id],
    queryFn: async () => {
      if (!formData.vcenter_id) return [];
      const { data, error } = await supabase
        .from('vcenter_datastores')
        .select('name')
        .eq('source_vcenter_id', formData.vcenter_id)
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!formData.vcenter_id
  });

  // Fetch networks for the selected vCenter
  const { data: networks = [] } = useQuery({
    queryKey: ['vcenter-networks', formData.vcenter_id],
    queryFn: async () => {
      if (!formData.vcenter_id) return [];
      const { data, error } = await supabase
        .from('vcenter_networks')
        .select('name')
        .eq('source_vcenter_id', formData.vcenter_id)
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!formData.vcenter_id
  });

  // Get unique cluster names
  const clusterNames = useMemo(() => {
    return [...new Set(clusters.map(c => c.cluster_name))].filter(Boolean);
  }, [clusters]);

  // Get unique datastore names
  const datastoreNames = useMemo(() => {
    return [...new Set(datastores.map(d => d.name))].filter(Boolean);
  }, [datastores]);

  // Get unique network names
  const networkNames = useMemo(() => {
    return [...new Set(networks.map(n => n.name))].filter(Boolean);
  }, [networks]);

  // Handle vCenter change - clear dependent selections
  const handleVCenterChange = (value: string) => {
    setFormData({
      ...formData,
      vcenter_id: value,
      template_moref: '',
      template_name: '',
      default_cluster: '',
      default_datastore: '',
      default_network: ''
    });
  };

  // Handle template selection from browser
  const handleTemplateSelect = (template: { moref: string; name: string; cluster?: string }) => {
    setFormData({
      ...formData,
      template_moref: template.moref,
      template_name: template.name,
      default_cluster: template.cluster || formData.default_cluster
    });
  };

  const handleOpenDialog = (template?: typeof templates[0]) => {
    if (template) {
      setEditingId(template.id);
      setFormData({
        name: template.name,
        description: template.description || '',
        vcenter_id: template.vcenter_id || '',
        template_moref: template.template_moref,
        template_name: template.template_name,
        default_datacenter: template.default_datacenter || '',
        default_cluster: template.default_cluster || '',
        default_datastore: template.default_datastore || '',
        default_network: template.default_network || '',
        default_resource_pool: template.default_resource_pool || '',
        default_zfs_pool_name: template.default_zfs_pool_name,
        default_zfs_disk_path: template.default_zfs_disk_path,
        default_nfs_network: template.default_nfs_network,
        default_cpu_count: template.default_cpu_count,
        default_memory_gb: template.default_memory_gb,
        default_zfs_disk_gb: template.default_zfs_disk_gb,
        default_ssh_username: template.default_ssh_username,
        ssh_private_key: ''
      });
    } else {
      setEditingId(null);
      setFormData(initialFormData);
    }
    setActiveTab('basic');
    setShowDialog(true);
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    setEditingId(null);
    setFormData(initialFormData);
  };

  const handleSubmit = async () => {
    try {
      if (editingId) {
        await updateTemplate({ id: editingId, template: formData });
      } else {
        await createTemplate(formData);
      }
      handleCloseDialog();
    } catch (error) {
      // Error handled by hook
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this template?')) {
      await deleteTemplate(id);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>ZFS Target Templates</CardTitle>
          <CardDescription>Loading templates...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            ZFS Target Templates
          </CardTitle>
          <CardDescription>
            Pre-configured VM templates for automated ZFS replication target deployment
          </CardDescription>
        </div>
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              Add Template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Template' : 'Add ZFS Target Template'}</DialogTitle>
              <DialogDescription>
                Configure a VMware template for automated ZFS target deployment
              </DialogDescription>
            </DialogHeader>
            
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="basic">Basic</TabsTrigger>
                <TabsTrigger value="vmware">VMware</TabsTrigger>
                <TabsTrigger value="zfs">ZFS/NFS</TabsTrigger>
                <TabsTrigger value="ssh">SSH Access</TabsTrigger>
              </TabsList>

              <TabsContent value="basic" className="space-y-4 mt-4">
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="name">Template Name *</Label>
                    <Input
                      id="name"
                      placeholder="e.g., Debian 12 ZFS Target"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      placeholder="Optional description of this template"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="vcenter">vCenter *</Label>
                    <Select
                      value={formData.vcenter_id}
                      onValueChange={handleVCenterChange}
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
                    <p className="text-xs text-muted-foreground">
                      Select a vCenter to browse templates, clusters, datastores, and networks
                    </p>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="vmware" className="space-y-4 mt-4">
                {!formData.vcenter_id ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <Server className="h-12 w-12 mb-2 opacity-50" />
                    <p>Please select a vCenter in the Basic tab first</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {/* Template Selection */}
                    <div className="grid gap-2">
                      <Label>VM Template *</Label>
                      <div className="flex gap-2">
                        <div className="flex-1 p-2 border rounded-md bg-muted/30 min-h-[38px] flex items-center">
                          {formData.template_moref ? (
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-primary" />
                              <span className="font-medium">{formData.template_name}</span>
                              <code className="text-xs bg-muted px-1 rounded">{formData.template_moref}</code>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">No template selected</span>
                          )}
                        </div>
                        <Button 
                          type="button" 
                          variant="outline"
                          onClick={() => setShowTemplateSelector(true)}
                        >
                          <Search className="h-4 w-4 mr-2" />
                          Browse
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Select a powered-off VM or template from your vCenter inventory
                      </p>
                    </div>

                    {/* Datacenter - keep as text input since we don't sync datacenters */}
                    <div className="grid gap-2">
                      <Label htmlFor="default_datacenter">Default Datacenter</Label>
                      <Input
                        id="default_datacenter"
                        placeholder="e.g., Datacenter1"
                        value={formData.default_datacenter}
                        onChange={(e) => setFormData({ ...formData, default_datacenter: e.target.value })}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {/* Cluster Dropdown */}
                      <div className="grid gap-2">
                        <Label htmlFor="default_cluster">Default Cluster</Label>
                        <Select
                          value={formData.default_cluster}
                          onValueChange={(value) => setFormData({ ...formData, default_cluster: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select cluster" />
                          </SelectTrigger>
                          <SelectContent>
                            {clusterNames.map((name) => (
                              <SelectItem key={name} value={name!}>
                                {name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Datastore Dropdown */}
                      <div className="grid gap-2">
                        <Label htmlFor="default_datastore">Default Datastore</Label>
                        <Select
                          value={formData.default_datastore}
                          onValueChange={(value) => setFormData({ ...formData, default_datastore: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select datastore" />
                          </SelectTrigger>
                          <SelectContent>
                            {datastoreNames.map((name) => (
                              <SelectItem key={name} value={name!}>
                                {name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Network Dropdown */}
                    <div className="grid gap-2">
                      <Label htmlFor="default_network">Default Network</Label>
                      <Select
                        value={formData.default_network}
                        onValueChange={(value) => setFormData({ ...formData, default_network: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select network" />
                        </SelectTrigger>
                        <SelectContent>
                          {networkNames.map((name) => (
                            <SelectItem key={name} value={name!}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="default_cpu_count" className="flex items-center gap-1">
                          <Cpu className="h-3 w-3" /> CPUs
                        </Label>
                        <Input
                          id="default_cpu_count"
                          type="number"
                          min={1}
                          value={formData.default_cpu_count}
                          onChange={(e) => setFormData({ ...formData, default_cpu_count: parseInt(e.target.value) || 2 })}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="default_memory_gb" className="flex items-center gap-1">
                          <MemoryStick className="h-3 w-3" /> Memory (GB)
                        </Label>
                        <Input
                          id="default_memory_gb"
                          type="number"
                          min={1}
                          value={formData.default_memory_gb}
                          onChange={(e) => setFormData({ ...formData, default_memory_gb: parseInt(e.target.value) || 8 })}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="default_zfs_disk_gb" className="flex items-center gap-1">
                          <HardDrive className="h-3 w-3" /> ZFS Disk (GB)
                        </Label>
                        <Input
                          id="default_zfs_disk_gb"
                          type="number"
                          min={50}
                          value={formData.default_zfs_disk_gb}
                          onChange={(e) => setFormData({ ...formData, default_zfs_disk_gb: parseInt(e.target.value) || 500 })}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="zfs" className="space-y-4 mt-4">
                <div className="grid gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="default_zfs_pool_name">ZFS Pool Name</Label>
                      <Input
                        id="default_zfs_pool_name"
                        placeholder="tank"
                        value={formData.default_zfs_pool_name}
                        onChange={(e) => setFormData({ ...formData, default_zfs_pool_name: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="default_zfs_disk_path">ZFS Disk Device Path</Label>
                      <Input
                        id="default_zfs_disk_path"
                        placeholder="/dev/sdb"
                        value={formData.default_zfs_disk_path}
                        onChange={(e) => setFormData({ ...formData, default_zfs_disk_path: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="default_nfs_network" className="flex items-center gap-1">
                      <Network className="h-3 w-3" /> NFS Export Network (CIDR)
                    </Label>
                    <Input
                      id="default_nfs_network"
                      placeholder="10.0.0.0/8"
                      value={formData.default_nfs_network}
                      onChange={(e) => setFormData({ ...formData, default_nfs_network: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Network CIDR that can access the NFS export (e.g., 10.0.0.0/8 or 192.168.1.0/24)
                    </p>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="ssh" className="space-y-4 mt-4">
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="default_ssh_username" className="flex items-center gap-1">
                      <Key className="h-3 w-3" /> SSH Username
                    </Label>
                    <Input
                      id="default_ssh_username"
                      placeholder="zfsadmin"
                      value={formData.default_ssh_username}
                      onChange={(e) => setFormData({ ...formData, default_ssh_username: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ssh_private_key">SSH Private Key (Optional)</Label>
                    <Textarea
                      id="ssh_private_key"
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                      className="font-mono text-xs"
                      rows={6}
                      value={formData.ssh_private_key}
                      onChange={(e) => setFormData({ ...formData, ssh_private_key: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Private key for SSH access. Will be encrypted before storage.
                      The template VM should have the corresponding public key in ~/.ssh/authorized_keys
                    </p>
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={handleCloseDialog}>
                Cancel
              </Button>
              <Button 
                onClick={handleSubmit} 
                disabled={!formData.name || !formData.template_moref || !formData.template_name || isCreating}
              >
                {isCreating ? 'Saving...' : (editingId ? 'Update Template' : 'Add Template')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>

      <CardContent>
        {templates.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No templates configured</p>
            <p className="text-sm">Add a template to enable automated ZFS target deployment</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>vCenter</TableHead>
                <TableHead>Resources</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => {
                const vcenter = vcenters.find(vc => vc.id === template.vcenter_id);
                return (
                  <TableRow key={template.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{template.name}</div>
                        {template.description && (
                          <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {template.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">
                        <div>{template.template_name}</div>
                        <div className="text-muted-foreground">{template.template_moref}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {vcenter?.host || <span className="text-muted-foreground">Not set</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="flex items-center gap-1">
                          <Cpu className="h-3 w-3" /> {template.default_cpu_count}
                        </span>
                        <span className="flex items-center gap-1">
                          <MemoryStick className="h-3 w-3" /> {template.default_memory_gb}GB
                        </span>
                        <span className="flex items-center gap-1">
                          <HardDrive className="h-3 w-3" /> {template.default_zfs_disk_gb}GB
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {template.is_active ? (
                          <Badge variant="default" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <XCircle className="h-3 w-3" /> Inactive
                          </Badge>
                        )}
                        <Switch
                          checked={template.is_active}
                          onCheckedChange={(checked) => toggleActive({ id: template.id, is_active: checked })}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(template.created_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenDialog(template)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(template.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Template Selector Dialog */}
      <VmTemplateSelector
        open={showTemplateSelector}
        onOpenChange={setShowTemplateSelector}
        sourceVCenterId={formData.vcenter_id}
        onSelect={handleTemplateSelect}
      />
    </Card>
  );
}
