import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

interface ClustersFilterToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  haFilter: string;
  onHaFilterChange: (value: string) => void;
  drsFilter: string;
  onDrsFilterChange: (value: string) => void;
}

export function ClustersFilterToolbar({
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  haFilter,
  onHaFilterChange,
  drsFilter,
  onDrsFilterChange,
}: ClustersFilterToolbarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/30">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search clusters..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      <Select value={statusFilter} onValueChange={onStatusFilterChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="green">Green</SelectItem>
          <SelectItem value="yellow">Yellow</SelectItem>
          <SelectItem value="red">Red</SelectItem>
        </SelectContent>
      </Select>

      <Select value={haFilter} onValueChange={onHaFilterChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="HA Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All HA</SelectItem>
          <SelectItem value="enabled">HA Enabled</SelectItem>
          <SelectItem value="disabled">HA Disabled</SelectItem>
        </SelectContent>
      </Select>

      <Select value={drsFilter} onValueChange={onDrsFilterChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="DRS Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All DRS</SelectItem>
          <SelectItem value="enabled">DRS Enabled</SelectItem>
          <SelectItem value="disabled">DRS Disabled</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
