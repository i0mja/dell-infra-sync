import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play } from "lucide-react";

interface CompactStatsBarProps {
  safeDays: number;
  activeJobs: number;
  failedJobs: number;
  nextWindow?: { title: string; start: string };
  optimalCount: number;
  onUpdateWizard: () => void;
}

export function CompactStatsBar({
  safeDays,
  activeJobs,
  failedJobs,
  nextWindow,
  optimalCount,
  onUpdateWizard
}: CompactStatsBarProps) {
  return (
    <div className="border-b bg-card">
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-6">
          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="h-2 w-2 rounded-full bg-success" />
            <span className="text-muted-foreground">Safe Days:</span>
            <span className="font-semibold text-success">{safeDays}</span>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span className="text-muted-foreground">Active:</span>
            <span className="font-semibold">{activeJobs}</span>
          </div>

          {failedJobs > 0 && (
            <>
              <div className="hidden h-4 w-px bg-border sm:block" />
              <div className="flex items-center gap-2 text-sm whitespace-nowrap">
                <span className="h-2 w-2 rounded-full bg-destructive" />
                <span className="text-muted-foreground">Failed:</span>
                <span className="font-semibold text-destructive">{failedJobs}</span>
              </div>
            </>
          )}

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="text-muted-foreground">Next Window:</span>
            {nextWindow ? (
              <span className="font-semibold truncate max-w-[220px]">{nextWindow.title}</span>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="text-muted-foreground">Recommendations:</span>
            <span className="font-semibold">{optimalCount}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button size="sm" onClick={onUpdateWizard}>
            <Play className="mr-2 h-4 w-4" />
            Update Wizard
          </Button>

          <Badge variant="outline" className="gap-2 sm:ml-2 sm:border-l sm:pl-2">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span className="text-xs font-medium tracking-wide">Operations</span>
          </Badge>
        </div>
      </div>
    </div>
  );
}
