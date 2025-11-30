import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
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
import { VCenterConnectivityDialog } from "@/components/vcenter/VCenterConnectivityDialog";
import { ClusterUpdateWizard } from "@/components/jobs/ClusterUpdateWizard";
import { VCenterDetailsSidebar } from "@/components/vcenter/VCenterDetailsSidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EsxiProfilesTab } from "@/components/vcenter/EsxiProfilesTab";
import { useVCenterData } from "@/hooks/useVCenterData";
import { useVCenters } from "@/hooks/useVCenters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Columns3, Download } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

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
  
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [selectedVmId, setSelectedVmId] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [selectedDatastoreId, setSelectedDatastoreId] = useState<string | null>(null);
  const [selectedVCenterId, setSelectedVCenterId] = useState<string | null>("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [clusterUpdateOpen, setClusterUpdateOpen] = useState(false);
  const [selectedClusterForUpdate, setSelectedClusterForUpdate] = useState<string | undefined>();
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [vcenterHost, setVcenterHost] = useState("");
  const [activeTab, setActiveTab] = useState("hosts");
  const [deleteHostDialogOpen, setDeleteHostDialogOpen] = useState(false);
  const [bulkDeleteHostDialogOpen, setBulkDeleteHostDialogOpen] = useState(false);
  const [hostToDelete, setHostToDelete] = useState<VCenterHost | null>(null);
  const [hostsToDelete, setHostsToDelete] = useState<VCenterHost[]>([]);
  
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const { vcenters } = useVCenters();
  const { vms, clusters, datastores, alarms, loading: vmsLoading, refetch: refetchVCenterData } = useVCenterData(
    selectedVCenterId === "all" ? null : selectedVCenterId
  );

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
      let query = supabase
        .from("vcenter_hosts")
        .select("*");

      // Filter by selectedVCenterId if not "all"
      if (selectedVCenterId && selectedVCenterId !== "all") {
        query = query.eq("source_vcenter_id", selectedVCenterId);
      }

      const { data, error } = await query
        .order("cluster", { ascending: true })
        .order("name", { ascending: true });

      if (error) throw error;
      setHosts(data || []);
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

  const handleTestConnectivity = async () => {
    try {
      setTesting(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast({
          title: "Authentication required",
          description: "Please log in to test connectivity",
          variant: "destructive",
        });
        return;
      }

      const { data, error } = await supabase.from("jobs").insert({
        job_type: "vcenter_connectivity_test",
        status: "pending",
        created_by: user.id,
        details: { test_type: "full_connectivity_test" },
      }).select().single();

      if (error) throw error;

      toast({
        title: "Connectivity test started",
        description: `Job ${data.id} created`,
      });

      setTestDialogOpen(true);
    } catch (error: any) {
      toast({
        title: "Failed to start connectivity test",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSyncNow = async () => {
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

      if (isPrivateNetwork(vcenterHost)) {
        const { data, error } = await supabase.from("jobs").insert({
          job_type: "vcenter_sync",
          status: "pending",
          created_by: user.id,
          target_scope: { type: 'all' },
          details: { sync_type: "full_sync" },
        }).select().single();

        if (error) throw error;

        toast({
          title: "vCenter sync started",
          description: "Job Executor will handle the sync for private network",
          action: (
            <Button variant="outline" size="sm" onClick={() => navigate('/maintenance-planner?tab=jobs')}>
              View Jobs
            </Button>
          ),
        });
      } else {
        const { error } = await supabase.functions.invoke("sync-vcenter-direct", {
          body: { syncType: "full" },
        });

        if (error) throw error;

        toast({
          title: "vCenter sync completed",
          description: "Data has been synchronized",
        });
        
        fetchHosts();
        refetchVCenterData();
      }
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

  const handleClusterUpdate = (clusterName?: string) => {
    setSelectedClusterForUpdate(clusterName);
    setClusterUpdateOpen(true);
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
        testing={testing}
        onSettings={() => setSettingsOpen(true)}
        onTest={handleTestConnectivity}
        onSync={handleSyncNow}
        onRefresh={() => {
          fetchHosts();
          refetchVCenterData();
        }}
        onClusterUpdate={() => handleClusterUpdate()}
        hasActiveClusters={uniqueClusters.length > 0}
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
              <TabsTrigger 
                value="hosts"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
              >
                Hosts ({hosts.length})
              </TabsTrigger>
              <TabsTrigger 
                value="vms"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
              >
                VMs ({vms.length})
              </TabsTrigger>
              <TabsTrigger 
                value="clusters"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
              >
                Clusters ({clusters.length})
              </TabsTrigger>
               <TabsTrigger 
                value="datastores"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
              >
                Datastores ({datastores.length})
              </TabsTrigger>
              <TabsTrigger 
                value="esxi-profiles"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
              >
                ESXi Profiles
              </TabsTrigger>
            </TabsList>
            
            <div className="flex-1" />
            
            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <Columns3 className="mr-1 h-4 w-4" /> Columns
              </Button>
              <Button variant="outline" size="sm">
                <Download className="mr-1 h-4 w-4" /> Export
              </Button>
            </div>
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
            />
          )}

          <TabsContent value="hosts" className="flex-1 mt-0 overflow-hidden">
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
              onSync={handleSyncNow}
              loading={hostsLoading}
              onHostDelete={handleHostDelete}
              onBulkDelete={handleBulkHostDelete}
            />
          </TabsContent>

          <TabsContent value="vms" className="flex-1 mt-0 overflow-hidden">
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
            />
          </TabsContent>

          <TabsContent value="clusters" className="flex-1 mt-0 overflow-hidden">
            <ClustersTable
              clusters={clusters}
              selectedClusterId={selectedClusterId}
              onClusterClick={handleClusterDataClick}
              loading={vmsLoading}
              searchTerm={clustersSearch}
              statusFilter={clustersStatusFilter}
              haFilter={clustersHaFilter}
              drsFilter={clustersDrsFilter}
            />
          </TabsContent>

          <TabsContent value="datastores" className="flex-1 mt-0 overflow-hidden">
            <DatastoresTable
              datastores={datastores}
              selectedDatastoreId={selectedDatastoreId}
              onDatastoreClick={(ds) => handleDatastoreClick(ds.id)}
              loading={vmsLoading}
              searchTerm={datastoresSearch}
              typeFilter={datastoresTypeFilter}
              accessFilter={datastoresAccessFilter}
              capacityFilter={datastoresCapacityFilter}
            />
          </TabsContent>

          <TabsContent value="esxi-profiles" className="flex-1 mt-0 p-6 overflow-auto">
            <EsxiProfilesTab />
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
            onClusterUpdate={handleClusterUpdate}
            onClose={handleCloseSidebar}
            onHostSync={(host) => handleHostSync(host.id)}
            onViewLinkedServer={(host) => handleViewLinkedServer(host.server_id!)}
            onLinkToServer={(host) => handleLinkToServer(host.id)}
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
      <VCenterConnectivityDialog open={testDialogOpen} onOpenChange={setTestDialogOpen} results={null} />
      
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

      <ClusterUpdateWizard
        open={clusterUpdateOpen}
        onOpenChange={setClusterUpdateOpen}
        preSelectedCluster={selectedClusterForUpdate}
      />
    </div>
  );
}
