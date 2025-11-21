import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";

interface MiniCalendarProps {
  date: Date;
  onDateChange: (date: Date) => void;
  dailyStatus: Map<string, {
    allTargetsSafe: boolean;
    hasWarnings: boolean;
    clusters: { [key: string]: any };
    serverGroups: { [key: string]: any };
    maintenanceWindows: any[];
  }>;
}

export function MiniCalendar({ date, onDateChange, dailyStatus }: MiniCalendarProps) {
  // Build modifiers for day styling
  const safeDays: Date[] = [];
  const warningDays: Date[] = [];
  const unsafeDays: Date[] = [];

  dailyStatus.forEach((status, dateKey) => {
    const day = new Date(dateKey);
    if (status.allTargetsSafe && !status.hasWarnings) {
      safeDays.push(day);
    } else if (status.hasWarnings) {
      warningDays.push(day);
    } else {
      unsafeDays.push(day);
    }
  });

  return (
    <div className="border rounded-lg p-4 bg-background">
      <h3 className="text-sm font-semibold mb-3">Calendar</h3>
      <Calendar
        mode="single"
        selected={date}
        onSelect={(d) => d && onDateChange(d)}
        className="rounded-md"
        modifiers={{
          safe: safeDays,
          warning: warningDays,
          unsafe: unsafeDays
        }}
        modifiersClassNames={{
          selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
          safe: "bg-success/20 hover:bg-success/30",
          warning: "bg-warning/20 hover:bg-warning/30",
          unsafe: "bg-destructive/20 hover:bg-destructive/30"
        }}
      />
    </div>
  );
}
