import { useMemo } from "react";
import { Job } from "@/components/activity/JobsTable";

export interface JobTypeSummary {
  jobType: string;
  label: string;
  currentJob: Job | null; // Running or most recent pending job
  lastCompleted: Job | null;
  lastFailed: Job | null;
  latestJob: Job; // Most recent job of any status
  stats: {
    totalRuns: number;
    successCount: number;
    failureCount: number;
    cancelledCount: number;
    pendingCount: number;
    runningCount: number;
    avgDurationMs: number;
  };
  activeJobs: {
    running: Job[];
    pending: Job[];
  };
}

const formatJobTypeLabel = (type: string): string => {
  const typeMap: Record<string, string> = {
    'discovery_scan': 'Initial Server Sync',
    'vcenter_sync': 'vCenter Sync',
    'refresh_server_info': 'Refresh Server Info',
    'scp_export': 'SCP Export',
    'scp_import': 'SCP Import',
    'firmware_update': 'Firmware Update',
    'power_control': 'Power Control',
    'virtual_media_mount': 'Virtual Media Mount',
    'virtual_media_unmount': 'Virtual Media Unmount',
    'bios_get': 'BIOS Get',
    'bios_set': 'BIOS Set',
    'idrac_config': 'iDRAC Config',
    'rolling_cluster_update': 'Rolling Cluster Update',
    'cluster_safety_check': 'Cluster Safety Check',
    'run_replication_sync': 'Replication Sync',
    'esxi_upgrade': 'ESXi Upgrade',
  };
  
  return typeMap[type] || type
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
};

export function useJobTypeSummaries(jobs: Job[]): JobTypeSummary[] {
  return useMemo(() => {
    // Group jobs by type
    const jobsByType = new Map<string, Job[]>();
    
    for (const job of jobs) {
      const existing = jobsByType.get(job.job_type) || [];
      existing.push(job);
      jobsByType.set(job.job_type, existing);
    }
    
    // Calculate summaries for each type
    const summaries: JobTypeSummary[] = [];
    
    for (const [jobType, typeJobs] of jobsByType.entries()) {
      // Sort by created_at descending
      const sortedJobs = [...typeJobs].sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      
      // Find current running or pending job
      const currentJob = sortedJobs.find(j => 
        j.status === 'running' || j.status === 'pending'
      ) || null;
      
      // Find last completed job
      const lastCompleted = sortedJobs.find(j => j.status === 'completed') || null;
      
      // Find last failed job
      const lastFailed = sortedJobs.find(j => j.status === 'failed') || null;
      
      // Get all running and pending jobs for bulk cancellation
      const runningJobs = sortedJobs.filter(j => j.status === 'running');
      const pendingJobs = sortedJobs.filter(j => j.status === 'pending');
      
      // Calculate stats
      const successCount = sortedJobs.filter(j => j.status === 'completed').length;
      const failureCount = sortedJobs.filter(j => j.status === 'failed').length;
      const cancelledCount = sortedJobs.filter(j => j.status === 'cancelled').length;
      const pendingCount = pendingJobs.length;
      const runningCount = runningJobs.length;
      
      // Calculate average duration for completed jobs
      const completedJobs = sortedJobs.filter(j => 
        j.status === 'completed' && j.started_at && j.completed_at
      );
      
      let avgDurationMs = 0;
      if (completedJobs.length > 0) {
        const totalDuration = completedJobs.reduce((sum, j) => {
          const start = new Date(j.started_at!).getTime();
          const end = new Date(j.completed_at!).getTime();
          return sum + (end - start);
        }, 0);
        avgDurationMs = totalDuration / completedJobs.length;
      }
      
      summaries.push({
        jobType,
        label: formatJobTypeLabel(jobType),
        currentJob,
        lastCompleted,
        lastFailed,
        latestJob: sortedJobs[0],
        stats: {
          totalRuns: sortedJobs.length,
          successCount,
          failureCount,
          cancelledCount,
          pendingCount,
          runningCount,
          avgDurationMs,
        },
        activeJobs: {
          running: runningJobs,
          pending: pendingJobs,
        },
      });
    }
    
    // Sort by most recent activity
    summaries.sort((a, b) => 
      new Date(b.latestJob.created_at).getTime() - new Date(a.latestJob.created_at).getTime()
    );
    
    return summaries;
  }, [jobs]);
}
