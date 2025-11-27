import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useServers } from "@/hooks/useServers";
import { useServerActions } from "@/hooks/useServerActions";
import { ServerStatsBar } from "@/components/servers/ServerStatsBar";
import { ServerFilterToolbar } from "@/components/servers/ServerFilterToolbar";
import { ServersTable } from "@/components/servers/ServersTable";
import { ServerDetailDialog } from "@/components/servers/ServerDetailDialog";
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
import { ServerUpdateWizard } from "@/components/jobs/ServerUpdateWizard";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { Server } from "@/hooks/useServers";

export default function Servers() {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Search and filter state
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

  // Detect local mode
  const isLocalMode =
    import.meta.env.VITE_SUPABASE_URL?.includes("127.0.0.1") ||
    import.meta.env.VITE_SUPABASE_URL?.includes("localhost");

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
      />

      {/* Main: Full-Width Table */}
      <div className="flex-1 overflow-hidden px-4 pb-6 pt-4">
        <div className="flex h-full flex-col rounded-xl border bg-card shadow-sm">
          {/* Filter toolbar header */}
          <div className="border-b p-4">
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
          </div>
          
          {/* Full-width table */}
          <div className="flex-1 overflow-hidden p-2 sm:p-4">
            <ServersTable
              servers={filteredServers}
              groupedData={groupedData}
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
              loading={false}
              refreshing={refreshing}
              healthCheckServer={null}
              hasActiveHealthCheck={() => false}
              isIncomplete={() => false}
              groupMemberships={groupMemberships || []}
              vCenterHosts={vCenterHosts || []}
              renderExpandedRow={() => null}
            />
          </div>
        </div>
      </div>

      {/* Server Detail Dialog/Sheet */}
      <ServerDetailDialog
        open={!!selectedServer}
        onOpenChange={(open) => {
          if (!open) setSelectedServer(null);
        }}
        server={selectedServer}
        onRefresh={() => {
          if (selectedServer) {
            handleRefreshInfo(selectedServer);
          }
        }}
        onPowerControl={() => {
          setPowerControlDialogOpen(true);
        }}
        onBiosConfig={() => {
          setBiosConfigDialogOpen(true);
        }}
        onBootConfig={() => {
          setBootConfigDialogOpen(true);
        }}
        onScpBackup={() => {
          setScpBackupDialogOpen(true);
        }}
        onVirtualMedia={() => {
          setVirtualMediaDialogOpen(true);
        }}
        onEventLog={() => {
          setEventLogDialogOpen(true);
        }}
        onHealthCheck={() => {
          setHealthDialogOpen(true);
        }}
        onLinkVCenter={() => {
          setLinkDialogOpen(true);
        }}
        onAudit={() => {
          setAuditDialogOpen(true);
        }}
      />

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

          <ServerUpdateWizard
            open={updateWizardOpen}
            onOpenChange={setUpdateWizardOpen}
            preSelectedTarget={{
              type: 'servers',
              ids: [selectedServer.id]
            }}
          />
        </>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Server</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              {selectedServer?.hostname || selectedServer?.ip_address}? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
