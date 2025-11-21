import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SafetyStatusTable } from "./SafetyStatusTable";
import { format, formatDistanceToNow, differenceInHours } from "date-fns";
import { Calendar, CheckCircle, XCircle, Clock, Lightbulb, Zap } from "lucide-react";

interface Operation {
  type: 'job' | 'maintenance';
  id: string;
  title: string;
  status: string;
  timestamp: Date;
  data: any;
}

interface OptimalWindow {
  start: string;
  end: string;
  duration_hours: number;
  confidence: 'high' | 'medium' | 'low';
  affected_clusters: string[];
  all_clusters_safe: boolean;
}

interface DetailsSidebarProps {
  selectedDate: Date | null;
  selectedOperation: Operation | null;
  dailyStatus: Map<string, {
    allTargetsSafe: boolean;
    hasWarnings: boolean;
    clusters: { [key: string]: { safe: boolean; healthy: number; total: number } };
    serverGroups: { [key: string]: { safe: boolean; healthy: number; total: number } };
    maintenanceWindows: any[];
  }>;
  optimalWindows: OptimalWindow[];
  onScheduleOptimal: (window: OptimalWindow) => void;
}

export function DetailsSidebar({
  selectedDate,
  selectedOperation,
  dailyStatus,
  optimalWindows,
  onScheduleOptimal
}: DetailsSidebarProps) {
  // Show operation details if selected
  if (selectedOperation) {
    const data = selectedOperation.data;
    const isJob = selectedOperation.type === 'job';

    return (
      <div className="border rounded-lg bg-background overflow-hidden flex flex-col">
        <div className="border-b px-4 py-3 bg-muted/30">
          <div className="flex items-center gap-2">
            {isJob ? <Zap className="h-4 w-4 text-blue-500" /> : <Calendar className="h-4 w-4 text-purple-500" />}
            <h3 className="font-semibold">Operation Details</h3>
          </div>
        </div>

        <div className="p-4 space-y-4 overflow-auto">
          <div>
            <h4 className="font-semibold mb-2">{selectedOperation.title}</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Type:</span>
                <span className="font-medium">{isJob ? 'Job' : 'Maintenance Window'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <Badge>{selectedOperation.status.toUpperCase()}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created:</span>
                <span>{format(selectedOperation.timestamp, 'MMM dd, yyyy HH:mm')}</span>
              </div>
            </div>
          </div>

          {isJob && (
            <>
              <div className="border-t pt-4">
                <h5 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Job Details</h5>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Job Type:</span>
                    <span className="font-medium">{data.job_type.replace('_', ' ')}</span>
                  </div>
                  {data.started_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Started:</span>
                      <span>{format(new Date(data.started_at), 'MMM dd, HH:mm')}</span>
                    </div>
                  )}
                  {data.completed_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Completed:</span>
                      <span>{format(new Date(data.completed_at), 'MMM dd, HH:mm')}</span>
                    </div>
                  )}
                </div>
              </div>

              {data.details?.error && (
                <div className="border-t pt-4">
                  <h5 className="text-xs font-semibold text-destructive mb-2 uppercase">Error</h5>
                  <p className="text-sm text-muted-foreground">{data.details.error}</p>
                </div>
              )}
            </>
          )}

          {!isJob && (
            <div className="border-t pt-4">
              <h5 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Window Details</h5>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Start:</span>
                  <span>{format(new Date(data.planned_start), 'MMM dd, HH:mm')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">End:</span>
                  <span>{format(new Date(data.planned_end), 'MMM dd, HH:mm')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration:</span>
                  <span>{differenceInHours(new Date(data.planned_end), new Date(data.planned_start))}h</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type:</span>
                  <span className="font-medium">{data.maintenance_type.replace('_', ' ')}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Show day safety status if date selected
  if (selectedDate && dailyStatus) {
    const dateKey = format(selectedDate, 'yyyy-MM-dd');
    const status = dailyStatus.get(dateKey);

    // Convert object format to array format for the table
    const clusters = status ? Object.entries(status.clusters).map(([cluster, data]) => ({
      cluster,
      totalTargets: data.total,
      healthyTargets: data.healthy,
      isSafe: data.safe,
      hasWarnings: !data.safe && data.healthy > 0
    })) : [];

    const serverGroups = status ? Object.entries(status.serverGroups).map(([id, data]) => ({
      id,
      name: id,
      totalServers: data.total,
      healthyServers: data.healthy,
      isSafe: data.safe
    })) : [];

    return (
      <div className="border rounded-lg bg-background overflow-hidden flex flex-col">
        <div className="border-b px-4 py-3 bg-muted/30">
          <h3 className="font-semibold">Safety Status</h3>
          <p className="text-xs text-muted-foreground">{format(selectedDate, 'MMMM dd, yyyy')}</p>
        </div>

        <div className="p-4 overflow-auto">
          {status ? (
            <SafetyStatusTable 
              clusters={clusters} 
              serverGroups={serverGroups} 
            />
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No safety data for this date</p>
            </div>
          )}

          {status?.maintenanceWindows && status.maintenanceWindows.length > 0 && (
            <div className="mt-6 pt-6 border-t">
              <h4 className="text-xs font-semibold text-muted-foreground mb-3 uppercase">Scheduled Maintenance</h4>
              <div className="space-y-2">
                {status.maintenanceWindows.map((window: any) => (
                  <div key={window.id} className="text-sm">
                    <div className="font-medium">{window.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(window.planned_start), 'HH:mm')} - {format(new Date(window.planned_end), 'HH:mm')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Default: Show optimal windows
  return (
    <div className="border rounded-lg bg-background overflow-hidden flex flex-col">
      <div className="border-b px-4 py-3 bg-muted/30">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <h3 className="font-semibold">Optimal Windows</h3>
        </div>
        <p className="text-xs text-muted-foreground mt-1">AI-recommended maintenance times</p>
      </div>

      <div className="p-4 space-y-3 overflow-auto">
        {optimalWindows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">No optimal windows available</p>
          </div>
        ) : (
          optimalWindows.map((window, idx) => {
            const startDate = new Date(window.start);
            const confidence = window.confidence;
            const confidenceColor = confidence === 'high' ? 'text-success' : confidence === 'medium' ? 'text-warning' : 'text-muted-foreground';

            return (
              <div key={idx} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium">{format(startDate, 'MMM dd, yyyy')}</div>
                    <div className="text-sm text-muted-foreground">
                      {format(startDate, 'HH:mm')} • {window.duration_hours}h duration
                    </div>
                  </div>
                  <Badge variant="outline" className={confidenceColor}>
                    {confidence.toUpperCase()}
                  </Badge>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  {window.all_clusters_safe ? (
                    <div className="flex items-center gap-1 text-success">
                      <CheckCircle className="h-3 w-3" />
                      <span>All clusters safe</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{window.affected_clusters.length} clusters affected</span>
                    </div>
                  )}
                </div>

                <Button 
                  size="sm" 
                  className="w-full" 
                  variant="outline"
                  onClick={() => onScheduleOptimal(window)}
                >
                  <Calendar className="mr-2 h-3 w-3" />
                  Schedule
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
