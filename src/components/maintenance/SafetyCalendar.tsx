import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { format, isSameDay } from "date-fns";

interface ClusterSafetyDay {
  date: Date;
  clusters: { [key: string]: { safe: boolean; healthy: number; total: number } };
  serverGroups: { [key: string]: { safe: boolean; healthy: number; total: number } };
  maintenanceWindows: any[];
  allTargetsChecked: boolean;
  allTargetsSafe: boolean;
}

interface SafetyCalendarProps {
  date: Date;
  onDateChange: (date: Date) => void;
  dailyStatus: Map<string, ClusterSafetyDay>;
}

export function SafetyCalendar({ date, onDateChange, dailyStatus }: SafetyCalendarProps) {
  const getDayStatus = (checkDate: Date): ClusterSafetyDay | null => {
    const dateKey = format(checkDate, 'yyyy-MM-dd');
    return dailyStatus.get(dateKey) || null;
  };

  const getDayClass = (dayStatus: ClusterSafetyDay | null): string => {
    if (!dayStatus?.allTargetsChecked) return '';
    if (dayStatus.allTargetsSafe) return 'bg-green-500/20 hover:bg-green-500/30';
    
    const anySafe = [...Object.values(dayStatus.clusters), ...Object.values(dayStatus.serverGroups)]
      .some(t => t.safe);
    return anySafe ? 'bg-yellow-500/20 hover:bg-yellow-500/30' : 'bg-red-500/20 hover:bg-red-500/30';
  };

  const renderDayIcon = (dayStatus: ClusterSafetyDay | null) => {
    if (!dayStatus?.allTargetsChecked) return null;
    if (dayStatus.allTargetsSafe) return <CheckCircle className="h-3 w-3 text-green-600" />;
    
    const anySafe = [...Object.values(dayStatus.clusters), ...Object.values(dayStatus.serverGroups)]
      .some(t => t.safe);
    return anySafe 
      ? <AlertTriangle className="h-3 w-3 text-yellow-600" />
      : <XCircle className="h-3 w-3 text-red-600" />;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Safety Calendar</CardTitle>
        <CardDescription>
          View cluster safety status by day. Green = safe, yellow = warnings, red = unsafe.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Calendar
          mode="single"
          selected={date}
          onSelect={(newDate) => newDate && onDateChange(newDate)}
          className="rounded-md border"
          modifiers={{
            safe: (day) => getDayStatus(day)?.allTargetsSafe || false,
            warning: (day) => {
              const status = getDayStatus(day);
              if (!status?.allTargetsChecked) return false;
              const anySafe = [...Object.values(status.clusters), ...Object.values(status.serverGroups)]
                .some(t => t.safe);
              return !status.allTargetsSafe && anySafe;
            },
            unsafe: (day) => {
              const status = getDayStatus(day);
              if (!status?.allTargetsChecked) return false;
              const allUnsafe = [...Object.values(status.clusters), ...Object.values(status.serverGroups)]
                .every(t => !t.safe);
              return allUnsafe;
            }
          }}
          modifiersClassNames={{
            safe: 'bg-green-500/20 hover:bg-green-500/30',
            warning: 'bg-yellow-500/20 hover:bg-yellow-500/30',
            unsafe: 'bg-red-500/20 hover:bg-red-500/30'
          }}
          components={{
            DayContent: ({ date: dayDate }) => {
              const dayStatus = getDayStatus(dayDate);
              return (
                <div className="flex flex-col items-center justify-center w-full h-full">
                  <span>{dayDate.getDate()}</span>
                  {renderDayIcon(dayStatus)}
                </div>
              );
            }
          }}
          onDayClick={(day) => {
            const dayStatus = getDayStatus(day);
            onDateChange(day);
          }}
        />
      </CardContent>
    </Card>
  );
}
