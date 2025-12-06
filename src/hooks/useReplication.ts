/**
 * Zerfaux Replication Hooks
 * 
 * React hooks for fetching and managing replication data from Supabase.
 * Job Executor API is only used for operational actions (run replication, vMotion, DR shell).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
}

export interface ProtectionGroup {
  id: string;
  name: string;
  description?: string;
  source_vcenter_id?: string;
  target_id?: string;
  protection_datastore?: string;
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

export function useReplicationTargets() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: targets = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ['replication-targets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('replication_targets')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as ReplicationTarget[];
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

  return { 
    targets, 
    loading, 
    error: error?.message || null, 
    refetch, 
    createTarget: createTargetMutation.mutateAsync, 
    deleteTarget: deleteTargetMutation.mutateAsync 
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
        .select('*')
        .order('name');
      if (error) throw error;
      // Map database fields to interface, handling JSON retention_policy
      return (data || []).map(row => ({
        ...row,
        retention_policy: (row.retention_policy as { daily: number; weekly: number; monthly: number }) || { daily: 7, weekly: 4, monthly: 12 }
      })) as ProtectionGroup[];
    }
  });

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

  // This operation requires Job Executor
  const runReplicationNow = async (groupId: string) => {
    try {
      const data = await fetchJobExecutor<{ message: string; jobs: ReplicationJob[] }>(
        `/api/replication/protection-groups/${groupId}/run-now`,
        { method: 'POST' }
      );
      toast({ title: 'Replication started', description: data.message });
      queryClient.invalidateQueries({ queryKey: ['protection-groups'] });
      queryClient.invalidateQueries({ queryKey: ['replication-jobs'] });
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start replication';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  };

  return { 
    groups, 
    loading, 
    error: error?.message || null, 
    refetch, 
    createGroup: createGroupMutation.mutateAsync, 
    deleteGroup: deleteGroupMutation.mutateAsync, 
    runReplicationNow 
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

  return { 
    vms, 
    loading, 
    error: error?.message || null, 
    refetch, 
    addVM: addVMMutation.mutateAsync, 
    removeVM: removeVMMutation.mutateAsync 
  };
}

export function useReplicationJobs() {
  const { data: jobs = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ['replication-jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('replication_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as ReplicationJob[];
    }
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
        .select('*')
        .eq('id', protectedVmId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!protectedVmId
  });

  // This operation requires Job Executor
  const moveToProtectionDatastore = async (targetDatastore?: string) => {
    if (!protectedVmId) return;
    
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
      const message = err instanceof Error ? err.message : 'Failed to relocate VM';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  };

  return { plan, loading, fetchPlan, moveToProtectionDatastore };
}

export function useDRShellPlan(protectedVmId?: string) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: plan, isLoading: loading, refetch: fetchPlan } = useQuery({
    queryKey: ['dr-shell-plan', protectedVmId],
    queryFn: async () => {
      if (!protectedVmId) return null;
      const { data, error } = await supabase
        .from('protected_vms')
        .select('*')
        .eq('id', protectedVmId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!protectedVmId
  });

  // This operation requires Job Executor
  const createDRShell = async (config: { shell_vm_name?: string; cpu_count?: number; memory_mb?: number }) => {
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

  return { plan, loading, fetchPlan, createDRShell };
}
