import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Play, Pause, Copy, SkipForward, ShieldCheck, 
  Calendar, Server, Settings, History, Info 
} from "lucide-react";
import { OverviewTab } from "./tabs/OverviewTab";
import { ScheduleTab } from "./tabs/ScheduleTab";
import { TargetsTab } from "./tabs/TargetsTab";
import { ConfigurationTab } from "./tabs/ConfigurationTab";
import { ExecutionHistoryTab } from "./tabs/ExecutionHistoryTab";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { getNextExecutionsFromConfig } from "@/lib/cron-utils";

interface MaintenanceWindowDetailDialogProps {
  window: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate?: () => void;
}

export function MaintenanceWindowDetailDialog({
  window,
  open,
  onOpenChange,
  onUpdate
}: MaintenanceWindowDetailDialogProps) {
  const [runNowDialogOpen, setRunNowDialogOpen] = useState(false);
  const [skipNextDialogOpen, setSkipNextDialogOpen] = useState(false);
  const [safetyCheckRunning, setSafetyCheckRunning] = useState(false);

  const handleRunNow = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create job immediately with all stored configuration
      const { error } = await supabase.from('jobs').insert({
        job_type: window.maintenance_type === 'firmware_only' ? 'firmware_update' : 
                  window.maintenance_type === 'esxi_upgrade' ? 'esxi_upgrade' : 'full_server_update',
        created_by: user.id,
        status: 'pending',
        details: window.details,
        target_scope: window.details?.server_ids || [],
        credential_set_ids: window.credential_set_ids || []
      });

      if (error) throw error;

      // Update last_executed_at
      await supabase
        .from('maintenance_windows')
        .update({ last_executed_at: new Date().toISOString() })
        .eq('id', window.id);

      toast.success("Maintenance window started", {
        description: "The update is now running"
      });
      
      onUpdate?.();
      setRunNowDialogOpen(false);
    } catch (error) {
      console.error('Error running maintenance window:', error);
      toast.error("Failed to start maintenance window");
    }
  };

  const handleSkipNext = async () => {
    try {
      if (!window.recurrence_enabled || !window.recurrence_pattern) {
        toast.error("Cannot skip next run", {
          description: "This window is not recurring"
        });
        return;
      }

      // Calculate next 2 scheduled runs
      const recurrenceConfig = JSON.parse(window.recurrence_pattern);
      const nextRuns = getNextExecutionsFromConfig(recurrenceConfig, new Date(window.planned_start), 2);
      
      if (nextRuns.length < 2) {
        toast.error("Cannot skip next run", {
          description: "No future runs scheduled"
        });
        return;
      }

      // Update planned_start to the second run (skip the first)
      const { error } = await supabase
        .from('maintenance_windows')
        .update({ 
          planned_start: nextRuns[1].toISOString(),
          skip_count: (window.skip_count || 0) + 1
        })
        .eq('id', window.id);

      if (error) throw error;

      toast.success("Next run skipped", {
        description: `Will now run on ${nextRuns[1].toLocaleString()}`
      });
      
      onUpdate?.();
      setSkipNextDialogOpen(false);
    } catch (error) {
      console.error('Error skipping next run:', error);
      toast.error("Failed to skip next run");
    }
  };

  const handleTogglePause = async () => {
    try {
      const newStatus = window.status === 'paused' ? 'planned' : 'paused';
      
      const { error } = await supabase
        .from('maintenance_windows')
        .update({ status: newStatus })
        .eq('id', window.id);

      if (error) throw error;

      toast.success(
        newStatus === 'paused' ? "Schedule paused" : "Schedule resumed",
        {
          description: newStatus === 'paused' 
            ? "This window will not run until resumed"
            : "This window will run as scheduled"
        }
      );
      
      onUpdate?.();
    } catch (error) {
      console.error('Error toggling pause:', error);
      toast.error("Failed to update schedule");
    }
  };

  const handleClone = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from('maintenance_windows').insert({
        title: `${window.title} (Copy)`,
        description: window.description,
        maintenance_type: window.maintenance_type,
        planned_start: window.planned_start,
        planned_end: window.planned_end,
        status: 'planned',
        cluster_ids: window.cluster_ids,
        server_group_ids: window.server_group_ids,
        server_ids: window.server_ids,
        details: window.details,
        credential_set_ids: window.credential_set_ids,
        recurrence_enabled: window.recurrence_enabled,
        recurrence_pattern: window.recurrence_pattern,
        auto_execute: window.auto_execute,
        requires_approval: window.requires_approval,
        notify_before_hours: window.notify_before_hours,
        created_by: user.id
      });

      if (error) throw error;

      toast.success("Maintenance window cloned", {
        description: "You can now edit the cloned window"
      });
      
      onUpdate?.();
    } catch (error) {
      console.error('Error cloning maintenance window:', error);
      toast.error("Failed to clone maintenance window");
    }
  };

  const handlePreflightCheck = async () => {
    try {
      setSafetyCheckRunning(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create safety check job
      const { data: job, error } = await supabase.from('jobs').insert({
        job_type: 'cluster_safety_check',
        created_by: user.id,
        status: 'pending',
        details: {
          cluster_names: window.cluster_ids || [],
          server_group_ids: window.server_group_ids || [],
          check_drs: true,
          check_ha: true,
          is_preflight: true
        },
        target_scope: {}
      }).select().single();

      if (error) throw error;

      toast.success("Pre-flight check started", {
        description: "Running safety checks on targets"
      });
      
      // Wait a moment then refresh
      setTimeout(() => {
        setSafetyCheckRunning(false);
        onUpdate?.();
      }, 2000);
    } catch (error) {
      console.error('Error running pre-flight check:', error);
      toast.error("Failed to run pre-flight check");
      setSafetyCheckRunning(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'planned': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'in_progress': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
      case 'completed': return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'failed': return 'bg-red-500/10 text-red-500 border-red-500/20';
      case 'paused': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const isPaused = window.status === 'paused';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <DialogTitle className="text-xl">{window.title}</DialogTitle>
                <div className="flex items-center gap-2 mt-2">
                  <Badge className={getStatusColor(window.status)}>
                    {window.status}
                  </Badge>
                  {window.recurrence_enabled && (
                    <Badge variant="outline" className="gap-1">
                      <Calendar className="w-3 h-3" />
                      Recurring
                    </Badge>
                  )}
                  {window.auto_execute && (
                    <Badge variant="outline">Auto-Execute</Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  size="sm" 
                  onClick={() => setRunNowDialogOpen(true)}
                  disabled={window.status === 'in_progress'}
                >
                  <Play className="w-4 h-4 mr-1" />
                  Run Now
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={handleTogglePause}
                >
                  {isPaused ? (
                    <>
                      <Play className="w-4 h-4 mr-1" />
                      Resume
                    </>
                  ) : (
                    <>
                      <Pause className="w-4 h-4 mr-1" />
                      Pause
                    </>
                  )}
                </Button>
                {window.recurrence_enabled && (
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => setSkipNextDialogOpen(true)}
                  >
                    <SkipForward className="w-4 h-4 mr-1" />
                    Skip Next
                  </Button>
                )}
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={handleClone}
                >
                  <Copy className="w-4 h-4 mr-1" />
                  Clone
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={handlePreflightCheck}
                  disabled={safetyCheckRunning}
                >
                  <ShieldCheck className="w-4 h-4 mr-1" />
                  {safetyCheckRunning ? "Checking..." : "Pre-flight"}
                </Button>
              </div>
            </div>
          </DialogHeader>

          <Tabs defaultValue="overview" className="flex-1 overflow-hidden flex flex-col">
            <TabsList>
              <TabsTrigger value="overview" className="gap-1.5">
                <Info className="w-4 h-4" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="schedule" className="gap-1.5">
                <Calendar className="w-4 h-4" />
                Schedule
              </TabsTrigger>
              <TabsTrigger value="targets" className="gap-1.5">
                <Server className="w-4 h-4" />
                Targets
              </TabsTrigger>
              <TabsTrigger value="configuration" className="gap-1.5">
                <Settings className="w-4 h-4" />
                Configuration
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5">
                <History className="w-4 h-4" />
                History
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-auto mt-4">
              <TabsContent value="overview" className="mt-0">
                <OverviewTab window={window} />
              </TabsContent>
              <TabsContent value="schedule" className="mt-0">
                <ScheduleTab window={window} onUpdate={onUpdate} />
              </TabsContent>
              <TabsContent value="targets" className="mt-0">
                <TargetsTab window={window} />
              </TabsContent>
              <TabsContent value="configuration" className="mt-0">
                <ConfigurationTab window={window} />
              </TabsContent>
              <TabsContent value="history" className="mt-0">
                <ExecutionHistoryTab window={window} />
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog open={runNowDialogOpen} onOpenChange={setRunNowDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run Maintenance Window Now?</AlertDialogTitle>
            <AlertDialogDescription>
              This will start the maintenance window immediately instead of waiting for the scheduled time.
              All configured settings will be used.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRunNow}>
              Run Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={skipNextDialogOpen} onOpenChange={setSkipNextDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip Next Scheduled Run?</AlertDialogTitle>
            <AlertDialogDescription>
              This will skip the next scheduled execution and move to the following one.
              The window will run at the next occurrence after that.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSkipNext}>
              Skip Next Run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
