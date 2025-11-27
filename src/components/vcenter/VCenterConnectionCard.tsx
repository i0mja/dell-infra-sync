import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, TestTube, RefreshCw, Edit, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { VCenter } from "@/hooks/useVCenters";

interface VCenterConnectionCardProps {
  vcenter: VCenter;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  onSync: () => void;
}

export function VCenterConnectionCard({
  vcenter,
  onEdit,
  onDelete,
  onTest,
  onSync,
}: VCenterConnectionCardProps) {
  const getStatusBadge = () => {
    if (!vcenter.last_sync_status) {
      return <Badge variant="secondary">Never Synced</Badge>;
    }

    switch (vcenter.last_sync_status) {
      case "success":
        return <Badge variant="default">Connected</Badge>;
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      case "partial":
        return <Badge variant="outline" className="text-warning">Partial</Badge>;
      default:
        return <Badge variant="secondary">{vcenter.last_sync_status}</Badge>;
    }
  };

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: vcenter.color || "#6366f1" }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold truncate">{vcenter.name}</span>
              {vcenter.is_primary && (
                <Badge variant="outline" className="text-xs">Primary</Badge>
              )}
            </div>
            <div className="text-sm text-muted-foreground truncate">
              {vcenter.host}
              {vcenter.datacenter_location && ` • ${vcenter.datacenter_location}`}
            </div>
            {vcenter.last_sync && (
              <div className="text-xs text-muted-foreground">
                Last sync: {formatDistanceToNow(new Date(vcenter.last_sync), { addSuffix: true })}
              </div>
            )}
            {vcenter.last_sync_error && (
              <div className="text-xs text-destructive mt-1 truncate">
                Error: {vcenter.last_sync_error}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
          {getStatusBadge()}

          <Button size="sm" variant="ghost" onClick={onTest}>
            <TestTube className="h-4 w-4" />
          </Button>

          <Button size="sm" variant="ghost" onClick={onSync}>
            <RefreshCw className="h-4 w-4" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </Card>
  );
}
