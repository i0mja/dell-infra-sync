import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useServers } from "@/hooks/useServers";
import { useConsoleLauncher } from "@/hooks/useConsoleLauncher";
import { useServerActions } from "@/hooks/useServerActions";
import { useAutoLinkVCenter } from "@/hooks/useAutoLinkVCenter";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logActivityDirect } from "@/hooks/useActivityLog";
import { ServerStatsBar } from "@/components/servers/ServerStatsBar";
import { ServersTable } from "@/components/servers/ServersTable";
import { ServerQuickView } from "@/components/servers/ServerQuickView";
import { AddServerDialog } from "@/components/servers/AddServerDialog";
import { useMediaQuery } from "@/hooks/use-media-query";
import { EditServerDialog } from "@/components/servers/EditServerDialog";
import { PowerControlDialog } from "@/components/servers/PowerControlDialog";
import { BiosConfigDialog } from "@/components/servers/BiosConfigDialog";
import { BootConfigDialog } from "@/components/servers/BootConfigDialog";
import { VirtualMediaDialog } from "@/components/servers/VirtualMediaDialog";
import { ScpBackupDialog } from "@/components/servers/scp/ScpBackupDialog";
import { ServerAuditDialog } from "@/components/servers/ServerAuditDialog";
import { ServerPropertiesDialog } from "@/components/servers/ServerPropertiesDialog";
import { ServerHealthDialog } from "@/components/servers/ServerHealthDialog";
import { EventLogDialog } from "@/components/servers/EventLogDialog";
import { LinkVCenterDialog } from "@/components/servers/LinkVCenterDialog";
import { AssignCredentialsDialog } from "@/components/servers/AssignCredentialsDialog";
import { DiscoveryScanDialog } from "@/components/servers/DiscoveryScanDialog";
import { WorkflowJobDialog } from "@/components/jobs/WorkflowJobDialog";
import { ClusterUpdateWizard } from "@/components/jobs/ClusterUpdateWizard";
import { IdracNetworkDialog } from "@/components/servers/IdracNetworkDialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { Server } from "@/hooks/useServers";

