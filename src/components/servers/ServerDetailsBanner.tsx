import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  MoreHorizontal,
  Power,
  RefreshCw,
  Settings2,
  Shield,
  Trash2,
  Users,
  Wrench,
  X,
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
    <Card className="w-full border bg-card/90 shadow-sm transition-all duration-300 ease-in-out animate-in slide-in-from-top-2">
      <CardContent className="p-4 space-y-4">
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
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                <span>{server.ip_address}</span>
              </div>
              <Separator orientation="vertical" className="h-5" />
              <span>Service Tag {server.service_tag || "N/A"}</span>
              <Separator orientation="vertical" className="h-5" />
              <span>iDRAC {server.idrac_firmware || "N/A"}</span>
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
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => onRefreshInfo(server)}>
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => onHealthCheck(server)}>
              <Activity className="h-4 w-4 mr-2" /> Health Check
            </Button>
            <Button variant="outline" size="sm" onClick={() => onPowerControl(server)}>
              <Power className="h-4 w-4 mr-2" /> Power
            </Button>
            <Button variant="outline" size="sm" onClick={() => onTestConnection(server)}>
              <Shield className="h-4 w-4 mr-2" /> Credentials
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More server actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Connectivity</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onLinkVCenter(server)}>
                  <Link2 className="mr-2 h-4 w-4" /> Link vCenter
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAssignCredentials(server)}>
                  <Shield className="mr-2 h-4 w-4" /> Manage credentials
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Configuration</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onBootConfig(server)}>
                  <HardDrive className="mr-2 h-4 w-4" /> Boot config
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onBiosConfig(server)}>
                  <Settings2 className="mr-2 h-4 w-4" /> BIOS config
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onVirtualMedia(server)}>
                  <Disc className="mr-2 h-4 w-4" /> Virtual media
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onScpBackup(server)}>
                  <FileJson className="mr-2 h-4 w-4" /> SCP backup
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Logs & tasks</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onViewEventLog(server)}>
                  <FileText className="mr-2 h-4 w-4" /> Event logs
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onViewAudit(server)}>
                  <FileStack className="mr-2 h-4 w-4" /> Audit trail
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onViewProperties(server)}>
                  <Wrench className="mr-2 h-4 w-4" /> Properties
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onWorkflow(server)}>
                  <Activity className="mr-2 h-4 w-4" /> Workflow
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onCreateJob(server)}>
                  <FolderIcon /> Firmware job
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onPreFlight(server)}>
                  <CheckCircle className="mr-2 h-4 w-4" /> Pre-flight
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => onEdit(server)} aria-label="Edit server">
                <Edit className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => onDelete(server)} aria-label="Delete server">
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close details">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border bg-muted/40 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Settings2 className="h-4 w-4" /> Platform
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-2 text-sm text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Model</span>
                  <span className="font-medium text-foreground">{server.model || "N/A"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Product</span>
                  <span className="font-medium text-foreground">{server.product_name || "N/A"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>BIOS</span>
                  <span className="font-medium text-foreground">{server.bios_version || "N/A"}</span>
                </div>
              </dl>
            </div>

            <div className="rounded-md border bg-muted/40 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Activity className="h-4 w-4" /> Health & Power
              </div>
              <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                <Badge variant="outline" className="justify-start gap-2 text-xs">
                  <Power className="h-3 w-3" />
                  {server.power_state || "Unknown"}
                </Badge>
                <Badge variant="outline" className="justify-start gap-2 text-xs">
                  <StethoscopeIcon />
                  {server.overall_health || "Unknown"}
                </Badge>
              </div>
              {server.last_health_check && (
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarIcon /> Last health check {format(new Date(server.last_health_check), "MMM d, HH:mm")}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => onViewHealth(server)}>
                  <StethoscopeIcon />
                  <span className="ml-2">Open status</span>
                </Button>
              </div>
            </div>

            <div className="rounded-md border bg-muted/40 p-3 md:col-span-2 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Shield className="h-4 w-4" /> Credentials
              </div>
              <div className="space-y-2 text-sm text-muted-foreground">
                {server.credential_set_id ? (
                  <div className="flex flex-wrap items-center gap-2">
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
                    {server.credential_last_tested && (
                      <span className="text-xs">
                        Tested {format(new Date(server.credential_last_tested), "MMM d, HH:mm")}
                      </span>
                    )}
                  </div>
                ) : (
                  <div>No credentials assigned.</div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => onAssignCredentials(server)}>
                  <Shield className="h-4 w-4 mr-2" />
                  {server.credential_set_id ? "Manage credentials" : "Assign credentials"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => onLinkVCenter(server)}>
                  <Link2 className="h-4 w-4 mr-2" /> vCenter link
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-md border bg-muted/40 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 text-sm font-semibold">
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4" /> Logs & Jobs
              </span>
            </div>
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Event logs</span>
                <Button variant="ghost" size="sm" onClick={() => onViewEventLog(server)}>
                  <FileText className="h-4 w-4 mr-2" />Open
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <span>Audit trail</span>
                <Button variant="ghost" size="sm" onClick={() => onViewAudit(server)}>
                  <FileStack className="h-4 w-4 mr-2" />Open
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <span>Properties</span>
                <Button variant="ghost" size="sm" onClick={() => onViewProperties(server)}>
                  <Wrench className="h-4 w-4 mr-2" />Open
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <span>Workflow</span>
                <Button variant="ghost" size="sm" onClick={() => onWorkflow(server)}>
                  <Activity className="h-4 w-4 mr-2" />Open
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <span>Firmware job</span>
                <Button variant="ghost" size="sm" onClick={() => onCreateJob(server)}>
                  <FolderIcon />Create
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <span>Pre-flight</span>
                <Button variant="ghost" size="sm" onClick={() => onPreFlight(server)}>
                  <CheckCircle className="h-4 w-4 mr-2" />Run
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
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
