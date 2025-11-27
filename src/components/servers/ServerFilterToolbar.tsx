import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Search, MoreHorizontal, Link2, Loader2 } from "lucide-react";

interface ServerFilterToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  groupFilter: string;
  onGroupFilterChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  groups: Array<{ id: string; name: string }>;
  vCenterClusters: string[];
  onBulkAutoLink?: () => void;
  bulkLinking?: boolean;
}

export function ServerFilterToolbar({
  searchTerm,
  onSearchChange,
  groupFilter,
  onGroupFilterChange,
  statusFilter,
  onStatusFilterChange,
  groups = [],
  vCenterClusters = [],
  onBulkAutoLink,
  bulkLinking = false,
}: ServerFilterToolbarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-card border rounded-lg">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search servers by hostname, IP, service tag..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>

      <Select value={groupFilter} onValueChange={onGroupFilterChange}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="All Groups" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Groups</SelectItem>
          <SelectItem value="ungrouped">Ungrouped</SelectItem>
          {groups.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {group.name}
            </SelectItem>
          ))}
          {vCenterClusters.map((cluster) => (
            <SelectItem key={`cluster-${cluster}`} value={`cluster:${cluster}`}>
              🖥 {cluster} (vCenter)
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={statusFilter} onValueChange={onStatusFilterChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="online">✓ Online</SelectItem>
          <SelectItem value="offline">⚠ Offline</SelectItem>
          <SelectItem value="unknown">? Unknown</SelectItem>
          <SelectItem value="incomplete">⚠ Incomplete Data</SelectItem>
        </SelectContent>
      </Select>

      {onBulkAutoLink && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={bulkLinking}>
              {bulkLinking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreHorizontal className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onBulkAutoLink} disabled={bulkLinking}>
              <Link2 className="h-4 w-4 mr-2" />
              Auto-Link All to vCenter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
