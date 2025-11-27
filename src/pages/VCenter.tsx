import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { VCenterStatsBar } from "@/components/vcenter/VCenterStatsBar";
import { HostsTable } from "@/components/vcenter/HostsTable";
import { VMsTable } from "@/components/vcenter/VMsTable";
import { ClustersPanel } from "@/components/vcenter/ClustersPanel";
import { DatastoresTable } from "@/components/vcenter/DatastoresTable";
import { AlarmsPanel } from "@/components/vcenter/AlarmsPanel";
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
  const [hostsLoading, setHostsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [clusterFilter, setClusterFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [linkFilter, setLinkFilter] = useState("all");
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [selectedVmId, setSelectedVmId] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [selectedDatastoreId, setSelectedDatastoreId] = useState<string | null>(null);
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
  
  const { vms, clusters, datastores, alarms, loading: vmsLoading, refetch: refetchVCenterData } = useVCenterData();

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
  }, []);

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

      <div className="flex-1 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <TabsList className="mx-4 mt-4">
            <TabsTrigger value="hosts">Hosts ({hosts.length})</TabsTrigger>
            <TabsTrigger value="vms">VMs ({vms.length})</TabsTrigger>
            <TabsTrigger value="clusters">Clusters ({clusters.length})</TabsTrigger>
            <TabsTrigger value="datastores">Datastores ({datastores.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="hosts" className="flex-1 mt-0">
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
              loading={hostsLoading}
            />
          </TabsContent>

          <TabsContent value="vms" className="flex-1 mt-0">
            <VMsTable
              vms={vms}
              selectedVmId={selectedVmId}
              onVmClick={(vm) => handleVmClick(vm.id)}
              loading={vmsLoading}
            />
          </TabsContent>

          <TabsContent value="clusters" className="flex-1 mt-0">
            <ClustersPanel
              clusters={clusters}
              selectedClusterId={selectedClusterId}
              onClusterClick={handleClusterDataClick}
              loading={vmsLoading}
            />
          </TabsContent>

          <TabsContent value="datastores" className="flex-1 mt-0">
            <DatastoresTable
              datastores={datastores}
              selectedDatastoreId={selectedDatastoreId}
              onDatastoreClick={(ds) => handleDatastoreClick(ds.id)}
              loading={vmsLoading}
            />
          </TabsContent>
        </Tabs>
      </div>

      <VCenterSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <VCenterConnectivityDialog open={testDialogOpen} onOpenChange={setTestDialogOpen} results={null} />
      <ClusterUpdateWizard
        open={clusterUpdateOpen}
        onOpenChange={setClusterUpdateOpen}
        preSelectedCluster={selectedClusterForUpdate}
      />
    </div>
  );
}
