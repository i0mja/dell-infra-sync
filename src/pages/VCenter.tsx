import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { VCenterStatsBar } from "@/components/vcenter/VCenterStatsBar";
import { HostsTable } from "@/components/vcenter/HostsTable";
import { HostFilterToolbar } from "@/components/vcenter/HostFilterToolbar";
import { VMsTable } from "@/components/vcenter/VMsTable";
import { VMsFilterToolbar } from "@/components/vcenter/VMsFilterToolbar";
import { ClustersTable } from "@/components/vcenter/ClustersTable";
import { ClustersFilterToolbar } from "@/components/vcenter/ClustersFilterToolbar";
import { DatastoresTable } from "@/components/vcenter/DatastoresTable";
import { DatastoresFilterToolbar } from "@/components/vcenter/DatastoresFilterToolbar";
import { VCenterManagementDialog } from "@/components/vcenter/VCenterManagementDialog";
import { VCenterDetailsSidebar } from "@/components/vcenter/VCenterDetailsSidebar";
import { NetworkDetailsSidebar } from "@/components/vcenter/NetworkDetailsSidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EsxiProfilesTab } from "@/components/vcenter/EsxiProfilesTab";
import { useVCenterData } from "@/hooks/useVCenterData";
import { useVCenters } from "@/hooks/useVCenters";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { useSavedViews } from "@/hooks/useSavedViews";
import { useDatastoreVMs } from "@/hooks/useDatastoreVMs";
import { useClusterDatastores } from "@/hooks/useClusterDatastores";
import { useVMVLANMapping } from "@/hooks/useVMVLANMapping";
import { useVLANOptions } from "@/hooks/useVLANOptions";
import { useUpdateAvailabilityScan } from "@/hooks/useUpdateAvailabilityScan";
import { parseIdracError } from "@/lib/idrac-errors";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { exportToCSV, ExportColumn } from "@/lib/csv-export";
import { DrReplicationTab } from "@/components/replication/DrReplicationTab";
import { NetworksTable } from "@/components/vcenter/NetworksTable";
import { NetworksFilterToolbar } from "@/components/vcenter/NetworksFilterToolbar";
import { SyncableTabTrigger } from "@/components/vcenter/SyncableTabTrigger";
import { ServerUpdateWizard } from "@/components/jobs/ServerUpdateWizard";
import { UpdateAvailabilityScanDialog } from "@/components/updates";
import { triggerVCenterSync, triggerPartialSync } from "@/services/vcenterService";
import type { ScanTarget } from "@/components/updates/types";
import type { SidebarNavItem } from "@/components/vcenter/SidebarBreadcrumb";

interface VCenterHost {
  id: string;
  name: string;
  cluster: string | null;
  vcenter_id: string | null;
  serial_number: string | null;
  server_id: string | null;
  esxi_version: string | null;
  status: string | null;
  maintenance_mode: boolean | null;
  last_sync: string | null;
  source_vcenter_id?: string | null;
}

interface ClusterGroup {
  name: string;
  hosts: VCenterHost[];
}