export default function Servers() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  // Filter state (managed by table)
  const [searchTerm, setSearchTerm] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Selection state
  const [selectedServer, setSelectedServer] = useState<Server | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [serversToDelete, setServersToDelete] = useState<Server[]>([]);
  const [powerControlDialogOpen, setPowerControlDialogOpen] = useState(false);
  const [biosConfigDialogOpen, setBiosConfigDialogOpen] = useState(false);
  const [bootConfigDialogOpen, setBootConfigDialogOpen] = useState(false);
  const [virtualMediaDialogOpen, setVirtualMediaDialogOpen] = useState(false);
  const [scpBackupDialogOpen, setScpBackupDialogOpen] = useState(false);
  const [auditDialogOpen, setAuditDialogOpen] = useState(false);
  const [propertiesDialogOpen, setPropertiesDialogOpen] = useState(false);
  const [healthDialogOpen, setHealthDialogOpen] = useState(false);
  const [eventLogDialogOpen, setEventLogDialogOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [assignCredentialsDialogOpen, setAssignCredentialsDialogOpen] = useState(false);
  const [discoveryScanOpen, setDiscoveryScanOpen] = useState(false);
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false);
  const [updateWizardOpen, setUpdateWizardOpen] = useState(false);
  const [networkSettingsDialogOpen, setNetworkSettingsDialogOpen] = useState(false);
  const [bulkUpdateServerIds, setBulkUpdateServerIds] = useState<string[]>([]);
  const [preSelectedClusterForUpdate, setPreSelectedClusterForUpdate] = useState<string | undefined>();
  const { launching: launchingConsole, launchConsole } = useConsoleLauncher();

  // Hooks
  const {
    filteredServers,
    groupedData,
    stats,
    serverGroups,
    groupMemberships,
    vCenterHosts,
    refetch,
  } = useServers(searchTerm, statusFilter, groupFilter);

  const { refreshing, testing, handleTestConnection, handleRefreshInfo, handleDeleteServer } =
    useServerActions();

  const { autoLinkSingleServer, autoLinkBulk, isLinking } = useAutoLinkVCenter();

  // Detect local mode
  const isLocalMode =
    import.meta.env.VITE_SUPABASE_URL?.includes("127.0.0.1") ||
    import.meta.env.VITE_SUPABASE_URL?.includes("localhost");

  // Auto-select server from URL param
  useEffect(() => {
    const serverId = searchParams.get('server');
    if (serverId && filteredServers.length > 0) {
      const server = filteredServers.find(s => s.id === serverId);
      if (server) {
        setSelectedServer(server);
        // Clear the param after selecting
        searchParams.delete('server');
        setSearchParams(searchParams, { replace: true });
      }
    }
  }, [searchParams, filteredServers, setSearchParams]);

  // Bulk refresh handler
  const [bulkRefreshing, setBulkRefreshing] = useState(false);
  
  const handleBulkRefresh = async () => {
    if (!user || filteredServers.length === 0) return;
    
    setBulkRefreshing(true);
    try {
      const serverIds = filteredServers.map((s) => s.id);
      
      const { data, error } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "discovery_scan",
          created_by: user.id,
          target_scope: { server_ids: serverIds },
        },
      });

      if (error) throw error;

      // Navigate to dashboard to view job progress
      navigate("/");
    } catch (error: any) {
      toast.error("Failed to Start Bulk Refresh", {
        description: error.message || "An error occurred",
      });
    } finally {
      setBulkRefreshing(false);
    }
  };

  // Get unique vCenter clusters for filter
  const uniqueVCenterClusters = Array.from(
    new Set(vCenterHosts?.map((h) => h.cluster).filter(Boolean) || [])
  );

  // Handlers
  const handleServerRowClick = (server: Server) => {
    setSelectedServer((current) => (current?.id === server.id ? null : server));
    setSelectedGroup(null);
  };

  const handleGroupRowClick = (groupId: string) => {
    setSelectedGroup((current) => (current === groupId ? null : groupId));
    setSelectedServer(null);
  };

  const handleAddServer = () => {
    setDialogOpen(true);
  };

  const handleDiscovery = () => {
    setDiscoveryScanOpen(true);
  };

  const confirmDelete = async () => {
    if (!selectedServer) return;
    await handleDeleteServer(selectedServer);
    setDeleteDialogOpen(false);
    setSelectedServer(null);
  };

  const handleServerDelete = (server: Server) => {
    setSelectedServer(server);
    setDeleteDialogOpen(true);
  };

  const handleBulkDelete = (serverIds: string[]) => {
    const servers = filteredServers.filter(s => serverIds.includes(s.id));
    setServersToDelete(servers);
    setBulkDeleteDialogOpen(true);
  };

  const confirmBulkDelete = async () => {
    for (const server of serversToDelete) {
      await handleDeleteServer(server);
    }
    setBulkDeleteDialogOpen(false);
    setServersToDelete([]);
    refetch();
  };

  const handleAutoLinkVCenter = async (server: Server) => {
    const result = await autoLinkSingleServer(server.id, server.service_tag);
    if (result.success) {
      refetch();
    }
  };

  const handleBulkAutoLink = async () => {
    await autoLinkBulk();
    refetch();
  };

  const handleBulkUpdate = (serverIds: string[]) => {
    setBulkUpdateServerIds(serverIds);
    setUpdateWizardOpen(true);
  };

  const handleLaunchConsole = async (server: Server) => {
    await launchConsole(server.id, server.hostname || server.ip_address);
  };

  // Handle cluster expansion request from wizard
  const handleClusterExpansionRequest = (clusterName: string) => {
    setUpdateWizardOpen(false);
    setBulkUpdateServerIds([]);
    setPreSelectedClusterForUpdate(clusterName);
    
    // Re-open wizard after a short delay with cluster pre-selected
    setTimeout(() => {
      setUpdateWizardOpen(true);
    }, 100);
  };

  // Handler functions
  const handleGroupUpdate = (groupId: string, groupType: 'manual' | 'vcenter' | undefined, serverIds: string[]) => {
    if (groupType === 'vcenter') {
      setPreSelectedClusterForUpdate(groupId);
    } else {
      setBulkUpdateServerIds(serverIds);
    }
    setUpdateWizardOpen(true);
  };

  const handleGroupSafetyCheck = async (groupId: string, clusterName: string) => {
    if (!user) return;
    
    try {
      const { error } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "cluster_safety_check",
          created_by: user.id,
          details: {
            cluster_name: clusterName,
            min_required_hosts: 2,
            check_drs: true,
            check_ha: true,
          },
          target_scope: {}
        },
      });
      
      if (error) throw error;
    } catch (error: any) {
      toast.error("Failed to Start Safety Check", {
        description: error.message,
      });
    }
  };

  const handleGroupFirmwareInventory = async (serverIds: string[]) => {
    if (!user) return;
    
    try {
      const { error } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "firmware_inventory_scan",
          created_by: user.id,
          target_scope: { server_ids: serverIds },
        },
      });
      
      if (error) throw error;
    } catch (error: any) {
      toast.error("Failed to Start Firmware Inventory", {
        description: error.message,
      });
    }
  };

  const handleGroupRefreshAll = async (serverIds: string[]) => {
    if (!user) return;
    
    try {
      const { error } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "discovery_scan",
          created_by: user.id,
          target_scope: { server_ids: serverIds },
        },
      });
      
      if (error) throw error;
    } catch (error: any) {
      toast.error("Failed to Start Refresh", {
        description: error.message,
      });
    }
  };

  const handleGroupHealthCheckAll = async (serverIds: string[]) => {
    if (!user) return;
    
    try {
      const { error } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "health_check",
          created_by: user.id,
          target_scope: { server_ids: serverIds },
        },
      });
      
      if (error) throw error;
    } catch (error: any) {
      toast.error("Failed to Start Health Check", {
        description: error.message,
      });
    }
  };

  const handleGroupTestCredentials = async (serverIds: string[]) => {
    if (!user) return;
    
    try {
      const { error } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "credential_test",
          created_by: user.id,
          target_scope: { server_ids: serverIds },
        },
      });
      
      if (error) throw error;

      // Log activity for each server
      serverIds.forEach(serverId => {
        logActivityDirect('credential_test', 'server', `Server ${serverId}`, { batch: true, total: serverIds.length }, { targetId: serverId, success: true });
      });
    } catch (error: any) {
      toast.error("Failed to Start Credential Test", {
        description: error.message,
      });
    }
  };

  const handleViewInVCenter = (clusterName: string) => {
    navigate(`/vcenter?cluster=${encodeURIComponent(clusterName)}`);
  };

  // Get selected group data
  const selectedGroupData = selectedGroup
    ? groupedData.find((g) => g.name === selectedGroup) || null
    : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top: Stats Bar */}
      <ServerStatsBar
        totalServers={stats.totalServers}
        onlineCount={stats.onlineCount}
        offlineCount={stats.offlineCount}
        unknownCount={stats.unknownCount}
        incompleteCount={stats.incompleteCount}
        credentialCoverage={stats.credentialCoverage}
        useJobExecutor={isLocalMode}
        onAddServer={handleAddServer}
        onRefreshAll={refetch}
        onDiscovery={handleDiscovery}
        onBulkRefresh={handleBulkRefresh}
        bulkRefreshing={bulkRefreshing}
      />

      {/* Main: Table + Sidebar Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Scrollable table area */}
        <div className="flex-1 overflow-y-auto">
          <ServersTable
          servers={filteredServers}
          groupedData={groupedData ? groupedData.map(g => ({
            id: g.group?.id || g.cluster || 'ungrouped',
            name: g.name,
            type: g.group ? 'manual' : (g.cluster ? 'vcenter' : undefined),
            servers: g.servers,
            onlineCount: g.onlineCount,
            linkedCount: g.linkedCount,
          })) : null}
          selectedServerId={selectedServer?.id || null}
          selectedGroupId={selectedGroup}
          onServerClick={handleServerRowClick}
          onGroupClick={handleGroupRowClick}
          onServerRefresh={handleRefreshInfo}
          onServerTest={handleTestConnection}
          onServerHealth={(server) => {
            setSelectedServer(server as any);
            setHealthDialogOpen(true);
          }}
          onServerPower={(server) => {
            setSelectedServer(server as any);
            setPowerControlDialogOpen(true);
          }}
          onServerDetails={(server) => setSelectedServer(server as any)}
          onAutoLinkVCenter={handleAutoLinkVCenter}
          onConsoleLaunch={handleLaunchConsole}
          onServerDelete={handleServerDelete}
          onBulkDelete={handleBulkDelete}
          loading={false}
          refreshing={refreshing}
          healthCheckServer={null}
          hasActiveHealthCheck={() => false}
          isIncomplete={() => false}
          groupMemberships={groupMemberships || []}
          vCenterHosts={vCenterHosts || []}
          renderExpandedRow={() => null}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          groupFilter={groupFilter}
          onGroupFilterChange={setGroupFilter}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          groups={serverGroups || []}
          vCenterClusters={uniqueVCenterClusters}
          onBulkAutoLink={handleBulkAutoLink}
          bulkLinking={isLinking}
          onBulkUpdate={handleBulkUpdate}
          onGroupUpdate={handleGroupUpdate}
          onGroupSafetyCheck={handleGroupSafetyCheck}
          onGroupRefreshAll={handleGroupRefreshAll}
          onGroupHealthCheckAll={handleGroupHealthCheckAll}
          onGroupTestCredentials={handleGroupTestCredentials}
          onGroupFirmwareInventory={handleGroupFirmwareInventory}
          onViewInVCenter={handleViewInVCenter}
          />
        </div>

        {/* Server Quick View Sidebar - normal flex child */}
        {selectedServer && (
          <ServerQuickView
            server={selectedServer}
            onClose={() => setSelectedServer(null)}
            onRefresh={() => handleRefreshInfo(selectedServer)}
            onPowerControl={() => setPowerControlDialogOpen(true)}
            onBiosConfig={() => setBiosConfigDialogOpen(true)}
            onBootConfig={() => setBootConfigDialogOpen(true)}
            onScpBackup={() => setScpBackupDialogOpen(true)}
            onVirtualMedia={() => setVirtualMediaDialogOpen(true)}
            onEventLog={() => setEventLogDialogOpen(true)}
            onHealthCheck={() => setHealthDialogOpen(true)}
            onConsoleLaunch={() => handleLaunchConsole(selectedServer)}
            onLinkVCenter={() => setLinkDialogOpen(true)}
            onAudit={() => setAuditDialogOpen(true)}
            onNetworkSettings={() => setNetworkSettingsDialogOpen(true)}
            refreshing={refreshing === selectedServer.id}
          />
        )}
      </div>

      {/* Dialogs */}
      <AddServerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={refetch}
      />

      <DiscoveryScanDialog
        open={discoveryScanOpen}
        onOpenChange={setDiscoveryScanOpen}
        onSuccess={refetch}
      />

      {selectedServer && (
        <>
          <EditServerDialog
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            server={selectedServer}
            onSuccess={refetch}
          />

          <PowerControlDialog
            open={powerControlDialogOpen}
            onOpenChange={setPowerControlDialogOpen}
            server={selectedServer}
          />

          <BiosConfigDialog
            open={biosConfigDialogOpen}
            onOpenChange={setBiosConfigDialogOpen}
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

          <LinkVCenterDialog
            open={linkDialogOpen}
            onOpenChange={setLinkDialogOpen}
            server={selectedServer}
            onSuccess={refetch}
          />

          <AssignCredentialsDialog
            open={assignCredentialsDialogOpen}
            onOpenChange={setAssignCredentialsDialogOpen}
            server={selectedServer}
            onSuccess={refetch}
          />

          <WorkflowJobDialog
            open={workflowDialogOpen}
            onOpenChange={setWorkflowDialogOpen}
            onSuccess={refetch}
            preSelectedServerId={selectedServer.id}
          />

          <IdracNetworkDialog
            open={networkSettingsDialogOpen}
            onOpenChange={setNetworkSettingsDialogOpen}
            server={selectedServer}
          />
        </>
      )}

      <ClusterUpdateWizard
        open={updateWizardOpen}
        onOpenChange={(open) => {
          setUpdateWizardOpen(open);
          if (!open) {
            setBulkUpdateServerIds([]);
            setPreSelectedClusterForUpdate(undefined);
          }
        }}
        preSelectedCluster={preSelectedClusterForUpdate}
        preSelectedTarget={preSelectedClusterForUpdate ? {
          type: 'cluster',
          id: preSelectedClusterForUpdate
        } : {
          type: 'servers',
          ids: bulkUpdateServerIds.length > 0 
            ? bulkUpdateServerIds 
            : (selectedServer ? [selectedServer.id] : [])
        }}
        onClusterExpansionRequest={handleClusterExpansionRequest}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Server</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              {selectedServer?.hostname || selectedServer?.ip_address}? This action cannot be
              undone. All related data will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {serversToDelete.length} Server{serversToDelete.length > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              The following servers will be permanently deleted:
              <ul className="mt-2 mb-2 ml-4 list-disc text-sm">
                {serversToDelete.slice(0, 5).map(s => (
                  <li key={s.id}>{s.hostname || s.ip_address}</li>
                ))}
                {serversToDelete.length > 5 && <li>(and {serversToDelete.length - 5} more...)</li>}
              </ul>
              This action cannot be undone. All related data will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
