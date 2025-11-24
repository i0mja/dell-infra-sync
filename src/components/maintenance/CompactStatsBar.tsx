import { Button } from "@/components/ui/button";
import { Calendar, Plus, CheckCircle2, Activity, Clock3, Lightbulb } from "lucide-react";

interface CompactStatsBarProps {
  safeDays: number;
  activeJobs: number;
  nextWindow?: { title: string; start: string };
  optimalCount: number;
  onScheduleMaintenance: () => void;
  onCreateJob: () => void;
}

export function CompactStatsBar({
  safeDays,
  activeJobs,
  nextWindow,
  optimalCount,
  onScheduleMaintenance,
  onCreateJob
}: CompactStatsBarProps) {
  return (
    <div className="border-b bg-card">
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-sm sm:gap-6">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span className="text-muted-foreground">Safe Days:</span>
            <span className="font-semibold">{safeDays}</span>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 whitespace-nowrap">
            <Activity className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">Active Jobs:</span>
            <span className="font-semibold">{activeJobs}</span>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 whitespace-nowrap">
            <Clock3 className="h-4 w-4 text-warning" />
            <span className="text-muted-foreground">Next Window:</span>
            {nextWindow ? (
              <span className="font-semibold truncate max-w-[220px]">{nextWindow.title}</span>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 whitespace-nowrap">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <span className="text-muted-foreground">Recommendations:</span>
            <span className="font-semibold">{optimalCount}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button size="sm" onClick={onScheduleMaintenance}>
            <Calendar className="mr-2 h-4 w-4" />
            Schedule maintenance
          </Button>
          <Button size="sm" variant="outline" onClick={onCreateJob}>
            <Plus className="mr-2 h-4 w-4" />
            Create job
          </Button>
        </div>
      </div>
    </div>
  );
}
