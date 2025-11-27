import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { VCenterSettingsDialog } from "@/components/vcenter/VCenterSettingsDialog";
import { VCenterConnectivityDialog } from "@/components/vcenter/VCenterConnectivityDialog";
import { ClusterUpdateWizard } from "@/components/jobs/ServerUpdateWizard";
import { VCenterStatsBar } from "@/components/vcenter/VCenterStatsBar";
import { HostFilterToolbar } from "@/components/vcenter/HostFilterToolbar";
import { HostsTable } from "@/components/vcenter/HostsTable";
import { HostDetailsSidebar } from "@/components/vcenter/HostDetailsSidebar";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";

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
  created_at: string;
}

interface ClusterGroup {
  name: string;
  hosts: VCenterHost[];
}

const VCenter = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [hosts, setHosts] = useState<VCenterHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [clusterFilter, setClusterFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [linkFilter, setLinkFilter] = useState("all");
  const [syncing, setSyncing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [vcenterHost, setVCenterHost] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<any>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [clusterWizardOpen, setClusterWizardOpen] = useState(false);
  const [selectedClusterName, setSelectedClusterName] = useState<string>('');
  const [selectedHost, setSelectedHost] = useState<VCenterHost | null>(null);
  const [selectedClusterGroup, setSelectedClusterGroup] = useState<string | null>(null);
  const { toast } = useToast();
  
  // Detect local mode
  const isLocalMode = import.meta.env.VITE_SUPABASE_URL?.includes('127.0.0.1') || 
                      import.meta.env.VITE_SUPABASE_URL?.includes('localhost');

  // Check if host is on private network (IP or hostname)
  const isPrivateNetwork = (host: string): boolean => {
    if (!host) return false;
    const cleanHost = host.trim().split(':')[0].toLowerCase();
    
    // Check private IP ranges (RFC 1918)
    if (/^10\./.test(cleanHost) || 
        /^192\.168\./.test(cleanHost) || 
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(cleanHost)) {
      return true;
    }
    
    // Check private hostname patterns
    // Single-word hostnames (no dots) are typically private
    if (!cleanHost.includes('.')) return true;
    
    // Common private domain suffixes
    const privateDomains = ['.local', '.internal', '.lan', '.grp', '.corp', '.domain', '.private', '.home'];
    return privateDomains.some(suffix => cleanHost.endsWith(suffix));
  };

  const isPrivateHost = vcenterHost ? isPrivateNetwork(vcenterHost) : false;
  const useJobExecutorPath = isLocalMode || isPrivateHost;

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
        title: "Error loading vCenter hosts",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchVCenterSettings = async () => {
    try {
      const { data } = await supabase
        .from('vcenter_settings')
        .select('host')
        .maybeSingle();
      
      setVCenterHost(data?.host || null);
    } catch (error) {
      console.error('Error fetching vCenter settings:', error);
    }
  };

  useEffect(() => {
    fetchHosts();
    fetchVCenterSettings();

    // Set up realtime subscription for vCenter hosts
    const channel = supabase
      .channel('vcenter-hosts-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vcenter_hosts'
        },
        () => {
          console.log('vCenter hosts updated, refreshing...');
          fetchHosts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filteredHosts = hosts.filter((host) => {
    // Search filter
    const matchesSearch = 
      host.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      host.cluster?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      host.serial_number?.toLowerCase().includes(searchTerm.toLowerCase());

    // Cluster filter
    const matchesCluster = 
      clusterFilter === "all" || 
      (host.cluster || "Unclustered") === clusterFilter;

    // Status filter
    const matchesStatus = 
      statusFilter === "all" ||
      (statusFilter === "maintenance" && host.maintenance_mode) ||
      (statusFilter !== "maintenance" && host.status?.toLowerCase() === statusFilter);

    // Link filter
    const matchesLink = 
      linkFilter === "all" ||
      (linkFilter === "linked" && host.server_id) ||
      (linkFilter === "unlinked" && !host.server_id);

    return matchesSearch && matchesCluster && matchesStatus && matchesLink;
  });

  // Group hosts by cluster
  const clusterGroups: ClusterGroup[] = filteredHosts.reduce((acc, host) => {
    const clusterName = host.cluster || "Unclustered";
    let group = acc.find(g => g.name === clusterName);
    
    if (!group) {
      group = { name: clusterName, hosts: [] };
      acc.push(group);
    }
    
    group.hosts.push(host);
    return acc;
  }, [] as ClusterGroup[]);

  const totalHosts = hosts.length;
  const linkedHosts = hosts.filter(h => h.server_id).length;
  const unlinkedHosts = totalHosts - linkedHosts;
  
  // Get latest sync time
  const lastSyncTime = hosts.reduce((latest, host) => {
    if (!host.last_sync) return latest;
    const hostTime = new Date(host.last_sync);
    return !latest || hostTime > new Date(latest) ? hostTime.toISOString() : latest;
  }, null as string | null);

  // Check if there are active clusters (not just "Unclustered")
  const hasActiveClusters = clusterGroups.some(c => c.name !== "Unclustered");

  // Get unique cluster names for filter
  const uniqueClusters = Array.from(new Set(hosts.map(h => h.cluster || "Unclustered")));

  const handleTestConnectivity = async () => {
    try {
      setTesting(true);
      
      // Check if vCenter is configured
      const { data: settings, error: settingsError } = await supabase
        .from('vcenter_settings')
        .select('*')
        .limit(1)
        .single();

      if (settingsError || !settings) {
        throw new Error("vCenter not configured. Please open Settings to configure.");
      }

      // Create connectivity test job
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'vcenter_connectivity_test',
          created_by: user?.id,
          status: 'pending',
          details: {}
        })
        .select()
        .single();

      if (jobError) throw jobError;

      toast({
        title: "Connectivity test started",
        description: "Running comprehensive connectivity tests...",
      });

      // Poll for job completion
      const pollInterval = setInterval(async () => {
        const { data: updatedJob } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', job.id)
          .single();

        if (updatedJob && updatedJob.status !== 'pending' && updatedJob.status !== 'running') {
          clearInterval(pollInterval);
          setTesting(false);
          
          if (updatedJob.status === 'completed') {
            setTestResults(updatedJob.details);
            setTestDialogOpen(true);
            const details = updatedJob.details as any;
            toast({
              title: "Connectivity test completed",
              description: details?.message || "Tests completed successfully",
            });
          } else {
            const details = updatedJob.details as any;
            toast({
              title: "Connectivity test failed",
              description: details?.error || "Test failed",
              variant: "destructive",
            });
          }
        }
      }, 2000);

      // Cleanup after 2 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setTesting(false);
      }, 120000);

    } catch (error: any) {
      console.error('Error testing connectivity:', error);
      toast({
        title: "Error starting connectivity test",
        description: error.message,
        variant: "destructive",
      });
      setTesting(false);
    }
  };

  const handleSyncNow = async () => {
    if (!user) {
      toast({
        title: "Authentication required",
        description: "You must be logged in to sync vCenter",
        variant: "destructive",
      });
      return;
    }

    setSyncing(true);
    try {
      // Fetch vCenter settings to check if host is private
      const { data: settings } = await supabase
        .from('vcenter_settings')
        .select('host')
        .maybeSingle();

      if (!settings?.host) {
        throw new Error("vCenter not configured. Please open Settings to configure.");
      }

      const useJobExecutor = isLocalMode || isPrivateNetwork(settings.host.trim());

      if (useJobExecutor) {
        // vCenter is on private network - force Job Executor
        console.log(`Private network detected (${settings.host}) - using Job Executor`);
        
        const { data: job, error: jobError } = await supabase
          .from('jobs')
          .insert({
            job_type: 'vcenter_sync',
            created_by: user.id,
            status: 'pending',
            details: {
              description: 'vCenter sync job created from UI (private network)',
              sync_type: 'full'
            }
          })
          .select()
          .single();

        if (jobError) throw jobError;

        toast({
          title: "Job Executor sync started",
          description: "Private network detected. Job queued for local Job Executor.",
          action: (
            <Button variant="outline" size="sm" onClick={() => navigate('/maintenance-planner?tab=jobs')}>
              View Jobs
            </Button>
          ),
        });
      } else {
        // Public vCenter - try cloud edge function with fallback to Job Executor
        console.log(`Public vCenter (${settings.host}) - attempting cloud sync`);
        
        try {
          const { data: result, error: invokeError } = await supabase.functions.invoke('sync-vcenter-direct');

          if (invokeError) throw invokeError;

          if (result.success) {
            toast({
              title: "Sync completed",
              description: `New: ${result.hosts_added || 0}, Updated: ${result.hosts_updated || 0}, Linked: ${result.linked || 0}`,
            });
            fetchHosts();
          } else {
            const errorMsg = result.errors?.length > 0 ? result.errors[0] : "Sync failed";
            throw new Error(errorMsg);
          }
        } catch (cloudError: any) {
          // Cloud sync failed - fall back to Job Executor
          console.log("Cloud sync failed, falling back to Job Executor:", cloudError.message);
          
          const { data: job, error: jobError } = await supabase
            .from('jobs')
            .insert({
              job_type: 'vcenter_sync',
              created_by: user.id,
              status: 'pending',
              details: {
                description: 'vCenter sync job created from UI (cloud fallback)',
                sync_type: 'full',
                cloud_error: cloudError.message
              }
            })
            .select()
            .single();

          if (jobError) throw jobError;

          toast({
            title: "Switched to Job Executor",
            description: "Cloud could not reach vCenter. Job queued for local Job Executor.",
            action: (
              <Button variant="outline" size="sm" onClick={() => navigate('/maintenance-planner?tab=jobs')}>
                View Jobs
              </Button>
            ),
          });
        }
      }
    } catch (error: any) {
      console.error("Sync error:", error);
      toast({
        title: "Sync failed",
        description: error.message || "Failed to sync vCenter data",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleClusterUpdate = (clusterName?: string) => {
    setSelectedClusterName(clusterName || '');
    setClusterWizardOpen(true);
  };

  const handleHostClick = (host: VCenterHost) => {
    setSelectedHost(host);
    setSelectedClusterGroup(null);
  };

  const handleClusterClick = (clusterName: string) => {
    setSelectedClusterGroup(clusterName);
    setSelectedHost(null);
  };

  const handleHostSync = (host: VCenterHost) => {
    setSelectedHost(host);
    toast({
      title: "Sync started",
      description: `Refreshing ${host.name} through a vCenter sync.`,
    });
    handleSyncNow();
  };

  const handleViewLinkedServer = (host: VCenterHost) => {
    if (!host.server_id) {
      toast({
        title: "No linked server",
        description: "Use the Servers page to link this ESXi host to a physical server.",
        variant: "destructive",
      });
      return;
    }

    navigate('/servers', { state: { highlightServerId: host.server_id } });
    toast({
      title: "Opening linked server",
      description: "Navigating to Servers so you can run iDRAC actions.",
    });
  };

  const handleLinkToServer = (host: VCenterHost) => {
    navigate('/servers');
    toast({
      title: "Link this ESXi host",
      description: host.serial_number
        ? `Use Link vCenter on the Servers page to map serial ${host.serial_number}.`
        : 'Open the Servers page to link this host to hardware.',
    });
  };

  const selectedCluster = selectedClusterGroup
    ? clusterGroups.find(c => c.name === selectedClusterGroup) || null
    : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top: Compact Stats Bar */}
      <VCenterStatsBar
        totalHosts={totalHosts}
        linkedHosts={linkedHosts}
        unlinkedHosts={unlinkedHosts}
        lastSync={lastSyncTime}
        mode={useJobExecutorPath ? 'job-executor' : 'cloud'}
        syncing={syncing}
        testing={testing}
        onSettings={() => setSettingsOpen(true)}
        onTest={handleTestConnectivity}
        onSync={handleSyncNow}
        onRefresh={fetchHosts}
        onClusterUpdate={() => handleClusterUpdate()}
        hasActiveClusters={hasActiveClusters}
      />

      {/* Main: Two Column Layout */}
      <div className="flex-1 overflow-hidden px-4 pb-6 pt-4">
        <div className="grid h-full gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)] xl:items-start">
          {/* Left: Filter + Table */}
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex h-full flex-col rounded-xl border bg-card shadow-sm">
              <div className="border-b p-4">
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
              </div>

              <div className="flex-1 overflow-hidden p-2 sm:p-4">
                <HostsTable
                  clusterGroups={clusterGroups}
                  selectedHostId={selectedHost?.id || null}
                  selectedCluster={selectedClusterGroup}
                  onHostClick={handleHostClick}
                  onClusterClick={handleClusterClick}
                  onHostSync={handleHostSync}
                  onClusterUpdate={handleClusterUpdate}
                  onViewLinkedServer={handleViewLinkedServer}
                  onLinkToServer={handleLinkToServer}
                  loading={loading}
                />
              </div>
            </div>
          </div>

          {/* Right: Host Details Sidebar */}
          <div className="min-h-[320px] rounded-xl border bg-card shadow-sm">
            <HostDetailsSidebar
              selectedHost={selectedHost}
              selectedCluster={selectedCluster}
              onClusterUpdate={handleClusterUpdate}
              onClose={() => {
                setSelectedHost(null);
                setSelectedClusterGroup(null);
              }}
            />
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <VCenterSettingsDialog 
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={() => {
          fetchHosts();
          fetchVCenterSettings();
        }}
      />

      <VCenterConnectivityDialog
        open={testDialogOpen}
        onOpenChange={setTestDialogOpen}
        results={testResults}
      />

      <ClusterUpdateWizard 
        open={clusterWizardOpen} 
        onOpenChange={setClusterWizardOpen}
        preSelectedTarget={selectedClusterName ? { type: 'cluster', id: selectedClusterName } : undefined}
      />
    </div>
  );
};

export default VCenter;
