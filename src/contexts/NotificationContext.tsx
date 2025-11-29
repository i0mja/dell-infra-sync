import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

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
}

export interface NotificationSettings {
  enabled: boolean;
  showProgress: boolean;
  soundEnabled: boolean;
  browserNotifications: boolean;
  maxRecentItems: number;
}

interface NotificationContextType {
  activeJobs: Job[];
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
    'discovery_scan': 'Discovery Scan',
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

// Helper to show job state toast notifications
const showJobStateToast = (job: Job, previousStatus: string) => {
  const jobTypeName = formatJobType(job.job_type);
  
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
  } else if (job.status === 'failed' && previousStatus !== 'failed') {
    const errorMsg = typeof job.details === 'object' && job.details !== null 
      ? (job.details as any).error 
      : undefined;
    toast.error(`Job Failed: ${jobTypeName}`, {
      description: errorMsg || 'Job encountered an error',
      duration: 8000,
    });
  } else if (job.status === 'cancelled' && previousStatus !== 'cancelled') {
    toast.warning(`Job Cancelled: ${jobTypeName}`, {
      description: 'Job was cancelled',
      duration: 4000,
    });
  }
};

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
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
  });

  // Use ref to avoid stale closures in subscription callbacks
  const previousJobStatusesRef = useRef<Map<string, string>>(new Map());

  // Keep ref in sync with state
  useEffect(() => {
    previousJobStatusesRef.current = previousJobStatuses;
  }, [previousJobStatuses]);

  // Fetch active jobs
  const fetchActiveJobs = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .in('status', ['pending', 'running'])
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

  // Calculate job progress with weighted running task progress
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
          // Extract status from task log
          const logLines = runningTask.log?.split('\n') || [];
          const lastLine = logLines[logLines.length - 1] || '';
          currentStatus = lastLine.trim() || 'Processing...';
        } else {
          currentStatus = 'Starting...';
        }
      }

      // Calculate weighted progress including running task's progress
      let progressPercent = 0;
      if (totalTasks > 0) {
        // Each completed task contributes (100 / totalTasks)%
        const completedProgress = (completedTasks / totalTasks) * 100;
        
        // Running task contributes its progress * (100 / totalTasks)%
        const runningProgress = runningTask 
          ? ((runningTask.progress || 0) / totalTasks)
          : 0;
        
        progressPercent = Math.min(100, Math.round(completedProgress + runningProgress));
      }

      const progress: JobProgress = {
        jobId: job.id,
        totalTasks,
        completedTasks,
        currentStatus,
        progressPercent,
        elapsedTime,
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
          
          // Detect state transitions and show toasts
          if (payload.eventType === 'UPDATE' && oldJob && newJob) {
            // Use ref to get current status map (avoids stale closure)
            const previousStatus = previousJobStatusesRef.current.get(newJob.id) || oldJob.status;
            if (previousStatus !== newJob.status) {
              showJobStateToast(newJob, previousStatus);
              setPreviousJobStatuses(prev => new Map(prev).set(newJob.id, newJob.status));
            }
          } else if (payload.eventType === 'INSERT' && newJob) {
            // New job created
            toast.info(`Job Queued: ${formatJobType(newJob.job_type)}`, {
              description: 'Job added to queue',
              duration: 3000,
            });
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
  }, [settings.enabled, session, fetchActiveJobs]);

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

  return (
    <NotificationContext.Provider
      value={{
        activeJobs,
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
