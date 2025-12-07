import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Search, Columns3, Download, Layers } from "lucide-react";

interface NetworksFilterToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  vlanFilter: string;
  onVlanFilterChange: (value: string) => void;
  visibleColumns?: string[];
  onToggleColumn?: (column: string) => void;
  onExport?: () => void;
  selectedCount?: number;
  groupByName?: boolean;
  onGroupByNameChange?: (value: boolean) => void;
}

const allColumns = [
  { id: "name", label: "Name" },
  { id: "type", label: "Type" },
  { id: "vlan", label: "VLAN" },
  { id: "sites", label: "Sites" },
  { id: "switch", label: "Switch" },
  { id: "hosts", label: "Hosts" },
  { id: "vms", label: "VMs" },
];

export function NetworksFilterToolbar({
  searchTerm,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  vlanFilter,
  onVlanFilterChange,
  visibleColumns = [],
  onToggleColumn,
  onExport,
  selectedCount = 0,
  groupByName = false,
  onGroupByNameChange,
}: NetworksFilterToolbarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/30">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search networks..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      {/* Type Filter */}
      <Select value={typeFilter} onValueChange={onTypeFilterChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="distributed">Distributed</SelectItem>
          <SelectItem value="standard">Standard</SelectItem>
        </SelectContent>
      </Select>

      {/* VLAN Filter */}
      <Select value={vlanFilter} onValueChange={onVlanFilterChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="VLAN" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All VLANs</SelectItem>
          <SelectItem value="tagged">Tagged</SelectItem>
          <SelectItem value="untagged">Untagged</SelectItem>
        </SelectContent>
      </Select>

      {/* Group by Name Toggle */}
      {onGroupByNameChange && (
        <div className="flex items-center gap-2 px-2">
          <Switch
            id="group-by-name"
            checked={groupByName}
            onCheckedChange={onGroupByNameChange}
          />
          <Label htmlFor="group-by-name" className="text-sm flex items-center gap-1.5 cursor-pointer">
            <Layers className="h-3.5 w-3.5" />
            Group by name
          </Label>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Selection count */}
      {selectedCount > 0 && (
        <span className="text-sm text-muted-foreground">
          {selectedCount} selected
        </span>
      )}

      {/* Column Visibility */}
      {onToggleColumn && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3 className="h-4 w-4 mr-2" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {allColumns.map((col) => (
              <DropdownMenuCheckboxItem
                key={col.id}
                checked={visibleColumns.includes(col.id)}
                onCheckedChange={() => onToggleColumn(col.id)}
              >
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Export */}
      {onExport && (
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      )}
    </div>
  );
}
