import { Calendar, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { subDays, subMonths, startOfMonth, endOfMonth } from "date-fns";

interface ReportFiltersProps {
  onDateRangeChange: (range: { start: Date; end: Date }) => void;
  onExport: () => void;
  isExporting?: boolean;
}

export function ReportFilters({ onDateRangeChange, onExport, isExporting }: ReportFiltersProps) {
  const handlePresetChange = (value: string) => {
    const now = new Date();
    let range: { start: Date; end: Date };

    switch (value) {
      case "7d":
        range = { start: subDays(now, 7), end: now };
        break;
      case "30d":
        range = { start: subDays(now, 30), end: now };
        break;
      case "90d":
        range = { start: subDays(now, 90), end: now };
        break;
      case "this_month":
        range = { start: startOfMonth(now), end: endOfMonth(now) };
        break;
      case "last_month":
        const lastMonth = subMonths(now, 1);
        range = { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
        break;
      case "all":
      default:
        range = { start: subDays(now, 365), end: now };
        break;
    }

    onDateRangeChange(range);
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <Select defaultValue="30d" onValueChange={handlePresetChange}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Date Range" />
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
      </div>

      <Button onClick={onExport} disabled={isExporting} variant="outline" size="sm">
        <Download className="h-4 w-4 mr-2" />
        {isExporting ? "Exporting..." : "Export CSV"}
      </Button>
    </div>
  );
}
