/**
 * useDatastoreManagement Hook
 * 
 * Provides datastore management operations with instant API support.
 * Uses the centralized datastoreService for instant-first pattern.
 */

import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { 
  manageDatastore, 
  scanDatastoreStatus,
  type DatastoreOperation 
} from '@/services/datastoreService';

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

// Re-export the type for backward compatibility
export type { DatastoreOperation };

export function useDatastoreManagement() {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  /**
   * Execute a datastore operation using instant API with job queue fallback
   */
  const executeOperation = async (
    targetId: string,
    operation: DatastoreOperation,
    hostNames?: string[]
  ): Promise<string | null> => {
    try {
      setLoading(true);

      const result = await manageDatastore(targetId, operation, hostNames);

      // If result is a string, it's a job ID (fallback to job queue)
      if (typeof result === 'string') {
        toast({
          title: "Datastore job created",
          description: `Operation: ${operation.replace('_', ' ')} (queued)`,
        });
        return result;
      }

      // Instant API success
      if (result.success) {
        toast({
          title: "Operation completed",
          description: result.message || `${operation.replace('_', ' ')} completed`,
        });
        return null; // No job ID - completed instantly
      } else {
        throw new Error(result.error || 'Operation failed');
      }
    } catch (error) {
      console.error('Failed to execute datastore operation:', error);
      toast({
        title: "Operation failed",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive",
      });
      return null;
    } finally {
      setLoading(false);
    }
  };

  const getDatastoreMountStatus = async (targetId: string) => {
    return executeOperation(targetId, 'status');
  };

  const mountOnAllHosts = async (targetId: string) => {
    return executeOperation(targetId, 'mount_all');
  };

  const mountOnHosts = async (targetId: string, hostNames: string[]) => {
    return executeOperation(targetId, 'mount_hosts', hostNames);
  };

  const unmountFromHosts = async (targetId: string, hostNames: string[]) => {
    return executeOperation(targetId, 'unmount_hosts', hostNames);
  };

  const unmountFromAllHosts = async (targetId: string) => {
    return executeOperation(targetId, 'unmount_all');
  };

  const refreshMounts = async (targetId: string) => {
    return executeOperation(targetId, 'refresh');
  };

  const rescanDatastore = async (targetId: string) => {
    try {
      setLoading(true);

      const result = await manageDatastore(targetId, 'rescan');

      // If result is a string, it's a job ID (fallback to job queue)
      if (typeof result === 'string') {
        toast({
          title: "Rescan job created",
          description: "vCenter will refresh its view of the datastore contents (queued)",
        });
        return result;
      }

      // Instant API success
      if (result.success) {
        toast({
          title: "Rescan completed",
          description: result.message || "Datastore rescan completed",
        });
        return null;
      } else {
        throw new Error(result.error || 'Rescan failed');
      }
    } catch (error) {
      console.error('Failed to create rescan job:', error);
      toast({
        title: "Failed to rescan datastore",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive",
      });
      return null;
    } finally {
      setLoading(false);
    }
  };

  const scanDatastoreStatusOp = async (targetId: string) => {
    try {
      setLoading(true);

      const result = await scanDatastoreStatus(targetId);

      // If result is a string, it's a job ID (fallback to job queue)
      if (typeof result === 'string') {
        toast({
          title: "Scan job created",
          description: "Scanning datastore status from vCenter (queued)",
        });
        return result;
      }

      // Instant API success
      if (result.success) {
        toast({
          title: "Scan completed",
          description: result.message || "Datastore status scan completed",
        });
        return null;
      } else {
        throw new Error(result.error || 'Scan failed');
      }
    } catch (error) {
      console.error('Failed to create scan job:', error);
      toast({
        title: "Failed to scan datastore status",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive",
      });
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Legacy function for backward compatibility
  const createDatastoreJob = async (
    targetId: string,
    operation: DatastoreOperation,
    hostNames?: string[]
  ): Promise<string | null> => {
    return executeOperation(targetId, operation, hostNames);
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
    scanDatastoreStatus: scanDatastoreStatusOp,
    createDatastoreJob,
  };
}
