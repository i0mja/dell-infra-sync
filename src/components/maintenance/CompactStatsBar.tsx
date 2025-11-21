import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Plus, CheckCircle, Activity, Clock, Lightbulb } from "lucide-react";

interface CompactStatsBarProps {
  safeDays: number;
  activeJobs: number;
  nextWindow?: { title: string; start: string };
  optimalCount: number;
  onSchedule: () => void;
  onCreateOperation: (type: 'job' | 'maintenance') => void;
}

export function CompactStatsBar({
  safeDays,
  activeJobs,
  nextWindow,
  optimalCount,
  onSchedule,
  onCreateOperation
}: CompactStatsBarProps) {
  return (
    <div className="border-b bg-card">
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-sm sm:gap-6">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <CheckCircle className="h-4 w-4 text-success" />
            <span className="text-muted-foreground">Safe Days:</span>
            <Badge variant="secondary">{safeDays}</Badge>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 whitespace-nowrap">
            <Activity className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">Active Jobs:</span>
            <Badge variant={activeJobs > 0 ? "default" : "outline"}>{activeJobs}</Badge>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 whitespace-nowrap">
            <Clock className="h-4 w-4 text-warning" />
            <span className="text-muted-foreground">Next:</span>
            {nextWindow ? (
              <span className="font-medium">{nextWindow.title}</span>
            ) : (
              <span className="text-muted-foreground">None scheduled</span>
            )}
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          <div className="flex items-center gap-2 whitespace-nowrap">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <span className="text-muted-foreground">Recommendations:</span>
            <Badge variant="outline">{optimalCount}</Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button size="sm" onClick={onSchedule}>
            <Calendar className="mr-2 h-4 w-4" />
            Schedule Maintenance
          </Button>
          <Button size="sm" variant="outline" onClick={() => onCreateOperation('job')}>
            <Plus className="mr-2 h-4 w-4" />
            New Operation
          </Button>
        </div>
      </div>
    </div>
  );
}
