import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle, Link2, Activity, Users } from "lucide-react";
import { ConnectionStatusBadge } from "./ConnectionStatusBadge";

interface Server {
  id: string;
  ip_address: string;
  hostname: string | null;
  model: string | null;
  service_tag: string | null;
  idrac_firmware: string | null;
  connection_status: 'online' | 'offline' | 'unknown' | null;
  connection_error: string | null;
  credential_test_status: string | null;
  last_connection_test: string | null;
  vcenter_host_id: string | null;
}

interface ServerCardProps {
  server: Server;
  refreshing?: string | null;
  hasActiveHealthCheck: (id: string) => boolean;
  isIncompleteServer: (server: Server) => boolean;
  getServerStatus: (server: Server) => { label: string; variant: any };
  handleLinkToVCenter: (server: Server) => void;
  groupMemberships?: any[];
  showGroups?: boolean;
}

export const ServerCard = ({
  server,
  refreshing,
  hasActiveHealthCheck,
  isIncompleteServer,
  getServerStatus,
  handleLinkToVCenter,
  groupMemberships,
  showGroups = true,
}: ServerCardProps) => {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
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
              {showGroups && groupMemberships
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
                <span className="text-muted-foreground">iDRAC Version:</span>
                <p className="font-medium">{server.idrac_firmware || "N/A"}</p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
