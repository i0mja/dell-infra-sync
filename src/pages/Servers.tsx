import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useServers } from "@/hooks/useServers";
import { useServerActions } from "@/hooks/useServerActions";
import { ServerStatsBar } from "@/components/servers/ServerStatsBar";
import { ServerFilterToolbar } from "@/components/servers/ServerFilterToolbar";
import { ServersTable } from "@/components/servers/ServersTable";
import { ServerDetailsSidebar } from "@/components/servers/ServerDetailsSidebar";
import { AddServerDialog } from "@/components/servers/AddServerDialog";
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
import { CreateJobDialog } from "@/components/jobs/CreateJobDialog";
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
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
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
    toast({
      title: "Discovery scan",
      description: "Use Create Job dialog to start a discovery scan",
    });
    setJobDialogOpen(true);
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

      {/* Main: Two Column Layout */}
      <div className="flex-1 overflow-hidden px-4 pb-6 pt-4">
        <div className="grid h-full gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
          {/* Left: Filter + Table */}
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex h-full flex-col rounded-xl border bg-card shadow-sm">
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

          {/* Right: Details Sidebar */}
          <div className="min-h-[320px] rounded-xl border bg-card shadow-sm">
            <ServerDetailsSidebar
              selectedServer={selectedServer}
              selectedGroup={
                selectedGroupData
                  ? {
                      name: selectedGroupData.name,
                      servers: selectedGroupData.servers,
                    }
                  : null
              }
              refreshing={refreshing === selectedServer?.id}
              testing={testing === selectedServer?.id}
              onClose={() => {
                setSelectedServer(null);
                setSelectedGroup(null);
              }}
              onEdit={(server) => {
                setSelectedServer(server);
                setEditDialogOpen(true);
              }}
              onDelete={(server) => {
                setSelectedServer(server);
                setDeleteDialogOpen(true);
              }}
              onTestConnection={handleTestConnection}
              onRefreshInfo={handleRefreshInfo}
              onPowerControl={(server) => {
                setSelectedServer(server);
                setPowerControlDialogOpen(true);
              }}
              onBiosConfig={(server) => {
                setSelectedServer(server);
                setBiosConfigDialogOpen(true);
              }}
              onBootConfig={(server) => {
                setSelectedServer(server);
                setBootConfigDialogOpen(true);
              }}
              onVirtualMedia={(server) => {
                setSelectedServer(server);
                setVirtualMediaDialogOpen(true);
              }}
              onScpBackup={(server) => {
                setSelectedServer(server);
                setScpBackupDialogOpen(true);
              }}
              onViewEventLog={(server) => {
                setSelectedServer(server);
                setEventLogDialogOpen(true);
              }}
              onViewHealth={(server) => {
                setSelectedServer(server);
                setHealthDialogOpen(true);
              }}
              onViewAudit={(server) => {
                setSelectedServer(server);
                setAuditDialogOpen(true);
              }}
              onViewProperties={(server) => {
                setSelectedServer(server);
                setPropertiesDialogOpen(true);
              }}
              onWorkflow={(server) => {
                setSelectedServer(server);
                setUpdateWizardOpen(true);
              }}
              onLinkVCenter={(server) => {
                setSelectedServer(server);
                setLinkDialogOpen(true);
              }}
              onAssignCredentials={(server) => {
                setSelectedServer(server);
                setAssignCredentialsDialogOpen(true);
              }}
              onCreateJob={(server) => {
                setSelectedServer(server);
                setJobDialogOpen(true);
              }}
            />
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <AddServerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
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

          <CreateJobDialog
            open={jobDialogOpen}
            onOpenChange={setJobDialogOpen}
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
