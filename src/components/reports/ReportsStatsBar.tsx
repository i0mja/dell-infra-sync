import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { FileBarChart, Download, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface ReportsStatsBarProps {
  activeCategory: string;
  reportCount: number;
  dateRange: { from: Date; to: Date };
  onDateRangeChange: (range: { from: Date; to: Date }) => void;
  onExportAll?: () => void;
}

export function ReportsStatsBar({
  activeCategory,
  reportCount,
  dateRange,
  onDateRangeChange,
  onExportAll,
}: ReportsStatsBarProps) {
  const categoryLabels: Record<string, string> = {
    inventory: "Inventory",
    operations: "Operations",
    compliance: "Compliance",
    maintenance: "Maintenance",
    audit: "Audit",
  };

  const presetRanges = [
    {
      label: "Last 7 days",
      getValue: () => ({
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        to: new Date(),
      }),
    },
    {
      label: "Last 30 days",
      getValue: () => ({
        from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        to: new Date(),
      }),
    },
    {
      label: "Last 90 days",
      getValue: () => ({
        from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        to: new Date(),
      }),
    },
  ];

  return (
    <div className="border-b bg-card">
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-6">
          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <FileBarChart className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Category:</span>
            <span className="font-semibold">{categoryLabels[activeCategory] || activeCategory}</span>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="text-muted-foreground">Reports:</span>
            <span className="font-semibold">{reportCount}</span>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-9 gap-2 text-sm font-normal",
                  !dateRange && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="h-4 w-4" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, "LLL dd, y")} -{" "}
                      {format(dateRange.to, "LLL dd, y")}
                    </>
                  ) : (
                    format(dateRange.from, "LLL dd, y")
                  )
                ) : (
                  <span>Pick a date range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <div className="flex">
                <div className="border-r p-3 space-y-2">
                  <div className="text-sm font-semibold mb-2">Presets</div>
                  {presetRanges.map((preset) => (
                    <Button
                      key={preset.label}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-xs"
                      onClick={() => onDateRangeChange(preset.getValue())}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                <div className="p-3">
                  <Calendar
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={{ from: dateRange?.from, to: dateRange?.to }}
                    onSelect={(range) => {
                      if (range?.from && range?.to) {
                        onDateRangeChange({ from: range.from, to: range.to });
                      }
                    }}
                    numberOfMonths={2}
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {onExportAll && (
            <Button variant="outline" size="sm" onClick={onExportAll}>
              <Download className="mr-2 h-4 w-4" />
              Export All
            </Button>
          )}

          <Badge variant="outline" className="gap-2 sm:ml-2 sm:border-l sm:pl-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-medium tracking-wide">Reports Module</span>
          </Badge>
        </div>
      </div>
    </div>
  );
}
