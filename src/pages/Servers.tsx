import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Search, RefreshCw, Link2, Wrench, RotateCw, Edit, History, Trash2, CheckCircle, Info, Power, Activity, FileText, HardDrive, Disc, FileJson, Settings2, Shield, Users, Calendar, Zap, FolderCog, FileStack, List, Layers, Server, AlertCircle, MoreVertical, Boxes } from "lucide-react";
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
import { WorkflowJobDialog } from "@/components/jobs/WorkflowJobDialog";
import { PreFlightCheckDialog } from "@/components/jobs/PreFlightCheckDialog";
import { ManageServerGroupsDialog } from "@/components/servers/ManageServerGroupsDialog";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuLabel,
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Job Executor is always enabled - iDRACs are always on private networks
  const useJobExecutorForIdrac = true;

  // View mode state with localStorage persistence
  const [viewMode, setViewMode] = useState<'flat' | 'grouped'>(() => {
    const saved = localStorage.getItem('server-view-mode');
    return (saved as 'flat' | 'grouped') || 'grouped';
  });
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [auditDialogOpen, setAuditDialogOpen] = useState(false);
  const [propertiesDialogOpen, setPropertiesDialogOpen] = useState(false);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [manageGroupsDialogOpen, setManageGroupsDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [assignCredentialsDialogOpen, setAssignCredentialsDialogOpen] = useState(false);
  const [showIncompleteBanner, setShowIncompleteBanner] = useState(true);
  const [bulkRefreshing, setBulkRefreshing] = useState(false);
  const [powerControlDialogOpen, setPowerControlDialogOpen] = useState(false);
  const [healthDialogOpen, setHealthDialogOpen] = useState(false);
  const [eventLogDialogOpen, setEventLogDialogOpen] = useState(false);
  const [bootConfigDialogOpen, setBootConfigDialogOpen] = useState(false);
  const [virtualMediaDialogOpen, setVirtualMediaDialogOpen] = useState(false);
  const [scpBackupDialogOpen, setScpBackupDialogOpen] = useState(false);
  const [biosConfigDialogOpen, setBiosConfigDialogOpen] = useState(false);
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false);
  const [preFlightCheckDialogOpen, setPreFlightCheckDialogOpen] = useState(false);
  const [selectedServer, setSelectedServer] = useState<Server | null>(null);
  const [deleteServerToConfirm, setDeleteServerToConfirm] = useState<Server | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [healthCheckServer, setHealthCheckServer] = useState<string | null>(null);
  const [quickScanIp, setQuickScanIp] = useState<string>("");
  const { toast } = useToast();
  
  // Fetch server groups
  const { data: serverGroups } = useQuery({
    queryKey: ['server-groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('server_groups')
        .select('id, name, color, icon')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Fetch server group memberships
  const { data: groupMemberships } = useQuery({
    queryKey: ['server-group-memberships'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('server_group_members')
        .select('server_id, server_group_id, server_groups(id, name, color, icon)');
      if (error) throw error;
      return data;
    },
  });

  // Fetch vCenter hosts for cluster grouping
  const { data: vCenterHosts } = useQuery({
    queryKey: ['vcenter-hosts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vcenter_hosts')
        .select('id, name, cluster, server_id')
        .not('cluster', 'is', null);
      if (error) throw error;
      return data;
    },
  });

  // Query for active health check jobs
  const { data: activeHealthCheckJobs } = useQuery({
    queryKey: ['active-health-check-jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, target_scope, details')
        .eq('job_type', 'health_check')
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 3000, // Poll every 3 seconds to detect job completion
  });
  
  const getServerStatus = (server: any) => {
    if (server.discovery_job_id) {
      return { status: "discovering", label: "Discovering", variant: "secondary" as const };
    }
    if (server.model && server.service_tag && server.idrac_firmware) {
      return { status: "discovered", label: "Discovered", variant: "default" as const };
    }
    return { status: "minimal", label: "Minimal Info", variant: "outline" as const };
  };

  const hasActiveHealthCheck = (serverId: string): boolean => {
    if (!activeHealthCheckJobs || activeHealthCheckJobs.length === 0) return false;
    
    return activeHealthCheckJobs.some(job => {
      const scope = job.target_scope as any;
      if (scope?.type === 'specific' && Array.isArray(scope.server_ids)) {
        return scope.server_ids.includes(serverId);
      }
      // Also check details.server_ip if target_scope not set
      const details = job.details as any;
      return details?.server_ip === serverId || details?.server_id === serverId;
    });
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

  const handleRunHealthCheck = async (server: Server) => {
    setHealthCheckServer(server.id);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'health_check',
          created_by: user.id,
          status: 'pending',
          target_scope: {
            type: 'specific',
            server_ids: [server.id]
          },
          details: {
            server_ip: server.ip_address,
            server_hostname: server.hostname || server.ip_address
          }
        })
        .select()
        .single();

      if (jobError) throw jobError;

      toast({
        title: 'Health check initiated',
        description: `Checking health status for ${server.hostname || server.ip_address}`,
      });

      setTimeout(async () => {
        const { data: updatedJob } = await supabase
          .from('jobs')
          .select('status, details')
          .eq('id', job.id)
          .single();

        if (updatedJob?.status === 'completed') {
          toast({
            title: 'Health check completed',
        description: 'View results in Health Status dialog',
      });
      fetchServers();
      queryClient.invalidateQueries({ queryKey: ['active-health-check-jobs'] });
        } else if (updatedJob?.status === 'failed') {
          const error = (updatedJob.details as any)?.error || 'Unknown error';
          toast({
            title: 'Health check failed',
            description: error,
        variant: 'destructive',
      });
      queryClient.invalidateQueries({ queryKey: ['active-health-check-jobs'] });
    }
        setHealthCheckServer(null);
      }, 10000);

    } catch (error: any) {
      console.error('Error initiating health check:', error);
      toast({
        title: 'Failed to initiate health check',
        description: error.message,
        variant: 'destructive',
      });
      setHealthCheckServer(null);
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

  // Helper to detect incomplete servers
  const isIncompleteServer = (server: Server) => {
    return !server.model || 
           !server.service_tag || 
           !server.idrac_firmware ||
           server.model === 'N/A' ||
           server.service_tag === 'N/A' ||
           server.idrac_firmware === 'N/A';
  };

  const incompleteServers = servers.filter(s => 
    isIncompleteServer(s) && s.credential_set_id
  );

  const handleRefreshIncomplete = async () => {
    setBulkRefreshing(true);
    try {
      for (const server of incompleteServers) {
        await handleRefreshInfo(server);
      }
      toast({
        title: "Bulk refresh started",
        description: `Started discovery jobs for ${incompleteServers.length} servers`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setBulkRefreshing(false);
    }
  };

  // Persist view mode preference
  useEffect(() => {
    localStorage.setItem('server-view-mode', viewMode);
  }, [viewMode]);

  const filteredServers = servers.filter((server) => {
    // Text search filter
    const matchesSearch = 
      server.ip_address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      server.hostname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      server.service_tag?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      server.model?.toLowerCase().includes(searchTerm.toLowerCase());
    
    // Group filter
    if (groupFilter === "all") {
      return matchesSearch;
    } else if (groupFilter === "ungrouped") {
      const hasGroup = groupMemberships?.some(m => m.server_id === server.id);
      return matchesSearch && !hasGroup;
    } else if (groupFilter.startsWith('vcenter-cluster-')) {
      // vCenter cluster filter
      const clusterName = groupFilter.replace('vcenter-cluster-', '');
      const vCenterHost = vCenterHosts?.find(h => h.id === server.vcenter_host_id);
      return matchesSearch && vCenterHost?.cluster === clusterName;
    } else {
      // Manual group filter
      const inGroup = groupMemberships?.some(
        m => m.server_id === server.id && m.server_group_id === groupFilter
      );
      return matchesSearch && inGroup;
    }
  });

  // Organize servers by groups for grouped view
  const organizeServersByGroup = () => {
    const grouped: Map<string, {
      group: any | null;
      servers: Server[];
      isVCenterCluster?: boolean;
      clusterName?: string;
    }> = new Map();

    // Add each manual server group
    serverGroups?.forEach(group => {
      grouped.set(group.id, { group, servers: [], isVCenterCluster: false });
    });

    // Add vCenter cluster groups
    const uniqueClusters = new Set<string>();
    vCenterHosts?.forEach(host => {
      if (host.cluster) {
        uniqueClusters.add(host.cluster);
      }
    });
    uniqueClusters.forEach(clusterName => {
      const clusterId = `vcenter-cluster-${clusterName}`;
      grouped.set(clusterId, { 
        group: {
          id: clusterId,
          name: clusterName,
          color: '#10b981', // green for vCenter clusters
          icon: 'Boxes',
        }, 
        servers: [], 
        isVCenterCluster: true,
        clusterName 
      });
    });

    // Add ungrouped section
    grouped.set('ungrouped', { group: null, servers: [], isVCenterCluster: false });

    // Distribute servers to manual groups
    filteredServers.forEach(server => {
      const memberships = groupMemberships?.filter(m => m.server_id === server.id);
      
      if (memberships && memberships.length > 0) {
        memberships.forEach(m => {
          const entry = grouped.get(m.server_group_id!);
          if (entry) {
            entry.servers.push(server);
          }
        });
      }
    });

    // Distribute servers to vCenter cluster groups
    filteredServers.forEach(server => {
      if (server.vcenter_host_id) {
        const vCenterHost = vCenterHosts?.find(h => h.id === server.vcenter_host_id);
        if (vCenterHost?.cluster) {
          const clusterId = `vcenter-cluster-${vCenterHost.cluster}`;
          const entry = grouped.get(clusterId);
          if (entry) {
            entry.servers.push(server);
          }
        }
      }
    });

    // Add servers to ungrouped if they're not in any manual group
    filteredServers.forEach(server => {
      const memberships = groupMemberships?.filter(m => m.server_id === server.id);
      if (!memberships || memberships.length === 0) {
        grouped.get('ungrouped')?.servers.push(server);
      }
    });

    return Array.from(grouped.values()).filter(g => g.servers.length > 0);
  };

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
          <Button 
            variant="outline" 
            onClick={() => navigate('/settings?tab=server-groups')}
          >
            <Users className="mr-2 h-4 w-4" />
            Manage Groups
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

      {incompleteServers.length > 0 && showIncompleteBanner && (
        <Alert className="mb-6 border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
          <Info className="h-4 w-4 text-yellow-600 dark:text-yellow-500" />
          <AlertDescription className="flex items-center justify-between">
            <span className="text-yellow-900 dark:text-yellow-200">
              {incompleteServers.length} {incompleteServers.length === 1 ? 'server has' : 'servers have'} incomplete information. Right-click and select "Refresh Server Information" to update, or refresh all at once.
            </span>
            <div className="flex items-center gap-2 ml-4">
              <Button 
                size="sm" 
                variant="outline"
                className="border-yellow-600 text-yellow-900 hover:bg-yellow-100 dark:text-yellow-200 dark:hover:bg-yellow-900/30"
                onClick={handleRefreshIncomplete}
                disabled={bulkRefreshing}
              >
                {bulkRefreshing ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Refreshing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Refresh All ({incompleteServers.length})
                  </>
                )}
              </Button>
              <Button 
                size="sm" 
                variant="ghost"
                className="text-yellow-900 hover:text-yellow-950 dark:text-yellow-200 dark:hover:text-yellow-100"
                onClick={() => setShowIncompleteBanner(false)}
              >
                Dismiss
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {servers.length > 0 && (!serverGroups || serverGroups.length === 0) && (
        <Alert className="mb-6">
          <Info className="h-4 w-4" />
          <AlertDescription>
            💡 <strong>Tip:</strong> Group your Dell servers into application clusters for unified maintenance scheduling.{" "}
            <Button 
              variant="link" 
              className="p-0 h-auto font-semibold"
              onClick={() => navigate('/settings?tab=server-groups')}
            >
              Create your first group
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Search & Filter Servers</CardTitle>
          <CardDescription>Filter by IP, hostname, service tag, model, or group</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search servers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            {(serverGroups && serverGroups.length > 0 || vCenterHosts && vCenterHosts.length > 0) && (
              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All Groups" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Groups</SelectItem>
                  <SelectItem value="ungrouped">Ungrouped Servers</SelectItem>
                  {serverGroups && serverGroups.length > 0 && (
                    <>
                      {serverGroups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                      ))}
                    </>
                  )}
                  {vCenterHosts && Array.from(new Set(vCenterHosts.map(h => h.cluster).filter(Boolean))).length > 0 && (
                    <>
                      {Array.from(new Set(vCenterHosts.map(h => h.cluster).filter(Boolean))).map((cluster) => (
                        <SelectItem key={`vcenter-cluster-${cluster}`} value={`vcenter-cluster-${cluster}`}>
                          🔷 {cluster}
                        </SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>
            )}
          </div>
          
          {/* View Mode Toggle */}
          <div className="flex gap-2">
            <Button 
              variant={viewMode === 'flat' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('flat')}
            >
              <List className="h-4 w-4 mr-2" />
              Flat View
            </Button>
            <Button 
              variant={viewMode === 'grouped' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('grouped')}
            >
              <Layers className="h-4 w-4 mr-2" />
              Grouped View
            </Button>
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
        viewMode === 'grouped' ? (
          // Grouped View with Accordions
          <Accordion type="multiple" defaultValue={organizeServersByGroup().map(g => g.group?.id || 'ungrouped')} className="space-y-4">
            {organizeServersByGroup().map(({ group, servers, isVCenterCluster }) => {
              const groupId = group?.id || 'ungrouped';
              const onlineCount = servers.filter(s => s.connection_status === 'online').length;
              const offlineCount = servers.filter(s => s.connection_status === 'offline').length;
              
              return (
                <AccordionItem key={groupId} value={groupId} className="border rounded-lg">
                  <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-accent/50">
                    <div className="flex items-center justify-between w-full pr-4">
                      <div className="flex items-center gap-3">
                        {group ? (
                          <>
                            <div 
                              className="w-10 h-10 rounded-lg flex items-center justify-center"
                              style={{ backgroundColor: `${group.color}20`, color: group.color }}
                            >
                              {group.icon === 'Boxes' ? (
                                <Boxes className="h-5 w-5" />
                              ) : group.icon === 'Server' ? (
                                <Server className="h-5 w-5" />
                              ) : (
                                <Users className="h-5 w-5" />
                              )}
                            </div>
                            <div className="text-left">
                              <div className="flex items-center gap-2">
                                <h3 className="text-lg font-semibold">{group.name}</h3>
                                {isVCenterCluster && (
                                  <Badge variant="outline" className="gap-1 border-green-600 text-green-700 dark:border-green-500 dark:text-green-400">
                                    vCenter Cluster
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {isVCenterCluster ? 'ESXi cluster from vCenter' : (group.description || `${group.group_type} group`)}
                              </p>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-muted">
                              <Server className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div className="text-left">
                              <h3 className="text-lg font-semibold">Ungrouped Servers</h3>
                              <p className="text-sm text-muted-foreground">
                                Servers not assigned to any group
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <Badge variant="outline" className="gap-1">
                          <Server className="h-3 w-3" />
                          {servers.length}
                        </Badge>
                        {onlineCount > 0 && (
                          <Badge variant="outline" className="gap-1 border-green-500 text-green-700 dark:border-green-600 dark:text-green-400">
                            <CheckCircle className="h-3 w-3" />
                            {onlineCount} online
                          </Badge>
                        )}
                        {offlineCount > 0 && (
                          <Badge variant="outline" className="gap-1 border-red-500 text-red-700 dark:border-red-600 dark:text-red-400">
                            <AlertCircle className="h-3 w-3" />
                            {offlineCount} offline
                          </Badge>
                        )}
                        {group && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                              {isVCenterCluster ? (
                                <>
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate('/maintenance-calendar', {
                                        state: {
                                          openDialog: true,
                                          prefilledData: {
                                            maintenance_type: 'firmware_update',
                                            cluster_ids: [group.name],
                                            details: { cluster_name: group.name }
                                          }
                                        }
                                      });
                                    }}
                                  >
                                    <Calendar className="mr-2 h-4 w-4" />
                                    Schedule Cluster Maintenance
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate('/vcenter');
                                    }}
                                  >
                                    <Link2 className="mr-2 h-4 w-4" />
                                    View in vCenter
                                  </DropdownMenuItem>
                                </>
                              ) : (
                                <>
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate('/maintenance-calendar', {
                                        state: {
                                          openDialog: true,
                                          prefilledData: {
                                            maintenance_type: 'firmware_update',
                                            server_group_ids: [group.id],
                                            details: { group_name: group.name }
                                          }
                                        }
                                      });
                                    }}
                                  >
                                    <Calendar className="mr-2 h-4 w-4" />
                                    Schedule Maintenance
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedServer(null);
                                    setJobDialogOpen(true);
                                  }}>
                                    <Zap className="mr-2 h-4 w-4" />
                                    Run Discovery on Group
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={(e) => {
                                    e.stopPropagation();
                                    navigate('/settings?tab=server-groups');
                                  }}>
                                    <Settings2 className="mr-2 h-4 w-4" />
                                    Edit Group
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                  </AccordionTrigger>
                  
                  <AccordionContent className="px-6 pb-4">
                    <div className="space-y-3 pt-2">
                      {servers.map((server) => (
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
                                        isIncomplete={isIncompleteServer(server)}
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
                                      {hasActiveHealthCheck(server.id) && (
                                        <Badge variant="outline" className="gap-1">
                                          <Activity className="h-3 w-3 animate-spin" />
                                          Health Check
                                        </Badge>
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
                                        <span className="text-muted-foreground">iDRAC Version:</span>
                                        <p className="font-medium">{server.idrac_firmware || "N/A"}</p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="w-72">
                            {/* Context menu items - reuse from flat view */}
                          </ContextMenuContent>
                        </ContextMenu>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        ) : (
          // Flat View
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
                            isIncomplete={isIncompleteServer(server)}
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
                    {hasActiveHealthCheck(server.id) && (
                      <Badge variant="outline" className="gap-1">
                        <Activity className="h-3 w-3 animate-spin" />
                        Health Check
                      </Badge>
                    )}
                    {groupMemberships
                            ?.filter(m => m.server_id === server.id)
                            .map((m) => {
                              const group = m.server_groups as any;
                              return (
                                <Badge 
                                  key={group.id}
                                  variant="outline"
                                  style={{ borderColor: group.color }}
                                  className="gap-1"
                                >
                                  <Users className="h-3 w-3" />
                                  {group.name}
                                </Badge>
                              );
                            })
                          }
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
              <ContextMenuContent className="w-72">
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
                      <div className="flex flex-col">
                        <span>Assign Credentials</span>
                        <span className="text-xs text-muted-foreground">Required to access iDRAC</span>
                      </div>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                  </>
                )}
                
                {/* Monitoring & Diagnostics Submenu */}
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Activity className="mr-2 h-4 w-4" />
                    Monitoring & Diagnostics
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-64">
                    <ContextMenuLabel className="text-xs text-muted-foreground">Real-time monitoring and logs</ContextMenuLabel>
                    <ContextMenuItem onClick={() => {
                      setSelectedServer(server);
                      setPowerControlDialogOpen(true);
                    }}>
                      <Power className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>Power Control</span>
                        <span className="text-xs text-muted-foreground">Power on/off/reset server</span>
                      </div>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => {
                      setSelectedServer(server);
                      setHealthDialogOpen(true);
                    }}>
                      <Activity className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>Health Status</span>
                        <span className="text-xs text-muted-foreground">View current health metrics</span>
                      </div>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => {
                      setSelectedServer(server);
                      setEventLogDialogOpen(true);
                    }}>
                      <FileText className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>Event Logs</span>
                        <span className="text-xs text-muted-foreground">View iDRAC event history</span>
                      </div>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem 
                      onClick={() => handleRunHealthCheck(server)}
                      disabled={healthCheckServer === server.id}
                    >
                      <Zap className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>Run Health Check</span>
                        <span className="text-xs text-muted-foreground">Fetch latest health data</span>
                      </div>
                    </ContextMenuItem>
                    <ContextMenuItem 
                      onClick={() => handleTestConnection(server)}
                      disabled={refreshing === server.id}
                    >
                      <CheckCircle className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>Test iDRAC Connection</span>
                        <span className="text-xs text-muted-foreground">Verify network connectivity</span>
                      </div>
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>

                {/* Configuration Submenu */}
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <FolderCog className="mr-2 h-4 w-4" />
                    Configuration
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-64">
                    <ContextMenuLabel className="text-xs text-muted-foreground">Server settings and backups</ContextMenuLabel>
                    <ContextMenuItem onClick={() => {
                      setSelectedServer(server);
                      setBootConfigDialogOpen(true);
                    }}>
                      <HardDrive className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>Boot Configuration</span>
                        <span className="text-xs text-muted-foreground">Manage boot order and mode</span>
                      </div>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => {
                      setSelectedServer(server);
                      setBiosConfigDialogOpen(true);
                    }}>
                      <Settings2 className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>BIOS Configuration</span>
                        <span className="text-xs text-muted-foreground">Read/modify BIOS settings</span>
                      </div>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => {
                      setSelectedServer(server);
                      setVirtualMediaDialogOpen(true);
                    }}>
                      <Disc className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>Virtual Media</span>
                        <span className="text-xs text-muted-foreground">Mount ISO/IMG remotely</span>
                      </div>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => {
                      setSelectedServer(server);
                      setScpBackupDialogOpen(true);
                    }}>
                      <FileJson className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>SCP Backup/Restore</span>
                        <span className="text-xs text-muted-foreground">Export/import full config</span>
                      </div>
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>

                {/* Firmware & Updates Submenu */}
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Wrench className="mr-2 h-4 w-4" />
                    Firmware & Updates
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-64">
                    <ContextMenuLabel className="text-xs text-muted-foreground">Update firmware and workflows</ContextMenuLabel>
                    <ContextMenuItem onClick={() => handleCreateJob(server)}>
                      <Zap className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>Update Now</span>
                        <span className="text-xs text-muted-foreground">Create immediate update job</span>
                      </div>
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => {
                        navigate('/maintenance-calendar', { 
                          state: { 
                            openDialog: true,
                            prefilledData: {
                              maintenance_type: 'firmware_update',
                              server_group_ids: [],
                              cluster_ids: [],
                              details: {
                                server_ids: [server.id],
                                server_name: server.hostname || server.ip_address
                              }
                            }
                          }
                        });
                      }}
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>Schedule Maintenance</span>
                        <span className="text-xs text-muted-foreground">Plan future update window</span>
                      </div>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={() => {
                        setSelectedServer(server);
                        setWorkflowDialogOpen(true);
                      }}
                    >
                      <FileStack className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>Prepare for Update</span>
                        <span className="text-xs text-muted-foreground">Full orchestration workflow</span>
                      </div>
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => {
                        setSelectedServer(server);
                        setPreFlightCheckDialogOpen(true);
                      }}
                      disabled={!server.vcenter_host_id}
                    >
                      <Shield className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>Check Update Readiness</span>
                        <span className="text-xs text-muted-foreground">
                          {!server.vcenter_host_id ? 'Requires vCenter link' : 'Pre-flight safety checks'}
                        </span>
                      </div>
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>

                {/* Management Submenu */}
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Settings2 className="mr-2 h-4 w-4" />
                    Management
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-64">
                    <ContextMenuLabel className="text-xs text-muted-foreground">Server inventory management</ContextMenuLabel>
                    <ContextMenuItem 
                      onClick={() => handleRefreshInfo(server)}
                      disabled={refreshing === server.id}
                      className={isIncompleteServer(server) ? "text-yellow-600 dark:text-yellow-500 font-medium" : ""}
                    >
                      <RotateCw className={`mr-2 h-4 w-4 ${refreshing === server.id ? 'animate-spin' : ''} ${isIncompleteServer(server) ? 'text-yellow-600 dark:text-yellow-500' : ''}`} />
                      <div className="flex flex-col">
                        <span>{isIncompleteServer(server) ? '⚠ Refresh Server Info' : 'Refresh Server Info'}</span>
                        <span className="text-xs text-muted-foreground">Update from iDRAC</span>
                      </div>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleLinkToVCenter(server)}>
                      <Link2 className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>Link to vCenter Host</span>
                        <span className="text-xs text-muted-foreground">Associate with ESXi host</span>
                      </div>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => {
                      setSelectedServer(server);
                      setManageGroupsDialogOpen(true);
                    }}>
                      <Users className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>Manage Groups</span>
                        <span className="text-xs text-muted-foreground">Add/remove group membership</span>
                      </div>
                    </ContextMenuItem>
                    {server.credential_test_status !== 'invalid' && (
                      <ContextMenuItem 
                        onClick={() => {
                          setSelectedServer(server);
                          setAssignCredentialsDialogOpen(true);
                        }}
                      >
                        <CheckCircle className="mr-2 h-4 w-4" />
                        <div className="flex flex-col">
                          <span>Update Credentials</span>
                          <span className="text-xs text-muted-foreground">Change iDRAC login</span>
                        </div>
                      </ContextMenuItem>
                    )}
                  </ContextMenuSubContent>
                </ContextMenuSub>

                {/* Information Submenu */}
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Info className="mr-2 h-4 w-4" />
                    Information
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-64">
                    <ContextMenuLabel className="text-xs text-muted-foreground">View server details</ContextMenuLabel>
                    <ContextMenuItem onClick={() => handleViewProperties(server)}>
                      <Info className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>View Properties</span>
                        <span className="text-xs text-muted-foreground">Full server details</span>
                      </div>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleViewAudit(server)}>
                      <History className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>Audit History</span>
                        <span className="text-xs text-muted-foreground">View all changes</span>
                      </div>
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>

                <ContextMenuSeparator />

                {/* Top-level actions */}
                <ContextMenuItem onClick={() => handleEditServer(server)}>
                  <Edit className="mr-2 h-4 w-4" />
                  <div className="flex flex-col">
                    <span>Edit Server Details</span>
                    <span className="text-xs text-muted-foreground">Modify hostname, notes, etc.</span>
                  </div>
                </ContextMenuItem>
                
                <ContextMenuSeparator />
                
                <ContextMenuItem 
                  onClick={() => handleDeleteServer(server)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  <div className="flex flex-col">
                    <span>Remove from Inventory</span>
                    <span className="text-xs text-muted-foreground">Permanently delete server</span>
                  </div>
                </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        )
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

          <WorkflowJobDialog
            open={workflowDialogOpen}
            onOpenChange={setWorkflowDialogOpen}
            onSuccess={fetchServers}
            defaultJobType="prepare_host_for_update"
            preSelectedServerId={selectedServer?.id}
          />
          
          <PreFlightCheckDialog
            open={preFlightCheckDialogOpen}
            onOpenChange={setPreFlightCheckDialogOpen}
            onProceed={() => {
              setPreFlightCheckDialogOpen(false);
              handleCreateJob(selectedServer!);
            }}
            serverId={selectedServer?.id || ''}
            jobType="firmware_update"
          />
        </>
      )}

      <ManageServerGroupsDialog
        server={selectedServer}
        open={manageGroupsDialogOpen}
        onOpenChange={setManageGroupsDialogOpen}
      />

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
