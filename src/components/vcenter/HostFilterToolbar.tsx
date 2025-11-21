import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

interface HostFilterToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  clusterFilter: string;
  onClusterFilterChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  linkFilter: string;
  onLinkFilterChange: (value: string) => void;
  clusters: string[];
}

export function HostFilterToolbar({
  searchTerm,
  onSearchChange,
  clusterFilter,
  onClusterFilterChange,
  statusFilter,
  onStatusFilterChange,
  linkFilter,
  onLinkFilterChange,
  clusters,
}: HostFilterToolbarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/50">
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search hosts, clusters, serial numbers..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      <Select value={clusterFilter} onValueChange={onClusterFilterChange}>
        <SelectTrigger className="w-[180px] h-9">
          <SelectValue placeholder="All Clusters" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Clusters</SelectItem>
          {clusters.map((cluster) => (
            <SelectItem key={cluster} value={cluster}>
              {cluster}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={statusFilter} onValueChange={onStatusFilterChange}>
        <SelectTrigger className="w-[150px] h-9">
          <SelectValue placeholder="All Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="connected">Connected</SelectItem>
          <SelectItem value="disconnected">Disconnected</SelectItem>
          <SelectItem value="maintenance">Maintenance</SelectItem>
        </SelectContent>
      </Select>

      <Select value={linkFilter} onValueChange={onLinkFilterChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="All Links" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Links</SelectItem>
          <SelectItem value="linked">Linked</SelectItem>
          <SelectItem value="unlinked">Unlinked</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
