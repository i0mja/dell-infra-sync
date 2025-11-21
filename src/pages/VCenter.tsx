import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, RefreshCw, Link as LinkIcon, Search, Settings, RefreshCcw, Activity } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { InfoIcon, Loader2 } from "lucide-react";
import { VCenterSettingsDialog } from "@/components/vcenter/VCenterSettingsDialog";
import { VCenterConnectivityDialog } from "@/components/vcenter/VCenterConnectivityDialog";
import { ClusterUpdateWizard } from "@/components/jobs/ClusterUpdateWizard";
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
  const [syncing, setSyncing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [vcenterHost, setVCenterHost] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<any>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [clusterWizardOpen, setClusterWizardOpen] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState<string>('');
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

  const filteredHosts = hosts.filter((host) =>
    host.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    host.cluster?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    host.serial_number?.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
    setSelectedCluster(clusterName || '');
    setClusterWizardOpen(true);
  };

  const getStatusColor = (status: string | null) => {
    switch (status?.toLowerCase()) {
      case 'connected':
        return 'text-success';
      case 'disconnected':
        return 'text-destructive';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">vCenter Integration</h1>
          <p className="text-muted-foreground">
            VMware vCenter ESXi hosts and cluster management
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
          <Button 
            variant="outline"
            onClick={handleTestConnectivity}
            disabled={testing}
          >
            {testing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Activity className="h-4 w-4 mr-2" />
                Test Connectivity
              </>
            )}
          </Button>
          <Button 
            variant="default" 
            onClick={() => handleClusterUpdate()}
            disabled={clusterGroups.length === 0 || clusterGroups.every(c => c.name === "Unclustered")}
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            Rolling Cluster Update
          </Button>
          <Button onClick={handleSyncNow} disabled={syncing}>
            {syncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCcw className="mr-2 h-4 w-4" />
                Sync Now
              </>
            )}
          </Button>
          <Button variant="outline" size="icon" onClick={fetchHosts}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Alert className="mb-6">
        <InfoIcon className="h-4 w-4" />
        <AlertTitle>
          {useJobExecutorPath ? "Job Executor Mode" : "Cloud Sync Mode"}
        </AlertTitle>
        <AlertDescription>
          {useJobExecutorPath ? (
            <>
              {isLocalMode && <span className="font-medium">Local deployment detected. </span>}
              {isPrivateHost && vcenterHost && (
                <span className="font-medium">Private vCenter detected ({vcenterHost}). </span>
              )}
              Clicking "Sync Now" will create a job for the Job Executor to process.
              Ensure the Job Executor is running on your local network. Check{" "}
              <Button 
                variant="link" 
                className="h-auto p-0 text-xs" 
                onClick={() => navigate('/settings?tab=diagnostics')}
              >
                Settings → Diagnostics
              </Button>{" "}
              for Job Executor status.
            </>
          ) : (
            <>
              {vcenterHost && <span className="font-medium">Public vCenter configured ({vcenterHost}). </span>}
              Click "Sync Now" to directly sync ESXi host data. If the cloud cannot reach your vCenter, 
              the system will automatically fall back to using the Job Executor.
            </>
          )}
        </AlertDescription>
      </Alert>

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

      <div className="grid gap-6 md:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Hosts</CardTitle>
            <Database className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{totalHosts}</div>
                <p className="text-xs text-muted-foreground">ESXi hosts in vCenter</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Linked</CardTitle>
            <LinkIcon className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{linkedHosts}</div>
                <p className="text-xs text-muted-foreground">Mapped to physical servers</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unlinked</CardTitle>
            <LinkIcon className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{unlinkedHosts}</div>
                <p className="text-xs text-muted-foreground">Need physical mapping</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Search Hosts</CardTitle>
          <CardDescription>Filter by hostname, cluster, or serial number</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search ESXi hosts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : clusterGroups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <Database className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">No vCenter hosts found</p>
            <p className="text-muted-foreground mb-4">
              {searchTerm
                ? "Try a different search term"
                : "Sync your vCenter data using the Python sync script to see ESXi hosts here"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {clusterGroups.map((cluster) => (
            <Card key={cluster.name}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl">{cluster.name}</CardTitle>
                    <CardDescription>
                      {cluster.hosts.length} ESXi hosts • 
                      {cluster.hosts.filter(h => h.server_id).length} linked • 
                      {cluster.hosts.filter(h => h.status === 'connected').length} connected
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {cluster.name !== "Unclustered" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleClusterUpdate(cluster.name)}
                          disabled={cluster.hosts.filter(h => h.server_id && h.status === 'connected').length < 2}
                        >
                          <RefreshCcw className="mr-2 h-3 w-3" />
                          Update Cluster
                        </Button>
                        <Badge variant="outline">Cluster</Badge>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {cluster.hosts.map((host) => (
                    <div key={host.id} className="p-4 border rounded-lg hover:bg-accent/50 transition-colors">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold">{host.name}</h4>
                            {host.server_id ? (
                              <Badge variant="secondary">Linked</Badge>
                            ) : (
                              <Badge variant="outline">Unlinked</Badge>
                            )}
                            {host.maintenance_mode && (
                              <Badge variant="destructive">Maintenance</Badge>
                            )}
                          </div>
                          <p className={`text-sm ${getStatusColor(host.status)}`}>
                            Status: {host.status || 'Unknown'}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Serial Number:</span>
                          <p className="font-medium">{host.serial_number || "N/A"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">ESXi Version:</span>
                          <p className="font-medium">{host.esxi_version || "N/A"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">vCenter ID:</span>
                          <p className="font-medium text-xs">{host.vcenter_id || "N/A"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Last Sync:</span>
                          <p className="font-medium text-xs">
                            {host.last_sync 
                              ? new Date(host.last_sync).toLocaleString() 
                              : "Never"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ClusterUpdateWizard
        open={clusterWizardOpen}
        onOpenChange={setClusterWizardOpen}
        preSelectedCluster={selectedCluster}
      />
    </div>
  );
};

export default VCenter;
