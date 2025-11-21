import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MaintenanceWindowCard } from "./MaintenanceWindowCard";
import { isFuture, isPast } from "date-fns";

interface MaintenanceWindow {
  id: string;
  title: string;
  description: string | null;
  planned_start: string;
  planned_end: string;
  status: string;
  maintenance_type: string;
  cluster_ids: string[] | null;
  server_group_ids: string[] | null;
  server_ids: string[] | null;
  auto_execute: boolean;
  notify_before_hours: number | null;
  details: any;
  created_by: string | null;
  job_ids: string[] | null;
}

interface ScheduledWindowsListProps {
  windows: MaintenanceWindow[];
  onDelete: (id: string) => void;
}

export function ScheduledWindowsList({ windows, onDelete }: ScheduledWindowsListProps) {
  const upcoming = windows.filter(w => 
    w.status === 'planned' && isFuture(new Date(w.planned_start))
  );
  
  const recent = windows.filter(w => 
    (w.status === 'completed' || w.status === 'cancelled' || isPast(new Date(w.planned_start))) &&
    w.status !== 'planned'
  ).slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scheduled Maintenance</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="upcoming">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upcoming">
              Upcoming ({upcoming.length})
            </TabsTrigger>
            <TabsTrigger value="recent">
              Recent ({recent.length})
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="upcoming" className="space-y-4 mt-4">
            {upcoming.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No upcoming maintenance windows
              </p>
            ) : (
              upcoming.map((window) => (
                <MaintenanceWindowCard
                  key={window.id}
                  window={window}
                  onDelete={onDelete}
                />
              ))
            )}
          </TabsContent>
          
          <TabsContent value="recent" className="space-y-4 mt-4">
            {recent.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No recent maintenance windows
              </p>
            ) : (
              recent.map((window) => (
                <MaintenanceWindowCard
                  key={window.id}
                  window={window}
                  onDelete={onDelete}
                />
              ))
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
