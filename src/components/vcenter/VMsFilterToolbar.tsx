import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

interface VMsFilterToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  clusterFilter: string;
  onClusterFilterChange: (value: string) => void;
  powerFilter: string;
  onPowerFilterChange: (value: string) => void;
  toolsFilter: string;
  onToolsFilterChange: (value: string) => void;
  osFilter: string;
  onOsFilterChange: (value: string) => void;
  clusters: string[];
}

export function VMsFilterToolbar({
  searchTerm,
  onSearchChange,
  clusterFilter,
  onClusterFilterChange,
  powerFilter,
  onPowerFilterChange,
  toolsFilter,
  onToolsFilterChange,
  osFilter,
  onOsFilterChange,
  clusters,
}: VMsFilterToolbarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/30">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search VMs..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      <Select value={clusterFilter} onValueChange={onClusterFilterChange}>
        <SelectTrigger className="w-[160px] h-9">
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

      <Select value={powerFilter} onValueChange={onPowerFilterChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Power State" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Power States</SelectItem>
          <SelectItem value="poweredon">Powered On</SelectItem>
          <SelectItem value="poweredoff">Powered Off</SelectItem>
          <SelectItem value="suspended">Suspended</SelectItem>
        </SelectContent>
      </Select>

      <Select value={toolsFilter} onValueChange={onToolsFilterChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Tools Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Tools</SelectItem>
          <SelectItem value="toolsok">Tools OK</SelectItem>
          <SelectItem value="toolsold">Tools Old</SelectItem>
          <SelectItem value="toolsnotinstalled">Not Installed</SelectItem>
          <SelectItem value="toolsnotrunning">Not Running</SelectItem>
        </SelectContent>
      </Select>

      <Select value={osFilter} onValueChange={onOsFilterChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="OS Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All OS Types</SelectItem>
          <SelectItem value="windows">Windows</SelectItem>
          <SelectItem value="rhel">RHEL/CentOS</SelectItem>
          <SelectItem value="ubuntu">Ubuntu</SelectItem>
          <SelectItem value="debian">Debian</SelectItem>
          <SelectItem value="linux">Other Linux</SelectItem>
          <SelectItem value="other">Other</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
