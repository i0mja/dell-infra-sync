import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Search, Columns3, Download } from "lucide-react";
import { ReportConfig, ReportType } from "@/config/reports-config";

interface ReportsFilterToolbarProps {
  reportTypes: ReportConfig[];
  selectedReportType: ReportType | null;
  onReportTypeChange: (value: ReportType) => void;
  dateRange: string;
  onDateRangeChange: (value: string) => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  visibleColumns: string[];
  allColumns: { key: string; label: string }[];
  onToggleColumn: (column: string) => void;
  onExport: () => void;
  isExporting?: boolean;
}

export function ReportsFilterToolbar({
  reportTypes,
  selectedReportType,
  onReportTypeChange,
  dateRange,
  onDateRangeChange,
  searchTerm,
  onSearchChange,
  visibleColumns,
  allColumns,
  onToggleColumn,
  onExport,
  isExporting = false,
}: ReportsFilterToolbarProps) {
  const isColumnVisible = (key: string) => visibleColumns.includes(key);

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/50">
      <Select 
        value={selectedReportType || ""} 
        onValueChange={(value) => onReportTypeChange(value as ReportType)}
      >
        <SelectTrigger className="w-[200px] h-9">
          <SelectValue placeholder="Select Report" />
        </SelectTrigger>
        <SelectContent>
          {reportTypes.map((report) => (
            <SelectItem key={report.id} value={report.id}>
              {report.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      <Select value={dateRange} onValueChange={onDateRangeChange}>
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Time Range" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="7d">Last 7 Days</SelectItem>
          <SelectItem value="30d">Last 30 Days</SelectItem>
          <SelectItem value="90d">Last 90 Days</SelectItem>
          <SelectItem value="this_month">This Month</SelectItem>
          <SelectItem value="last_month">Last Month</SelectItem>
          <SelectItem value="all">All Time</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex-1" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Columns3 className="mr-1 h-4 w-4" /> Columns
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {allColumns.map((col) => (
            <DropdownMenuCheckboxItem
              key={col.key}
              checked={isColumnVisible(col.key)}
              onCheckedChange={() => onToggleColumn(col.key)}
            >
              {col.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="outline" size="sm" onClick={onExport} disabled={isExporting}>
        <Download className="mr-1 h-4 w-4" /> Export
      </Button>
    </div>
  );
}
