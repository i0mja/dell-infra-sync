import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

interface DatastoresFilterToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  accessFilter: string;
  onAccessFilterChange: (value: string) => void;
  capacityFilter: string;
  onCapacityFilterChange: (value: string) => void;
}

export function DatastoresFilterToolbar({
  searchTerm,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  accessFilter,
  onAccessFilterChange,
  capacityFilter,
  onCapacityFilterChange,
}: DatastoresFilterToolbarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/30">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search datastores..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      <Select value={typeFilter} onValueChange={onTypeFilterChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="vmfs">VMFS</SelectItem>
          <SelectItem value="nfs">NFS</SelectItem>
          <SelectItem value="vsan">vSAN</SelectItem>
          <SelectItem value="vvol">vVol</SelectItem>
        </SelectContent>
      </Select>

      <Select value={accessFilter} onValueChange={onAccessFilterChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Accessible" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="accessible">Accessible</SelectItem>
          <SelectItem value="not-accessible">Not Accessible</SelectItem>
        </SelectContent>
      </Select>

      <Select value={capacityFilter} onValueChange={onCapacityFilterChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Capacity" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Capacities</SelectItem>
          <SelectItem value="critical">&gt;90% Full</SelectItem>
          <SelectItem value="warning">&gt;75% Full</SelectItem>
          <SelectItem value="healthy">&lt;75% Full</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