export default function VCenter() {
  const [hosts, setHosts] = useState<VCenterHost[]>([]);
  const [hostsLoading, setHostsLoading] = useState(true);
  
  // Hosts filters
  const [hostsSearch, setHostsSearch] = useState("");
  const [hostsClusterFilter, setHostsClusterFilter] = useState("all");
  const [hostsStatusFilter, setHostsStatusFilter] = useState("all");
  const [hostsLinkFilter, setHostsLinkFilter] = useState("all");
  
  // VMs filters
  const [vmsSearch, setVmsSearch] = useState("");
  const [vmsClusterFilter, setVmsClusterFilter] = useState("all");
  const [vmsPowerFilter, setVmsPowerFilter] = useState("all");
  const [vmsToolsFilter, setVmsToolsFilter] = useState("all");
  const [vmsOsFilter, setVmsOsFilter] = useState("all");
  const [vmsVlanFilter, setVmsVlanFilter] = useState("all");
  
  // Clusters filters
  const [clustersSearch, setClustersSearch] = useState("");
  const [clustersStatusFilter, setClustersStatusFilter] = useState("all");
  const [clustersHaFilter, setClustersHaFilter] = useState("all");
  const [clustersDrsFilter, setClustersDrsFilter] = useState("all");
  
  // Datastores filters
  const [datastoresSearch, setDatastoresSearch] = useState("");
  const [datastoresTypeFilter, setDatastoresTypeFilter] = useState("all");
  const [datastoresAccessFilter, setDatastoresAccessFilter] = useState("all");
  const [datastoresCapacityFilter, setDatastoresCapacityFilter] = useState("all");
  
  // Column visibility hooks
  const hostsColumnVisibility = useColumnVisibility("vcenter-hosts-columns", ["name", "status", "esxi", "serial", "linked", "vcenter", "sync"]);
  const vmsColumnVisibility = useColumnVisibility("vcenter-vms-columns", ["name", "power", "ip", "resources", "disk", "os", "tools", "cluster"]);
  const clustersColumnVisibility = useColumnVisibility("vcenter-clusters-columns", ["name", "status", "hosts", "vms", "ha", "drs", "cpu", "memory", "storage", "sync"]);
  const datastoresColumnVisibility = useColumnVisibility("vcenter-datastores-columns", ["name", "type", "capacity", "usage", "hosts", "vms", "accessible"]);
  
  // Saved views hooks
  const hostsSavedViews = useSavedViews("vcenter-hosts-views");
  const vmsSavedViews = useSavedViews("vcenter-vms-views");
  const clustersSavedViews = useSavedViews("vcenter-clusters-views");
  const datastoresSavedViews = useSavedViews("vcenter-datastores-views");
  
  // Selection counts (updated by tables via callback)
  const [hostsSelectedCount, setHostsSelectedCount] = useState(0);
  const [vmsSelectedCount, setVmsSelectedCount] = useState(0);
  const [clustersSelectedCount, setClustersSelectedCount] = useState(0);
  const [datastoresSelectedCount, setDatastoresSelectedCount] = useState(0);
  
  // Selected items for export
  const [selectedHostIds, setSelectedHostIds] = useState<Set<string>>(new Set());
  const [selectedVmIds, setSelectedVmIds] = useState<Set<string>>(new Set());
  const [selectedClusterIds, setSelectedClusterIds] = useState<Set<string>>(new Set());
  const [selectedDatastoreIds, setSelectedDatastoreIds] = useState<Set<string>>(new Set());
  
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [selectedVmId, setSelectedVmId] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [selectedDatastoreId, setSelectedDatastoreId] = useState<string | null>(null);
  const [selectedVCenterId, setSelectedVCenterId] = useState<string | null>("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [partialSyncing, setPartialSyncing] = useState<string | null>(null);
  const [vcenterHost, setVcenterHost] = useState("");
  const [activeTab, setActiveTab] = useState("hosts");
  const [deleteHostDialogOpen, setDeleteHostDialogOpen] = useState(false);
  const [bulkDeleteHostDialogOpen, setBulkDeleteHostDialogOpen] = useState(false);
  const [hostToDelete, setHostToDelete] = useState<VCenterHost | null>(null);
  const [hostsToDelete, setHostsToDelete] = useState<VCenterHost[]>([]);
  
  // Cluster Update Wizard state
  const [clusterUpdateWizardOpen, setClusterUpdateWizardOpen] = useState(false);
  const [clusterToUpdate, setClusterToUpdate] = useState<string | null>(null);
  
  // Check for Updates state
  const [updateScanDialogOpen, setUpdateScanDialogOpen] = useState(false);
  const [updateScanTarget, setUpdateScanTarget] = useState<ScanTarget | null>(null);
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  
  // Update availability scan hook
  const { startScan, isStarting: isScanStarting, scan: activeScan, progress: scanProgress, hostResultsForProgress } = useUpdateAvailabilityScan(activeScanId || undefined);

  // Sidebar navigation stack for breadcrumb
  const [sidebarNavStack, setSidebarNavStack] = useState<SidebarNavItem[]>([]);
  
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Auto-close dialog and navigate when scan completes
  useEffect(() => {
    if (!activeScan || !updateScanDialogOpen) return;
    
    if (activeScan.status === 'completed') {
      setUpdateScanDialogOpen(false);
      toast({
        title: 'Scan Complete',
        description: `Found ${activeScan.summary?.updatesAvailable ?? 0} updates available.`,
      });
      navigate(`/updates?scanId=${activeScan.id}`);
      setActiveScanId(null);
    } else if (activeScan.status === 'failed') {
      setUpdateScanDialogOpen(false);
      const parsedError = parseIdracError(activeScan.error_message);
      toast({
        title: parsedError?.title || 'Scan Failed',
        description: parsedError?.message || 'The firmware scan encountered an error.',
        variant: 'destructive',
      });
      setActiveScanId(null);
    } else if (activeScan.status === 'cancelled') {
      setUpdateScanDialogOpen(false);
      setActiveScanId(null);
    }
  }, [activeScan?.status, activeScan?.id, activeScan?.summary, activeScan?.error_message, updateScanDialogOpen, navigate, toast]);
  
  const { vcenters } = useVCenters();
  const { vms, clusters, datastores, alarms, networks, loading: vmsLoading, refetch: refetchVCenterData } = useVCenterData(
    selectedVCenterId === "all" ? null : selectedVCenterId
  );
  
  // Fetch VMs for selected datastore
  const { data: datastoreVMs, isLoading: datastoreVMsLoading } = useDatastoreVMs(selectedDatastoreId);
  
  // Find cluster info for the hook (derive directly to avoid dependency issues)
  const selectedClusterForHook = clusters.find(c => c.id === selectedClusterId);
  
  // Fetch datastores for selected cluster
  const { data: clusterDatastores, isLoading: clusterDatastoresLoading } = useClusterDatastores(
    selectedClusterForHook?.source_vcenter_id,
    selectedClusterForHook?.cluster_name
  );
  
  // VM VLAN mapping for VLAN filter
  const { data: vmVlanMapping } = useVMVLANMapping();
  const { data: vlanOptions } = useVLANOptions();

  // Networks filters
  const [networksSearch, setNetworksSearch] = useState("");
  const [networksTypeFilter, setNetworksTypeFilter] = useState("all");
  const [networksVlanFilter, setNetworksVlanFilter] = useState("all");
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | null>(null);
  const [selectedGroupedNetworks, setSelectedGroupedNetworks] = useState<typeof networks>([]);
  const [networksGroupByName, setNetworksGroupByName] = useState(true);
  const networksColumnVisibility = useColumnVisibility("vcenter-networks-columns", ["name", "type", "vlan", "sites", "hosts", "vms"]);

  const isPrivateNetwork = (host: string | null): boolean => {
    if (!host) return false;
    const cleanHost = host.trim().split(':')[0].toLowerCase();
    const privateRanges = [/^10\./, /^172\.(1[6-9]|2[0-9]|3[0-1])\./, /^192\.168\./];
    const privateDomains = ['.local', '.internal', '.lan', '.grp', '.corp', '.domain', '.private', '.home'];
    
    if (privateRanges.some((range) => range.test(cleanHost))) return true;
    if (!cleanHost.includes('.')) return true;
    return privateDomains.some(suffix => cleanHost.endsWith(suffix));
  };

  const fetchHosts = async () => {
    try {
      setHostsLoading(true);
      
      // Fetch hosts
      let query = supabase
        .from("vcenter_hosts")
        .select("*");

      if (selectedVCenterId && selectedVCenterId !== "all") {
        query = query.eq("source_vcenter_id", selectedVCenterId);
      }

      const { data: hostsData, error: hostsError } = await query
        .order("cluster", { ascending: true })
        .order("name", { ascending: true });

      if (hostsError) throw hostsError;

      // Fetch servers that are linked to vcenter hosts (to get reverse link)
      const { data: linkedServers } = await supabase
        .from("servers")
        .select("id, vcenter_host_id")
        .not("vcenter_host_id", "is", null);

      // Create a lookup map: vcenter_host_id -> server_id
      const hostToServerMap = new Map(
        (linkedServers || []).map(s => [s.vcenter_host_id, s.id])
      );

      // Merge - use existing server_id or get from servers table
      const hostsWithLinks = (hostsData || []).map(host => ({
        ...host,
        server_id: host.server_id || hostToServerMap.get(host.id) || null,
      }));

      setHosts(hostsWithLinks);
    } catch (error: any) {
      toast({
        title: "Error fetching hosts",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setHostsLoading(false);
    }
  };

  const fetchVCenterSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("vcenter_settings")
        .select("host")
        .single();

      if (error) throw error;
      if (data?.host) {
        setVcenterHost(data.host);
      }
    } catch (error) {
      console.error("Error fetching vCenter settings:", error);
    }
  };

  useEffect(() => {
    fetchHosts();
    fetchVCenterSettings();

    const channel = supabase
      .channel("vcenter_hosts_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vcenter_hosts" },
        () => {
          fetchHosts();
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [selectedVCenterId]);

  // Handle URL params for tab, cluster selection, entity selection, and settings dialog
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    const clusterParam = searchParams.get('cluster');
    const settingsParam = searchParams.get('settings');
    const selectedParam = searchParams.get('selected');
    
    // Set active tab from URL param
    if (tabParam && ['hosts', 'vms', 'clusters', 'datastores', 'networks', 'esxi-profiles', 'replication'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
    
    // Auto-open settings dialog from URL param
    if (settingsParam === 'true') {
      setSettingsOpen(true);
      searchParams.delete('settings');
      setSearchParams(searchParams, { replace: true });
    }
    
    // Auto-select cluster by name or ID
    if (clusterParam && clusters.length > 0) {
      const cluster = clusters.find(c => 
        c.cluster_name === clusterParam || c.id === clusterParam
      );
      
      if (cluster) {
        setSelectedClusterId(cluster.id);
        searchParams.delete('cluster');
        setSearchParams(searchParams, { replace: true });
      }
    }
    
    // Handle entity selection from global search navigation
    if (selectedParam) {
      const currentTab = tabParam || activeTab;
      switch (currentTab) {
        case 'vms':
          setSelectedVmId(selectedParam);
          break;
        case 'hosts':
          setSelectedHostId(selectedParam);
          break;
        case 'clusters':
          setSelectedClusterId(selectedParam);
          break;
        case 'datastores':
          setSelectedDatastoreId(selectedParam);
          break;
        case 'networks':
          setSelectedNetworkId(selectedParam);
          break;
      }
      searchParams.delete('selected');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, clusters, activeTab]);

  const filteredHosts = hosts.filter((host) => {
    const matchesSearch =
      !hostsSearch ||
      host.name.toLowerCase().includes(hostsSearch.toLowerCase()) ||
      host.cluster?.toLowerCase().includes(hostsSearch.toLowerCase()) ||
      host.serial_number?.toLowerCase().includes(hostsSearch.toLowerCase());

    const matchesCluster =
      hostsClusterFilter === "all" || host.cluster === hostsClusterFilter;

    const matchesStatus =
      hostsStatusFilter === "all" ||
      (hostsStatusFilter === "connected" && host.status === "connected") ||
      (hostsStatusFilter === "disconnected" && host.status === "disconnected") ||
      (hostsStatusFilter === "maintenance" && host.maintenance_mode);

    const matchesLink =
      hostsLinkFilter === "all" ||
      (hostsLinkFilter === "linked" && host.server_id) ||
      (hostsLinkFilter === "unlinked" && !host.server_id);

    return matchesSearch && matchesCluster && matchesStatus && matchesLink;
  });

  const clusterGroups: ClusterGroup[] = filteredHosts.reduce(
    (acc: ClusterGroup[], host) => {
      const clusterName = host.cluster || "Unclustered";
      let group = acc.find((g) => g.name === clusterName);

      if (!group) {
        group = { name: clusterName, hosts: [] };
        acc.push(group);
      }

      group.hosts.push(host);
      return acc;
    },
    []
  );

  const uniqueClusters = Array.from(
    new Set(hosts.map((h) => h.cluster).filter(Boolean))
  ) as string[];

  const linkedHosts = hosts.filter((h) => h.server_id).length;
  const unlinkedHosts = hosts.length - linkedHosts;

  const lastSync = hosts.reduce((latest, host) => {
    if (!host.last_sync) return latest;
    if (!latest) return host.last_sync;
    return new Date(host.last_sync) > new Date(latest) ? host.last_sync : latest;
  }, null as string | null);

  // Removed handleTestConnectivity and handleSyncNow - consolidated into handleSync

  const handleSync = async () => {
    try {
      setSyncing(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast({
          title: "Authentication required",
          description: "Please log in to sync",
          variant: "destructive",
        });
        return;
      }

      // Get all sync-enabled vCenters
      const enabledVCenters = vcenters.filter(vc => vc.sync_enabled);
      
      if (enabledVCenters.length === 0) {
        toast({
          title: "No vCenters to sync",
          description: "Enable sync on at least one vCenter in settings",
          variant: "destructive",
        });
        return;
      }

      // Create sync jobs for all enabled vCenters
      const { error } = await supabase.from("jobs").insert(
        enabledVCenters.map(vc => ({
          job_type: "vcenter_sync" as const,
          status: "pending" as const,
          created_by: user.id,
          target_scope: { vcenter_ids: [vc.id] },
          details: { sync_type: "full_sync", vcenter_name: vc.name },
        }))
      );

      if (error) throw error;

      toast({
        title: `Syncing ${enabledVCenters.length} vCenter${enabledVCenters.length > 1 ? 's' : ''}`,
        description: "Job Executor will handle the syncs",
        action: (
          <Button variant="outline" size="sm" onClick={() => navigate('/maintenance-planner?tab=jobs')}>
            View Jobs
          </Button>
        ),
      });
    } catch (error: any) {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  const handlePartialSync = async (scope: 'vms' | 'hosts' | 'clusters' | 'datastores' | 'networks') => {
    try {
      setPartialSyncing(scope);
      
      const targetVCenterId = selectedVCenterId === "all" ? undefined : selectedVCenterId;
      const result = await triggerPartialSync(scope, targetVCenterId);

      const scopeLabel = scope.charAt(0).toUpperCase() + scope.slice(1);
      
      // If result is a string, it's a job ID (fallback occurred)
      if (typeof result === 'string') {
        toast({
          title: `${scopeLabel} sync started`,
          description: `Syncing ${scope} from vCenter (queued)`,
          action: (
            <Button variant="outline" size="sm" onClick={() => navigate('/maintenance-planner?tab=jobs')}>
              View Jobs
            </Button>
          ),
        });
      } else if (result.success) {
        toast({
          title: `${scopeLabel} sync completed`,
          description: result.message || `${scope} synced successfully`,
        });
      } else {
        throw new Error(result.error || 'Sync failed');
      }

      // Refresh data after a short delay
      setTimeout(() => {
        if (scope === 'hosts') fetchHosts();
        refetchVCenterData();
      }, 2000);
      
    } catch (error: any) {
      toast({ 
        title: "Sync failed", 
        description: error.message, 
        variant: "destructive" 
      });
    } finally {
      setPartialSyncing(null);
    }
  };


  const handleHostClick = (host: VCenterHost) => {
    setSelectedHostId(selectedHostId === host.id ? null : host.id);
  };

  const handleVmClick = (vmId: string) => {
    setSelectedVmId(selectedVmId === vmId ? null : vmId);
  };

  const handleClusterDataClick = (clusterId: string) => {
    setSelectedClusterId(selectedClusterId === clusterId ? null : clusterId);
  };

  const handleDatastoreClick = (datastoreId: string) => {
    setSelectedDatastoreId(selectedDatastoreId === datastoreId ? null : datastoreId);
  };

  // Helper to get current selection info for nav stack
  const getCurrentNavItem = (): SidebarNavItem | null => {
    if (selectedVmId) {
      const vm = vms.find(v => v.id === selectedVmId);
      if (vm) return { type: 'vm', id: vm.id, name: vm.name };
    }
    if (selectedHostId) {
      const host = hosts.find(h => h.id === selectedHostId);
      if (host) return { type: 'host', id: host.id, name: host.name };
    }
    if (selectedClusterId) {
      const cluster = clusters.find(c => c.id === selectedClusterId);
      if (cluster) return { type: 'cluster', id: cluster.id, name: cluster.cluster_name };
    }
    if (selectedDatastoreId) {
      const ds = datastores.find(d => d.id === selectedDatastoreId);
      if (ds) return { type: 'datastore', id: ds.id, name: ds.name };
    }
    return null;
  };

  // Push current selection to nav stack before navigating away
  const pushCurrentToNavStack = () => {
    const current = getCurrentNavItem();
    if (current) {
      setSidebarNavStack(prev => [...prev, current]);
    }
  };

  // Navigate to VMs tab and select a specific VM
  const handleNavigateToVM = (vmId: string) => {
    pushCurrentToNavStack();
    setActiveTab("vms");
    setSelectedDatastoreId(null);
    setSelectedClusterId(null);
    setSelectedHostId(null);
    setSelectedVmId(vmId);
  };

  // Navigate to Datastores tab and select a specific datastore
  const handleNavigateToDatastore = (datastoreId: string) => {
    pushCurrentToNavStack();
    setActiveTab("datastores");
    setSelectedClusterId(null);
    setSelectedVmId(null);
    setSelectedHostId(null);
    setSelectedDatastoreId(datastoreId);
  };

  // Navigate to Hosts tab and select a specific host
  const handleNavigateToHost = (hostId: string) => {
    pushCurrentToNavStack();
    setActiveTab("hosts");
    setSelectedClusterId(null);
    setSelectedVmId(null);
    setSelectedDatastoreId(null);
    setSelectedHostId(hostId);
  };

  // Navigate to Clusters tab and select a specific cluster
  const handleNavigateToCluster = (clusterId: string) => {
    pushCurrentToNavStack();
    setActiveTab("clusters");
    setSelectedHostId(null);
    setSelectedVmId(null);
    setSelectedDatastoreId(null);
    setSelectedClusterId(clusterId);
  };

  // Handle sidebar back navigation
  const handleSidebarBack = () => {
    if (sidebarNavStack.length === 0) return;
    
    const prev = sidebarNavStack[sidebarNavStack.length - 1];
    setSidebarNavStack(s => s.slice(0, -1));
    
    // Clear all selections first
    setSelectedHostId(null);
    setSelectedVmId(null);
    setSelectedClusterId(null);
    setSelectedDatastoreId(null);
    
    // Restore the previous selection
    switch (prev.type) {
      case 'vm':
        setActiveTab('vms');
        setSelectedVmId(prev.id);
        break;
      case 'host':
        setActiveTab('hosts');
        setSelectedHostId(prev.id);
        break;
      case 'cluster':
        setActiveTab('clusters');
        setSelectedClusterId(prev.id);
        break;
      case 'datastore':
        setActiveTab('datastores');
        setSelectedDatastoreId(prev.id);
        break;
    }
  };

  // Handle navigating to a specific point in the nav stack
  const handleSidebarNavigateTo = (index: number) => {
    if (index < 0 || index >= sidebarNavStack.length) return;
    
    const target = sidebarNavStack[index];
    // Keep only items before this index
    setSidebarNavStack(s => s.slice(0, index));
    
    // Clear all selections first
    setSelectedHostId(null);
    setSelectedVmId(null);
    setSelectedClusterId(null);
    setSelectedDatastoreId(null);
    
    // Restore the target selection
    switch (target.type) {
      case 'vm':
        setActiveTab('vms');
        setSelectedVmId(target.id);
        break;
      case 'host':
        setActiveTab('hosts');
        setSelectedHostId(target.id);
        break;
      case 'cluster':
        setActiveTab('clusters');
        setSelectedClusterId(target.id);
        break;
      case 'datastore':
        setActiveTab('datastores');
        setSelectedDatastoreId(target.id);
        break;
    }
  };

  // Handle cluster update - opens the ServerUpdateWizard with the cluster pre-selected
  const handleClusterUpdate = (clusterName?: string) => {
    if (clusterName) {
      setClusterToUpdate(clusterName);
      setClusterUpdateWizardOpen(true);
    }
  };

  // Handle safety check - creates a cluster_safety_check job
  const handleSafetyCheck = async (clusterName: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({ title: "Authentication required", variant: "destructive" });
        return;
      }

      const { error } = await supabase.from("jobs").insert({
        job_type: "cluster_safety_check" as any,
        status: "pending",
        created_by: user.id,
        target_scope: {},
        details: { 
          cluster_name: clusterName,
          min_required_hosts: 2,
          check_drs: true,
          check_ha: true
        }
      });

      if (error) throw error;

      toast({
        title: "Safety check started",
        description: `Running safety check on cluster ${clusterName}`
      });
    } catch (error: any) {
      toast({
        title: "Failed to start safety check",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  // Handle navigate to hosts - switches to Hosts tab filtered by cluster
  const handleNavigateToHosts = (clusterName: string) => {
    setActiveTab('hosts');
    setHostsClusterFilter(clusterName);
    setSelectedClusterId(null);
    toast({
      title: "Filtered to cluster hosts",
      description: `Showing hosts in ${clusterName}`
    });
  };

  // Handle navigate to VMs - switches to VMs tab filtered by cluster
  const handleNavigateToVMs = (clusterName: string) => {
    setActiveTab('vms');
    setVmsClusterFilter(clusterName);
    setSelectedClusterId(null);
    toast({
      title: "Filtered to cluster VMs",
      description: `Showing VMs in ${clusterName}`
    });
  };

  // Handle Check for Updates - opens the scan dialog
  const handleCheckForUpdates = (target: ScanTarget) => {
    setUpdateScanTarget(target);
    setUpdateScanDialogOpen(true);
  };

  const handleClusterCheckForUpdates = (clusterName: string, hostIds?: string[]) => {
    // Find cluster to get host IDs if not provided
    const cluster = clusters.find(c => c.cluster_name === clusterName);
    const clusterHosts = hosts.filter(h => h.cluster === clusterName);
    
    handleCheckForUpdates({
      type: 'cluster',
      name: clusterName,
      vcenterHostIds: hostIds?.length ? hostIds : clusterHosts.map(h => h.id),
      serverIds: clusterHosts.filter(h => h.server_id).map(h => h.server_id!),
    });
  };

  const handleHostCheckForUpdates = (host: VCenterHost) => {
    handleCheckForUpdates({
      type: 'single_host',
      name: host.name,
      vcenterHostIds: [host.id],
      serverIds: host.server_id ? [host.server_id] : undefined,
    });
  };

  const handleHostSync = async (hostId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast({
          title: "Authentication required",
          variant: "destructive",
        });
        return;
      }

      const { error } = await supabase.from("jobs").insert({
        job_type: "vcenter_sync",
        status: "pending",
        created_by: user.id,
        target_scope: { vcenter_host_ids: [hostId] },
        details: { sync_type: "single_host", host_id: hostId },
      });

      if (error) throw error;

      toast({
        title: "Host sync started",
        description: "Syncing host data",
      });
    } catch (error: any) {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleViewLinkedServer = (serverId: string) => {
    navigate(`/servers?id=${serverId}`);
  };

  const handleLinkToServer = (hostId: string) => {
    navigate(`/servers?link_vcenter=${hostId}`);
  };

  const handleHostDelete = (host: VCenterHost) => {
    setHostToDelete(host);
    setDeleteHostDialogOpen(true);
  };

  const handleBulkHostDelete = (hostIds: string[]) => {
    const hostsToRemove = hosts.filter(h => hostIds.includes(h.id));
    setHostsToDelete(hostsToRemove);
    setBulkDeleteHostDialogOpen(true);
  };

  const confirmDeleteHost = async () => {
    if (!hostToDelete) return;
    
    try {
      const { error } = await supabase
        .from("vcenter_hosts")
        .delete()
        .eq("id", hostToDelete.id);

      if (error) throw error;

      toast({
        title: "Host removed",
        description: "Host has been removed from sync tracking. It will reappear on next vCenter sync.",
      });

      fetchHosts();
      setDeleteHostDialogOpen(false);
      setHostToDelete(null);
    } catch (error: any) {
      toast({
        title: "Error removing host",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const confirmBulkDeleteHosts = async () => {
    try {
      const hostIds = hostsToDelete.map(h => h.id);
      const { error } = await supabase
        .from("vcenter_hosts")
        .delete()
        .in("id", hostIds);

      if (error) throw error;

      toast({
        title: `${hostIds.length} hosts removed`,
        description: "Hosts have been removed from sync tracking. They will reappear on next vCenter sync.",
      });

      fetchHosts();
      setBulkDeleteHostDialogOpen(false);
      setHostsToDelete([]);
    } catch (error: any) {
      toast({
        title: "Error removing hosts",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleCloseSidebar = () => {
    setSelectedHostId(null);
    setSelectedVmId(null);
    setSelectedClusterId(null);
    setSelectedDatastoreId(null);
    setSidebarNavStack([]); // Clear navigation history
  };

  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    handleCloseSidebar();
  };

  // Resolve selected objects from IDs
  const selectedHost = selectedHostId 
    ? hosts.find(h => h.id === selectedHostId) || null 
    : null;

  const selectedVm = selectedVmId 
    ? vms.find(v => v.id === selectedVmId) || null 
    : null;

  const selectedClusterData = selectedClusterId 
    ? clusters.find(c => c.id === selectedClusterId) || null 
    : null;

  const selectedDatastore = selectedDatastoreId 
    ? datastores.find(d => d.id === selectedDatastoreId) || null 
    : null;

  const hasSelection = selectedHost || selectedVm || selectedClusterData || selectedDatastore;
  const selectedNetwork = networks.find(n => n.id === selectedNetworkId) || null;
  const selectedNetworkVCenterName = selectedNetwork?.source_vcenter_id 
    ? vcenters.find(vc => vc.id === selectedNetwork.source_vcenter_id)?.name 
    : undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <VCenterStatsBar
        totalHosts={hosts.length}
        linkedHosts={linkedHosts}
        unlinkedHosts={unlinkedHosts}
        totalVms={vms.length}
        totalDatastores={datastores.length}
        alarms={alarms}
        lastSync={lastSync}
        mode={isPrivateNetwork(vcenterHost) ? "job-executor" : "cloud"}
        syncing={syncing}
        onSettings={() => setSettingsOpen(true)}
        onSync={handleSync}
        onPartialSync={handlePartialSync}
        partialSyncing={partialSyncing}
        vcenters={vcenters.map(vc => ({ id: vc.id, name: vc.name, color: vc.color }))}
        selectedVCenterId={selectedVCenterId}
        onVCenterChange={setSelectedVCenterId}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Scrollable tabs/table area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="h-full flex flex-col">
          {/* Tabs Row with Action Buttons */}
          <div className="flex items-center border-b bg-card px-4">
            <TabsList className="h-auto p-0 bg-transparent gap-2">
              <SyncableTabTrigger
                value="hosts"
                label="Hosts"
                count={hosts.length}
                onSync={() => handlePartialSync('hosts')}
                syncing={partialSyncing === 'hosts'}
              />
              <SyncableTabTrigger
                value="vms"
                label="VMs"
                count={vms.length}
                onSync={() => handlePartialSync('vms')}
                syncing={partialSyncing === 'vms'}
              />
              <SyncableTabTrigger
                value="clusters"
                label="Clusters"
                count={clusters.length}
                onSync={() => handlePartialSync('clusters')}
                syncing={partialSyncing === 'clusters'}
              />
              <SyncableTabTrigger
                value="datastores"
                label="Datastores"
                count={datastores.length}
                onSync={() => handlePartialSync('datastores')}
                syncing={partialSyncing === 'datastores'}
              />
              <SyncableTabTrigger
                value="networks"
                label="Networks"
                count={networks.length}
                onSync={() => handlePartialSync('networks')}
                syncing={partialSyncing === 'networks'}
              />
              <TabsTrigger
                value="esxi-profiles"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
              >
                ESXi Profiles
              </TabsTrigger>
              <TabsTrigger 
                value="replication"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
              >
                DR / Replication
              </TabsTrigger>
            </TabsList>
            
            <div className="flex-1" />
          </div>

          {/* Filter Toolbars */}
          {activeTab === "hosts" && (
            <HostFilterToolbar
              searchTerm={hostsSearch}
              onSearchChange={setHostsSearch}
              clusters={Array.from(new Set(hosts.map((h) => h.cluster).filter(Boolean))) as string[]}
              clusterFilter={hostsClusterFilter}
              onClusterFilterChange={setHostsClusterFilter}
              statusFilter={hostsStatusFilter}
              onStatusFilterChange={setHostsStatusFilter}
              linkFilter={hostsLinkFilter}
              onLinkFilterChange={setHostsLinkFilter}
              visibleColumns={hostsColumnVisibility.visibleColumns}
              onToggleColumn={hostsColumnVisibility.toggleColumn}
              onExport={() => {
                const columns: ExportColumn<VCenterHost>[] = [
                  { key: "name", label: "Hostname" },
                  { key: "status", label: "Status" },
                  { key: "maintenance_mode", label: "Maintenance", format: (v) => (v ? "Yes" : "No") },
                  { key: "esxi_version", label: "ESXi Version" },
                  { key: "serial_number", label: "Serial Number" },
                  { key: "server_id", label: "Linked", format: (v) => (v ? "Yes" : "No") },
                  { key: "cluster", label: "Cluster" },
                  { key: "last_sync", label: "Last Sync" },
                ];
                const hostsToExport = selectedHostIds.size > 0 ? hosts.filter((h) => selectedHostIds.has(h.id)) : hosts;
                exportToCSV(hostsToExport, columns, "vcenter-hosts");
                toast({ title: "Export successful", description: `Exported ${hostsToExport.length} hosts` });
              }}
              selectedCount={hostsSelectedCount}
              onSaveView={(name) => {
                hostsSavedViews.saveView(name, {}, undefined, undefined, hostsColumnVisibility.visibleColumns);
                toast({ title: "View saved", description: `"${name}" saved successfully` });
              }}
            />
          )}
          {activeTab === "vms" && (
            <VMsFilterToolbar
              searchTerm={vmsSearch}
              onSearchChange={setVmsSearch}
              clusters={Array.from(new Set(vms.map((v) => v.cluster_name).filter(Boolean))) as string[]}
              clusterFilter={vmsClusterFilter}
              onClusterFilterChange={setVmsClusterFilter}
              powerFilter={vmsPowerFilter}
              onPowerFilterChange={setVmsPowerFilter}
              toolsFilter={vmsToolsFilter}
              onToolsFilterChange={setVmsToolsFilter}
              osFilter={vmsOsFilter}
              onOsFilterChange={setVmsOsFilter}
              vlanFilter={vmsVlanFilter}
              onVlanFilterChange={setVmsVlanFilter}
              vlanOptions={vlanOptions || []}
              visibleColumns={vmsColumnVisibility.visibleColumns}
              onToggleColumn={vmsColumnVisibility.toggleColumn}
              onExport={() => {
                const columns: ExportColumn<typeof vms[0]>[] = [
                  { key: "name", label: "VM Name" },
                  { key: "power_state", label: "Power State" },
                  { key: "ip_address", label: "IP Address" },
                  { key: "cpu_count", label: "CPUs" },
                  { key: "memory_mb", label: "Memory (MB)" },
                  { key: "disk_gb", label: "Disk (GB)" },
                  { key: "guest_os", label: "Guest OS" },
                  { key: "tools_status", label: "Tools Status" },
                  { key: "cluster_name", label: "Cluster" },
                ];
                const vmsToExport = selectedVmIds.size > 0 ? vms.filter((v) => selectedVmIds.has(v.id)) : vms;
                exportToCSV(vmsToExport, columns, "vcenter-vms");
                toast({ title: "Export successful", description: `Exported ${vmsToExport.length} VMs` });
              }}
              selectedCount={vmsSelectedCount}
              onSaveView={(name) => {
                vmsSavedViews.saveView(name, { cluster: vmsClusterFilter, power: vmsPowerFilter, tools: vmsToolsFilter, os: vmsOsFilter, vlan: vmsVlanFilter }, undefined, undefined, vmsColumnVisibility.visibleColumns);
                toast({ title: "View saved", description: `"${name}" saved successfully` });
              }}
            />
          )}
          {activeTab === "clusters" && (
            <ClustersFilterToolbar
              searchTerm={clustersSearch}
              onSearchChange={setClustersSearch}
              statusFilter={clustersStatusFilter}
              onStatusFilterChange={setClustersStatusFilter}
              haFilter={clustersHaFilter}
              onHaFilterChange={setClustersHaFilter}
              drsFilter={clustersDrsFilter}
              onDrsFilterChange={setClustersDrsFilter}
              visibleColumns={clustersColumnVisibility.visibleColumns}
              onToggleColumn={clustersColumnVisibility.toggleColumn}
              onExport={() => {
                const columns: ExportColumn<typeof clusters[0]>[] = [
                  { key: "cluster_name", label: "Cluster Name" },
                  { key: "overall_status", label: "Status" },
                  { key: "host_count", label: "Hosts" },
                  { key: "vm_count", label: "VMs" },
                  { key: "ha_enabled", label: "HA Enabled", format: (v) => (v ? "Yes" : "No") },
                  { key: "drs_enabled", label: "DRS Enabled", format: (v) => (v ? "Yes" : "No") },
                  { key: "last_sync", label: "Last Sync" },
                ];
                const clustersToExport = selectedClusterIds.size > 0 ? clusters.filter((c) => selectedClusterIds.has(c.id)) : clusters;
                exportToCSV(clustersToExport, columns, "vcenter-clusters");
                toast({ title: "Export successful", description: `Exported ${clustersToExport.length} clusters` });
              }}
              selectedCount={clustersSelectedCount}
              onSaveView={(name) => {
                clustersSavedViews.saveView(name, { status: clustersStatusFilter, ha: clustersHaFilter, drs: clustersDrsFilter }, undefined, undefined, clustersColumnVisibility.visibleColumns);
                toast({ title: "View saved", description: `"${name}" saved successfully` });
              }}
            />
          )}
          {activeTab === "datastores" && (
            <DatastoresFilterToolbar
              searchTerm={datastoresSearch}
              onSearchChange={setDatastoresSearch}
              typeFilter={datastoresTypeFilter}
              onTypeFilterChange={setDatastoresTypeFilter}
              accessFilter={datastoresAccessFilter}
              onAccessFilterChange={setDatastoresAccessFilter}
              capacityFilter={datastoresCapacityFilter}
              onCapacityFilterChange={setDatastoresCapacityFilter}
              visibleColumns={datastoresColumnVisibility.visibleColumns}
              onToggleColumn={datastoresColumnVisibility.toggleColumn}
              onExport={() => {
                const columns: ExportColumn<typeof datastores[0]>[] = [
                  { key: "name", label: "Name" },
                  { key: "type", label: "Type" },
                  { key: "capacity_bytes", label: "Capacity (bytes)" },
                  { key: "free_bytes", label: "Free (bytes)" },
                  { key: "host_count", label: "Hosts" },
                  { key: "vm_count", label: "VMs" },
                  { key: "accessible", label: "Accessible", format: (v) => (v ? "Yes" : "No") },
                ];
                const datastoresToExport = selectedDatastoreIds.size > 0 ? datastores.filter((d) => selectedDatastoreIds.has(d.id)) : datastores;
                exportToCSV(datastoresToExport, columns, "vcenter-datastores");
                toast({ title: "Export successful", description: `Exported ${datastoresToExport.length} datastores` });
              }}
              selectedCount={datastoresSelectedCount}
              onSaveView={(name) => {
                datastoresSavedViews.saveView(name, { type: datastoresTypeFilter, access: datastoresAccessFilter, capacity: datastoresCapacityFilter }, undefined, undefined, datastoresColumnVisibility.visibleColumns);
                toast({ title: "View saved", description: `"${name}" saved successfully` });
              }}
            />
          )}

          {activeTab === "networks" && (
            <NetworksFilterToolbar
              searchTerm={networksSearch}
              onSearchChange={setNetworksSearch}
              typeFilter={networksTypeFilter}
              onTypeFilterChange={setNetworksTypeFilter}
              vlanFilter={networksVlanFilter}
              onVlanFilterChange={setNetworksVlanFilter}
              visibleColumns={networksColumnVisibility.visibleColumns}
              onToggleColumn={networksColumnVisibility.toggleColumn}
              groupByName={networksGroupByName}
              onGroupByNameChange={setNetworksGroupByName}
            />
          )}

          <TabsContent value="hosts" className="flex-1 mt-0 overflow-hidden min-h-0">
            <div className="h-full flex flex-col">
              <HostsTable
                clusterGroups={clusterGroups}
                selectedHostId={selectedHostId}
                selectedCluster={null}
                onHostClick={handleHostClick}
                onClusterClick={() => {}}
                onHostSync={(host) => handleHostSync(host.id)}
                onClusterUpdate={handleClusterUpdate}
                onViewLinkedServer={(host) => handleViewLinkedServer(host.server_id!)}
                onLinkToServer={(host) => handleLinkToServer(host.id)}
                onSync={handleSync}
                loading={hostsLoading}
                onHostDelete={handleHostDelete}
                onBulkDelete={handleBulkHostDelete}
                visibleColumns={hostsColumnVisibility.visibleColumns}
                onSelectionChange={(ids) => {
                  setSelectedHostIds(ids);
                  setHostsSelectedCount(ids.size);
                }}
                vcenters={vcenters}
                onCheckForUpdates={handleHostCheckForUpdates}
              />
            </div>
          </TabsContent>

          <TabsContent value="vms" className="flex-1 mt-0 overflow-hidden min-h-0">
            <div className="h-full flex flex-col">
              <VMsTable
                vms={vms}
                selectedVmId={selectedVmId}
                onVmClick={(vm) => handleVmClick(vm.id)}
                loading={vmsLoading}
                searchTerm={vmsSearch}
                clusterFilter={vmsClusterFilter}
                powerFilter={vmsPowerFilter}
                toolsFilter={vmsToolsFilter}
                osFilter={vmsOsFilter}
                vlanFilter={vmsVlanFilter}
                vmVlanMapping={vmVlanMapping}
                visibleColumns={vmsColumnVisibility.visibleColumns}
              />
            </div>
          </TabsContent>

          <TabsContent value="clusters" className="flex-1 mt-0 overflow-hidden min-h-0">
            <div className="h-full flex flex-col">
              <ClustersTable
                clusters={clusters}
                selectedClusterId={selectedClusterId}
                onClusterClick={handleClusterDataClick}
                loading={vmsLoading}
                searchTerm={clustersSearch}
                statusFilter={clustersStatusFilter}
                haFilter={clustersHaFilter}
                drsFilter={clustersDrsFilter}
                visibleColumns={clustersColumnVisibility.visibleColumns}
                onCheckForUpdates={(cluster) => handleClusterCheckForUpdates(cluster.cluster_name)}
                onSafetyCheck={handleSafetyCheck}
                onClusterUpdate={handleClusterUpdate}
              />
            </div>
          </TabsContent>

          <TabsContent value="datastores" className="flex-1 mt-0 overflow-hidden min-h-0">
            <div className="h-full flex flex-col">
              <DatastoresTable
                datastores={datastores}
                selectedDatastoreId={selectedDatastoreId}
                onDatastoreClick={(ds) => handleDatastoreClick(ds.id)}
                loading={vmsLoading}
                searchTerm={datastoresSearch}
                typeFilter={datastoresTypeFilter}
                accessFilter={datastoresAccessFilter}
                capacityFilter={datastoresCapacityFilter}
                visibleColumns={datastoresColumnVisibility.visibleColumns}
              />
            </div>
          </TabsContent>

          <TabsContent value="networks" className="flex-1 mt-0 overflow-hidden min-h-0">
            <div className="h-full flex flex-col">
              <NetworksTable
                networks={networks}
                selectedNetworkId={selectedNetworkId}
                onNetworkClick={(net, groupedNets) => {
                  if (selectedNetworkId === net.id) {
                    setSelectedNetworkId(null);
                    setSelectedGroupedNetworks([]);
                  } else {
                    setSelectedNetworkId(net.id);
                    setSelectedGroupedNetworks(groupedNets || [net]);
                  }
                }}
                loading={vmsLoading}
                searchTerm={networksSearch}
                typeFilter={networksTypeFilter}
                vlanFilter={networksVlanFilter}
                visibleColumns={networksColumnVisibility.visibleColumns}
                groupByName={networksGroupByName}
                vcenterMap={new Map(vcenters.map(vc => [vc.id, vc.name]))}
              />
            </div>
          </TabsContent>

          <TabsContent value="esxi-profiles" className="flex-1 mt-0 overflow-auto min-h-0">
            <div className="p-6">
              <EsxiProfilesTab />
            </div>
          </TabsContent>

          <TabsContent value="replication" className="flex-1 mt-0 overflow-hidden min-h-0">
            <div className="h-full flex flex-col">
              <DrReplicationTab />
            </div>
          </TabsContent>
        </Tabs>
        </div>

        {/* Fixed sidebar - only shows when something is selected */}
        {hasSelection && (
        <VCenterDetailsSidebar 
            selectedHost={selectedHost}
            selectedCluster={null}
            selectedVm={selectedVm}
            selectedClusterData={selectedClusterData}
            selectedDatastore={selectedDatastore}
            datastoreVMs={datastoreVMs}
            datastoreVMsLoading={datastoreVMsLoading}
            clusterDatastores={clusterDatastores}
            clusterDatastoresLoading={clusterDatastoresLoading}
            onClusterUpdate={handleClusterUpdate}
            onClose={handleCloseSidebar}
            onHostSync={(host) => handleHostSync(host.id)}
            onViewLinkedServer={(host) => handleViewLinkedServer(host.server_id!)}
            onLinkToServer={(host) => handleLinkToServer(host.id)}
            onNavigateToVM={handleNavigateToVM}
            onNavigateToDatastore={handleNavigateToDatastore}
            onNavigateToHost={handleNavigateToHost}
            onNavigateToCluster={handleNavigateToCluster}
            onSafetyCheck={handleSafetyCheck}
            onNavigateToHosts={handleNavigateToHosts}
            onNavigateToVMs={handleNavigateToVMs}
            onCheckForUpdates={handleClusterCheckForUpdates}
            navStack={sidebarNavStack}
            onNavigateBack={handleSidebarBack}
            onNavigateTo={handleSidebarNavigateTo}
          />
        )}
        
        {/* Network details sidebar */}
        {selectedNetwork && !hasSelection && (
          <NetworkDetailsSidebar
            network={selectedNetwork}
            groupedNetworks={selectedGroupedNetworks.length > 0 ? selectedGroupedNetworks : undefined}
            selectedVCenterId={selectedVCenterId}
            onClose={() => {
              setSelectedNetworkId(null);
              setSelectedGroupedNetworks([]);
            }}
            vcenterName={selectedNetworkVCenterName}
            vcenterMap={new Map(vcenters.map(vc => [vc.id, vc.name]))}
          />
        )}
      </div>

      <VCenterManagementDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onVCenterAdded={() => {
          fetchHosts();
          refetchVCenterData();
        }}
      />
      
      
      <AlertDialog open={deleteHostDialogOpen} onOpenChange={setDeleteHostDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Host</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {hostToDelete?.name} from sync tracking?
              <br /><br />
              <strong>Note:</strong> This will remove the host from your local tracking. The host will reappear on the next vCenter sync if it still exists in vCenter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteHost} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteHostDialogOpen} onOpenChange={setBulkDeleteHostDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {hostsToDelete.length} Host{hostsToDelete.length > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              The following hosts will be removed from sync tracking:
              <ul className="mt-2 mb-2 ml-4 list-disc text-sm">
                {hostsToDelete.slice(0, 5).map(h => (
                  <li key={h.id}>{h.name}</li>
                ))}
                {hostsToDelete.length > 5 && <li>(and {hostsToDelete.length - 5} more...)</li>}
              </ul>
              <strong>Note:</strong> These hosts will reappear on the next vCenter sync if they still exist in vCenter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBulkDeleteHosts} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cluster Update Wizard */}
      <ServerUpdateWizard
        open={clusterUpdateWizardOpen}
        onOpenChange={(open) => {
          setClusterUpdateWizardOpen(open);
          if (!open) setClusterToUpdate(null);
        }}
        preSelectedTarget={clusterToUpdate ? {
          type: 'cluster',
          id: clusterToUpdate
        } : undefined}
      />

      {/* Update Availability Scan Dialog */}
      {updateScanTarget && (
        <UpdateAvailabilityScanDialog
          open={updateScanDialogOpen}
          onOpenChange={(open) => {
            setUpdateScanDialogOpen(open);
            if (!open) {
              setActiveScanId(null);
            }
          }}
          target={updateScanTarget}
          isScanning={isScanStarting || activeScan?.status === 'running' || activeScan?.status === 'pending'}
          scanProgress={scanProgress ? {
            scannedHosts: scanProgress.scannedHosts,
            totalHosts: scanProgress.totalHosts,
            currentHost: scanProgress.currentHost,
            updatesFound: scanProgress.updatesFound,
            criticalFound: scanProgress.criticalFound,
            hostResults: hostResultsForProgress,
          } : undefined}
          onStartScan={async (firmwareSource) => {
            try {
              const scanId = await startScan({
                scanType: updateScanTarget.type === 'single_host' ? 'single_host' : 
                          updateScanTarget.type === 'cluster' ? 'cluster' :
                          updateScanTarget.type === 'group' ? 'group' : 'servers',
                targetId: updateScanTarget.type === 'cluster' ? updateScanTarget.name : 
                          updateScanTarget.type === 'group' ? updateScanTarget.name : undefined,
                targetName: updateScanTarget.name,
                serverIds: updateScanTarget.serverIds,
                vcenterHostIds: updateScanTarget.vcenterHostIds,
                firmwareSource,
              });
              setActiveScanId(scanId);
              // Don't close - let dialog show progress
            } catch (error) {
              console.error('Failed to start scan:', error);
            }
          }}
        />
      )}

    </div>
  );
}
