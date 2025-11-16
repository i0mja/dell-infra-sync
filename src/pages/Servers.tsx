import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Search, RefreshCw, Link2, Wrench, RotateCw, Edit, History, Trash2, CheckCircle, Info, Power, Activity, FileText, HardDrive, Disc, FileJson, Settings2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { AddServerDialog } from "@/components/servers/AddServerDialog";
import { LinkVCenterDialog } from "@/components/servers/LinkVCenterDialog";
import { EditServerDialog } from "@/components/servers/EditServerDialog";
import { ServerAuditDialog } from "@/components/servers/ServerAuditDialog";
import { ServerPropertiesDialog } from "@/components/servers/ServerPropertiesDialog";
import { CreateJobDialog } from "@/components/jobs/CreateJobDialog";
import { AssignCredentialsDialog } from "@/components/servers/AssignCredentialsDialog";
import { ConnectionStatusBadge } from "@/components/servers/ConnectionStatusBadge";
import { PowerControlDialog } from "@/components/servers/PowerControlDialog";
import { ServerHealthDialog } from "@/components/servers/ServerHealthDialog";
import { EventLogDialog } from "@/components/servers/EventLogDialog";
import { BootConfigDialog } from "@/components/servers/BootConfigDialog";
import { VirtualMediaDialog } from "@/components/servers/VirtualMediaDialog";
import { ScpBackupDialog } from "@/components/servers/ScpBackupDialog";
import { BiosConfigDialog } from "@/components/servers/BiosConfigDialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Server {
  id: string;
  ip_address: string;
  hostname: string | null;
  model: string | null;
  service_tag: string | null;
  manager_mac_address: string | null;
  product_name: string | null;
  manufacturer: string | null;
  redfish_version: string | null;
  supported_endpoints: any | null;
  idrac_firmware: string | null;
  bios_version: string | null;
  cpu_count: number | null;
  memory_gb: number | null;
  vcenter_host_id: string | null;
  discovery_job_id: string | null;
  credential_set_id: string | null;
  last_seen: string | null;
  created_at: string;
  notes: string | null;
  last_connection_test: string | null;
  connection_status: 'online' | 'offline' | 'unknown' | null;
  connection_error: string | null;
  credential_test_status: string | null;
  credential_last_tested: string | null;
  power_state: string | null;
  overall_health: string | null;
  last_health_check: string | null;
}

