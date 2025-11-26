import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Activity,
  AlertCircle,
  CheckCircle,
  Disc,
  Edit,
  FileJson,
  FileStack,
  FileText,
  HardDrive,
  Link2,
  Power,
  RefreshCw,
  Settings2,
  Shield,
  Trash2,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { format } from "date-fns";

interface Server {
  id: string;
  ip_address: string;
  hostname: string | null;
  model: string | null;
  service_tag: string | null;
  manufacturer: string | null;
  product_name: string | null;
  idrac_firmware: string | null;
  bios_version: string | null;
  redfish_version: string | null;
  cpu_count: number | null;
  memory_gb: number | null;
  manager_mac_address: string | null;
  connection_status: "online" | "offline" | "unknown" | null;
  connection_error: string | null;
  credential_test_status: string | null;
  credential_last_tested: string | null;
  last_connection_test: string | null;
  power_state: string | null;
  overall_health: string | null;
  last_health_check: string | null;
  vcenter_host_id: string | null;
  credential_set_id: string | null;
  last_seen: string | null;
  created_at: string;
  notes: string | null;
}

interface ServerDetailsBannerProps {
  server: Server;
  groupMemberships?: any[];
  vCenterHosts?: any[];
  refreshing: boolean;
  onClose: () => void;
  onEdit: (server: Server) => void;
  onDelete: (server: Server) => void;
  onTestConnection: (server: Server) => void;
  onRefreshInfo: (server: Server) => void;
  onHealthCheck: (server: Server) => void;
  onPowerControl: (server: Server) => void;
  onBiosConfig: (server: Server) => void;
  onBootConfig: (server: Server) => void;
  onVirtualMedia: (server: Server) => void;
  onScpBackup: (server: Server) => void;
  onViewAudit: (server: Server) => void;
  onViewProperties: (server: Server) => void;
  onViewHealth: (server: Server) => void;
  onViewEventLog: (server: Server) => void;
  onLinkVCenter: (server: Server) => void;
  onAssignCredentials: (server: Server) => void;
  onCreateJob: (server: Server) => void;
  onWorkflow: (server: Server) => void;
  onPreFlight: (server: Server) => void;
}

