import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Calendar as CalendarIcon,
  Sparkles,
  Dot
} from "lucide-react";
import { DayContentProps } from "react-day-picker";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface ClusterSafetyDay {
  date: Date;
  clusters: {
    [clusterName: string]: {
      safe: boolean;
      healthy_hosts: number;
      total_hosts: number;
    }
  };
  allClustersChecked: boolean;
  allClustersSafe: boolean;
  maintenanceWindows: any[];
}

interface MaintenanceCalendarViewProps {
  date: Date;
  onDateChange: (date: Date | undefined) => void;
  dailyStatus: Map<string, ClusterSafetyDay>;
  onDayClick?: (day: ClusterSafetyDay | null, date: Date) => void;
}

export function MaintenanceCalendarView({
  date,
  onDateChange,
  dailyStatus,
  onDayClick
}: MaintenanceCalendarViewProps) {
  
  const getDayStatus = (checkDate: Date): ClusterSafetyDay | null => {
    const dateKey = format(checkDate, 'yyyy-MM-dd');
    return dailyStatus.get(dateKey) || null;
  };

  const getDayClass = (dayStatus: ClusterSafetyDay | null): string => {
    if (!dayStatus) return '';
    
    if (dayStatus.allClustersSafe) {
      return 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800';
    }
    
    const hasWarnings = Object.values(dayStatus.clusters).some(c => !c.safe);
    const allUnsafe = Object.values(dayStatus.clusters).every(c => !c.safe);
    
    if (allUnsafe) {
      return 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800';
    }
    
    if (hasWarnings) {
      return 'bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800';
    }
    
    return '';
  };

  const renderDayIcon = (dayStatus: ClusterSafetyDay | null) => {
    if (!dayStatus) return null;
    
    if (dayStatus.allClustersSafe) {
      return <CheckCircle className="h-3 w-3 text-green-600" />;
    }
    
    const hasWarnings = Object.values(dayStatus.clusters).some(c => !c.safe);
    const allUnsafe = Object.values(dayStatus.clusters).every(c => !c.safe);
    
    if (allUnsafe) {
      return <XCircle className="h-3 w-3 text-red-600" />;
    }
    
    if (hasWarnings) {
      return <AlertTriangle className="h-3 w-3 text-yellow-600" />;
    }
    
    return null;
  };

  const DayContent = (props: DayContentProps) => {
    const status = getDayStatus(props.date);
    const hasMaintenance = (status?.maintenanceWindows?.length || 0) > 0;

    const bgClass = getDayClass(status);

    return (
      <div
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium transition-colors",
          bgClass || "hover:bg-accent/50",
        )}
      >
        <span>{format(props.date, 'd')}</span>

        {status && (
          <span className="absolute top-1 right-1">{renderDayIcon(status)}</span>
        )}

        {hasMaintenance && (
          <span className="absolute bottom-1.5 flex items-center gap-0.5 text-[10px] font-semibold text-primary">
            <Dot className="h-3 w-3" />
          </span>
        )}
      </div>
    );
  };

  return (
    <Card className="p-5 shadow-sm border-primary/10">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-5 w-5" />
          <div>
            <h2 className="text-lg font-semibold">Maintenance readiness calendar</h2>
            <p className="text-xs text-muted-foreground">Tap a day to inspect safety checks and maintenance windows.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>Optimal days are highlighted</span>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-4 text-xs">
        <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-sm">
          <div className="h-3 w-3 rounded-full bg-green-500/80" />
          <span className="font-medium">All safe</span>
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-sm">
          <div className="h-3 w-3 rounded-full bg-yellow-400/80" />
          <span className="font-medium">Warnings</span>
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-sm">
          <div className="h-3 w-3 rounded-full bg-red-500/80" />
          <span className="font-medium">Unsafe</span>
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-sm">
          <Dot className="h-4 w-4 text-primary" />
          <span className="font-medium">Has maintenance</span>
        </div>
      </div>

      <Calendar
        mode="single"
        selected={date}
        onSelect={onDateChange}
        className="pointer-events-auto"
        modifiers={{
          safe: (checkDate) => {
            const status = getDayStatus(checkDate);
            return status?.allClustersSafe || false;
          },
          warning: (checkDate) => {
            const status = getDayStatus(checkDate);
            if (!status) return false;
            const hasWarnings = Object.values(status.clusters).some(c => !c.safe);
            return hasWarnings && !status.allClustersSafe;
          },
          unsafe: (checkDate) => {
            const status = getDayStatus(checkDate);
            if (!status) return false;
            return Object.values(status.clusters).every(c => !c.safe);
          },
          maintenance: (checkDate) => {
            const status = getDayStatus(checkDate);
            return (status?.maintenanceWindows?.length || 0) > 0;
          }
        }}
        classNames={{
          day: cn(
            "relative flex h-10 w-10 items-center justify-center rounded-md p-0 font-medium aria-selected:bg-primary aria-selected:text-primary-foreground",
          ),
          cell: "p-0",
        }}
        components={{
          DayContent,
        }}
        onDayClick={(clickedDate) => {
          const status = getDayStatus(clickedDate);
          onDayClick?.(status, clickedDate);
        }}
      />
    </Card>
  );
}
