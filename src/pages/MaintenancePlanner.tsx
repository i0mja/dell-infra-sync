import { useState } from "react";
import { useMaintenanceData } from "@/hooks/useMaintenanceData";
import { useSafetyStatus } from "@/hooks/useSafetyStatus";
import { useActiveJobs } from "@/hooks/useActiveJobs";
import { useOptimalWindows } from "@/hooks/useOptimalWindows";
import { PlannerHeader } from "@/components/maintenance/PlannerHeader";
import { SafetyCalendar } from "@/components/maintenance/SafetyCalendar";
import { DayDetailsPanel } from "@/components/maintenance/DayDetailsPanel";
import { ActiveOperationsPanel } from "@/components/maintenance/ActiveOperationsPanel";
import { ScheduledWindowsList } from "@/components/maintenance/ScheduledWindowsList";
import { OptimalWindowsSidebar } from "@/components/maintenance/OptimalWindowsSidebar";
import { ClusterSafetyTrendChart } from "@/components/maintenance/ClusterSafetyTrendChart";
import { ScheduleMaintenanceDialog } from "@/components/maintenance/dialogs/ScheduleMaintenanceDialog";
import { JobDetailDialog } from "@/components/jobs/JobDetailDialog";
import { JobsPanel } from "@/components/jobs/JobsPanel";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { subMonths, addMonths, isFuture, format } from "date-fns";
import { useSearchParams } from "react-router-dom";

export default function MaintenancePlanner() {
  const [searchParams] = useSearchParams();
  const showJobsPanel = searchParams.get('view') === 'all-jobs';
  
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
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

  // Show full jobs panel if requested
  if (showJobsPanel) {
    return <JobsPanel defaultView="all" />;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PlannerHeader
        safeDays={safeDays}
        activeJobs={activeJobs.length}
        nextWindow={nextWindow ? { title: nextWindow.title, start: nextWindow.planned_start } : undefined}
        optimalCount={optimalWindows.length}
        onSchedule={() => setScheduleDialogOpen(true)}
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

          <ActiveOperationsPanel
            jobs={activeJobs}
            onJobClick={handleJobClick}
          />

          <ScheduledWindowsList
            windows={windows}
            onDelete={handleDeleteWindow}
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
