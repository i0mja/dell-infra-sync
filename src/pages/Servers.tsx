import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus, RefreshCw, Wrench } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AddServerDialog } from "@/components/servers/AddServerDialog";
import { LinkVCenterDialog } from "@/components/servers/LinkVCenterDialog";
import { EditServerDialog } from "@/components/servers/EditServerDialog";
import { ServerAuditDialog } from "@/components/servers/ServerAuditDialog";
import { ServerPropertiesDialog } from "@/components/servers/ServerPropertiesDialog";
import { CreateJobDialog } from "@/components/jobs/CreateJobDialog";
import { AssignCredentialsDialog } from "@/components/servers/AssignCredentialsDialog";
import { PowerControlDialog } from "@/components/servers/PowerControlDialog";
import { ServerHealthDialog } from "@/components/servers/ServerHealthDialog";
import { EventLogDialog } from "@/components/servers/EventLogDialog";
import { BootConfigDialog } from "@/components/servers/BootConfigDialog";
import { VirtualMediaDialog } from "@/components/servers/VirtualMediaDialog";
import { ScpBackupDialog } from "@/components/servers/ScpBackupDialog";
import { BiosConfigDialog } from "@/components/servers/BiosConfigDialog";
import { WorkflowJobDialog } from "@/components/jobs/WorkflowJobDialog";
import { PreFlightCheckDialog } from "@/components/jobs/PreFlightCheckDialog";
import { ServerStatsBar } from "@/components/servers/ServerStatsBar";
import { ServerFilterToolbar } from "@/components/servers/ServerFilterToolbar";
import { ServersTable } from "@/components/servers/ServersTable";
import { ServerDetailsSidebar } from "@/components/servers/ServerDetailsSidebar";
import { IncompleteServersBanner } from "@/components/servers/IncompleteServersBanner";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Job Executor is always enabled - iDRACs are always on private networks
  const useJobExecutorForIdrac = true;

  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedServer, setSelectedServer] = useState<Server | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
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
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [healthCheckServer, setHealthCheckServer] = useState<string | null>(null);
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
            description: "Job Executor may not be running - check Maintenance Planner → Jobs for status",
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

  const filteredServers = servers.filter((server) => {
    // Text search filter
    const matchesSearch = 
      server.ip_address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      server.hostname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      server.service_tag?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      server.model?.toLowerCase().includes(searchTerm.toLowerCase());
    
    // Status filter
    let matchesStatus = true;
    if (statusFilter === "online") {
      matchesStatus = server.connection_status === 'online';
    } else if (statusFilter === "offline") {
      matchesStatus = server.connection_status === 'offline';
    } else if (statusFilter === "unknown") {
      matchesStatus = !server.connection_status || server.connection_status === 'unknown';
    } else if (statusFilter === "incomplete") {
      matchesStatus = isIncompleteServer(server);
    }
    
    // Group filter
    let matchesGroup = true;
    if (groupFilter === "ungrouped") {
      const hasGroup = groupMemberships?.some(m => m.server_id === server.id);
      matchesGroup = !hasGroup;
    } else if (groupFilter.startsWith('cluster:')) {
      const clusterName = groupFilter.replace('cluster:', '');
      const vCenterHost = vCenterHosts?.find(h => h.id === server.vcenter_host_id);
      matchesGroup = vCenterHost?.cluster === clusterName;
    } else if (groupFilter !== "all") {
      const inGroup = groupMemberships?.some(
        m => m.server_id === server.id && m.server_group_id === groupFilter
      );
      matchesGroup = inGroup;
    }
    
    return matchesSearch && matchesStatus && matchesGroup;
  });

  // Organize servers by groups for grouped view
  const organizeServersByGroup = () => {
    const grouped: Array<{
      name: string;
      group?: { id: string; name: string; color: string; icon?: string };
      cluster?: string;
      servers: Server[];
      onlineCount: number;
      linkedCount: number;
    }> = [];

    // Add each manual server group
    serverGroups?.forEach(group => {
      const groupServers = filteredServers.filter(s => 
        groupMemberships?.some(m => m.server_id === s.id && m.server_group_id === group.id)
      );
      if (groupServers.length > 0) {
        grouped.push({
          name: group.name,
          group: group,
          servers: groupServers,
          onlineCount: groupServers.filter(s => s.connection_status === 'online').length,
          linkedCount: groupServers.filter(s => s.vcenter_host_id).length,
        });
      }
    });

    // Add vCenter cluster groups
    const uniqueClusters = new Set<string>();
    vCenterHosts?.forEach(host => {
      if (host.cluster) uniqueClusters.add(host.cluster);
    });
    
    uniqueClusters.forEach(clusterName => {
      const clusterServers = filteredServers.filter(s => {
        const vCenterHost = vCenterHosts?.find(h => h.id === s.vcenter_host_id);
        return vCenterHost?.cluster === clusterName;
      });
      if (clusterServers.length > 0) {
        grouped.push({
          name: `${clusterName} (vCenter)`,
          cluster: clusterName,
          servers: clusterServers,
          onlineCount: clusterServers.filter(s => s.connection_status === 'online').length,
          linkedCount: clusterServers.filter(s => s.vcenter_host_id).length,
        });
      }
    });

    // Add ungrouped servers
    const ungroupedServers = filteredServers.filter(s => {
      const hasManualGroup = groupMemberships?.some(m => m.server_id === s.id);
      const vCenterHost = s.vcenter_host_id 
        ? vCenterHosts?.find(h => h.id === s.vcenter_host_id)
        : null;
      const hasVCenterCluster = vCenterHost?.cluster != null;
      return !hasManualGroup && !hasVCenterCluster;
    });
    
    if (ungroupedServers.length > 0) {
      grouped.push({
        name: 'Ungrouped',
        servers: ungroupedServers,
        onlineCount: ungroupedServers.filter(s => s.connection_status === 'online').length,
        linkedCount: ungroupedServers.filter(s => s.vcenter_host_id).length,
      });
    }

    return grouped;
  };

  const uniqueVCenterClusters = Array.from(new Set(
    vCenterHosts?.map(h => h.cluster).filter(Boolean) || []
  ));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top: Compact Stats Bar */}
      <ServerStatsBar 
        totalServers={servers.length}
        onlineCount={servers.filter(s => s.connection_status === 'online').length}
        offlineCount={servers.filter(s => s.connection_status === 'offline').length}
        unknownCount={servers.filter(s => !s.connection_status || s.connection_status === 'unknown').length}
        incompleteCount={incompleteServers.length}
        onAddServer={() => setDialogOpen(true)}
        onRefreshAll={fetchServers}
        onManageGroups={() => navigate('/settings?tab=server-groups')}
        onDiscovery={() => setJobDialogOpen(true)}
        useJobExecutor={useJobExecutorForIdrac}
      />
      
      {/* Incomplete Servers Banner (conditional) */}
      {incompleteServers.length > 0 && showIncompleteBanner && (
        <div className="px-4 pt-4">
          <IncompleteServersBanner 
            count={incompleteServers.length}
            onRefreshAll={handleRefreshIncomplete}
            onDismiss={() => setShowIncompleteBanner(false)}
            refreshing={bulkRefreshing}
          />
        </div>
      )}
      
      {/* Main: Two Column Layout */}
      <div className="flex-1 flex gap-4 p-4 overflow-hidden">
        
        {/* Left: Servers Table */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <ServerFilterToolbar
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            groupFilter={groupFilter}
            onGroupFilterChange={setGroupFilter}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            groups={serverGroups || []}
            vCenterClusters={uniqueVCenterClusters}
          />
          
          <ServersTable
            servers={filteredServers}
            groupedData={groupFilter !== 'all' || searchTerm ? null : organizeServersByGroup()}
            selectedServerId={selectedServer?.id || null}
            selectedGroupId={selectedGroup}
            onServerClick={(server) => setSelectedServer(server as any)}
            onGroupClick={setSelectedGroup}
            loading={loading}
            refreshing={refreshing}
            healthCheckServer={healthCheckServer}
            hasActiveHealthCheck={hasActiveHealthCheck}
            isIncomplete={isIncompleteServer}
            groupMemberships={groupMemberships}
            vCenterHosts={vCenterHosts}
          />
        </div>
        
        {/* Right: Server Details */}
        <div className="w-[480px] flex-shrink-0">
          <ServerDetailsSidebar
            selectedServer={selectedServer}
            selectedGroup={selectedGroup ? organizeServersByGroup().find(g => 
              g.group?.id === selectedGroup || g.cluster === selectedGroup.replace(' (vCenter)', '')
            ) || null : null}
            servers={servers}
            groupMemberships={groupMemberships}
            vCenterHosts={vCenterHosts}
            onClose={() => {
              setSelectedServer(null);
              setSelectedGroup(null);
            }}
            onEdit={(s: any) => { setSelectedServer(s); setEditDialogOpen(true); }}
            onDelete={(s: any) => { setSelectedServer(s); setDeleteDialogOpen(true); }}
            onTestConnection={(s: any) => handleTestConnection(s)}
            onRefreshInfo={(s: any) => handleRefreshInfo(s)}
            onHealthCheck={(s: any) => handleRunHealthCheck(s)}
            onPowerControl={(s: any) => { setSelectedServer(s); setPowerControlDialogOpen(true); }}
            onBiosConfig={(s: any) => { setSelectedServer(s); setBiosConfigDialogOpen(true); }}
            onBootConfig={(s: any) => { setSelectedServer(s); setBootConfigDialogOpen(true); }}
            onVirtualMedia={(s: any) => { setSelectedServer(s); setVirtualMediaDialogOpen(true); }}
            onScpBackup={(s: any) => { setSelectedServer(s); setScpBackupDialogOpen(true); }}
            onViewAudit={(s: any) => { setSelectedServer(s); setAuditDialogOpen(true); }}
            onViewProperties={(s: any) => { setSelectedServer(s); setPropertiesDialogOpen(true); }}
            onViewHealth={(s: any) => { setSelectedServer(s); setHealthDialogOpen(true); }}
            onViewEventLog={(s: any) => { setSelectedServer(s); setEventLogDialogOpen(true); }}
            onLinkVCenter={(s: any) => { setSelectedServer(s); setLinkDialogOpen(true); }}
            onAssignCredentials={(s: any) => { setSelectedServer(s); setAssignCredentialsDialogOpen(true); }}
            onCreateJob={(s: any) => { setSelectedServer(s); setJobDialogOpen(true); }}
            onWorkflow={(s: any) => { setSelectedServer(s); setWorkflowDialogOpen(true); }}
            onPreFlight={(s: any) => { setSelectedServer(s); setPreFlightCheckDialogOpen(true); }}
            refreshing={refreshing}
          />
        </div>
      </div>
      
      {/* All Dialogs */}
      <AddServerDialog open={dialogOpen} onOpenChange={setDialogOpen} onSuccess={fetchServers} />
      {selectedServer && (
        <>
          <EditServerDialog 
            open={editDialogOpen} 
            onOpenChange={setEditDialogOpen}
            server={selectedServer}
            onSuccess={fetchServers}
          />
          <LinkVCenterDialog 
            open={linkDialogOpen} 
            onOpenChange={setLinkDialogOpen}
            server={selectedServer}
            onSuccess={fetchServers}
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
          <ServerAuditDialog
            open={auditDialogOpen}
            onOpenChange={setAuditDialogOpen}
            server={selectedServer}
          />
          <ServerPropertiesDialog
            open={propertiesDialogOpen}
            onOpenChange={setPropertiesDialogOpen}
            server={selectedServer}
          />
        </>
      )}
      <CreateJobDialog
        open={jobDialogOpen}
        onOpenChange={setJobDialogOpen}
        preSelectedServerId={selectedServer?.id}
        onSuccess={fetchServers}
      />
      <WorkflowJobDialog
        open={workflowDialogOpen}
        onOpenChange={setWorkflowDialogOpen}
        preSelectedServerId={selectedServer?.id}
        onSuccess={fetchServers}
      />
      <PreFlightCheckDialog
        open={preFlightCheckDialogOpen}
        onOpenChange={setPreFlightCheckDialogOpen}
        serverId={selectedServer?.id}
        onProceed={() => {}}
        jobType="firmware_update"
      />
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Server</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {selectedServer?.hostname || selectedServer?.ip_address}? This will unlink it from vCenter if linked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Servers;