export function ServerDetailsBanner({
  server,
  groupMemberships = [],
  vCenterHosts = [],
  refreshing,
  onClose,
  onEdit,
  onDelete,
  onTestConnection,
  onRefreshInfo,
  onHealthCheck,
  onPowerControl,
  onBiosConfig,
  onBootConfig,
  onVirtualMedia,
  onScpBackup,
  onViewAudit,
  onViewProperties,
  onViewHealth,
  onViewEventLog,
  onLinkVCenter,
  onAssignCredentials,
  onCreateJob,
  onWorkflow,
  onPreFlight,
}: ServerDetailsBannerProps) {
  const vcHost = vCenterHosts?.find((h) => h.server_id === server.id);
  const serverGroups = groupMemberships
    ?.filter((m) => m.server_id === server.id)
    .map((m) => m.server_groups as any) || [];

  const connectionBadge = () => {
    if (server.connection_status === "online") {
      return (
        <Badge variant="default" className="gap-1">
          <span className="text-green-400">●</span> Online
        </Badge>
      );
    }

    if (server.connection_status === "offline") {
      return (
        <Badge variant="destructive" className="gap-1">
          <span>●</span> Offline
        </Badge>
      );
    }

    return (
      <Badge variant="secondary" className="gap-1">
        <span className="text-yellow-400">●</span> Unknown
      </Badge>
    );
  };

  return (
    <div className="w-full rounded-lg border bg-card/80 p-4 shadow-sm transition-all duration-300 ease-in-out animate-in slide-in-from-top-2">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-lg font-semibold">
              {server.hostname || server.ip_address}
            </h4>
            {connectionBadge()}
            {server.last_seen && (
              <Badge variant="outline" className="gap-1 text-xs">
                <HardDrive className="h-3 w-3" />
                {format(new Date(server.last_seen), "MMM d, HH:mm")}
              </Badge>
            )}
            {vcHost && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Link2 className="h-3 w-3" />
                {vcHost.cluster || "Linked"}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>IP: {server.ip_address}</span>
            <Separator orientation="vertical" className="h-4" />
            <span>Service Tag: {server.service_tag || "N/A"}</span>
            <Separator orientation="vertical" className="h-4" />
            <span>iDRAC: {server.idrac_firmware || "N/A"}</span>
          </div>
          {serverGroups.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {serverGroups.map((group: any) => (
                <Badge
                  key={group.id}
                  variant="outline"
                  style={{ borderColor: group.color }}
                  className="gap-1 text-xs"
                >
                  <Users className="h-3 w-3" />
                  {group.name}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => onRefreshInfo(server)}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onEdit(server)}>
            <Edit className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(server)}>
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border bg-muted/40 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Settings2 className="h-4 w-4" /> System
            </div>
            <div className="mt-2 space-y-1 text-sm text-muted-foreground">
              <div>Model: {server.model || "N/A"}</div>
              <div>Product: {server.product_name || "N/A"}</div>
              <div>BIOS: {server.bios_version || "N/A"}</div>
            </div>
          </div>

          <div className="rounded-md border bg-muted/40 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4" /> Health & Power
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-sm text-muted-foreground">
              <Badge variant="outline" className="gap-1 text-xs">
                <Power className="h-3 w-3" />
                {server.power_state || "Unknown"}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {server.overall_health || "Unknown"}
              </Badge>
              {server.last_health_check && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <CalendarIcon />
                  {format(new Date(server.last_health_check), "MMM d, HH:mm")}
                </Badge>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => onPowerControl(server)}>
                <Power className="h-4 w-4 mr-2" /> Power
              </Button>
              <Button variant="outline" size="sm" onClick={() => onHealthCheck(server)}>
                <Activity className="h-4 w-4 mr-2" /> Health
              </Button>
              <Button variant="outline" size="sm" onClick={() => onViewHealth(server)}>
                <StethoscopeIcon /> Status
              </Button>
            </div>
          </div>

          <div className="rounded-md border bg-muted/40 p-3 md:col-span-2">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <Zap className="h-4 w-4" /> Actions
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <Button variant="outline" size="sm" onClick={() => onTestConnection(server)}>
                <Shield className="h-4 w-4 mr-2" /> Test Credentials
              </Button>
              <Button variant="outline" size="sm" onClick={() => onLinkVCenter(server)}>
                <Link2 className="h-4 w-4 mr-2" /> vCenter Link
              </Button>
              <Button variant="outline" size="sm" onClick={() => onAssignCredentials(server)}>
                <Shield className="h-4 w-4 mr-2" /> Credentials
              </Button>
              <Button variant="outline" size="sm" onClick={() => onBootConfig(server)}>
                <HardDrive className="h-4 w-4 mr-2" /> Boot
              </Button>
              <Button variant="outline" size="sm" onClick={() => onBiosConfig(server)}>
                <Settings2 className="h-4 w-4 mr-2" /> BIOS
              </Button>
              <Button variant="outline" size="sm" onClick={() => onVirtualMedia(server)}>
                <Disc className="h-4 w-4 mr-2" /> Virtual Media
              </Button>
              <Button variant="outline" size="sm" onClick={() => onScpBackup(server)}>
                <FileJson className="h-4 w-4 mr-2" /> SCP Backup
              </Button>
              <Button variant="outline" size="sm" onClick={() => onViewEventLog(server)}>
                <FileText className="h-4 w-4 mr-2" /> Event Logs
              </Button>
              <Button variant="outline" size="sm" onClick={() => onViewAudit(server)}>
                <FileStack className="h-4 w-4 mr-2" /> Audit Trail
              </Button>
              <Button variant="outline" size="sm" onClick={() => onViewProperties(server)}>
                <Wrench className="h-4 w-4 mr-2" /> Properties
              </Button>
              <Button variant="outline" size="sm" onClick={() => onWorkflow(server)}>
                <Activity className="h-4 w-4 mr-2" /> Workflow
              </Button>
              <Button variant="outline" size="sm" onClick={() => onCreateJob(server)}>
                <FolderIcon /> Firmware Job
              </Button>
              <Button variant="outline" size="sm" onClick={() => onPreFlight(server)}>
                <CheckCircle className="h-4 w-4 mr-2" /> Pre-Flight
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-md border bg-muted/40 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4" /> Credential Status
          </div>
          <div className="text-sm text-muted-foreground">
            {server.credential_set_id ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {server.credential_test_status === "success" && (
                    <Badge variant="default" className="gap-1">
                      <CheckCircle className="h-3 w-3" /> Valid
                    </Badge>
                  )}
                  {server.credential_test_status === "failed" && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertCircle className="h-3 w-3" /> Failed
                    </Badge>
                  )}
                  {!server.credential_test_status && <Badge variant="secondary">Not tested</Badge>}
                </div>
                {server.credential_last_tested && (
                  <div className="text-xs">
                    Last tested {format(new Date(server.credential_last_tested), "MMM d, HH:mm")}
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onAssignCredentials(server)}
                >
                  <Shield className="h-4 w-4 mr-2" />
                  Manage Credentials
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div>No credentials assigned.</div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onAssignCredentials(server)}
                >
                  <Shield className="h-4 w-4 mr-2" />
                  Assign Credentials
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CalendarIcon() {
  return <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>;
}

function StethoscopeIcon() {
  return <StethoscopeSvg />;
}

function StethoscopeSvg() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4v4" />
      <path d="M18 4v4" />
      <path d="M4 8h4" />
      <path d="M16 8h4" />
      <path d="M12 12a4 4 0 0 1-4-4V4h8v4a4 4 0 0 1-4 4Z" />
      <path d="M12 12v4" />
      <path d="M12 16a4 4 0 1 0 4 4v-5" />
      <circle cx="20" cy="16" r="2" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h5l2 2h11v9a2 2 0 0 1-2 2H3Z" />
      <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
