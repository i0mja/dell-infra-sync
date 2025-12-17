import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface HostMountStatus {
  host_id: string;
  host_name: string;
  cluster_name: string | null;
  mounted: boolean;
  error?: string;
}

export interface DatastoreMountResult {
  datastore_name: string | null;
  nfs_export_path: string | null;
  hosts: HostMountStatus[];
  total_hosts: number;
  mounted_count: number;
}

export type DatastoreOperation = 
  | 'status' 
  | 'mount_all' 
  | 'mount_hosts' 
  | 'unmount_hosts' 
  | 'unmount_all' 
  | 'refresh'
  | 'scan'
  | 'rescan';

export function useDatastoreManagement() {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const createDatastoreJob = async (
    targetId: string,
    operation: DatastoreOperation,
    hostNames?: string[]
  ): Promise<string | null> => {
    try {
      setLoading(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Authentication required');
      }

      // Create manage_datastore job
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'manage_datastore',
          status: 'pending',
          created_by: user.id,
          details: {
            target_id: targetId,
            operation,
            host_names: hostNames || [],
          },
          target_scope: {}
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Datastore job created",
        description: `Operation: ${operation.replace('_', ' ')}`,
      });

      return job.id;
    } catch (error) {
      console.error('Failed to create datastore job:', error);
      toast({
        title: "Failed to create job",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive",
      });
      return null;
    } finally {
      setLoading(false);
    }
  };

  const getDatastoreMountStatus = async (targetId: string) => {
    return createDatastoreJob(targetId, 'status');
  };

  const mountOnAllHosts = async (targetId: string) => {
    return createDatastoreJob(targetId, 'mount_all');
  };

  const mountOnHosts = async (targetId: string, hostNames: string[]) => {
    return createDatastoreJob(targetId, 'mount_hosts', hostNames);
  };

  const unmountFromHosts = async (targetId: string, hostNames: string[]) => {
    return createDatastoreJob(targetId, 'unmount_hosts', hostNames);
  };

  const unmountFromAllHosts = async (targetId: string) => {
    return createDatastoreJob(targetId, 'unmount_all');
  };

  const refreshMounts = async (targetId: string) => {
    return createDatastoreJob(targetId, 'refresh');
  };

  const rescanDatastore = async (targetId: string) => {
    try {
      setLoading(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Authentication required');
      }

      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'manage_datastore',
          status: 'pending',
          created_by: user.id,
          details: {
            target_id: targetId,
            operation: 'rescan',
          },
          target_scope: {}
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Rescan job created",
        description: "vCenter will refresh its view of the datastore contents",
      });

      return job.id;
    } catch (error) {
      console.error('Failed to create rescan job:', error);
      toast({
        title: "Failed to create rescan job",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive",
      });
      return null;
    } finally {
      setLoading(false);
    }
  };

  const scanDatastoreStatus = async (targetId: string) => {
    try {
      setLoading(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Authentication required');
      }

      // Create scan_datastore_status job
      const { data: job, error } = await supabase
        .from('jobs')
        .insert({
          job_type: 'scan_datastore_status',
          status: 'pending',
          created_by: user.id,
          details: {
            target_id: targetId,
            auto_detect: true,
          },
          target_scope: {}
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Scan job created",
        description: "Scanning datastore status from vCenter",
      });

      return job.id;
    } catch (error) {
      console.error('Failed to create scan job:', error);
      toast({
        title: "Failed to create scan job",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive",
      });
      return null;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    getDatastoreMountStatus,
    mountOnAllHosts,
    mountOnHosts,
    unmountFromHosts,
    unmountFromAllHosts,
    refreshMounts,
    rescanDatastore,
    scanDatastoreStatus,
    createDatastoreJob,
  };
}
