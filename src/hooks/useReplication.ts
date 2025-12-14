/**
 * Zerfaux Replication Hooks
 * 
 * React hooks for fetching and managing replication data from Supabase.
 * Job Executor API is only used for operational actions (run replication, vMotion, DR shell).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// Get Job Executor URL for operations only
const getJobExecutorUrl = (): string => {
  return localStorage.getItem('job_executor_url') || 
         import.meta.env.VITE_JOB_EXECUTOR_URL || 
         'http://localhost:8081';
};

// Generic fetch helper for Job Executor operations only
async function fetchJobExecutor<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getJobExecutorUrl();
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  
  return response.json();
}

// Types
export interface ReplicationTarget {
  id: string;
  name: string;
  description?: string;
  target_type: string;
  hostname: string;
  port: number;
  zfs_pool: string;
  zfs_dataset_prefix?: string;
  ssh_username?: string;
  dr_vcenter_id?: string;
  is_active: boolean;
  health_status: string;
  last_health_check?: string;
  created_at: string;
  site_role?: string;
  partner_target_id?: string;
  ssh_trust_established?: boolean;
  ssh_key_id?: string;
  datastore_name?: string;
  nfs_export_path?: string;
  hosting_vm_id?: string;
  // Joined hosting VM info
  hosting_vm?: {
    id: string;
    name: string;
    ip_address?: string;
    power_state?: string;
  } | null;
  // Joined linked datastore info
  linked_datastore?: {
    id: string;
    name: string;
    type?: string;
    capacity_bytes?: number;
    free_bytes?: number;
  } | null;
  // Joined partner target info
  partner_target?: {
    id: string;
    name: string;
    hostname: string;
    zfs_pool: string;
    health_status: string;
    dr_vcenter_id?: string;
    ssh_trust_established?: boolean;
  } | null;
}

export interface ProtectionGroup {
  id: string;
  name: string;
  description?: string;
  source_vcenter_id?: string;
  target_id?: string;
  protection_datastore?: string;
  dr_datastore?: string;
  dr_dataset?: string;
  replication_schedule?: string;
  retention_policy: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  rpo_minutes: number;
  is_enabled: boolean;
  last_replication_at?: string;
  next_replication_at?: string;
  vm_count?: number;
  created_at: string;
  // Phase 1 new fields
  replication_pair_id?: string;
  status?: string;
  priority?: string;
  boot_order?: unknown;
  current_rpo_seconds?: number;
  journal_history_hours?: number;
  test_reminder_days?: number;
  last_test_at?: string;
  paused_at?: string;
  pause_reason?: string;
}

export interface ProtectedVM {
  id: string;
  protection_group_id: string;
  vm_id?: string;
  vm_name: string;
  vm_vcenter_id?: string;
  current_datastore?: string;
  target_datastore?: string;
  needs_storage_vmotion: boolean;
  dr_shell_vm_name?: string;
  dr_shell_vm_created: boolean;
  dr_shell_vm_id?: string;
  last_snapshot_at?: string;
  last_replication_at?: string;
  replication_status: string;
  status_message?: string;
  priority: number;
  created_at: string;
}

export interface ReplicationJob {
  id: string;
  protection_group_id?: string;
  protected_vm_id?: string;
  job_type: string;
  status: string;
  started_at?: string;
  completed_at?: string;
  bytes_transferred: number;
  snapshot_name?: string;
  error_message?: string;
  created_at: string;
}

export interface VCenterConnection {
  id: string;
  host: string;
  port: number;
  username: string;
  sync_enabled: boolean;
  last_sync?: string;
}

export interface VCenterVM {
  id: string;
  name: string;
  power_state?: string;
  guest_os?: string;
  cpu_count?: number;
  memory_mb?: number;
  disk_gb?: number;
  ip_address?: string;
  cluster_name?: string;
}

// ==========================================
// Hooks using Supabase directly
// ==========================================

// Types for decommission flow
export interface TargetDependencies {
  dependentGroups: Array<{ id: string; name: string; vm_count?: number }>;
  partnerTarget: { id: string; name: string } | null;
  hasDeployedVm: boolean;
}

export function useReplicationTargets() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: targets = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ['replication-targets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('replication_targets')
        .select('*')
        .is('archived_at', null) // Only show non-archived targets
        .order('name');
      if (error) throw error;

      const targetIds = (data || []).map(t => t.id);
      const hostingVmIds = (data || []).filter(t => t.hosting_vm_id).map(t => t.hosting_vm_id);
      const partnerIds = (data || []).filter(t => t.partner_target_id).map(t => t.partner_target_id);
      
      // Collect deployed_vm_morefs for targets without hosting_vm_id (fallback lookup)
      const morefTargets = (data || []).filter(t => !t.hosting_vm_id && t.deployed_vm_moref);
      const morefs = morefTargets.map(t => t.deployed_vm_moref);

      // Fetch hosting VMs, linked datastores, partner targets, and moref fallback VMs in parallel
      const [hostingVmsResult, linkedDatastoresResult, partnersResult, morefVmsResult] = await Promise.all([
        hostingVmIds.length > 0 
          ? supabase.from('vcenter_vms').select('id, name, ip_address, power_state, vcenter_id').in('id', hostingVmIds)
          : { data: [] },
        targetIds.length > 0
          ? supabase.from('vcenter_datastores').select('id, name, type, capacity_bytes, free_bytes, replication_target_id').in('replication_target_id', targetIds)
          : { data: [] },
        partnerIds.length > 0
          ? supabase.from('replication_targets').select('id, name, hostname, zfs_pool, health_status, dr_vcenter_id, ssh_trust_established').in('id', partnerIds)
          : { data: [] },
        // Fallback: look up VMs by deployed_vm_moref (stored in vcenter_id column)
        morefs.length > 0
          ? supabase.from('vcenter_vms').select('id, name, ip_address, power_state, vcenter_id').in('vcenter_id', morefs)
          : { data: [] }
      ]);

      // Build lookup maps
      const vmMap: Record<string, ReplicationTarget['hosting_vm'] & { vcenter_id?: string }> = {};
      (hostingVmsResult.data || []).forEach(vm => { vmMap[vm.id] = vm; });
      
      // Build moref -> VM lookup for fallback
      const morefVmMap: Record<string, ReplicationTarget['hosting_vm'] & { vcenter_id?: string }> = {};
      (morefVmsResult.data || []).forEach(vm => { 
        if (vm.vcenter_id) morefVmMap[vm.vcenter_id] = vm; 
      });

      const datastoreMap: Record<string, ReplicationTarget['linked_datastore']> = {};
      (linkedDatastoresResult.data || []).forEach(ds => { 
        if (ds.replication_target_id) datastoreMap[ds.replication_target_id] = ds; 
      });

      const partnerMap: Record<string, ReplicationTarget['partner_target']> = {};
      (partnersResult.data || []).forEach(p => { partnerMap[p.id] = p; });

      // Map targets with VM lookup fallback via moref
      const enrichedTargets = (data || []).map(t => {
        let hosting_vm: ReplicationTarget['hosting_vm'] = null;
        
        // First try hosting_vm_id
        if (t.hosting_vm_id && vmMap[t.hosting_vm_id]) {
          hosting_vm = vmMap[t.hosting_vm_id];
        } 
        // Fallback: try deployed_vm_moref
        else if (t.deployed_vm_moref && morefVmMap[t.deployed_vm_moref]) {
          hosting_vm = morefVmMap[t.deployed_vm_moref];
          // Auto-update hosting_vm_id in background (fire and forget)
          if (hosting_vm?.id) {
            supabase
              .from('replication_targets')
              .update({ hosting_vm_id: hosting_vm.id })
              .eq('id', t.id)
              .then(() => console.log(`[useReplicationTargets] Auto-linked VM ${hosting_vm?.name} to target ${t.name}`));
          }
        }
        
        return {
          ...t,
          hosting_vm,
          linked_datastore: datastoreMap[t.id] || null,
          partner_target: t.partner_target_id ? partnerMap[t.partner_target_id] || null : null
        };
      }) as ReplicationTarget[];
      
      return enrichedTargets;
    }
  });

  const createTargetMutation = useMutation({
    mutationFn: async (target: Partial<ReplicationTarget>) => {
      const { data, error } = await supabase
        .from('replication_targets')
        .insert({
          name: target.name,
          description: target.description,
          target_type: target.target_type || 'zfs',
          hostname: target.hostname,
          port: target.port || 22,
          zfs_pool: target.zfs_pool,
          zfs_dataset_prefix: target.zfs_dataset_prefix,
          ssh_username: target.ssh_username,
          dr_vcenter_id: target.dr_vcenter_id,
          is_active: target.is_active ?? true,
          health_status: 'unknown'
        })
        .select()
        .single();
      if (error) throw error;
      return data as ReplicationTarget;
    },
    onSuccess: () => {
      toast({ title: 'Target created successfully' });
      queryClient.invalidateQueries({ queryKey: ['replication-targets'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  const deleteTargetMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('replication_targets')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Target deleted' });
      queryClient.invalidateQueries({ queryKey: ['replication-targets'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  // Archive target (soft delete)
  const archiveTargetMutation = useMutation({
    mutationFn: async (id: string) => {
      // Clear partner relationship first
      const { data: target } = await supabase
        .from('replication_targets')
        .select('partner_target_id')
        .eq('id', id)
        .single();
      
      if (target?.partner_target_id) {
        await supabase
          .from('replication_targets')
          .update({ partner_target_id: null, site_role: null })
          .eq('id', target.partner_target_id);
      }

      const { error } = await supabase
        .from('replication_targets')
        .update({ 
          archived_at: new Date().toISOString(),
          partner_target_id: null,
          site_role: null,
          is_active: false
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Target archived' });
      queryClient.invalidateQueries({ queryKey: ['replication-targets'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  // Decommission target (creates job for full cleanup)
  const decommissionTargetMutation = useMutation({
    mutationFn: async (id: string) => {
      // Get target details for the job
      const { data: target, error: fetchErr } = await supabase
        .from('replication_targets')
        .select('*')
        .eq('id', id)
        .single();
      if (fetchErr) throw fetchErr;

      // Clear partner relationship
      if (target?.partner_target_id) {
        await supabase
          .from('replication_targets')
          .update({ partner_target_id: null, site_role: null })
          .eq('id', target.partner_target_id);
      }

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();

      // Create decommission job
      const { data: job, error: jobErr } = await supabase
        .from('jobs')
        .insert({
          job_type: 'decommission_zfs_target' as any,
          status: 'pending',
          created_by: user?.id,
          target_scope: { replication_target_id: id },
          details: {
            target_id: id,
            target_name: target.name,
            hostname: target.hostname,
            zfs_pool: target.zfs_pool,
            dr_vcenter_id: target.dr_vcenter_id,
            deployed_vm_moref: target.deployed_vm_moref,
            actions: ['destroy_zfs_pool', 'remove_nfs_datastore', 'power_off_vm', 'delete_vm']
          }
        })
        .select()
        .single();
      if (jobErr) throw jobErr;

      // Mark target as being decommissioned
      await supabase
        .from('replication_targets')
        .update({ 
          is_active: false,
          health_status: 'decommissioning',
          partner_target_id: null,
          site_role: null
        })
        .eq('id', id);

      return job;
    },
    onSuccess: () => {
      toast({ 
        title: 'Decommission job created',
        description: 'Check Jobs page for progress'
      });
      queryClient.invalidateQueries({ queryKey: ['replication-targets'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  // Check target dependencies before deletion
  const checkTargetDependencies = async (targetId: string): Promise<TargetDependencies> => {
    // Get protection groups using this target
    const { data: groups } = await supabase
      .from('protection_groups')
      .select('id, name')
      .eq('target_id', targetId);

    // Get VM counts for each group
    const groupsWithCounts: TargetDependencies['dependentGroups'] = [];
    if (groups && groups.length > 0) {
      for (const g of groups) {
        const { count } = await supabase
          .from('protected_vms')
          .select('*', { count: 'exact', head: true })
          .eq('protection_group_id', g.id);
        groupsWithCounts.push({ ...g, vm_count: count || 0 });
      }
    }

    // Get partner target info
    const { data: target } = await supabase
      .from('replication_targets')
      .select('partner_target_id, deployed_vm_moref')
      .eq('id', targetId)
      .single();

    let partnerTarget: TargetDependencies['partnerTarget'] = null;
    if (target?.partner_target_id) {
      const { data: partner } = await supabase
        .from('replication_targets')
        .select('id, name')
        .eq('id', target.partner_target_id)
        .single();
      if (partner) {
        partnerTarget = partner;
      }
    }

    return {
      dependentGroups: groupsWithCounts,
      partnerTarget,
      hasDeployedVm: !!target?.deployed_vm_moref
    };
  };

  const updateTargetMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<ReplicationTarget> }) => {
      const updatePayload: Record<string, any> = {};
      
      // Only include fields that are explicitly provided
      if (updates.name !== undefined) updatePayload.name = updates.name;
      if (updates.description !== undefined) updatePayload.description = updates.description;
      if (updates.partner_target_id !== undefined) updatePayload.partner_target_id = updates.partner_target_id;
      if (updates.site_role !== undefined) updatePayload.site_role = updates.site_role;
      if (updates.dr_vcenter_id !== undefined) updatePayload.dr_vcenter_id = updates.dr_vcenter_id;
      if (updates.hosting_vm_id !== undefined) updatePayload.hosting_vm_id = updates.hosting_vm_id;
      if (updates.hostname !== undefined) updatePayload.hostname = updates.hostname;
      
      const { data, error } = await supabase
        .from('replication_targets')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as ReplicationTarget;
    },
    onSuccess: () => {
      toast({ title: 'Target updated' });
      queryClient.invalidateQueries({ queryKey: ['replication-targets'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  // Set partner relationship (bidirectional)
  const setPartnerMutation = useMutation({
    mutationFn: async ({ sourceId, partnerId }: { sourceId: string; partnerId: string | null }) => {
      // If setting a partner, update both sides
      if (partnerId) {
        // Update source to point to partner
        const { error: err1 } = await supabase
          .from('replication_targets')
          .update({ partner_target_id: partnerId, site_role: 'primary' })
          .eq('id', sourceId);
        if (err1) throw err1;

        // Update partner to point back to source
        const { error: err2 } = await supabase
          .from('replication_targets')
          .update({ partner_target_id: sourceId, site_role: 'dr' })
          .eq('id', partnerId);
        if (err2) throw err2;
      } else {
        // Clearing partner - get current partner first
        const { data: current } = await supabase
          .from('replication_targets')
          .select('partner_target_id')
          .eq('id', sourceId)
          .single();
        
        // Clear source
        const { error: err1 } = await supabase
          .from('replication_targets')
          .update({ partner_target_id: null, site_role: null })
          .eq('id', sourceId);
        if (err1) throw err1;

        // Clear former partner if exists
        if (current?.partner_target_id) {
          const { error: err2 } = await supabase
            .from('replication_targets')
            .update({ partner_target_id: null, site_role: null })
            .eq('id', current.partner_target_id);
          if (err2) throw err2;
        }
      }
    },
    onSuccess: (_, variables) => {
      toast({ title: variables.partnerId ? 'Targets paired successfully' : 'Pairing removed' });
      queryClient.invalidateQueries({ queryKey: ['replication-targets'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  return { 
    targets, 
    loading, 
    error: error?.message || null, 
    refetch, 
    createTarget: createTargetMutation.mutateAsync, 
    deleteTarget: deleteTargetMutation.mutateAsync,
    archiveTarget: archiveTargetMutation.mutateAsync,
    decommissionTarget: decommissionTargetMutation.mutateAsync,
    checkTargetDependencies,
    updateTarget: updateTargetMutation.mutateAsync,
    setPartner: setPartnerMutation.mutateAsync
  };
}

export function useProtectionGroups() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: groups = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ['protection-groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('protection_groups')
        .select('*, protected_vms(count)')
        .order('name');
      if (error) throw error;
      // Map database fields to interface, handling JSON retention_policy and VM count
      return (data || []).map(row => ({
        ...row,
        vm_count: (row.protected_vms as { count: number }[])?.[0]?.count || 0,
        retention_policy: (row.retention_policy as { daily: number; weekly: number; monthly: number }) || { daily: 7, weekly: 4, monthly: 12 }
      })) as ProtectionGroup[];
    },
    refetchInterval: 15000 // Auto-refresh every 15 seconds
  });

  // Real-time subscription for protection groups and protected VMs changes
  useEffect(() => {
    const channel = supabase
      .channel('protection-groups-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'protection_groups' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['protection-groups'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'protected_vms' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['protection-groups'] });
          queryClient.invalidateQueries({ queryKey: ['protected-vms'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const createGroupMutation = useMutation({
    mutationFn: async (group: Partial<ProtectionGroup>) => {
      const { data, error } = await supabase
        .from('protection_groups')
        .insert({
          name: group.name,
          description: group.description,
          source_vcenter_id: group.source_vcenter_id,
          target_id: group.target_id,
          protection_datastore: group.protection_datastore,
          dr_datastore: group.dr_datastore,
          dr_dataset: group.dr_dataset,
          replication_schedule: group.replication_schedule,
          retention_policy: group.retention_policy || { daily: 7, weekly: 4, monthly: 12 },
          rpo_minutes: group.rpo_minutes || 60,
          is_enabled: group.is_enabled ?? true
        })
        .select()
        .single();
      if (error) throw error;
      // Cast the returned data properly
      return {
        ...data,
        retention_policy: (data.retention_policy as { daily: number; weekly: number; monthly: number }) || { daily: 7, weekly: 4, monthly: 12 }
      } as ProtectionGroup;
    },
    onSuccess: () => {
      toast({ title: 'Protection group created' });
      queryClient.invalidateQueries({ queryKey: ['protection-groups'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('protection_groups')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Protection group deleted' });
      queryClient.invalidateQueries({ queryKey: ['protection-groups'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  // Run replication now - creates a job directly in Supabase
  const runReplicationNow = async (groupId: string) => {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      // Mark group as sync in progress
      await supabase
        .from('protection_groups')
        .update({ sync_in_progress: true, status: 'syncing' })
        .eq('id', groupId);
      
      // Create a run_replication_sync job
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'run_replication_sync' as any,
          status: 'pending',
          created_by: user?.id,
          target_scope: { protection_group_id: groupId },
          details: {
            protection_group_id: groupId,
            triggered_by: 'manual',
          },
        })
        .select()
        .single();
      
      if (error) throw error;
      
      toast({ 
        title: 'Replication sync started', 
        description: 'Check the Jobs page for progress' 
      });
      queryClient.invalidateQueries({ queryKey: ['protection-groups'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      return { message: 'Sync job created', job };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start replication';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  };

  // Exchange SSH keys between paired targets
  const exchangeSshKeysMutation = useMutation({
    mutationFn: async ({ sourceTargetId, destTargetId }: { sourceTargetId: string; destTargetId: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'exchange_ssh_keys' as any,
          status: 'pending',
          created_by: user?.id,
          target_scope: { source_target_id: sourceTargetId, destination_target_id: destTargetId },
          details: {
            source_target_id: sourceTargetId,
            destination_target_id: destTargetId,
          },
        })
        .select()
        .single();
      
      if (error) throw error;
      return job;
    },
    onSuccess: () => {
      toast({ 
        title: 'SSH key exchange started', 
        description: 'Check Jobs page for progress' 
      });
      queryClient.invalidateQueries({ queryKey: ['replication-targets'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  const updateGroupMutation = useMutation({
    mutationFn: async ({ id, updates, originalGroup }: { id: string; updates: Partial<ProtectionGroup>; originalGroup?: ProtectionGroup }) => {
      const { data, error } = await supabase
        .from('protection_groups')
        .update({
          name: updates.name,
          description: updates.description,
          rpo_minutes: updates.rpo_minutes,
          priority: updates.priority,
          replication_schedule: updates.replication_schedule,
          retention_policy: updates.retention_policy,
          is_enabled: updates.is_enabled,
          journal_history_hours: updates.journal_history_hours,
          test_reminder_days: updates.test_reminder_days,
          paused_at: updates.paused_at,
          pause_reason: updates.pause_reason,
          source_vcenter_id: updates.source_vcenter_id,
          protection_datastore: updates.protection_datastore,
          dr_datastore: updates.dr_datastore,
          target_id: updates.target_id,
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      
      // Check if config-affecting fields changed - queue sync job
      const configFields = ['rpo_minutes', 'retention_policy', 'replication_schedule'];
      const hasConfigChanges = configFields.some(field => {
        const updateValue = updates[field as keyof typeof updates];
        const originalValue = originalGroup?.[field as keyof ProtectionGroup];
        if (updateValue === undefined) return false;
        // Deep compare for objects like retention_policy
        return JSON.stringify(updateValue) !== JSON.stringify(originalValue);
      });
      
      if (hasConfigChanges) {
        // Get current user for created_by
        const { data: { user } } = await supabase.auth.getUser();
        
        // Queue sync_protection_config job
        await supabase.from('jobs').insert({
          job_type: 'sync_protection_config' as any, // Cast needed until types regenerate
          status: 'pending',
          target_scope: { protection_group_id: id },
          details: {
            protection_group_id: id,
            changes: configFields.filter(f => updates[f as keyof typeof updates] !== undefined),
            rpo_minutes: updates.rpo_minutes,
            retention_policy: updates.retention_policy,
            replication_schedule: updates.replication_schedule,
          },
          created_by: user?.id,
        });
      }
      
      return {
        ...data,
        retention_policy: (data.retention_policy as { daily: number; weekly: number; monthly: number }) || { daily: 7, weekly: 4, monthly: 12 },
        configSyncQueued: hasConfigChanges
      } as ProtectionGroup & { configSyncQueued?: boolean };
    },
    onSuccess: (data) => {
      const configSynced = (data as any).configSyncQueued;
      if (configSynced) {
        toast({ 
          title: 'Protection group updated',
          description: 'Configuration sync job queued for ZFS appliances'
        });
      } else {
        toast({ title: 'Protection group updated' });
      }
      queryClient.invalidateQueries({ queryKey: ['protection-groups'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  const pauseGroupMutation = useMutation({
    mutationFn: async ({ id, paused, reason }: { id: string; paused: boolean; reason?: string }) => {
      const { data, error } = await supabase
        .from('protection_groups')
        .update({
          paused_at: paused ? new Date().toISOString() : null,
          pause_reason: paused ? reason || 'Manually paused' : null,
          status: paused ? 'paused' : 'meeting_sla',
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      toast({ title: variables.paused ? 'Protection group paused' : 'Protection group resumed' });
      queryClient.invalidateQueries({ queryKey: ['protection-groups'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  return { 
    groups, 
    loading, 
    error: error?.message || null, 
    refetch, 
    createGroup: createGroupMutation.mutateAsync, 
    updateGroup: updateGroupMutation.mutateAsync,
    deleteGroup: deleteGroupMutation.mutateAsync, 
    pauseGroup: pauseGroupMutation.mutateAsync,
    runReplicationNow,
    exchangeSshKeys: exchangeSshKeysMutation.mutateAsync,
  };
}

export function useProtectedVMs(groupId?: string) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: vms = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ['protected-vms', groupId],
    queryFn: async () => {
      if (!groupId) return [];
      const { data, error } = await supabase
        .from('protected_vms')
        .select('*')
        .eq('protection_group_id', groupId)
        .order('priority');
      if (error) throw error;
      return data as ProtectedVM[];
    },
    enabled: !!groupId
  });

  const addVMMutation = useMutation({
    mutationFn: async (vm: Partial<ProtectedVM>) => {
      if (!groupId) throw new Error('No group selected');
      const { data, error } = await supabase
        .from('protected_vms')
        .insert({
          protection_group_id: groupId,
          vm_id: vm.vm_id,
          vm_name: vm.vm_name,
          vm_vcenter_id: vm.vm_vcenter_id,
          current_datastore: vm.current_datastore,
          target_datastore: vm.target_datastore,
          needs_storage_vmotion: vm.needs_storage_vmotion ?? false,
          replication_status: 'pending',
          priority: vm.priority || 100
        })
        .select()
        .single();
      if (error) throw error;
      return data as ProtectedVM;
    },
    onSuccess: () => {
      toast({ title: 'VM added to protection group' });
      queryClient.invalidateQueries({ queryKey: ['protected-vms', groupId] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  // Batch add multiple VMs
  const addVMsMutation = useMutation({
    mutationFn: async ({ vmsToAdd, autoMigrate }: { vmsToAdd: Partial<ProtectedVM>[], autoMigrate?: boolean }) => {
      if (!groupId) throw new Error('No group selected');
      if (vmsToAdd.length === 0) throw new Error('No VMs to add');

      const insertData = vmsToAdd.map((vm, index) => ({
        protection_group_id: groupId,
        vm_id: vm.vm_id,
        vm_name: vm.vm_name,
        vm_vcenter_id: vm.vm_vcenter_id,
        current_datastore: vm.current_datastore,
        target_datastore: vm.target_datastore,
        needs_storage_vmotion: vm.needs_storage_vmotion ?? true,
        replication_status: 'pending',
        priority: vm.priority || 100 + index
      }));

      const { data, error } = await supabase
        .from('protected_vms')
        .insert(insertData)
        .select();
      
      if (error) throw error;

      // If autoMigrate is true, trigger batch migration jobs
      if (autoMigrate && data && data.length > 0) {
        try {
          const vmIds = data.map(vm => vm.id);
          await fetchJobExecutor('/api/zerfaux/batch-storage-vmotion', {
            method: 'POST',
            body: JSON.stringify({ vm_ids: vmIds })
          });
        } catch (migrationError) {
          console.error('Auto-migration job creation failed:', migrationError);
          // Don't throw - VMs are added, migration jobs just failed to queue
        }
      }

      return data as ProtectedVM[];
    },
    onSuccess: (data) => {
      toast({ title: `${data.length} VM${data.length !== 1 ? 's' : ''} added to protection group` });
      queryClient.invalidateQueries({ queryKey: ['protected-vms', groupId] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  const removeVMMutation = useMutation({
    mutationFn: async (vmId: string) => {
      const { error } = await supabase
        .from('protected_vms')
        .delete()
        .eq('id', vmId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'VM removed from protection' });
      queryClient.invalidateQueries({ queryKey: ['protected-vms', groupId] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  // Batch migrate VMs to protection datastore
  const batchMigrateMutation = useMutation({
    mutationFn: async (vmIds: string[]) => {
      if (vmIds.length === 0) throw new Error('No VMs to migrate');
      
      const result = await fetchJobExecutor('/api/zerfaux/batch-storage-vmotion', {
        method: 'POST',
        body: JSON.stringify({ vm_ids: vmIds })
      });
      return result;
    },
    onSuccess: () => {
      toast({ title: 'Migration jobs created', description: 'VMs will be migrated to protection datastore' });
      queryClient.invalidateQueries({ queryKey: ['protected-vms', groupId] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error creating migration jobs', description: err.message, variant: 'destructive' });
    }
  });

  return { 
    vms, 
    loading, 
    error: error?.message || null, 
    refetch, 
    addVM: addVMMutation.mutateAsync,
    addVMs: (vmsToAdd: Partial<ProtectedVM>[], autoMigrate?: boolean) => 
      addVMsMutation.mutateAsync({ vmsToAdd, autoMigrate }),
    batchMigrate: batchMigrateMutation.mutateAsync,
    removeVM: removeVMMutation.mutateAsync 
  };
}

export function useReplicationJobs() {
  const { data: jobs = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ['replication-jobs'],
    queryFn: async () => {
      // Query the jobs table for replication-related job types
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .in('job_type', ['run_replication_sync', 'storage_vmotion'])
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      // Map jobs table to ReplicationJob interface
      return (data || []).map(job => {
        const targetScope = job.target_scope as Record<string, unknown> | null;
        const details = job.details as Record<string, unknown> | null;
        return {
          id: job.id,
          protection_group_id: (targetScope?.protection_group_id || details?.protection_group_id) as string | undefined,
          protected_vm_id: details?.protected_vm_id as string | undefined,
          job_type: job.job_type,
          status: job.status,
          started_at: job.started_at,
          completed_at: job.completed_at,
          bytes_transferred: (details?.bytes_transferred as number) || 0,
          error_message: details?.error as string | undefined,
          source_snapshot: details?.source_snapshot as string | undefined,
          target_snapshot: details?.target_snapshot as string | undefined,
          incremental: details?.incremental as boolean | undefined,
          created_at: job.created_at,
        };
      }) as ReplicationJob[];
    },
    refetchInterval: 10000 // Auto-refresh every 10 seconds
  });

  return { jobs, loading, error: error?.message || null, refetch };
}

export function useReplicationVCenters() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: vcenters = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ['replication-vcenters'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vcenter_settings')
        .select('*')
        .order('host');
      if (error) throw error;
      return data as VCenterConnection[];
    }
  });

  // This operation requires Job Executor
  const syncVCenter = async (id: string) => {
    try {
      const data = await fetchJobExecutor<{ vms_found: number; message: string }>(
        `/api/replication/vcenters/${id}/sync`,
        { method: 'POST' }
      );
      toast({ title: 'vCenter synced', description: data.message });
      queryClient.invalidateQueries({ queryKey: ['replication-vcenters'] });
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sync vCenter';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  };

  return { vcenters, loading, error: error?.message || null, refetch, syncVCenter };
}

export function useVCenterVMs(vcenterId?: string) {
  const { data: vms = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ['vcenter-vms', vcenterId],
    queryFn: async () => {
      if (!vcenterId) return [];
      const { data, error } = await supabase
        .from('vcenter_vms')
        .select('*')
        .eq('source_vcenter_id', vcenterId)
        .order('name');
      if (error) throw error;
      return data as VCenterVM[];
    },
    enabled: !!vcenterId
  });

  return { vms, loading, error: error?.message || null, refetch };
}

// Check if running in mixed content scenario (HTTPS page -> HTTP API)
const checkMixedContent = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (window.location.protocol !== 'https:') return false;
  const url = getJobExecutorUrl();
  return url?.startsWith('http://') ?? false;
};

// Wizard hooks - these require Job Executor for actual operations
export function useProtectionPlan(protectedVmId?: string) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: plan, isLoading: loading, refetch: fetchPlan } = useQuery({
    queryKey: ['protection-plan', protectedVmId],
    queryFn: async () => {
      if (!protectedVmId) return null;
      const { data, error } = await supabase
        .from('protected_vms')
        .select(`
          *,
          vcenter_vm:vcenter_vms!protected_vms_vm_id_fkey(
            id, name, cpu_count, memory_mb, guest_os, power_state
          )
        `)
        .eq('id', protectedVmId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!protectedVmId
  });

  // Move via job queue fallback (for HTTPS/mixed content scenarios)
  const moveViaJobQueue = async (vmId: string, targetDatastore?: string): Promise<{ success: boolean; message: string }> => {
    const startTime = Date.now();
    
    // Create a storage_vmotion job
    const { data: job, error } = await supabase
      .from('jobs')
      .insert({
        job_type: 'storage_vmotion',
        status: 'pending',
        target_scope: { protected_vm_id: vmId },
        details: { target_datastore: targetDatastore }
      })
      .select()
      .single();
    
    if (error || !job) {
      throw new Error('Failed to create storage vMotion job');
    }
    
    // Poll for job completion (max 5 minutes)
    const pollInterval = 2000;
    const maxWait = 300000;
    
    while (Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      const { data: updatedJob } = await supabase
        .from('jobs')
        .select('status, details')
        .eq('id', job.id)
        .single();
      
      if (!updatedJob) continue;
      
      if (updatedJob.status === 'completed') {
        return {
          success: true,
          message: (updatedJob.details as { message?: string })?.message || 'VM relocated successfully'
        };
      }
      
      if (updatedJob.status === 'failed' || updatedJob.status === 'cancelled') {
        const details = updatedJob.details as { error?: string } | null;
        throw new Error(details?.error || 'Storage vMotion job failed');
      }
    }
    
    throw new Error('Storage vMotion job timed out');
  };

  // This operation requires Job Executor - with job queue fallback for HTTPS
  const moveToProtectionDatastore = async (targetDatastore?: string) => {
    if (!protectedVmId) return;
    
    const isMixedContent = checkMixedContent();
    
    // Use job queue directly if mixed content scenario
    if (isMixedContent) {
      try {
        const result = await moveViaJobQueue(protectedVmId, targetDatastore);
        toast({ title: 'VM relocated', description: result.message });
        queryClient.invalidateQueries({ queryKey: ['protection-plan', protectedVmId] });
        queryClient.invalidateQueries({ queryKey: ['protected-vms'] });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to relocate VM';
        toast({ title: 'Error', description: message, variant: 'destructive' });
        throw err;
      }
    }
    
    // Try direct API first
    try {
      const data = await fetchJobExecutor<{ success: boolean; message: string }>(
        `/api/replication/protected-vms/${protectedVmId}/move-to-protection-datastore`,
        {
          method: 'POST',
          body: JSON.stringify({ target_datastore: targetDatastore }),
        }
      );
      toast({ title: 'VM relocated', description: data.message });
      queryClient.invalidateQueries({ queryKey: ['protection-plan', protectedVmId] });
      queryClient.invalidateQueries({ queryKey: ['protected-vms'] });
      return data;
    } catch (err) {
      // Fall back to job queue on network errors
      if (err instanceof Error && err.message?.includes('Failed to fetch')) {
        try {
          const result = await moveViaJobQueue(protectedVmId, targetDatastore);
          toast({ title: 'VM relocated', description: result.message });
          queryClient.invalidateQueries({ queryKey: ['protection-plan', protectedVmId] });
          queryClient.invalidateQueries({ queryKey: ['protected-vms'] });
          return result;
        } catch (fallbackErr) {
          const message = fallbackErr instanceof Error ? fallbackErr.message : 'Failed to relocate VM';
          toast({ title: 'Error', description: message, variant: 'destructive' });
          throw fallbackErr;
        }
      }
      
      const message = err instanceof Error ? err.message : 'Failed to relocate VM';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  };

  return { plan, loading, fetchPlan, moveToProtectionDatastore };
}

export function useDRShellPlan(protectedVmId?: string, selectedDrVcenterId?: string | null) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch protected VM with protection group info
  const { data: plan, isLoading: loading, refetch: fetchPlan } = useQuery({
    queryKey: ['dr-shell-plan', protectedVmId],
    queryFn: async () => {
      if (!protectedVmId) return null;
      const { data, error } = await supabase
        .from('protected_vms')
        .select(`
          *,
          protection_group:protection_groups(
            id, name, source_vcenter_id, target_id, protection_datastore
          ),
          vcenter_vm:vcenter_vms!protected_vms_vm_id_fkey(
            id, name, cpu_count, memory_mb, guest_os, power_state
          )
        `)
        .eq('id', protectedVmId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!protectedVmId
  });

  // Fetch all vCenters for DR site selection
  const { data: vcenters } = useQuery({
    queryKey: ['vcenters-for-dr'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vcenters')
        .select('id, name, host, sync_enabled')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Fetch datastores for selected DR vCenter
  const { data: drDatastores, isLoading: datastoresLoading } = useQuery({
    queryKey: ['dr-datastores', selectedDrVcenterId],
    queryFn: async () => {
      if (!selectedDrVcenterId) return [];
      const { data, error } = await supabase
        .from('vcenter_datastores')
        .select('id, name, free_bytes, capacity_bytes, type, accessible')
        .eq('source_vcenter_id', selectedDrVcenterId)
        .eq('accessible', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedDrVcenterId,
  });

  // Fetch networks for selected DR vCenter (excludes uplink port groups)
  const { data: drNetworks, isLoading: networksLoading } = useQuery({
    queryKey: ['dr-networks', selectedDrVcenterId],
    queryFn: async () => {
      if (!selectedDrVcenterId) return [];
      const { data, error } = await supabase
        .from('vcenter_networks')
        .select('id, name, vlan_id, vlan_range, vlan_type, network_type, parent_switch_name')
        .eq('source_vcenter_id', selectedDrVcenterId)
        .eq('uplink_port_group', false)
        .eq('accessible', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedDrVcenterId,
  });

  // This operation requires Job Executor
  const createDRShell = async (config: { 
    shell_vm_name?: string; 
    cpu_count?: number; 
    memory_mb?: number; 
    dr_vcenter_id?: string;
    datastore_name?: string;
    network_name?: string;
  }) => {
    if (!protectedVmId) return;
    
    try {
      const data = await fetchJobExecutor<{ success: boolean; shell_vm_name: string; message: string }>(
        `/api/replication/protected-vms/${protectedVmId}/create-dr-shell`,
        {
          method: 'POST',
          body: JSON.stringify(config),
        }
      );
      toast({ title: 'DR Shell created', description: data.message });
      queryClient.invalidateQueries({ queryKey: ['dr-shell-plan', protectedVmId] });
      queryClient.invalidateQueries({ queryKey: ['protected-vms'] });
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create DR shell';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  };

  return { plan, loading, fetchPlan, createDRShell, vcenters, drDatastores, datastoresLoading, drNetworks, networksLoading };
}