const Servers = () => {
  // Job Executor is always enabled - iDRACs are always on private networks
  const useJobExecutorForIdrac = true;
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [auditDialogOpen, setAuditDialogOpen] = useState(false);
  const [propertiesDialogOpen, setPropertiesDialogOpen] = useState(false);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [assignCredentialsDialogOpen, setAssignCredentialsDialogOpen] = useState(false);
  const [powerControlDialogOpen, setPowerControlDialogOpen] = useState(false);
  const [healthDialogOpen, setHealthDialogOpen] = useState(false);
  const [eventLogDialogOpen, setEventLogDialogOpen] = useState(false);
  const [bootConfigDialogOpen, setBootConfigDialogOpen] = useState(false);
  const [virtualMediaDialogOpen, setVirtualMediaDialogOpen] = useState(false);
  const [scpBackupDialogOpen, setScpBackupDialogOpen] = useState(false);
  const [biosConfigDialogOpen, setBiosConfigDialogOpen] = useState(false);
  const [selectedServer, setSelectedServer] = useState<Server | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [quickScanIp, setQuickScanIp] = useState<string>("");
  const { toast } = useToast();
  
  const getServerStatus = (server: any) => {
    if (server.discovery_job_id) {
      return { status: "discovering", label: "Discovering", variant: "secondary" as const };
    }
    if (server.model && server.service_tag && server.idrac_firmware) {
      return { status: "discovered", label: "Discovered", variant: "default" as const };
    }
    return { status: "minimal", label: "Minimal Info", variant: "outline" as const };
  };

  const fetchServers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("servers")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setServers((data as Server[]) || []);
    } catch (error: any) {
      toast({
        title: "Error loading servers",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServers();
    // Job Executor is always enabled - no need to load setting from database
  }, []);

  const handleLinkToVCenter = (server: Server) => {
    setSelectedServer(server);
    setLinkDialogOpen(true);
  };

  const handleCreateJob = (server: Server) => {
    setSelectedServer(server);
    setJobDialogOpen(true);
  };

  const handleTestConnection = async (server: Server) => {
    try {
      // Check if server has credentials assigned
      if (!server.credential_set_id) {
        toast({
          title: "Credentials Required",
          description: "Assign credentials to this server first",
          variant: "destructive",
        });
        setSelectedServer(server);
        setAssignCredentialsDialogOpen(true);
        return;
      }

      setRefreshing(server.id);
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      
      // Create test_credentials job
      const { data: job, error } = await supabase
        .from('jobs')
        .insert([{
          job_type: 'test_credentials',
          target_scope: { ip_address: server.ip_address },
          credential_set_ids: [server.credential_set_id],
          created_by: user.id,
          status: 'pending'
        }])
        .select()
        .single();
      
      if (error) throw error;
      
      toast({
        title: "Testing Connection",
        description: "Job created - checking connection via Job Executor...",
      });
      
      // Poll job status
      const pollInterval = setInterval(async () => {
        const { data: updatedJob } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', job.id)
          .single();
        
        if (updatedJob?.status === 'completed') {
          clearInterval(pollInterval);
          setRefreshing(null);
          const details = updatedJob.details as any;
          toast({
            title: "✓ Connection Successful",
            description: `${server.hostname || server.ip_address} is reachable - ${details?.message || ''}`,
          });
          fetchServers();
        } else if (updatedJob?.status === 'failed') {
          clearInterval(pollInterval);
          setRefreshing(null);
          const details = updatedJob.details as any;
          toast({
            title: "✗ Connection Failed",
            description: details?.message || 'Connection test failed',
            variant: "destructive",
          });
          fetchServers();
        }
      }, 2000);
      
      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
        if (refreshing === server.id) {
          setRefreshing(null);
          toast({
            title: "Test Timed Out",
            description: "Job Executor may not be running - check Activity Monitor",
            variant: "destructive",
          });
        }
      }, 30000);
      
    } catch (error: any) {
      setRefreshing(null);
      toast({
        title: "Error testing connection",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleRefreshInfo = async (server: Server) => {
    try {
      // Check if server has credentials assigned
      if (!server.credential_set_id) {
        toast({
          title: "Credentials Required",
          description: "Assign credentials to this server first",
          variant: "destructive",
        });
        setSelectedServer(server);
        setAssignCredentialsDialogOpen(true);
        return;
      }

      setRefreshing(server.id);
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      
      // Create discovery_scan job for this single server
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert([{
          job_type: 'discovery_scan',
          target_scope: { 
            target_type: 'specific_servers',
            server_ids: [server.id]
          },
          credential_set_ids: [server.credential_set_id],
          created_by: user.id,
          status: 'pending'
        }])
        .select()
        .single();
      
      if (jobError) throw jobError;
      
      // Create job task for this server
      const { error: taskError } = await supabase
        .from('job_tasks')
        .insert({
          job_id: job.id,
          server_id: server.id,
          status: 'pending'
        });
      
      if (taskError) throw taskError;
      
      toast({
        title: "Fetching Server Details",
        description: "Job created - collecting information via Job Executor...",
      });
      
      // Poll job status
      const pollInterval = setInterval(async () => {
        const { data: updatedJob } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', job.id)
          .single();
        
        if (updatedJob?.status === 'completed') {
          clearInterval(pollInterval);
          setRefreshing(null);
          toast({
            title: "✓ Server Information Updated",
            description: `${server.hostname || server.ip_address} details refreshed successfully`,
          });
          fetchServers();
        } else if (updatedJob?.status === 'failed') {
          clearInterval(pollInterval);
          setRefreshing(null);
          const details = updatedJob.details as any;
          toast({
            title: "✗ Refresh Failed",
            description: details?.error || 'Failed to fetch server information',
            variant: "destructive",
          });
          fetchServers();
        }
      }, 3000);
      
      // Timeout after 60 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
        if (refreshing === server.id) {
          setRefreshing(null);
          toast({
            title: "Refresh Timed Out",
            description: "Job Executor may not be running - check Jobs page for status",
            variant: "destructive",
          });
        }
      }, 60000);
      
    } catch (error: any) {
      setRefreshing(null);
      toast({
        title: "Error refreshing server",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleEditServer = (server: Server) => {
    setSelectedServer(server);
    setEditDialogOpen(true);
  };

  const handleViewAudit = (server: Server) => {
    setSelectedServer(server);
    setAuditDialogOpen(true);
  };

  const handleViewProperties = (server: Server) => {
    setSelectedServer(server);
    setPropertiesDialogOpen(true);
  };

  const handleDeleteServer = (server: Server) => {
    setSelectedServer(server);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!selectedServer) return;

    try {
      // Unlink from vCenter host if linked
      if (selectedServer.vcenter_host_id) {
        await supabase
          .from("vcenter_hosts")
          .update({ server_id: null })
          .eq("id", selectedServer.vcenter_host_id);
      }

      // Create audit log before deletion
      await supabase.from("audit_logs").insert({
        action: "server_deleted",
        details: {
          server_id: selectedServer.id,
          hostname: selectedServer.hostname,
          ip_address: selectedServer.ip_address,
        },
      });

      // Delete server
      const { error } = await supabase
        .from("servers")
        .delete()
        .eq("id", selectedServer.id);

      if (error) throw error;

      toast({
        title: "Server removed",
        description: "Server has been removed from inventory",
      });

      setDeleteDialogOpen(false);
      setSelectedServer(null);
      fetchServers();
    } catch (error: any) {
      toast({
        title: "Error removing server",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const filteredServers = servers.filter((server) =>
    server.ip_address.toLowerCase().includes(searchTerm.toLowerCase()) ||
    server.hostname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    server.service_tag?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    server.model?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Server Inventory</h1>
          <p className="text-muted-foreground">
            Manage Dell servers discovered via iDRAC Redfish API
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={fetchServers}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Server
          </Button>
        </div>
      </div>

      {useJobExecutorForIdrac && (
        <Alert className="mb-6">
          <Info className="h-4 w-4" />
          <AlertDescription>
            Running in local mode. Network operations like "Test Connection" and "Refresh Info" use Edge Functions which may have limited access to your local network due to Docker isolation. 
            For comprehensive testing, use the Job Executor with discovery jobs.
          </AlertDescription>
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Search Servers</CardTitle>
          <CardDescription>Filter by IP, hostname, service tag, or model</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search servers..."
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
      ) : filteredServers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <p className="text-lg font-medium mb-2">No servers found</p>
            <p className="text-muted-foreground mb-4">
              {searchTerm
                ? "Try a different search term"
                : "Add servers manually or run an IP scan to discover Dell iDRAC endpoints"}
            </p>
            {!searchTerm && (
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Your First Server
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredServers.map((server) => (
            <ContextMenu key={server.id}>
              <ContextMenuTrigger>
                <Card className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-semibold">{server.hostname || server.ip_address}</h3>
                          <ConnectionStatusBadge 
                            status={server.connection_status}
                            lastTest={server.last_connection_test}
                            error={server.connection_error}
                            credentialTestStatus={server.credential_test_status}
                          />
                          <Badge variant={getServerStatus(server).variant}>
                            {getServerStatus(server).label}
                          </Badge>
                          {server.vcenter_host_id ? (
                            <Badge variant="secondary">
                              <CheckCircle className="mr-1 h-3 w-3" />
                              Linked
                            </Badge>
                          ) : (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge 
                                    variant="outline" 
                                    className="cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleLinkToVCenter(server);
                                    }}
                                  >
                                    <Link2 className="mr-1 h-3 w-3" />
                                    Unlinked
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Click to link to vCenter host</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {refreshing === server.id && (
                            <Badge variant="outline" className="animate-pulse">Refreshing...</Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">IP Address:</span>
                            <p className="font-medium">{server.ip_address}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Model:</span>
                            <p className="font-medium">{server.model || "N/A"}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Service Tag:</span>
                            <p className="font-medium">{server.service_tag || "N/A"}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">iDRAC Firmware:</span>
                            <p className="font-medium">{server.idrac_firmware || "N/A"}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-64">
                {server.credential_test_status === 'invalid' && (
                  <>
                    <ContextMenuItem 
                      onClick={() => {
                        setSelectedServer(server);
                        setAssignCredentialsDialogOpen(true);
                      }}
                      className="text-yellow-600 dark:text-yellow-500 font-medium"
                    >
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Assign Credentials
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                  </>
                )}
                <ContextMenuItem onClick={() => {
                  setSelectedServer(server);
                  setPowerControlDialogOpen(true);
                }}>
                  <Power className="mr-2 h-4 w-4" />
                  Power Control
                </ContextMenuItem>
                <ContextMenuItem onClick={() => {
                  setSelectedServer(server);
                  setHealthDialogOpen(true);
                }}>
                  <Activity className="mr-2 h-4 w-4" />
                  Health Status
                </ContextMenuItem>
                <ContextMenuItem onClick={() => {
                  setSelectedServer(server);
                  setEventLogDialogOpen(true);
                }}>
                  <FileText className="mr-2 h-4 w-4" />
                  Event Logs
                </ContextMenuItem>
                <ContextMenuItem onClick={() => {
                  setSelectedServer(server);
                  setBootConfigDialogOpen(true);
                }}>
                  <HardDrive className="mr-2 h-4 w-4" />
                  Boot Configuration
                </ContextMenuItem>
                <ContextMenuItem onClick={() => {
                  setSelectedServer(server);
                  setVirtualMediaDialogOpen(true);
                }}>
                  <Disc className="mr-2 h-4 w-4" />
                  Virtual Media
                </ContextMenuItem>
                <ContextMenuItem onClick={() => {
                  setSelectedServer(server);
                  setScpBackupDialogOpen(true);
                }}>
                  <FileJson className="mr-2 h-4 w-4" />
                  SCP Backup/Restore
                </ContextMenuItem>
                <ContextMenuItem onClick={() => {
                  setSelectedServer(server);
                  setBiosConfigDialogOpen(true);
                }}>
                  <Settings2 className="mr-2 h-4 w-4" />
                  BIOS Configuration
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => handleLinkToVCenter(server)}>
                  <Link2 className="mr-2 h-4 w-4" />
                  Link to vCenter Host
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleCreateJob(server)}>
                  <Wrench className="mr-2 h-4 w-4" />
                  Create Firmware Update Job
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem 
                  onClick={() => handleTestConnection(server)}
                  disabled={refreshing === server.id}
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Test iDRAC Connection
                </ContextMenuItem>
                <ContextMenuItem 
                  onClick={() => handleRefreshInfo(server)}
                  disabled={refreshing === server.id}
                >
                  <RotateCw className={`mr-2 h-4 w-4 ${refreshing === server.id ? 'animate-spin' : ''}`} />
                  Refresh Server Information
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleEditServer(server)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit Server Details
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleViewAudit(server)}>
                  <History className="mr-2 h-4 w-4" />
                  View Audit History
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleViewProperties(server)}>
                  <Info className="mr-2 h-4 w-4" />
                  View Properties
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem 
                  onClick={() => handleDeleteServer(server)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove from Inventory
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
      )}

      <AddServerDialog 
        open={dialogOpen} 
        onOpenChange={setDialogOpen} 
        onSuccess={fetchServers}
      />
      
      {selectedServer && (
        <>
          <LinkVCenterDialog
            open={linkDialogOpen}
            onOpenChange={setLinkDialogOpen}
            server={selectedServer}
            onSuccess={fetchServers}
          />
          <EditServerDialog
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            server={selectedServer}
            onSuccess={fetchServers}
          />
          <ServerAuditDialog
            open={auditDialogOpen}
            onOpenChange={setAuditDialogOpen}
            server={selectedServer}
          />
          <ServerPropertiesDialog
            open={propertiesDialogOpen}
            onOpenChange={setPropertiesDialogOpen}
            server={selectedServer}
            onEdit={() => {
              setPropertiesDialogOpen(false);
              setEditDialogOpen(true);
            }}
          />
          <CreateJobDialog
            open={jobDialogOpen}
            onOpenChange={(open) => {
              setJobDialogOpen(open);
              if (!open) setQuickScanIp("");
            }}
            onSuccess={fetchServers}
            preSelectedServerId={selectedServer.id}
            quickScanIp={quickScanIp}
          />
          <AssignCredentialsDialog
            open={assignCredentialsDialogOpen}
            onOpenChange={setAssignCredentialsDialogOpen}
            server={selectedServer}
            onSuccess={fetchServers}
          />
          <PowerControlDialog
            open={powerControlDialogOpen}
            onOpenChange={setPowerControlDialogOpen}
            server={selectedServer}
          />
          <ServerHealthDialog
            open={healthDialogOpen}
            onOpenChange={setHealthDialogOpen}
            server={selectedServer}
          />
          <EventLogDialog
            open={eventLogDialogOpen}
            onOpenChange={setEventLogDialogOpen}
            server={selectedServer}
          />
          <BootConfigDialog
            open={bootConfigDialogOpen}
            onOpenChange={setBootConfigDialogOpen}
            server={selectedServer}
          />
          <VirtualMediaDialog
            open={virtualMediaDialogOpen}
            onOpenChange={setVirtualMediaDialogOpen}
            server={selectedServer}
          />
          <ScpBackupDialog
            open={scpBackupDialogOpen}
            onOpenChange={setScpBackupDialogOpen}
            server={selectedServer}
          />
          <BiosConfigDialog
            open={biosConfigDialogOpen}
            onOpenChange={setBiosConfigDialogOpen}
            server={selectedServer}
          />
        </>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Server from Inventory</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {selectedServer?.hostname || selectedServer?.ip_address} from the inventory?
              {selectedServer?.vcenter_host_id && (
                <span className="block mt-2 text-amber-600">
                  This server is currently linked to a vCenter host. The link will be removed.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove Server
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Servers;
