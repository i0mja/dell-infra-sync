import { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export function GlobalSyncIndicator() {
  const [runningJobs, setRunningJobs] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const prevRunningJobsRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();

  // Don't show on dashboard where DrStatsBar already shows sync status
  const isOnDashboard = location.pathname === "/" || location.pathname === "/dashboard";

  useEffect(() => {
    const fetchRunningJobs = async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, job_type, details')
        .in('job_type', ['run_replication_sync', 'storage_vmotion', 'create_dr_shell'])
        .in('status', ['pending', 'running']);

      if (!error && data) {
        // Filter out scheduled/automatic replication syncs (only show manually triggered ones)
        const manualJobs = data.filter(job => {
          if (job.job_type === 'run_replication_sync') {
            const details = job.details as Record<string, unknown> | null;
            // Only show if NOT triggered by scheduled/automatic process
            return !details?.triggered_by;
          }
          return true;
        });
        
        const count = manualJobs.length;
        
        // Reset dismissed state when new jobs start (using ref for comparison)
        if (count > 0 && prevRunningJobsRef.current === 0) {
          setDismissed(false);
        }
        prevRunningJobsRef.current = count;
        
        setRunningJobs(count);
      }
    };

    fetchRunningJobs();

    // Subscribe to real-time updates
    const channel = supabase
      .channel('global-sync-indicator')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs'
        },
        () => {
          fetchRunningJobs();
        }
      )
      .subscribe();

    // Poll every 5 seconds as backup
    const interval = setInterval(fetchRunningJobs, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []); // Empty dependency array - runs once on mount

  // Don't show if no jobs, dismissed, or on dashboard
  if (runningJobs === 0 || dismissed || isOnDashboard) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2 duration-300">
      <Card className="p-3 shadow-lg border-blue-500/30 bg-card/95 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-blue-500/10">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          </div>
          <div>
            <p className="text-sm font-medium">Sync in Progress</p>
            <p className="text-xs text-muted-foreground">
              {runningJobs} job{runningJobs !== 1 ? 's' : ''} running
            </p>
          </div>
          <Button
            size="sm"
            variant="link"
            className="text-blue-500"
            onClick={() => navigate('/')}
          >
            View
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => setDismissed(true)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
