import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Shield, Activity, Lightbulb, Plus } from "lucide-react";

interface PlannerHeaderProps {
  safeDays: number;
  activeJobs: number;
  nextWindow?: { title: string; start: string };
  optimalCount: number;
  onSchedule: () => void;
  onCreateJob: () => void;
}

export function PlannerHeader({ 
  safeDays, 
  activeJobs, 
  nextWindow, 
  optimalCount,
  onSchedule,
  onCreateJob
}: PlannerHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Maintenance Planner</h1>
          <p className="text-muted-foreground">
            Schedule and monitor maintenance windows with intelligent safety validation
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onSchedule} size="lg">
            <Calendar className="mr-2 h-5 w-5" />
            Schedule Maintenance
          </Button>
          <Button onClick={onCreateJob} variant="outline" size="lg">
            <Plus className="mr-2 h-5 w-5" />
            Create Job
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Safe Days</p>
                <p className="text-3xl font-bold">{safeDays}</p>
              </div>
              <Shield className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Jobs</p>
                <p className="text-3xl font-bold">{activeJobs}</p>
              </div>
              <Activity className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Next Maintenance</p>
                <p className="text-xl font-semibold truncate">
                  {nextWindow ? nextWindow.title : 'None scheduled'}
                </p>
              </div>
              <Calendar className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Recommendations</p>
                <p className="text-3xl font-bold">{optimalCount}</p>
              </div>
              <Lightbulb className="h-8 w-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
