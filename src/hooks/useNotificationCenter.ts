import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type Job = Database['public']['Tables']['jobs']['Row'];
type JobTask = Database['public']['Tables']['job_tasks']['Row'];
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

export const useNotificationCenter = () => {
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const [recentCommands, setRecentCommands] = useState<IdracCommand[]>([]);
  const [jobProgress, setJobProgress] = useState<Map<string, JobProgress>>(new Map());
  const [unreadCount, setUnreadCount] = useState(0);
  const [settings, setSettings] = useState<NotificationSettings>({
    enabled: true,
    showProgress: true,
    soundEnabled: false,
    browserNotifications: false,
    maxRecentItems: 10,
  });

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
    if (!settings.enabled) return;

    fetchActiveJobs();
    
    const channel = supabase
      .channel('notification-jobs')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs',
        },
        (payload) => {
          console.log('Job change received:', payload);
          fetchActiveJobs();
        }
      )
      .subscribe((status) => {
        console.log('Jobs subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [settings.enabled]);

  // Subscribe to command changes
  useEffect(() => {
    if (!settings.enabled) return;

    fetchRecentCommands();
    
    const channel = supabase
      .channel('notification-commands')
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
      .subscribe((status) => {
        console.log('Commands subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [settings.enabled]);

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

  return {
    activeJobs,
    recentCommands,
    jobProgress,
    unreadCount,
    settings,
    updateSettings,
    refreshJobs: fetchActiveJobs,
    refreshCommands: fetchRecentCommands,
  };
};
