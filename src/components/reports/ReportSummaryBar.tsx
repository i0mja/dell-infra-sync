import { Separator } from "@/components/ui/separator";

interface ReportSummaryBarProps {
  summary: Record<string, any> | undefined;
  isLoading?: boolean;
}

export function ReportSummaryBar({ summary, isLoading }: ReportSummaryBarProps) {
  if (isLoading || !summary) {
    return (
      <div className="flex items-center gap-4 px-4 py-2 text-sm text-muted-foreground border-b bg-muted/30">
        <span className="animate-pulse">Loading summary...</span>
      </div>
    );
  }

  const entries = Object.entries(summary);
  
  if (entries.length === 0) {
    return null;
  }

  const formatLabel = (key: string) => {
    return key
      .replace(/([A-Z])/g, " $1")
      .replace(/_/g, " ")
      .trim()
      .replace(/^\w/, (c) => c.toUpperCase());
  };

  const formatValue = (value: any) => {
    if (typeof value === "number") {
      return value.toLocaleString();
    }
    return String(value);
  };

  return (
    <div className="flex items-center gap-4 px-4 py-2 text-sm border-b bg-muted/30">
      {entries.map(([key, value], index) => (
        <div key={key} className="flex items-center gap-4">
          <span>
            <span className="font-medium">{formatValue(value)}</span>
            <span className="text-muted-foreground ml-1">{formatLabel(key)}</span>
          </span>
          {index < entries.length - 1 && (
            <Separator orientation="vertical" className="h-4" />
          )}
        </div>
      ))}
    </div>
  );
}
