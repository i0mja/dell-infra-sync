import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import type { HostScanStatus } from '@/components/updates/FirmwareScanProgressCard';

export type ScanType = 'cluster' | 'group' | 'servers' | 'single_host';
export type FirmwareSource = 'local_repository' | 'dell_online_catalog';
export type ScanStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ResultStatus = 'pending' | 'scanning' | 'completed' | 'failed' | 'skipped';

export interface FirmwareComponent {
  name: string;
  type: string;
  installedVersion: string;
  availableVersion?: string;
  status: 'up-to-date' | 'update-available' | 'critical-update' | 'not-in-catalog';
  criticality?: 'Critical' | 'Recommended' | 'Optional';
  componentId?: string;
}

export interface ScanBlocker {
  type: 'connectivity' | 'authentication' | 'timeout' | 'unsupported' | 'other';
  message: string;
}

export interface UpdateAvailabilityScan {
  id: string;
  scan_type: ScanType;
  target_id: string | null;
  target_name: string | null;
  target_server_ids: string[] | null;
  firmware_source: FirmwareSource;
  status: ScanStatus;
  started_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  summary: {
    hostsScanned?: number;
    hostsSuccessful?: number;
    hostsFailed?: number;
    totalComponents?: number;
    updatesAvailable?: number;
    criticalUpdates?: number;
    upToDate?: number;
    esxiUpdatesAvailable?: number;
  };
  error_message: string | null;
}

export interface UpdateAvailabilityResult {
  id: string;
  scan_id: string;
  server_id: string | null;
  vcenter_host_id: string | null;
  hostname: string | null;
  server_model: string | null;
  service_tag: string | null;
  esxi_version: string | null;
  esxi_update_available: boolean;
  esxi_target_version: string | null;
  firmware_components: FirmwareComponent[];
  total_components: number;
  updates_available: number;
  critical_updates: number;
  up_to_date: number;
  not_in_catalog: number;
  blockers: ScanBlocker[];
  scan_status: ResultStatus;
  scanned_at: string | null;
  created_at: string;
}

export interface StartScanParams {
  scanType: ScanType;
  targetId?: string;
  targetName?: string;
  serverIds?: string[];
  vcenterHostIds?: string[];
  firmwareSource: FirmwareSource;
}

export interface ScanProgress {
  scannedHosts: number;
  totalHosts: number;
  currentHost?: string;
  updatesFound: number;
  criticalFound: number;
}

