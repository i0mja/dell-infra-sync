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
import { 
  NETWORK_COLUMNS, 
  NETWORK_TYPE_FILTERS, 
  ACCESSIBLE_FILTERS, 
  HAS_VMS_FILTERS 
} from "@/lib/vcenter-column-definitions";

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
  accessibleFilter?: string;
  onAccessibleFilterChange?: (value: string) => void;
  hasVmsFilter?: string;
  onHasVmsFilterChange?: (value: string) => void;
}

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
  accessibleFilter = "all",
  onAccessibleFilterChange,
  hasVmsFilter = "all",
  onHasVmsFilterChange,
}: NetworksFilterToolbarProps) {
  // Get columns appropriate for current view mode
  const availableColumns = NETWORK_COLUMNS.filter(col => {
    // In grouped mode, hide 'switch' column; in flat mode, hide 'sites' column
    if (groupByName && col.key === 'switch') return false;
    if (!groupByName && col.key === 'sites') return false;
    return true;
  });

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b bg-muted/30 flex-wrap">
      {/* Search */}
      <div className="relative flex-1 min-w-[140px] max-w-[160px]">
        <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search networks..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-8 h-7 text-xs"
        />
      </div>

      {/* Type Filter */}
      <Select value={typeFilter} onValueChange={onTypeFilterChange}>
        <SelectTrigger className="w-[100px] h-7 text-xs">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          {NETWORK_TYPE_FILTERS.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* VLAN Filter */}
      <Select value={vlanFilter} onValueChange={onVlanFilterChange}>
        <SelectTrigger className="w-[90px] h-7 text-xs">
          <SelectValue placeholder="VLAN" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All VLANs</SelectItem>
          <SelectItem value="tagged">Tagged</SelectItem>
          <SelectItem value="untagged">Untagged</SelectItem>
        </SelectContent>
      </Select>

      {/* Accessible Filter */}
      {onAccessibleFilterChange && (
        <Select value={accessibleFilter} onValueChange={onAccessibleFilterChange}>
          <SelectTrigger className="w-[100px] h-7 text-xs">
            <SelectValue placeholder="Access" />
          </SelectTrigger>
          <SelectContent>
            {ACCESSIBLE_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Has VMs Filter */}
      {onHasVmsFilterChange && (
        <Select value={hasVmsFilter} onValueChange={onHasVmsFilterChange}>
          <SelectTrigger className="w-[90px] h-7 text-xs">
            <SelectValue placeholder="VMs" />
          </SelectTrigger>
          <SelectContent>
            {HAS_VMS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Group by Name Toggle */}
      {onGroupByNameChange && (
        <div className="flex items-center gap-1.5 px-1">
          <Switch
            id="group-by-name"
            checked={groupByName}
            onCheckedChange={onGroupByNameChange}
            className="scale-75"
          />
          <Label htmlFor="group-by-name" className="text-xs flex items-center gap-1 cursor-pointer">
            <Layers className="h-3 w-3" />
            Group
          </Label>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Selection count */}
      {selectedCount > 0 && (
        <span className="text-xs text-muted-foreground">
          {selectedCount} sel
        </span>
      )}

      {/* Column Visibility */}
      {onToggleColumn && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0">
              <Columns3 className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {availableColumns.map((col) => (
              <DropdownMenuCheckboxItem
                key={col.key}
                checked={visibleColumns.includes(col.key)}
                onCheckedChange={() => onToggleColumn(col.key)}
              >
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Export */}
      {onExport && (
        <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={onExport}>
          <Download className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
