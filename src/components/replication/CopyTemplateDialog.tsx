/**
 * Cross-vCenter Template Copy Dialog
 * 
 * Allows copying a ZFS target template from one vCenter to another
 * using OVF export/import.
 */

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, Copy, Server, ArrowRight, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ZfsTargetTemplate } from '@/hooks/useZfsTemplates';

interface CopyTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ZfsTargetTemplate | null;
  sourceVCenterName: string;
}

export function CopyTemplateDialog({ 
  open, 
  onOpenChange, 
  template, 
  sourceVCenterName 
}: CopyTemplateDialogProps) {
  const { toast } = useToast();
  const [isCopying, setIsCopying] = useState(false);
  const [destVCenterId, setDestVCenterId] = useState('');
  const [destDatacenter, setDestDatacenter] = useState('');
  const [destCluster, setDestCluster] = useState('');
  const [destDatastore, setDestDatastore] = useState('');
  const [newTemplateName, setNewTemplateName] = useState('');

  // Fetch all vCenters (excluding source)
  const { data: vcenters = [] } = useQuery({
    queryKey: ['vcenters-for-copy'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vcenters')
        .select('id, name, host, datacenter_location')
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: open
  });

  // Filter out source vCenter
  const destinationVCenters = vcenters.filter(vc => vc.id !== template?.vcenter_id);

  // Fetch clusters for destination vCenter
  const { data: clusters = [], isLoading: loadingClusters } = useQuery({
    queryKey: ['dest-clusters', destVCenterId],
    queryFn: async () => {
      if (!destVCenterId) return [];
      const { data, error } = await supabase
        .from('vcenter_clusters')
        .select('cluster_name')
        .eq('source_vcenter_id', destVCenterId)
        .order('cluster_name');
      if (error) throw error;
      return data;
    },
    enabled: !!destVCenterId
  });

  // Fetch datastores for destination vCenter
  const { data: datastores = [], isLoading: loadingDatastores } = useQuery({
    queryKey: ['dest-datastores', destVCenterId],
    queryFn: async () => {
      if (!destVCenterId) return [];
      const { data, error } = await supabase
        .from('vcenter_datastores')
        .select('name')
        .eq('source_vcenter_id', destVCenterId)
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!destVCenterId
  });

  // Get unique names
  const clusterNames = [...new Set(clusters.map(c => c.cluster_name))].filter(Boolean);
  const datastoreNames = [...new Set(datastores.map(d => d.name))].filter(Boolean);

  // Set default template name when dialog opens or destination changes
  useEffect(() => {
    if (template && destVCenterId) {
      const destVC = vcenters.find(vc => vc.id === destVCenterId);
      const location = destVC?.datacenter_location || destVC?.name || 'copy';
      setNewTemplateName(`${template.template_name}-${location.toLowerCase().replace(/\s+/g, '-')}`);
    }
  }, [template, destVCenterId, vcenters]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setDestVCenterId('');
      setDestDatacenter('');
      setDestCluster('');
      setDestDatastore('');
      setNewTemplateName('');
    }
  }, [open]);

  const handleCopy = async () => {
    if (!template || !destVCenterId || !destDatastore || !newTemplateName) {
      toast({
        title: 'Missing required fields',
        description: 'Please fill in all required fields',
        variant: 'destructive'
      });
      return;
    }

    setIsCopying(true);
    try {
      // Create job for cross-vCenter template copy
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'copy_template_cross_vcenter' as any,
          status: 'pending',
          details: {
            source_template_id: template.id,
            source_vcenter_id: template.vcenter_id,
            source_template_moref: template.template_moref,
            source_template_name: template.template_name,
            dest_vcenter_id: destVCenterId,
            dest_datacenter: destDatacenter || null,
            dest_cluster: destCluster || null,
            dest_datastore: destDatastore,
            new_template_name: newTemplateName,
            create_db_entry: true,
            // Copy template settings for the new entry
            template_settings: {
              name: `${template.name} (${vcenters.find(v => v.id === destVCenterId)?.name})`,
              description: template.description,
              default_zfs_pool_name: template.default_zfs_pool_name,
              default_zfs_disk_path: template.default_zfs_disk_path,
              default_nfs_network: template.default_nfs_network,
              default_cpu_count: template.default_cpu_count,
              default_memory_gb: template.default_memory_gb,
              default_zfs_disk_gb: template.default_zfs_disk_gb,
              default_ssh_username: template.default_ssh_username
            }
          },
          target_scope: {
            source_vcenter_id: template.vcenter_id,
            dest_vcenter_id: destVCenterId
          }
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Template copy job created',
        description: `Job ${job.id.slice(0, 8)} started. Check the Jobs panel for progress.`
      });

      onOpenChange(false);
    } catch (err) {
      console.error('Failed to create copy job:', err);
      toast({
        title: 'Failed to start copy',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setIsCopying(false);
    }
  };

  const selectedDestVC = vcenters.find(vc => vc.id === destVCenterId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Copy Template to Another vCenter
          </DialogTitle>
          <DialogDescription>
            Export this template via OVF and import it to a different vCenter
          </DialogDescription>
        </DialogHeader>

        {template && (
          <div className="space-y-4">
            {/* Source info */}
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <Server className="h-4 w-4" />
                Source Template
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Template:</span>{' '}
                  <span className="font-mono">{template.template_name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">vCenter:</span>{' '}
                  <Badge variant="outline">{sourceVCenterName}</Badge>
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
            </div>

            {/* Destination selection */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Destination vCenter *</Label>
                <Select value={destVCenterId} onValueChange={setDestVCenterId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select destination vCenter" />
                  </SelectTrigger>
                  <SelectContent>
                    {destinationVCenters.map(vc => (
                      <SelectItem key={vc.id} value={vc.id}>
                        {vc.name} ({vc.host})
                        {vc.datacenter_location && ` - ${vc.datacenter_location}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {destinationVCenters.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No other vCenters available. Add another vCenter connection first.
                  </p>
                )}
              </div>

              {destVCenterId && (
                <>
                  <div className="space-y-2">
                    <Label>Datacenter (optional)</Label>
                    <Input
                      placeholder="e.g., Lyon-DC"
                      value={destDatacenter}
                      onChange={e => setDestDatacenter(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Cluster</Label>
                      <Select value={destCluster} onValueChange={setDestCluster}>
                        <SelectTrigger>
                          <SelectValue placeholder={loadingClusters ? "Loading..." : "Select cluster"} />
                        </SelectTrigger>
                        <SelectContent>
                          {clusterNames.map(name => (
                            <SelectItem key={name} value={name!}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Datastore *</Label>
                      <Select value={destDatastore} onValueChange={setDestDatastore}>
                        <SelectTrigger>
                          <SelectValue placeholder={loadingDatastores ? "Loading..." : "Select datastore"} />
                        </SelectTrigger>
                        <SelectContent>
                          {datastoreNames.map(name => (
                            <SelectItem key={name} value={name!}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>New Template Name *</Label>
                    <Input
                      placeholder="e.g., zfs-target-template-lyon"
                      value={newTemplateName}
                      onChange={e => setNewTemplateName(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      This will be the name of the template in the destination vCenter
                    </p>
                  </div>
                </>
              )}
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                This operation exports the template as OVF from {sourceVCenterName} and imports 
                it to {selectedDestVC?.name || 'the destination vCenter'}. This may take several 
                minutes depending on template size.
              </AlertDescription>
            </Alert>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCopying}>
            Cancel
          </Button>
          <Button 
            onClick={handleCopy} 
            disabled={isCopying || !destVCenterId || !destDatastore || !newTemplateName}
          >
            {isCopying ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating Job...
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                Copy Template
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}