export function useUpdateAvailabilityScan(scanId?: string) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<ScanProgress | null>(null);

  // Fetch a specific scan
  const { data: scan, isLoading: scanLoading, refetch: refetchScan } = useQuery({
    queryKey: ['update-availability-scan', scanId],
    queryFn: async () => {
      if (!scanId) return null;
      const { data, error } = await supabase
        .from('update_availability_scans')
        .select('*')
        .eq('id', scanId)
        .single();
      if (error) throw error;
      return data as UpdateAvailabilityScan;
    },
    enabled: !!scanId,
    refetchInterval: (query) => {
      const data = query.state.data as UpdateAvailabilityScan | undefined;
      // Auto-refresh while scan is running
      return data?.status === 'running' || data?.status === 'pending' ? 2000 : false;
    },
  });

  // Fetch associated job for real-time progress
  const { data: job } = useQuery({
    queryKey: ['firmware-scan-job', scanId],
    queryFn: async () => {
      if (!scanId) return null;
      const { data, error } = await supabase
        .from('jobs')
        .select('id, status, details, target_scope')
        .eq('job_type', 'firmware_inventory_scan')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      // Find job matching this scan_id in target_scope
      const matchingJob = data?.find((j) => {
        const scope = j.target_scope as Record<string, unknown> | null;
        return scope?.scan_id === scanId;
      });
      return matchingJob || null;
    },
    enabled: !!scanId,
    refetchInterval: (query) => {
      const data = query.state.data as { status: string } | null | undefined;
      return data?.status === 'running' || data?.status === 'pending' ? 1000 : false;
    },
  });

  // Transform component data from DB format (componentName, currentVersion) to UI format (name, installedVersion)
  const transformComponent = (comp: Record<string, unknown>): FirmwareComponent => {
    const hasUpdate = Boolean(comp.updateAvailable || comp.update_available);
    const criticality = (comp.criticality as string) || undefined;
    
    // Derive status from component data
    let status: FirmwareComponent['status'] = 'up-to-date';
    if (hasUpdate) {
      status = criticality === 'Critical' ? 'critical-update' : 'update-available';
    } else if (!comp.availableVersion && !comp.available_version) {
      status = 'not-in-catalog';
    }
    
    return {
      name: (comp.name || comp.componentName || comp.component_name || 'Unknown') as string,
      type: (comp.type || comp.componentType || comp.component_type || 'Unknown') as string,
      installedVersion: (comp.installedVersion || comp.currentVersion || comp.current_version || '-') as string,
      availableVersion: (comp.availableVersion || comp.available_version) as string | undefined,
      status,
      criticality: criticality as FirmwareComponent['criticality'],
      componentId: (comp.componentId || comp.component_id) as string | undefined,
    };
  };

  // Fetch scan results
  const { data: results, isLoading: resultsLoading, refetch: refetchResults } = useQuery({
    queryKey: ['update-availability-results', scanId],
    queryFn: async () => {
      if (!scanId) return [];
      const { data, error } = await supabase
        .from('update_availability_results')
        .select('*')
        .eq('scan_id', scanId)
        .order('hostname');
      if (error) throw error;
      return (data || []).map(r => ({
        ...r,
        firmware_components: (Array.isArray(r.firmware_components) 
          ? r.firmware_components.map((c) => transformComponent(c as Record<string, unknown>))
          : []) as FirmwareComponent[],
        blockers: (Array.isArray(r.blockers) ? r.blockers : []) as unknown as ScanBlocker[],
      })) as UpdateAvailabilityResult[];
    },
    enabled: !!scanId,
    refetchInterval: (query) => {
      // Auto-refresh while scan is running
      return scan?.status === 'running' || scan?.status === 'pending' ? 2000 : false;
    },
  });

  // Derive host status list from results for real-time progress display
  const hostResultsForProgress: HostScanStatus[] = useMemo(() => {
    if (!results || results.length === 0) return [];
    return results.map(r => ({
      hostname: r.hostname || 'Unknown',
      status: r.scan_status === 'failed' ? 'failed' as const : 
              r.scan_status === 'completed' ? 'completed' as const : 
              r.scan_status === 'scanning' ? 'scanning' as const : 'pending' as const,
      componentsChecked: r.total_components,
      updatesAvailable: r.updates_available,
      error: r.blockers?.[0]?.message,
    }));
  }, [results]);

  // Update progress state from job details and results
  useEffect(() => {
    if (job?.details || results) {
      const details = (job?.details || {}) as Record<string, unknown>;
      
      // Calculate updates from actual results if available (more accurate)
      const updatesFromResults = results?.reduce((sum, r) => sum + r.updates_available, 0) ?? 0;
      const criticalFromResults = results?.reduce((sum, r) => sum + r.critical_updates, 0) ?? 0;
      const scannedFromResults = results?.length ?? 0;
      
      setProgress({
        scannedHosts: scannedFromResults || (details.hosts_scanned ?? details.hostsScanned ?? 0) as number,
        totalHosts: (details.hosts_total ?? details.hostsTotal ?? 0) as number,
        currentHost: (details.current_host ?? details.currentHost) as string | undefined,
        updatesFound: updatesFromResults || (details.updates_found ?? details.updatesFound ?? 0) as number,
        criticalFound: criticalFromResults || (details.critical_found ?? details.criticalFound ?? 0) as number,
      });
    }
  }, [job?.details, results]);

  // Fetch recent scans
  const { data: recentScans, isLoading: recentScansLoading } = useQuery({
    queryKey: ['update-availability-scans-recent'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('update_availability_scans')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as UpdateAvailabilityScan[];
    },
  });

  // Start a new scan
  const startScanMutation = useMutation({
    mutationFn: async (params: StartScanParams) => {
      // Create the scan record
      const { data: scanData, error: scanError } = await supabase
        .from('update_availability_scans')
        .insert({
          scan_type: params.scanType,
          target_id: params.targetId || null,
          target_name: params.targetName || null,
          target_server_ids: params.serverIds || null,
          firmware_source: params.firmwareSource,
          status: 'pending',
          created_by: user?.id,
        })
        .select()
        .single();

      if (scanError) throw scanError;

      // Create a job to execute the scan (uses firmware_inventory_scan job type)
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'firmware_inventory_scan' as const,
          status: 'pending' as const,
          created_by: user?.id,
          target_scope: {
            scan_id: scanData.id,
            scan_type: params.scanType,
            target_id: params.targetId,
            server_ids: params.serverIds,
            vcenter_host_ids: params.vcenterHostIds,
            firmware_source: params.firmwareSource,
          },
          details: {
            scan_id: scanData.id,
            target_name: params.targetName,
            is_update_availability_check: true,
          },
        })
        .select()
        .single();

      if (jobError) {
        // Rollback scan if job creation fails
        await supabase.from('update_availability_scans').delete().eq('id', scanData.id);
        throw jobError;
      }

      // Update scan to running
      await supabase
        .from('update_availability_scans')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', scanData.id);

      return scanData.id;
    },
    onSuccess: (scanId) => {
      queryClient.invalidateQueries({ queryKey: ['update-availability-scans-recent'] });
      toast({
        title: 'Scan Started',
        description: 'Update availability scan has been initiated.',
      });
    },
    onError: (error) => {
      console.error('Failed to start scan:', error);
      toast({
        title: 'Scan Failed',
        description: 'Failed to start update availability scan.',
        variant: 'destructive',
      });
    },
  });

  // Cancel a running scan
  const cancelScanMutation = useMutation({
    mutationFn: async (targetScanId: string) => {
      const { error } = await supabase
        .from('update_availability_scans')
        .update({ 
          status: 'cancelled', 
          completed_at: new Date().toISOString(),
          error_message: 'Scan cancelled by user',
        })
        .eq('id', targetScanId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['update-availability-scan', scanId] });
      queryClient.invalidateQueries({ queryKey: ['update-availability-scans-recent'] });
      toast({
        title: 'Scan Cancelled',
        description: 'The update availability scan has been cancelled.',
      });
    },
  });

  // Delete a scan
  const deleteScanMutation = useMutation({
    mutationFn: async (targetScanId: string) => {
      const { error } = await supabase
        .from('update_availability_scans')
        .delete()
        .eq('id', targetScanId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['update-availability-scans-recent'] });
      toast({
        title: 'Scan Deleted',
        description: 'The scan record has been removed.',
      });
    },
  });

  // Calculate derived stats from results
  const calculateStats = useCallback(() => {
    if (!results || results.length === 0) {
      return {
        hostsScanned: 0,
        hostsSuccessful: 0,
        hostsFailed: 0,
        totalComponents: 0,
        updatesAvailable: 0,
        criticalUpdates: 0,
        upToDate: 0,
        esxiUpdatesAvailable: 0,
      };
    }

    return {
      hostsScanned: results.length,
      hostsSuccessful: results.filter(r => r.scan_status === 'completed').length,
      hostsFailed: results.filter(r => r.scan_status === 'failed' || r.scan_status === 'skipped').length,
      totalComponents: results.reduce((sum, r) => sum + r.total_components, 0),
      updatesAvailable: results.reduce((sum, r) => sum + r.updates_available, 0),
      criticalUpdates: results.reduce((sum, r) => sum + r.critical_updates, 0),
      upToDate: results.reduce((sum, r) => sum + r.up_to_date, 0),
      esxiUpdatesAvailable: results.filter(r => r.esxi_update_available).length,
    };
  }, [results]);

  // Get component type summary across all hosts
  const getComponentSummary = useCallback(() => {
    if (!results || results.length === 0) return [];

    const componentMap = new Map<string, {
      type: string;
      hostsOutdated: number;
      versions: Set<string>;
      availableVersion?: string;
      criticality?: string;
    }>();

    results.forEach(result => {
      result.firmware_components.forEach(comp => {
        const key = comp.type || comp.name;
        const existing = componentMap.get(key) || {
          type: key,
          hostsOutdated: 0,
          versions: new Set<string>(),
          availableVersion: undefined,
          criticality: undefined,
        };

        existing.versions.add(comp.installedVersion);
        if (comp.status === 'update-available' || comp.status === 'critical-update') {
          existing.hostsOutdated++;
        }
        if (comp.availableVersion) {
          existing.availableVersion = comp.availableVersion;
        }
        if (comp.criticality) {
          existing.criticality = comp.criticality;
        }

        componentMap.set(key, existing);
      });
    });

    return Array.from(componentMap.values())
      .map(c => ({
        type: c.type,
        hostsOutdated: c.hostsOutdated,
        versionRange: Array.from(c.versions).sort().join(' - '),
        availableVersion: c.availableVersion,
        criticality: c.criticality,
      }))
      .sort((a, b) => b.hostsOutdated - a.hostsOutdated);
  }, [results]);

  return {
    // Scan data
    scan,
    results,
    recentScans,
    
    // Loading states
    isLoading: scanLoading || resultsLoading,
    isRecentScansLoading: recentScansLoading,
    isScanRunning: scan?.status === 'running' || scan?.status === 'pending',
    
    // Progress
    progress,
    hostResultsForProgress,
    
    // Actions
    startScan: startScanMutation.mutateAsync,
    cancelScan: cancelScanMutation.mutate,
    deleteScan: deleteScanMutation.mutate,
    refetch: () => {
      refetchScan();
      refetchResults();
    },
    
    // Mutation states
    isStarting: startScanMutation.isPending,
    isCancelling: cancelScanMutation.isPending,
    
    // Computed data
    stats: calculateStats(),
    componentSummary: getComponentSummary(),
  };
}
