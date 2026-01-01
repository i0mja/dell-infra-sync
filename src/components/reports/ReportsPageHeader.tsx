import { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ReportsPageHeaderProps {
  icon: LucideIcon;
  title: string;
  description: string;
  recordCount?: number;
}

export function ReportsPageHeader({ icon: Icon, title, description, recordCount }: ReportsPageHeaderProps) {
  return (
    <div className="border-b bg-card/50 px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {recordCount !== undefined && recordCount > 0 && (
          <Badge variant="secondary">{recordCount} records</Badge>
        )}
      </div>
    </div>
  );
}
