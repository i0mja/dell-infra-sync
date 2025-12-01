import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useServers } from "@/hooks/useServers";
import { launchConsole } from "@/lib/job-executor-api";
import { useServerActions } from "@/hooks/useServerActions";
import { useAutoLinkVCenter } from "@/hooks/useAutoLinkVCenter";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { Server } from "@/hooks/useServers";

export default function Servers() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
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
  const [bulkUpdateServerIds, setBulkUpdateServerIds] = useState<string[]>([]);
  const [launchingConsole, setLaunchingConsole] = useState(false);

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

      toast({
        title: "Bulk Refresh Started",
        description: `Refreshing information for ${serverIds.length} server(s). Check Jobs panel for progress.`,
      });

      // Navigate to dashboard to view job progress
      navigate("/");
    } catch (error: any) {
      toast({
        title: "Failed to Start Bulk Refresh",
        description: error.message || "An error occurred",
        variant: "destructive",
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
    setLaunchingConsole(true);
    try {
      const result = await launchConsole(server.id);
      
      if (result.success && result.console_url) {
        window.open(result.console_url, '_blank');
        
        if (result.requires_login) {
          toast({
            title: "Console Opened",
            description: "Please log in manually in the new tab (iDRAC8)"
          });
        } else {
          toast({
            title: "Console Launched",
            description: "iDRAC console opened in new tab"
          });
        }
      } else {
        throw new Error(result.error || "Failed to get console URL");
      }
    } catch (error: any) {
      toast({
        title: "Failed to Launch Console",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLaunchingConsole(false);
    }
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
        </>
      )}

      <ClusterUpdateWizard
        open={updateWizardOpen}
        onOpenChange={(open) => {
          setUpdateWizardOpen(open);
          if (!open) setBulkUpdateServerIds([]);
        }}
        preSelectedTarget={{
          type: 'servers',
          ids: bulkUpdateServerIds.length > 0 
            ? bulkUpdateServerIds 
            : (selectedServer ? [selectedServer.id] : [])
        }}
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
