import { Link, Key, Clock, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import type { Server } from "@/hooks/useServers";
import { CollapsibleSection } from "./CollapsibleSection";

interface ServerConnectivityProps {
  server: Server;
  onAssignCredentials?: () => void;
  onLinkVCenter?: () => void;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value || "—"}</span>
    </div>
  );
}

export function ServerConnectivity({ 
  server, 
  onAssignCredentials,
  onLinkVCenter 
}: ServerConnectivityProps) {
  const lastSeenText = server.last_seen
    ? formatDistanceToNow(new Date(server.last_seen), { addSuffix: true })
    : "Never";

  return (
    <CollapsibleSection icon={Link} title="Connectivity" defaultOpen={true}>
      <div className="space-y-2">
        <InfoRow 
          label="Credentials" 
          value={
            <Badge 
              variant={server.credential_set_id ? "secondary" : "outline"}
              className="text-[10px] px-1.5 py-0 h-4"
            >
              {server.credential_set_id ? "Assigned" : "None"}
            </Badge>
          } 
        />
        <InfoRow 
          label="Last Seen" 
          value={
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              {lastSeenText}
            </span>
          } 
        />
        {server.vcenter_host_id && (
          <InfoRow 
            label="vCenter Link" 
            value={
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                Linked
              </Badge>
            } 
          />
        )}
        
        {/* Quick actions for connectivity */}
        <div className="flex gap-2 pt-2">
          {!server.credential_set_id && onAssignCredentials && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={onAssignCredentials}
            >
              <Key className="h-3 w-3 mr-1" />
              Assign
            </Button>
          )}
          {!server.vcenter_host_id && onLinkVCenter && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={onLinkVCenter}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Link vCenter
            </Button>
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
}
