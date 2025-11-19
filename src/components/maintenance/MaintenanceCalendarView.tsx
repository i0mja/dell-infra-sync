import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertTriangle, XCircle, Calendar as CalendarIcon } from "lucide-react";
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
  onDayClick: (day: ClusterSafetyDay) => void;
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

  return (
    <Card className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <CalendarIcon className="h-5 w-5" />
        <h2 className="text-lg font-semibold">Cluster Safety Calendar</h2>
      </div>
      
      <div className="mb-4 flex gap-4 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-green-100 border border-green-200 rounded" />
          <span>All Safe</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-yellow-100 border border-yellow-200 rounded" />
          <span>Warnings</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-red-100 border border-red-200 rounded" />
          <span>Unsafe</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-gray-100 border border-gray-200 rounded" />
          <span>No Data</span>
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
          }
        }}
        modifiersClassNames={{
          safe: 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800',
          warning: 'bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800',
          unsafe: 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'
        }}
        onDayClick={(clickedDate) => {
          const status = getDayStatus(clickedDate);
          if (status) {
            onDayClick(status);
          }
        }}
      />
    </Card>
  );
}
