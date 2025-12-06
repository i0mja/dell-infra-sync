/**
 * Zerfaux Replication Hooks
 * 
 * React hooks for fetching and managing replication data from the Job Executor API.
 */

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

// Get Job Executor URL from activity settings or environment
const getJobExecutorUrl = (): string => {
  return localStorage.getItem('job_executor_url') || 
         import.meta.env.VITE_JOB_EXECUTOR_URL || 
         'http://localhost:8081';
};

// Generic fetch helper
async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
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
// Hooks
// ==========================================

export function useReplicationTargets() {
  const [targets, setTargets] = useState<ReplicationTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchApi<{ targets: ReplicationTarget[] }>('/api/replication/targets');
      setTargets(data.targets || []);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch targets';
      setError(message);
      console.error('Failed to fetch replication targets:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const createTarget = async (target: Partial<ReplicationTarget>) => {
    try {
      const data = await fetchApi<{ target: ReplicationTarget }>('/api/replication/targets', {
        method: 'POST',
        body: JSON.stringify(target),
      });
      toast({ title: 'Target created successfully' });
      await refetch();
      return data.target;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create target';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  };

  const deleteTarget = async (id: string) => {
    try {
      await fetchApi(`/api/replication/targets/${id}`, { method: 'DELETE' });
      toast({ title: 'Target deleted' });
      await refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete target';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  };

  return { targets, loading, error, refetch, createTarget, deleteTarget };
}

export function useProtectionGroups() {
  const [groups, setGroups] = useState<ProtectionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchApi<{ protection_groups: ProtectionGroup[] }>('/api/replication/protection-groups');
      setGroups(data.protection_groups || []);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch groups';
      setError(message);
      console.error('Failed to fetch protection groups:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const createGroup = async (group: Partial<ProtectionGroup>) => {
    try {
      const data = await fetchApi<{ protection_group: ProtectionGroup }>('/api/replication/protection-groups', {
        method: 'POST',
        body: JSON.stringify(group),
      });
      toast({ title: 'Protection group created' });
      await refetch();
      return data.protection_group;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create group';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  };

  const deleteGroup = async (id: string) => {
    try {
      await fetchApi(`/api/replication/protection-groups/${id}`, { method: 'DELETE' });
      toast({ title: 'Protection group deleted' });
      await refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete group';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  };

  const runReplicationNow = async (groupId: string) => {
    try {
      const data = await fetchApi<{ message: string; jobs: ReplicationJob[] }>(
        `/api/replication/protection-groups/${groupId}/run-now`,
        { method: 'POST' }
      );
      toast({ title: 'Replication started', description: data.message });
      await refetch();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start replication';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  };

  return { groups, loading, error, refetch, createGroup, deleteGroup, runReplicationNow };
}

export function useProtectedVMs(groupId?: string) {
  const [vms, setVms] = useState<ProtectedVM[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const refetch = useCallback(async () => {
    if (!groupId) {
      setVms([]);
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      const data = await fetchApi<{ protected_vms: ProtectedVM[] }>(
        `/api/replication/protection-groups/${groupId}/protected-vms`
      );
      setVms(data.protected_vms || []);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch VMs';
      setError(message);
      console.error('Failed to fetch protected VMs:', err);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const addVM = async (vm: Partial<ProtectedVM>) => {
    if (!groupId) return;
    try {
      const data = await fetchApi<{ protected_vm: ProtectedVM }>(
        `/api/replication/protection-groups/${groupId}/protected-vms`,
        {
          method: 'POST',
          body: JSON.stringify(vm),
        }
      );
      toast({ title: 'VM added to protection group' });
      await refetch();
      return data.protected_vm;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add VM';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  };

  const removeVM = async (vmId: string) => {
    try {
      await fetchApi(`/api/replication/protected-vms/${vmId}`, { method: 'DELETE' });
      toast({ title: 'VM removed from protection' });
      await refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove VM';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  };

  return { vms, loading, error, refetch, addVM, removeVM };
}

export function useReplicationJobs() {
  const [jobs, setJobs] = useState<ReplicationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchApi<{ jobs: ReplicationJob[] }>('/api/replication/jobs');
      setJobs(data.jobs || []);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch jobs';
      setError(message);
      console.error('Failed to fetch replication jobs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { jobs, loading, error, refetch };
}

export function useReplicationVCenters() {
  const [vcenters, setVCenters] = useState<VCenterConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchApi<{ vcenters: VCenterConnection[] }>('/api/replication/vcenters');
      setVCenters(data.vcenters || []);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch vCenters';
      setError(message);
      console.error('Failed to fetch vCenters:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const syncVCenter = async (id: string) => {
    try {
      const data = await fetchApi<{ vms_found: number; message: string }>(
        `/api/replication/vcenters/${id}/sync`,
        { method: 'POST' }
      );
      toast({ title: 'vCenter synced', description: data.message });
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sync vCenter';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  };

  return { vcenters, loading, error, refetch, syncVCenter };
}

export function useVCenterVMs(vcenterId?: string) {
  const [vms, setVMs] = useState<VCenterVM[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!vcenterId) {
      setVMs([]);
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      const data = await fetchApi<{ vms: VCenterVM[] }>(`/api/replication/vcenters/${vcenterId}/vms`);
      setVMs(data.vms || []);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch VMs';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [vcenterId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { vms, loading, error, refetch };
}

// Wizard hooks
export function useProtectionPlan(protectedVmId?: string) {
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const fetchPlan = useCallback(async () => {
    if (!protectedVmId) return;
    
    try {
      setLoading(true);
      const data = await fetchApi<{ plan: any }>(`/api/replication/protected-vms/${protectedVmId}/protection-plan`);
      setPlan(data.plan);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch plan';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [protectedVmId, toast]);

  const moveToProtectionDatastore = async (targetDatastore?: string) => {
    if (!protectedVmId) return;
    
    try {
      const data = await fetchApi<{ success: boolean; message: string }>(
        `/api/replication/protected-vms/${protectedVmId}/move-to-protection-datastore`,
        {
          method: 'POST',
          body: JSON.stringify({ target_datastore: targetDatastore }),
        }
      );
      toast({ title: 'VM relocated', description: data.message });
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
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const fetchPlan = useCallback(async () => {
    if (!protectedVmId) return;
    
    try {
      setLoading(true);
      const data = await fetchApi<{ plan: any }>(`/api/replication/protected-vms/${protectedVmId}/dr-shell-plan`);
      setPlan(data.plan);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch plan';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [protectedVmId, toast]);

  const createDRShell = async (config: { shell_vm_name?: string; cpu_count?: number; memory_mb?: number }) => {
    if (!protectedVmId) return;
    
    try {
      const data = await fetchApi<{ success: boolean; shell_vm_name: string; message: string }>(
        `/api/replication/protected-vms/${protectedVmId}/create-dr-shell`,
        {
          method: 'POST',
          body: JSON.stringify(config),
        }
      );
      toast({ title: 'DR Shell VM created', description: data.message });
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create DR shell';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  };

  return { plan, loading, fetchPlan, createDRShell };
}
