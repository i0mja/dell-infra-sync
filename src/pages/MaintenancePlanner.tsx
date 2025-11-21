import { useState } from "react";
import { useMaintenanceData } from "@/hooks/useMaintenanceData";
import { useSafetyStatus } from "@/hooks/useSafetyStatus";
import { useActiveJobs } from "@/hooks/useActiveJobs";
import { useOptimalWindows } from "@/hooks/useOptimalWindows";
import { PlannerHeader } from "@/components/maintenance/PlannerHeader";
import { SafetyCalendar } from "@/components/maintenance/SafetyCalendar";
import { DayDetailsPanel } from "@/components/maintenance/DayDetailsPanel";
import { OperationsTimeline } from "@/components/maintenance/OperationsTimeline";
import { OptimalWindowsSidebar } from "@/components/maintenance/OptimalWindowsSidebar";
import { ClusterSafetyTrendChart } from "@/components/maintenance/ClusterSafetyTrendChart";
import { ScheduleMaintenanceDialog } from "@/components/maintenance/dialogs/ScheduleMaintenanceDialog";
import { CreateJobDialog } from "@/components/jobs/CreateJobDialog";
import { JobDetailDialog } from "@/components/jobs/JobDetailDialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { subMonths, addMonths, isFuture, format } from "date-fns";

export default function MaintenancePlanner() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [createJobDialogOpen, setCreateJobDialogOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [jobDetailDialogOpen, setJobDetailDialogOpen] = useState(false);
  const { toast } = useToast();

  // Data hooks
  const { windows, clusters, serverGroups, refetch: refetchData } = useMaintenanceData();
  const { dailyStatus, chartData } = useSafetyStatus(subMonths(new Date(), 1), addMonths(new Date(), 1));
  const { activeJobs } = useActiveJobs();
  const { windows: optimalWindows, loading: optimalLoading } = useOptimalWindows(clusters);

  // Calculate stats
  const safeDays = Array.from(dailyStatus.values()).filter(d => d.allTargetsSafe).length;
  const nextWindow = windows.find(w => w.status === 'planned' && isFuture(new Date(w.planned_start)));
  
  const selectedDayStatus = dailyStatus.get(format(selectedDate, 'yyyy-MM-dd'));

  const handleScheduleFromRecommendation = (window: any) => {
    setScheduleDialogOpen(true);
  };

  const handleDeleteWindow = async (id: string) => {
    try {
      const { error } = await supabase
        .from('maintenance_windows')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Maintenance window deleted",
      });

      refetchData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleJobClick = (job: any) => {
    setSelectedJob(job);
    setJobDetailDialogOpen(true);
  };

  const handleCreateOperation = (type: 'job' | 'maintenance') => {
    if (type === 'job') {
      setCreateJobDialogOpen(true);
    } else {
      setScheduleDialogOpen(true);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PlannerHeader
        safeDays={safeDays}
        activeJobs={activeJobs.length}
        nextWindow={nextWindow ? { title: nextWindow.title, start: nextWindow.planned_start } : undefined}
        optimalCount={optimalWindows.length}
        onSchedule={() => setScheduleDialogOpen(true)}
        onCreateOperation={handleCreateOperation}
      />

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main content - 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          <SafetyCalendar
            date={selectedDate}
            onDateChange={setSelectedDate}
            dailyStatus={dailyStatus}
          />

          <DayDetailsPanel
            date={selectedDate}
            status={selectedDayStatus || null}
          />

          <OperationsTimeline 
            onJobClick={handleJobClick}
            onWindowDelete={handleDeleteWindow}
            onCreateOperation={handleCreateOperation}
          />

          <ClusterSafetyTrendChart
            data={chartData}
            clusters={clusters}
            maintenanceWindows={windows.filter(w => 
              w.status === 'planned' && 
              isFuture(new Date(w.planned_start))
            )}
          />
        </div>

        {/* Sidebar - 1 column */}
        <div className="space-y-6">
          <OptimalWindowsSidebar
            windows={optimalWindows}
            onSchedule={handleScheduleFromRecommendation}
            loading={optimalLoading}
          />
        </div>
      </div>

      <ScheduleMaintenanceDialog
        open={scheduleDialogOpen}
        onOpenChange={setScheduleDialogOpen}
        clusters={clusters}
        serverGroups={serverGroups}
        onSuccess={refetchData}
      />

      <CreateJobDialog
        open={createJobDialogOpen}
        onOpenChange={setCreateJobDialogOpen}
        onSuccess={refetchData}
      />

      {selectedJob && (
        <JobDetailDialog
          open={jobDetailDialogOpen}
          onOpenChange={setJobDetailDialogOpen}
          job={selectedJob}
        />
      )}
    </div>
  );
}
