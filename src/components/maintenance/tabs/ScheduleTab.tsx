import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format, formatDuration, intervalToDuration } from "date-fns";
import { Calendar, Clock, Repeat, Edit } from "lucide-react";
import { getNextExecutionsFromConfig, getHumanReadableSchedule } from "@/lib/cron-utils";

interface ScheduleTabProps {
  window: any;
  onUpdate?: () => void;
  onEdit?: () => void;
  canEdit?: boolean;
}

export function ScheduleTab({ window, onUpdate, onEdit, canEdit }: ScheduleTabProps) {
  const duration = intervalToDuration({
    start: new Date(window.planned_start),
    end: new Date(window.planned_end)
  });

  const formattedDuration = formatDuration(duration, {
    format: ['hours', 'minutes']
  });

  const nextRuns = window.recurrence_enabled && window.recurrence_pattern
    ? (() => {
        try {
          const recurrenceConfig = JSON.parse(window.recurrence_pattern);
          return getNextExecutionsFromConfig(recurrenceConfig, new Date(window.planned_start), 5);
        } catch (error) {
          console.error('Error parsing recurrence pattern:', error);
          return [];
        }
      })()
    : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Schedule</CardTitle>
          {canEdit && onEdit && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Edit className="mr-2 h-4 w-4" />
              Edit Schedule
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Start Time
              </div>
              <p className="text-sm font-medium">
                {format(new Date(window.planned_start), 'PPp')}
              </p>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                End Time
              </div>
              <p className="text-sm font-medium">
                {format(new Date(window.planned_end), 'PPp')}
              </p>
            </div>
          </div>

          <div>
            <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Duration
            </div>
            <p className="text-sm font-medium">{formattedDuration}</p>
          </div>

          {window.notify_before_hours && (
            <div>
              <div className="text-sm text-muted-foreground mb-1">Notification</div>
              <p className="text-sm">
                Send notification {window.notify_before_hours} hours before start
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {window.recurrence_enabled && window.recurrence_pattern && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Repeat className="w-4 h-4" />
              Recurrence
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Pattern</div>
              <p className="text-sm font-medium">
                {(() => {
                  try {
                    const config = JSON.parse(window.recurrence_pattern);
                    return getHumanReadableSchedule({ ...config, enabled: true });
                  } catch (error) {
                    return 'Invalid pattern';
                  }
                })()}
              </p>
            </div>

            {window.skip_count > 0 && (
              <div>
                <div className="text-sm text-muted-foreground mb-1">Skipped Runs</div>
                <Badge variant="outline">{window.skip_count} run(s) skipped</Badge>
              </div>
            )}

            {nextRuns.length > 0 && (
              <div>
                <div className="text-sm text-muted-foreground mb-2">Next 5 Scheduled Runs</div>
                <div className="space-y-2">
                  {nextRuns.map((date, index) => (
                    <div 
                      key={index}
                      className="flex items-center gap-2 text-sm p-2 rounded-md bg-muted/50"
                    >
                      <Badge variant="outline" className="w-6 justify-center">
                        {index + 1}
                      </Badge>
                      <span>{format(date, 'PPp')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
