import { useState, useMemo, useEffect } from "react";
import { useMaintenanceData } from "@/hooks/useMaintenanceData";
import { useSafetyStatus } from "@/hooks/useSafetyStatus";
import { useActiveJobs } from "@/hooks/useActiveJobs";
import { useOptimalWindows } from "@/hooks/useOptimalWindows";
import { CompactStatsBar } from "@/components/maintenance/CompactStatsBar";
import { OperationsTable } from "@/components/maintenance/OperationsTable";
import { ClusterSafetyTrendChart } from "@/components/maintenance/ClusterSafetyTrendChart";
import { ScheduleMaintenanceDialog } from "@/components/maintenance/dialogs/ScheduleMaintenanceDialog";

import { JobDetailDialog } from "@/components/jobs/JobDetailDialog";
import { ClusterUpdateWizard } from "@/components/jobs/ClusterUpdateWizard";
import { MaintenanceWindowDetailDialog } from "@/components/maintenance/MaintenanceWindowDetailDialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { subMonths, addMonths, isFuture, format } from "date-fns";
import { ChevronDown, ChevronUp } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface Job {
  id: string;
  job_type: string;
  status: string;
  target_scope: any;
  details: any;
  created_by: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

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
}

interface Operation {
  type: 'job' | 'maintenance';
  id: string;
  title: string;
  status: 'active' | 'planned' | 'completed' | 'failed';
  timestamp: Date;
  target: string;
  data: Job | MaintenanceWindow;
}

interface SchedulePrefill {
  start?: Date;
  end?: Date;
  clusters?: string[];
  serverGroupIds?: string[];
}

