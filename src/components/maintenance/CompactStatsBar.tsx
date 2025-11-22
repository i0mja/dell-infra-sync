import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
    <TooltipProvider>
      <div className="border-b bg-card">
        <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm sm:gap-6">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <CheckCircle className="h-4 w-4 text-success" />
                  <Badge variant="secondary">{safeDays}</Badge>
                </div>
              </TooltipTrigger>
              <TooltipContent>Safe Days</TooltipContent>
            </Tooltip>

            <div className="hidden h-4 w-px bg-border sm:block" />

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <Activity className="h-4 w-4 text-primary" />
                  <Badge variant={activeJobs > 0 ? "default" : "outline"}>{activeJobs}</Badge>
                </div>
              </TooltipTrigger>
              <TooltipContent>Active Jobs</TooltipContent>
            </Tooltip>

            <div className="hidden h-4 w-px bg-border sm:block" />

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <Clock className="h-4 w-4 text-warning" />
                  {nextWindow ? (
                    <span className="font-medium">{nextWindow.title}</span>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>Next Maintenance Window</TooltipContent>
            </Tooltip>

            <div className="hidden h-4 w-px bg-border sm:block" />

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <Lightbulb className="h-4 w-4 text-amber-500" />
                  <Badge variant="outline">{optimalCount}</Badge>
                </div>
              </TooltipTrigger>
              <TooltipContent>Optimal Window Recommendations</TooltipContent>
            </Tooltip>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" onClick={onSchedule}>
                  <Calendar className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Schedule Maintenance</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" onClick={() => onCreateOperation('job')}>
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New Operation</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
