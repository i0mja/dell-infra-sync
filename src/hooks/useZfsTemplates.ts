/**
 * ZFS Target Templates Hook
 * 
 * CRUD operations for ZFS target templates used for automated deployment.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface ZfsTargetTemplate {
  id: string;
  name: string;
  description?: string;
  
  // vCenter reference
  vcenter_id?: string;
  template_moref: string;
  template_name: string;
  
  // Default deployment settings
  default_datacenter?: string;
  default_cluster?: string;
  default_datastore?: string;
  default_network?: string;
  default_resource_pool?: string;
  
  // ZFS configuration defaults
  default_zfs_pool_name: string;
  default_zfs_disk_path: string;
  default_nfs_network: string;
  
  // VM sizing defaults
  default_cpu_count: number;
  default_memory_gb: number;
  default_zfs_disk_gb: number;
  
  // SSH access
  default_ssh_username: string;
  ssh_key_id?: string;           // Reference to centralized ssh_keys table (preferred)
  ssh_key_encrypted?: string;    // Legacy: direct encrypted key storage
  
  // Disk configuration
  use_template_disk?: boolean;   // Skip adding disk, use existing template disk
  
  // Metadata
  is_active: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface ZfsTemplateFormData {
  name: string;
  description?: string;
  vcenter_id?: string;
  template_moref: string;
  template_name: string;
  default_datacenter?: string;
  default_cluster?: string;
  default_datastore?: string;
  default_network?: string;
  default_resource_pool?: string;
  default_zfs_pool_name?: string;
  default_zfs_disk_path?: string;
  default_nfs_network?: string;
  default_cpu_count?: number;
  default_memory_gb?: number;
  default_zfs_disk_gb?: number;
  default_ssh_username?: string;
  ssh_key_id?: string;           // Reference to centralized SSH key
  ssh_private_key?: string;      // Legacy: for direct encryption
  use_template_disk?: boolean;   // Skip adding disk, use existing template disk
}

export function useZfsTemplates() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all templates
  const { data: templates = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ['zfs-target-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zfs_target_templates')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as ZfsTargetTemplate[];
    }
  });

  // Create template
  const createTemplateMutation = useMutation({
    mutationFn: async (template: ZfsTemplateFormData) => {
      const { data: user } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from('zfs_target_templates')
        .insert({
          name: template.name,
          description: template.description,
          vcenter_id: template.vcenter_id,
          template_moref: template.template_moref,
          template_name: template.template_name,
          default_datacenter: template.default_datacenter,
          default_cluster: template.default_cluster,
          default_datastore: template.default_datastore,
          default_network: template.default_network,
          default_resource_pool: template.default_resource_pool,
          default_zfs_pool_name: template.default_zfs_pool_name || 'tank',
          default_zfs_disk_path: template.default_zfs_disk_path || '/dev/sdb',
          default_nfs_network: template.default_nfs_network || '10.0.0.0/8',
          default_cpu_count: template.default_cpu_count || 2,
          default_memory_gb: template.default_memory_gb || 8,
          default_zfs_disk_gb: template.default_zfs_disk_gb || 500,
          default_ssh_username: template.default_ssh_username || 'zfsadmin',
          ssh_key_id: template.ssh_key_id || null,
          is_active: true,
          created_by: user?.user?.id
        })
        .select()
        .single();
      
      if (error) throw error;

      // If SSH key provided, encrypt it
      if (template.ssh_private_key && data) {
        const { error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
          body: {
            type: 'zfs_template',
            template_id: data.id,
            ssh_key: template.ssh_private_key,
          }
        });
        
        if (encryptError) {
          console.error('Failed to encrypt SSH key:', encryptError);
          // Don't fail the template creation, just log the error
        }
      }

      return data as ZfsTargetTemplate;
    },
    onSuccess: () => {
      toast({ title: 'Template created successfully' });
      queryClient.invalidateQueries({ queryKey: ['zfs-target-templates'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  // Update template
  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, template }: { id: string; template: Partial<ZfsTemplateFormData> }) => {
      const updateData: Record<string, unknown> = { ...template };
      delete updateData.ssh_private_key; // Remove from direct update
      updateData.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('zfs_target_templates')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;

      // Legacy: If SSH key provided directly, encrypt it (backward compat)
      if (template.ssh_private_key && !template.ssh_key_id) {
        const { error: encryptError } = await supabase.functions.invoke('encrypt-credentials', {
          body: {
            type: 'zfs_template',
            template_id: id,
            ssh_key: template.ssh_private_key,
          }
        });
        
        if (encryptError) {
          console.error('Failed to encrypt SSH key:', encryptError);
        }
      }

      return data as ZfsTargetTemplate;
    },
    onSuccess: () => {
      toast({ title: 'Template updated successfully' });
      queryClient.invalidateQueries({ queryKey: ['zfs-target-templates'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  // Delete template
  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('zfs_target_templates')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Template deleted' });
      queryClient.invalidateQueries({ queryKey: ['zfs-target-templates'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  // Toggle template active state
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('zfs_target_templates')
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      toast({ title: variables.is_active ? 'Template activated' : 'Template deactivated' });
      queryClient.invalidateQueries({ queryKey: ['zfs-target-templates'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  // Deploy ZFS target from template
  const deployFromTemplateMutation = useMutation({
    mutationFn: async (config: {
      template_id: string;
      vm_name: string;
      // Network configuration
      network_id?: string;
      network_name?: string;
      use_dhcp?: boolean;
      // Static IP config (optional if DHCP)
      ip_address?: string;
      subnet_mask?: string;
      gateway?: string;
      dns_servers?: string[];
      hostname?: string;
      // ZFS config
      zfs_pool_name?: string;
      zfs_disk_gb?: number;
      nfs_network?: string;
      // Resources
      cpu_count?: number;
      memory_gb?: number;
    }) => {
      const { data: user } = await supabase.auth.getUser();
      
      // Create a job for deployment
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'deploy_zfs_target' as const,
          status: 'pending',
          created_by: user?.user?.id,
          target_scope: { template_id: config.template_id },
          details: {
            vm_name: config.vm_name,
            // Network config
            network_id: config.network_id,
            network_name: config.network_name,
            use_dhcp: config.use_dhcp ?? false,
            // IP config (may be undefined if DHCP)
            ip_address: config.ip_address,
            subnet_mask: config.subnet_mask,
            gateway: config.gateway,
            dns_servers: config.dns_servers || [],
            hostname: config.hostname || config.vm_name,
            // ZFS config
            zfs_pool_name: config.zfs_pool_name,
            zfs_disk_gb: config.zfs_disk_gb,
            nfs_network: config.nfs_network,
            // Resources
            cpu_count: config.cpu_count,
            memory_gb: config.memory_gb
          }
        })
        .select()
        .single();

      if (error) throw error;
      return job;
    },
    onSuccess: () => {
      toast({ title: 'Deployment job created', description: 'The ZFS target will be deployed shortly' });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  // Validate template prerequisites
  const validateTemplateMutation = useMutation({
    mutationFn: async (config: {
      template_id: string;
      test_ssh?: boolean;
      deploy_ssh_key?: boolean;
      root_password?: string;
    }) => {
      const { data: user } = await supabase.auth.getUser();
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'validate_zfs_template' as const,
          status: 'pending',
          created_by: user?.user?.id,
          target_scope: { template_id: config.template_id },
          details: {
            template_id: config.template_id,
            test_ssh: config.test_ssh ?? false,
            deploy_ssh_key: config.deploy_ssh_key ?? false,
            root_password: config.root_password
          }
        })
        .select()
        .single();

      if (error) throw error;
      return job;
    },
    onSuccess: () => {
      toast({ title: 'Validation started', description: 'Checking template prerequisites...' });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  return {
    templates,
    loading,
    error: error?.message || null,
    refetch,
    createTemplate: createTemplateMutation.mutateAsync,
    updateTemplate: updateTemplateMutation.mutateAsync,
    deleteTemplate: deleteTemplateMutation.mutateAsync,
    toggleActive: toggleActiveMutation.mutateAsync,
    deployFromTemplate: deployFromTemplateMutation.mutateAsync,
    validateTemplate: validateTemplateMutation.mutateAsync,
    isCreating: createTemplateMutation.isPending,
    isDeploying: deployFromTemplateMutation.isPending,
    isValidating: validateTemplateMutation.isPending
  };
}
