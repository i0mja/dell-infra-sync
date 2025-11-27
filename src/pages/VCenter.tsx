import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { VCenterStatsBar } from "@/components/vcenter/VCenterStatsBar";
import { HostFilterToolbar } from "@/components/vcenter/HostFilterToolbar";
import { HostsTable } from "@/components/vcenter/HostsTable";
import { VMsTable } from "@/components/vcenter/VMsTable";
import { ClustersPanel } from "@/components/vcenter/ClustersPanel";
import { DatastoresTable } from "@/components/vcenter/DatastoresTable";
import { AlarmsPanel } from "@/components/vcenter/AlarmsPanel";
import { VCenterDetailsSidebar } from "@/components/vcenter/VCenterDetailsSidebar";
import { VCenterSettingsDialog } from "@/components/vcenter/VCenterSettingsDialog";
import { VCenterConnectivityDialog } from "@/components/vcenter/VCenterConnectivityDialog";
import { ClusterUpdateWizard } from "@/components/jobs/ClusterUpdateWizard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useVCenterData } from "@/hooks/useVCenterData";
import { Button } from "@/components/ui/button";

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
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [clusterFilter, setClusterFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [linkFilter, setLinkFilter] = useState("all");
  const [selectedHost, setSelectedHost] = useState<VCenterHost | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [clusterUpdateOpen, setClusterUpdateOpen] = useState(false);
  const [selectedClusterForUpdate, setSelectedClusterForUpdate] = useState<string | undefined>();
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [vcenterHost, setVcenterHost] = useState("");
  const [activeTab, setActiveTab] = useState("hosts");
  
  const navigate = useNavigate();
  const { toast } = useToast();
  
  // Fetch VM, cluster, datastore, and alarm data
  const { vms, clusters: clusterData, datastores, alarms, loading: vcenterDataLoading, refetch: refetchVCenterData } = useVCenterData();
  
  const [selectedVm, setSelectedVm] = useState<any>(null);
  const [selectedClusterData, setSelectedClusterData] = useState<any>(null);
  const [selectedDatastore, setSelectedDatastore] = useState<any>(null);

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
      setLoading(true);
      const { data, error } = await supabase
        .from("vcenter_hosts")
        .select("*")
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
      setLoading(false);
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
  }, []);

  // Filter hosts
  const filteredHosts = hosts.filter((host) => {
    const matchesSearch =
      !searchTerm ||
      host.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      host.cluster?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      host.serial_number?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCluster =
      clusterFilter === "all" || host.cluster === clusterFilter;

    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "connected" && host.status === "connected") ||
      (statusFilter === "disconnected" && host.status === "disconnected") ||
      (statusFilter === "maintenance" && host.maintenance_mode);

    const matchesLink =
      linkFilter === "all" ||
      (linkFilter === "linked" && host.server_id) ||
      (linkFilter === "unlinked" && !host.server_id);

    return matchesSearch && matchesCluster && matchesStatus && matchesLink;
  });

  // Group hosts by cluster
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

      // Check if vCenter host is private
      if (isPrivateNetwork(vcenterHost)) {
        // Use Job Executor for private network
        const { data, error } = await supabase.from("jobs").insert({
          job_type: "vcenter_sync",
          status: "pending",
          created_by: user.id,
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
        // Use direct cloud sync for public/accessible networks
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
    setSelectedHost(host);
    setSelectedCluster(null);
    setSelectedVm(null);
    setSelectedClusterData(null);
    setSelectedDatastore(null);
  };

  const handleClusterClick = (clusterName: string) => {
    setSelectedCluster(clusterName);
    setSelectedHost(null);
    setSelectedVm(null);
    setSelectedClusterData(null);
    setSelectedDatastore(null);
  };

  const handleHostSync = async (host: VCenterHost) => {
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
        target_scope: { vcenter_host_ids: [host.id] },
        details: { sync_type: "single_host", host_id: host.id },
      });

      if (error) throw error;

      toast({
        title: "Host sync started",
        description: `Syncing ${host.name}`,
      });
    } catch (error: any) {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleViewLinkedServer = (host: VCenterHost) => {
    if (host.server_id) {
      navigate(`/servers?id=${host.server_id}`);
    }
  };

  const handleLinkToServer = (host: VCenterHost) => {
    navigate(`/servers?link_vcenter=${host.id}`);
  };

  const handleVmClick = (vm: any) => {
    setSelectedVm(vm);
    setSelectedHost(null);
    setSelectedCluster(null);
    setSelectedClusterData(null);
    setSelectedDatastore(null);
  };

  const handleClusterDataClick = (cluster: any) => {
    setSelectedClusterData(cluster);
    setSelectedHost(null);
    setSelectedCluster(null);
    setSelectedVm(null);
    setSelectedDatastore(null);
  };

  const handleDatastoreClick = (datastore: any) => {
    setSelectedDatastore(datastore);
    setSelectedHost(null);
    setSelectedCluster(null);
    setSelectedVm(null);
    setSelectedClusterData(null);
  };

  const sidebarOpen = !!(selectedHost || selectedCluster || selectedVm || selectedClusterData || selectedDatastore);
  const selectedClusterGroup = selectedCluster ? clusterGroups.find(c => c.name === selectedCluster) || null : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
        <VCenterStatsBar
          totalHosts={hosts.length}
          linkedHosts={linkedHosts}
          unlinkedHosts={unlinkedHosts}
          totalVms={vms.length}
          totalDatastores={datastores.length}
          activeAlarms={alarms.length}
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
        />

        {alarms.length > 0 && <AlarmsPanel alarms={alarms} />}

        <div className="flex-1 flex overflow-hidden">
          <div className={`transition-all duration-300 ${sidebarOpen ? "w-[calc(100%-400px)]" : "w-full"}`}>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
              <TabsList className="mx-4 mt-4 mb-0">
                <TabsTrigger value="hosts">Hosts ({hosts.length})</TabsTrigger>
                <TabsTrigger value="vms">VMs ({vms.length})</TabsTrigger>
                <TabsTrigger value="clusters">Clusters ({clusterData.length})</TabsTrigger>
                <TabsTrigger value="datastores">Datastores ({datastores.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="hosts" className="flex-1 flex flex-col mt-0 overflow-hidden">
                <HostFilterToolbar
                  searchTerm={searchTerm}
                  onSearchChange={setSearchTerm}
                  clusterFilter={clusterFilter}
                  onClusterFilterChange={setClusterFilter}
                  statusFilter={statusFilter}
                  onStatusFilterChange={setStatusFilter}
                  linkFilter={linkFilter}
                  onLinkFilterChange={setLinkFilter}
                  clusters={uniqueClusters}
                />
                <div className="flex-1 p-4 overflow-hidden">
                  <HostsTable
                    clusterGroups={clusterGroups}
                    selectedHostId={selectedHost?.id || null}
                    selectedCluster={selectedCluster}
                    onHostClick={handleHostClick}
                    onClusterClick={handleClusterClick}
                    onHostSync={handleHostSync}
                    onClusterUpdate={handleClusterUpdate}
                    onViewLinkedServer={handleViewLinkedServer}
                    onLinkToServer={handleLinkToServer}
                    loading={loading}
                  />
                </div>
              </TabsContent>

              <TabsContent value="vms" className="flex-1 mt-0 overflow-hidden">
                <VMsTable
                  vms={vms}
                  selectedVmId={selectedVm?.id || null}
                  onVmClick={handleVmClick}
                  loading={vcenterDataLoading}
                />
              </TabsContent>

              <TabsContent value="clusters" className="flex-1 mt-0 overflow-hidden">
                <ClustersPanel
                  clusters={clusterData}
                  selectedClusterId={selectedClusterData?.id || null}
                  onClusterClick={handleClusterDataClick}
                  loading={vcenterDataLoading}
                />
              </TabsContent>

              <TabsContent value="datastores" className="flex-1 mt-0 overflow-hidden">
                <DatastoresTable
                  datastores={datastores}
                  selectedDatastoreId={selectedDatastore?.id || null}
                  onDatastoreClick={handleDatastoreClick}
                  loading={vcenterDataLoading}
                />
              </TabsContent>
            </Tabs>
          </div>

          {sidebarOpen && (
            <div className="w-[400px] border-l">
              <VCenterDetailsSidebar
                selectedHost={selectedHost}
                selectedCluster={selectedClusterGroup}
                selectedVm={selectedVm}
                selectedClusterData={selectedClusterData}
                selectedDatastore={selectedDatastore}
                onClusterUpdate={handleClusterUpdate}
                onClose={() => {
                  setSelectedHost(null);
                  setSelectedCluster(null);
                  setSelectedVm(null);
                  setSelectedClusterData(null);
                  setSelectedDatastore(null);
                }}
              />
            </div>
          )}
        </div>

        <VCenterSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onSaved={() => {
            fetchVCenterSettings();
            fetchHosts();
          }}
        />

        <VCenterConnectivityDialog
          open={testDialogOpen}
          onOpenChange={setTestDialogOpen}
          results={null}
        />

        {clusterUpdateOpen && (
          <ClusterUpdateWizard
            open={clusterUpdateOpen}
            onOpenChange={setClusterUpdateOpen}
            preSelectedCluster={selectedClusterForUpdate}
          />
        )}
      </div>
  );
}

