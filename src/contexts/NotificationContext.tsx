import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { INTERNAL_JOB_TYPES, SLA_MONITORING_JOB_TYPES } from '@/lib/job-constants';

// Combined list of job types to filter from notifications
const FILTERED_JOB_TYPES = [...INTERNAL_JOB_TYPES, ...SLA_MONITORING_JOB_TYPES];

type Job = Database['public']['Tables']['jobs']['Row'];
type IdracCommand = Database['public']['Tables']['idrac_commands']['Row'];

export interface JobProgress {
  jobId: string;
  totalTasks: number;
  completedTasks: number;
  currentStatus: string;
  progressPercent: number;
  elapsedTime: string;
  estimatedRemaining?: string;
  isWorkflow?: boolean;
}

export type ToastLevel = 'errors_only' | 'errors_and_warnings' | 'all';

export interface NotificationSettings {
  enabled: boolean;
  showProgress: boolean;
  soundEnabled: boolean;
  browserNotifications: boolean;
  maxRecentItems: number;
  toastLevel: ToastLevel;
}

interface RecentlyCompletedJob {
  job: Job;
  completedAt: number;
}

interface NotificationContextType {
  activeJobs: Job[];
  recentlyCompletedJobs: Job[];
  recentCommands: IdracCommand[];
  jobProgress: Map<string, JobProgress>;
  unreadCount: number;
  settings: NotificationSettings;
  updateSettings: (newSettings: Partial<NotificationSettings>) => void;
  refreshJobs: () => Promise<void>;
  refreshCommands: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// Helper to format job type for display
const formatJobType = (type: string): string => {
  const typeMap: Record<string, string> = {
    'discovery_scan': 'Initial Server Sync',
    'test_credentials': 'Credential Test',
    'refresh_existing_servers': 'Server Refresh',
    'scp_export': 'SCP Backup',
    'scp_import': 'SCP Restore',
    'power_control': 'Power Control',
    'firmware_update': 'Firmware Update',
    'vcenter_sync': 'vCenter Sync',
    'virtual_media': 'Virtual Media',
    'bios_config': 'BIOS Configuration',
    'boot_config': 'Boot Configuration',
  };
  return typeMap[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

// Helper to show job state toast notifications based on toast level
const showJobStateToast = (job: Job, previousStatus: string, toastLevel: ToastLevel) => {
  const jobTypeName = formatJobType(job.job_type);
  
  // Always show errors
  if (job.status === 'failed' && previousStatus !== 'failed') {
    const errorMsg = typeof job.details === 'object' && job.details !== null 
      ? (job.details as any).error 
      : undefined;
    toast.error(`Job Failed: ${jobTypeName}`, {
      description: errorMsg || 'Job encountered an error',
      duration: 8000,
    });
    return;
  }
  
  // Show warnings only if level allows
  if (toastLevel === 'errors_and_warnings' || toastLevel === 'all') {
    if (job.status === 'cancelled' && previousStatus !== 'cancelled') {
      toast.warning(`Job Cancelled: ${jobTypeName}`, {
        description: 'Job was cancelled',
        duration: 4000,
      });
      return;
    }
  }
  
  // Show info/success only if level is 'all'
  if (toastLevel === 'all') {
    if (job.status === 'running' && previousStatus === 'pending') {
      toast.info(`Job Started: ${jobTypeName}`, {
        description: 'Job is now running',
        duration: 4000,
      });
    } else if (job.status === 'completed' && previousStatus !== 'completed') {
      toast.success(`Job Completed: ${jobTypeName}`, {
        description: 'Job finished successfully',
        duration: 5000,
      });
    }
  }
};

const RECENTLY_COMPLETED_DURATION_MS = 15000; // 15 seconds
const TOAST_DEDUP_WINDOW_MS = 2000; // 2 seconds dedup window

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const [recentlyCompletedJobs, setRecentlyCompletedJobs] = useState<RecentlyCompletedJob[]>([]);
  const [recentCommands, setRecentCommands] = useState<IdracCommand[]>([]);
  const [jobProgress, setJobProgress] = useState<Map<string, JobProgress>>(new Map());
  const [unreadCount, setUnreadCount] = useState(0);
  const [previousJobStatuses, setPreviousJobStatuses] = useState<Map<string, string>>(new Map());
  const [settings, setSettings] = useState<NotificationSettings>({
    enabled: true,
    showProgress: true,
    soundEnabled: false,
    browserNotifications: false,
    maxRecentItems: 10,
    toastLevel: 'errors_only',
  });

  // Use ref to avoid stale closures in subscription callbacks
  const previousJobStatusesRef = useRef<Map<string, string>>(new Map());
  const recentlyCompletedRef = useRef<RecentlyCompletedJob[]>([]);
  // Track recent toasts to prevent duplicates
  const recentToastsRef = useRef<Map<string, number>>(new Map());
  // Settings ref for subscription callbacks
  const settingsRef = useRef<NotificationSettings>(settings);

  // Keep refs in sync with state
  useEffect(() => {
    previousJobStatusesRef.current = previousJobStatuses;
  }, [previousJobStatuses]);

  useEffect(() => {
    recentlyCompletedRef.current = recentlyCompletedJobs;
  }, [recentlyCompletedJobs]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Cleanup recently completed jobs after duration
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setRecentlyCompletedJobs(prev => 
        prev.filter(item => now - item.completedAt < RECENTLY_COMPLETED_DURATION_MS)
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Add job to recently completed list
  const addRecentlyCompleted = useCallback((job: Job) => {
    setRecentlyCompletedJobs(prev => {
      // Don't add if already in list
      if (prev.some(item => item.job.id === job.id)) return prev;
      return [...prev, { job, completedAt: Date.now() }];
    });
  }, []);

  // Fetch active jobs (excluding internal job types)
  const fetchActiveJobs = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .in('status', ['pending', 'running'])
        .not('job_type', 'in', `(${FILTERED_JOB_TYPES.join(',')})`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setActiveJobs(data || []);
      setUnreadCount((data || []).length);
    } catch (error) {
      console.error('Error fetching active jobs:', error);
    }
  }, []);

  // Fetch recent commands
  const fetchRecentCommands = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('idrac_commands')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(settings.maxRecentItems);

      if (error) throw error;
      setRecentCommands(data || []);
    } catch (error) {
      console.error('Error fetching recent commands:', error);
    }
  }, [settings.maxRecentItems]);

  // Calculate job progress - use job.details first, then task-based fallback
  const calculateJobProgress = useCallback(async (job: Job) => {
    try {
      const { data: tasks, error } = await supabase
        .from('job_tasks')
        .select('*')
        .eq('job_id', job.id);

      if (error) throw error;

      const totalTasks = tasks?.length || 0;
      const completedTasks = tasks?.filter(t => t.status === 'completed').length || 0;
      const runningTask = tasks?.find(t => t.status === 'running');
      
      const elapsedMs = Date.now() - new Date(job.started_at || job.created_at).getTime();
      const elapsedMinutes = Math.floor(elapsedMs / 60000);
      const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);
      const elapsedTime = elapsedMinutes > 0 
        ? `${elapsedMinutes}m ${elapsedSeconds}s` 
        : `${elapsedSeconds}s`;

      let currentStatus = 'Queued';
      if (job.status === 'running') {
        if (runningTask) {
          const logLines = runningTask.log?.split('\n') || [];
          const lastLine = logLines[logLines.length - 1] || '';
          currentStatus = lastLine.trim() || 'Processing...';
        } else {
          currentStatus = 'Starting...';
        }
      }

      // Calculate progress from job.details first (same logic as useJobsWithProgress)
      const calculatedFromDetails = (() => {
        const details = job.details;
        if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
        
        // Explicit progress_percent
        if ('progress_percent' in details && details.progress_percent !== undefined && details.progress_percent !== null) {
          return typeof details.progress_percent === 'number' ? details.progress_percent : null;
        }
        
        // vCenter sync: vms_processed / vms_total
        if ('vms_total' in details && 'vms_processed' in details && 
            typeof details.vms_total === 'number' && typeof details.vms_processed === 'number' && 
            details.vms_total > 0) {
          return Math.round((details.vms_processed / details.vms_total) * 100);
        }
        
        // Discovery scan: servers_scanned / total_ips
        if ('total_ips' in details && 'servers_scanned' in details && 
            typeof details.total_ips === 'number' && typeof details.servers_scanned === 'number' && 
            details.total_ips > 0) {
          return Math.round((details.servers_scanned / details.total_ips) * 100);
        }
        
        // Hosts sync: hosts_processed / hosts_total
        if ('hosts_total' in details && typeof details.hosts_total === 'number' && details.hosts_total > 0) {
          const processed = ('hosts_processed' in details && typeof details.hosts_processed === 'number') 
            ? details.hosts_processed 
            : ('hosts_synced' in details && typeof details.hosts_synced === 'number') 
            ? details.hosts_synced 
            : null;
          if (processed !== null) {
            return Math.round((processed / details.hosts_total) * 100);
          }
        }
        
        // Multi-server jobs: current_server_index / total_servers
        if ('total_servers' in details && 'current_server_index' in details && 
            typeof details.total_servers === 'number' && typeof details.current_server_index === 'number' && 
            details.total_servers > 0) {
          return Math.round(((details.current_server_index + 1) / details.total_servers) * 100);
        }
        
        // Health check or multi-server with counts
        if ('total_servers' in details && typeof details.total_servers === 'number' && details.total_servers > 0) {
          if ('success_count' in details || 'failed_count' in details) {
            const completed = (typeof details.success_count === 'number' ? details.success_count : 0) + 
                             (typeof details.failed_count === 'number' ? details.failed_count : 0);
            return Math.round((completed / details.total_servers) * 100);
          }
          if ('results' in details && Array.isArray(details.results)) {
            return Math.round((details.results.length / details.total_servers) * 100);
          }
        }
        
        return null;
      })();

      // Fallback: Query workflow_executions for workflow-based jobs
      let workflowProgress: number | null = null;
      let workflowCurrentStep: string | null = null;
      let workflowTotalSteps = 0;
      let workflowCompletedSteps = 0;
      
      if (calculatedFromDetails === null && totalTasks === 0) {
        const { data: workflowSteps } = await supabase
          .from('workflow_executions')
          .select('step_name, step_status')
          .eq('job_id', job.id)
          .order('step_number', { ascending: true });
        
        if (workflowSteps && workflowSteps.length > 0) {
          workflowTotalSteps = workflowSteps.length;
          workflowCompletedSteps = workflowSteps.filter(s => 
            ['completed', 'skipped'].includes(s.step_status)
          ).length;
          workflowProgress = Math.round((workflowCompletedSteps / workflowTotalSteps) * 100);
          
          // Get current step from running workflow execution
          const runningStep = workflowSteps.find(s => s.step_status === 'running');
          if (runningStep) {
            workflowCurrentStep = runningStep.step_name?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || null;
          }
        }
      }

      // Extract iDRAC job queue for firmware updates
      let idracCurrentStatus: string | null = null;
      const details = job.details;
      if (details && typeof details === 'object' && !Array.isArray(details) && 'idrac_job_queue' in details) {
        const idracQueue = (details as any).idrac_job_queue as Array<{
          id: string;
          name: string;
          job_state: string;
          percent_complete: number;
        }>;
        
        if (Array.isArray(idracQueue) && idracQueue.length > 0) {
          const runningIdracJobs = idracQueue.filter(j => 
            j.job_state?.toLowerCase() === 'running'
          );
          
          if (runningIdracJobs.length > 0) {
            const firstRunning = runningIdracJobs[0];
            idracCurrentStatus = `${firstRunning.name} (${firstRunning.percent_complete}%)`;
          } else {
            const scheduledJobs = idracQueue.filter(j => 
              ['scheduled', 'new', 'downloaded'].includes(j.job_state?.toLowerCase())
            );
            if (scheduledJobs.length > 0) {
              idracCurrentStatus = `${scheduledJobs.length} iDRAC jobs queued`;
            }
          }
        }
      }

      // Use details-based progress if available, otherwise workflow/task-based, otherwise minimum for running
      let progressPercent = 0;
      if (calculatedFromDetails !== null) {
        progressPercent = calculatedFromDetails;
      } else if (workflowProgress !== null) {
        progressPercent = workflowProgress;
      } else if (totalTasks > 0) {
        const completedProgress = (completedTasks / totalTasks) * 100;
        const runningProgress = runningTask ? ((runningTask.progress || 0) / totalTasks) : 0;
        progressPercent = Math.min(100, Math.round(completedProgress + runningProgress));
      } else if (job.status === 'running') {
        progressPercent = 5; // Minimum indicator for running jobs with no progress data
      }

      // Priority: iDRAC queue > workflow step > task log
      if (idracCurrentStatus) {
        currentStatus = idracCurrentStatus;
      } else if (workflowCurrentStep) {
        currentStatus = workflowCurrentStep;
      }

      // Use workflow step counts if no tasks exist
      const finalTotalTasks = totalTasks > 0 ? totalTasks : workflowTotalSteps;
      const finalCompletedTasks = totalTasks > 0 ? completedTasks : workflowCompletedSteps;

      const progress: JobProgress = {
        jobId: job.id,
        totalTasks: finalTotalTasks,
        completedTasks: finalCompletedTasks,
        currentStatus,
        progressPercent,
        elapsedTime,
        isWorkflow: workflowTotalSteps > 0,
      };

      setJobProgress(prev => new Map(prev).set(job.id, progress));
    } catch (error) {
      console.error('Error calculating job progress:', error);
    }
  }, []);

  // Fetch job progress for all active jobs
  const fetchAllJobProgress = useCallback(async () => {
    for (const job of activeJobs) {
      await calculateJobProgress(job);
    }
  }, [activeJobs, calculateJobProgress]);

  // Subscribe to job changes
  useEffect(() => {
    if (!settings.enabled || !session) return;

    fetchActiveJobs();
    
    const channel = supabase
      .channel('global-notification-jobs')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs',
        },
        (payload) => {
          console.log('Job change received:', payload);
          
          const newJob = payload.new as Job | null;
          const oldJob = payload.old as Job | null;
          
          // Skip notifications for internal and SLA monitoring job types
          if (newJob && (FILTERED_JOB_TYPES as readonly string[]).includes(newJob.job_type)) {
            return;
          }
          
          // Check if job is silent (should not show toast notifications)
          const isSilentJob = (job: Job | null): boolean => {
            if (!job) return false;
            const details = job.details;
            return typeof details === 'object' && details !== null && (details as any).silent === true;
          };
          
          // Detect state transitions and show toasts
          if (payload.eventType === 'UPDATE' && oldJob && newJob) {
            // Use ref to get current status map (avoids stale closure)
            const previousStatus = previousJobStatusesRef.current.get(newJob.id) || oldJob.status;
            if (previousStatus !== newJob.status) {
              // Only show toast if job is NOT silent
              if (!isSilentJob(newJob)) {
                showJobStateToast(newJob, previousStatus, settingsRef.current.toastLevel);
              }
              setPreviousJobStatuses(prev => new Map(prev).set(newJob.id, newJob.status));
              
              // Track recently completed jobs so they remain visible briefly
              if (newJob.status === 'completed' || newJob.status === 'failed') {
                addRecentlyCompleted(newJob);
              }
            }
          } else if (payload.eventType === 'INSERT' && newJob) {
            // Only show toast if job is NOT silent and toast level is 'all'
            if (!isSilentJob(newJob) && settingsRef.current.toastLevel === 'all') {
              // New job created - check for duplicate toasts
              const toastKey = `${newJob.id}-queued`;
              const now = Date.now();
              const lastToastTime = recentToastsRef.current.get(toastKey);
              
              // Only show toast if we haven't shown one for this job recently
              if (!lastToastTime || (now - lastToastTime) > TOAST_DEDUP_WINDOW_MS) {
                recentToastsRef.current.set(toastKey, now);
                toast.info(`Job Queued: ${formatJobType(newJob.job_type)}`, {
                  description: 'Job added to queue',
                  duration: 3000,
                });
              }
            }
            setPreviousJobStatuses(prev => new Map(prev).set(newJob.id, newJob.status));
          }
          
          fetchActiveJobs();
        }
      )
      .subscribe((status, err) => {
        console.log('Jobs subscription status:', status);
        if (err) {
          console.error('Jobs subscription error:', err);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [settings.enabled, session, fetchActiveJobs, addRecentlyCompleted]);

  // Subscribe to command changes
  useEffect(() => {
    if (!settings.enabled || !session) return;

    fetchRecentCommands();
    
    const channel = supabase
      .channel('global-notification-commands')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'idrac_commands',
        },
        (payload) => {
          console.log('Command change received:', payload);
          fetchRecentCommands();
        }
      )
      .subscribe((status, err) => {
        console.log('Commands subscription status:', status);
        if (err) {
          console.error('Commands subscription error:', err);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [settings.enabled, session, fetchRecentCommands]);

  // Poll job progress
  useEffect(() => {
    if (!settings.enabled || !settings.showProgress || activeJobs.length === 0) return;

    fetchAllJobProgress();
    const interval = setInterval(fetchAllJobProgress, 2000);

    return () => clearInterval(interval);
  }, [settings.enabled, settings.showProgress, activeJobs, fetchAllJobProgress]);

  // Load settings from localStorage
  useEffect(() => {
    const savedSettings = localStorage.getItem('notificationSettings');
    if (savedSettings) {
      try {
        setSettings(JSON.parse(savedSettings));
      } catch (error) {
        console.error('Error loading notification settings:', error);
      }
    }
  }, []);

  // Save settings to localStorage
  const updateSettings = useCallback((newSettings: Partial<NotificationSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      localStorage.setItem('notificationSettings', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Get recently completed jobs as plain array
  const recentlyCompletedJobsArray = recentlyCompletedJobs.map(item => item.job);

  return (
    <NotificationContext.Provider
      value={{
        activeJobs,
        recentlyCompletedJobs: recentlyCompletedJobsArray,
        recentCommands,
        jobProgress,
        unreadCount,
        settings,
        updateSettings,
        refreshJobs: fetchActiveJobs,
        refreshCommands: fetchRecentCommands,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within NotificationProvider');
  }
  return context;
}