export default function MaintenancePlanner() {
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [schedulePrefill, setSchedulePrefill] = useState<SchedulePrefill>();
  
  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [jobDetailDialogOpen, setJobDetailDialogOpen] = useState(false);
  const [selectedWindow, setSelectedWindow] = useState<any>(null);
  const [windowDetailDialogOpen, setWindowDetailDialogOpen] = useState(false);
  const [bulkCancelDialogOpen, setBulkCancelDialogOpen] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [jobsToCancel, setJobsToCancel] = useState<string[]>([]);
  const [operationsToDelete, setOperationsToDelete] = useState<string[]>([]);
  const [trendChartOpen, setTrendChartOpen] = useState(false);
  const [updateWizardOpen, setUpdateWizardOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const { toast } = useToast();
  const { userRole } = useAuth();

  const canManage = userRole === 'admin' || userRole === 'operator';

  // Data hooks
  const { windows, clusters, serverGroups, refetch: refetchData } = useMaintenanceData();
  const { dailyStatus, chartData } = useSafetyStatus(subMonths(new Date(), 1), addMonths(new Date(), 1));
  const { activeJobs } = useActiveJobs();
  const { windows: optimalWindows } = useOptimalWindows(clusters);

  // Fetch jobs
  useEffect(() => {
    const fetchJobs = async () => {
      const { data } = await supabase
        .from("jobs")
        .select("*")
        .is("parent_job_id", null)
        .order("created_at", { ascending: false });
      
      if (data) setJobs(data);
    };

    fetchJobs();

    const channel = supabase
      .channel('jobs-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, fetchJobs)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Calculate stats
  const safeDays = Array.from(dailyStatus.values()).filter(d => d.allTargetsSafe).length;
  const nextWindow = windows.find(w => w.status === 'planned' && isFuture(new Date(w.planned_start)));

  // Map job/window status to unified operation status
  const mapJobStatus = (job: Job): Operation['status'] => {
    if (job.status === 'completed') return 'completed';
    if (job.status === 'failed' || job.status === 'cancelled') return 'failed';
    if (job.status === 'running') return 'active';
    return 'planned';
  };

  const mapWindowStatus = (window: MaintenanceWindow): Operation['status'] => {
    if (window.status === 'completed') return 'completed';
    if (window.status === 'failed' || window.status === 'cancelled') return 'failed';
    if (window.status === 'in_progress') return 'active';
    return 'planned';
  };

  const getJobTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      firmware_update: "Firmware Update",
      discovery_scan: "Discovery Scan",
      vcenter_sync: "vCenter Sync",
      full_server_update: "Full Server Update",
      cluster_safety_check: "Safety Check",
    };
    return labels[type] || type;
  };

  // Combine jobs and windows into operations
  const operations = useMemo<Operation[]>(() => {
    const jobOps: Operation[] = jobs.map(j => ({
      type: 'job' as const,
      id: j.id,
      title: getJobTypeLabel(j.job_type),
      status: mapJobStatus(j),
      timestamp: new Date(j.started_at || j.created_at),
      target: j.target_scope?.server_ids 
        ? `${j.target_scope.server_ids.length} servers`
        : j.target_scope?.cluster_name || 'N/A',
      data: j
    }));

    const windowOps: Operation[] = windows.map(w => ({
      type: 'maintenance' as const,
      id: w.id,
      title: w.title,
      status: mapWindowStatus(w),
      timestamp: new Date(w.planned_start),
      target: `${w.cluster_ids?.length || 0} clusters, ${w.server_group_ids?.length || 0} groups`,
      data: w
    }));

    const all = [...jobOps, ...windowOps];
    
    // Sort by relevance
    return all.sort((a, b) => {
      const statusOrder = { active: 0, planned: 1, completed: 2, failed: 3 };
      const aOrder = statusOrder[a.status];
      const bOrder = statusOrder[b.status];
      
      if (aOrder !== bOrder) return aOrder - bOrder;
      return b.timestamp.getTime() - a.timestamp.getTime();
    });
  }, [jobs, windows]);

  const handleOperationClick = (operation: Operation) => {
    if (operation.type === 'job') {
      setSelectedJob(operation.data);
      setJobDetailDialogOpen(true);
    } else if (operation.type === 'maintenance') {
      setSelectedWindow(operation.data);
      setWindowDetailDialogOpen(true);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      const { error } = await supabase.functions.invoke('update-job', {
        body: { job: { id: jobId, status: 'cancelled', completed_at: new Date().toISOString() } }
      });
      if (error) throw error;
      toast({ title: "Job cancelled" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleRetryJob = async (job: Job) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: result, error } = await supabase.functions.invoke('create-job', {
        body: {
          job_type: job.job_type as any,
          created_by: user?.id,
          target_scope: job.target_scope,
          details: job.details
        }
      });
      if (error) throw error;
      if (!result?.success) throw new Error(result?.error || 'Failed');
      toast({ title: "Job retried" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleDeleteWindow = async (id: string) => {
    try {
      const { error } = await supabase
        .from('maintenance_windows')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast({ title: "Success", description: "Maintenance window deleted" });
      refetchData();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleCreateOperation = (type: 'job' | 'maintenance') => {
    setSchedulePrefill(undefined);
    setScheduleDialogOpen(true);
  };

  const handleScheduleOptimal = (window: { start: string; end: string; affected_clusters: string[] }) => {
    setSchedulePrefill({
      start: new Date(window.start),
      end: new Date(window.end),
      clusters: window.affected_clusters
    });
    setScheduleDialogOpen(true);
  };

  const handleBulkCancel = (jobIds: string[]) => {
    setJobsToCancel(jobIds);
    setBulkCancelDialogOpen(true);
  };

  const confirmBulkCancel = async () => {
    for (const jobId of jobsToCancel) {
      await supabase.from("jobs").update({ status: "cancelled" }).eq("id", jobId);
    }
    toast({ title: "Jobs cancelled", description: `${jobsToCancel.length} job(s) cancelled` });
    setBulkCancelDialogOpen(false);
    setJobsToCancel([]);
  };

  const handleBulkDelete = (operationIds: string[]) => {
    setOperationsToDelete(operationIds);
    setBulkDeleteDialogOpen(true);
  };

  const confirmBulkDelete = async () => {
    const jobsToDelete = operations.filter(op => 'job' in op && operationsToDelete.includes(op.id)).map(op => op.id);
    const windowsToDelete = operations.filter(op => 'maintenance' in op && operationsToDelete.includes(op.id)).map(op => op.id);
    if (jobsToDelete.length > 0) await supabase.from("jobs").delete().in("id", jobsToDelete);
    if (windowsToDelete.length > 0) await supabase.from("maintenance_windows").delete().in("id", windowsToDelete);
    toast({ title: "Operations deleted", description: `${operationsToDelete.length} operation(s) deleted` });
    setBulkDeleteDialogOpen(false);
    setOperationsToDelete([]);
  };

  const failedJobs = jobs.filter(j => j.status === 'failed').length;

  // Quick action handlers for OperationsTable
  const runSafetyCheck = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.functions.invoke('create-job', {
        body: {
          job_type: 'cluster_safety_check',
          created_by: user.id,
          target_scope: { type: 'all_clusters', clusters }
        }
      });

      if (error) throw error;
      toast({ title: "Safety check started", description: "Checking all clusters..." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const syncVCenters = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.functions.invoke('create-job', {
        body: {
          job_type: 'vcenter_sync',
          created_by: user.id,
          target_scope: { type: 'all' }
        }
      });

      if (error) throw error;
      toast({ title: "vCenter sync started" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const runDiscovery = async () => {
    toast({ 
      title: "Discovery scan", 
      description: "Please configure discovery settings in the Servers page" 
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact Stats Bar */}
      <CompactStatsBar
        safeDays={safeDays}
        activeJobs={activeJobs.length}
        failedJobs={failedJobs}
        nextWindow={nextWindow ? { title: nextWindow.title, start: nextWindow.planned_start } : undefined}
        optimalCount={optimalWindows.length}
        onScheduleMaintenance={() => handleCreateOperation('maintenance')}
        onCreateJob={() => handleCreateOperation('maintenance')}
        onUpdateWizard={() => setUpdateWizardOpen(true)}
      />

      {/* Main Content: Full-height Table */}
      <div className="flex-1 overflow-hidden">
        <OperationsTable
          operations={operations}
          clusters={clusters}
          serverGroups={serverGroups}
          onRowClick={handleOperationClick}
          onCancel={handleCancelJob}
          onRetry={handleRetryJob}
          onDelete={handleDeleteWindow}
          canManage={canManage}
          optimalWindow={optimalWindows[0] || null}
          onScheduleOptimal={() => optimalWindows[0] && handleScheduleOptimal(optimalWindows[0])}
          onRunSafetyCheck={runSafetyCheck}
          onSyncVCenters={syncVCenters}
          onRunDiscovery={runDiscovery}
          onUpdateWizard={() => setUpdateWizardOpen(true)}
          onBulkCancel={handleBulkCancel}
          onBulkDelete={handleBulkDelete}
        />
      </div>

      {/* Bottom: Collapsible Trend Chart */}
      <Collapsible open={trendChartOpen} onOpenChange={setTrendChartOpen}>
        <div className="border-t">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between px-6 py-2 rounded-none">
              <span className="font-semibold">Safety Trend Chart</span>
              {trendChartOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="p-4 border-t">
              <ClusterSafetyTrendChart
                data={chartData}
                clusters={clusters}
                maintenanceWindows={windows.filter(w => 
                  w.status === 'planned' && isFuture(new Date(w.planned_start))
                )}
              />
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Dialogs */}
      <ScheduleMaintenanceDialog
        open={scheduleDialogOpen}
        onOpenChange={(open) => {
          if (!open) setSchedulePrefill(undefined);
          setScheduleDialogOpen(open);
        }}
        clusters={clusters}
        serverGroups={serverGroups}
        prefilledData={schedulePrefill}
        onSuccess={refetchData}
      />

      {selectedJob && (
        <JobDetailDialog
          open={jobDetailDialogOpen}
          onOpenChange={setJobDetailDialogOpen}
          job={selectedJob}
        />
      )}

      {selectedWindow && (
        <MaintenanceWindowDetailDialog
          window={selectedWindow}
          open={windowDetailDialogOpen}
          onOpenChange={setWindowDetailDialogOpen}
          onUpdate={() => {
            refetchData();
            // Refresh jobs too since they may be linked
            const fetchJobs = async () => {
              const { data } = await supabase
                .from("jobs")
                .select("*")
                .is("parent_job_id", null)
                .order("created_at", { ascending: false });
              
              if (data) setJobs(data);
            };
            fetchJobs();
          }}
        />
      )}

      <ClusterUpdateWizard 
        open={updateWizardOpen}
        onOpenChange={setUpdateWizardOpen}
      />

      <AlertDialog open={bulkCancelDialogOpen} onOpenChange={setBulkCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {jobsToCancel.length} Job{jobsToCancel.length > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to cancel {jobsToCancel.length} running job(s)?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBulkCancel}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {operationsToDelete.length} Operation{operationsToDelete.length > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete All</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
