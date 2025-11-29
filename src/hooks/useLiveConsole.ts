import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';

type Job = Database['public']['Tables']['jobs']['Row'];
type JobTask = Database['public']['Tables']['job_tasks']['Row'];

interface ConsoleLogEntry {
  id: string;
  timestamp: string;
  jobId: string;
  jobType: string;
  serverId?: string;
  message: string;
  level: 'success' | 'error' | 'warning' | 'info' | 'default';
  rawLog: string;
}

export const useLiveConsole = () => {
  const { session } = useAuth();
  const [logs, setLogs] = useState<ConsoleLogEntry[]>([]);
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string>('all');
  const maxLogs = 500;

  const fetchActiveJobs = async () => {
    const { data } = await supabase
      .from('jobs')
      .select('*')
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: false });
    
    if (data) {
      setActiveJobs(data);
    }
  };

  const formatJobType = (jobType: string): string => {
    return jobType
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const detectLogLevel = (line: string): ConsoleLogEntry['level'] => {
    const lower = line.toLowerCase();
    if (lower.includes('error') || lower.includes('failed') || lower.includes('✗')) {
      return 'error';
    }
    if (lower.includes('warning') || lower.includes('warn') || lower.includes('⚠')) {
      return 'warning';
    }
    if (lower.includes('success') || lower.includes('completed') || lower.includes('✓')) {
      return 'success';
    }
    if (lower.includes('info') || lower.includes('starting') || lower.includes('→')) {
      return 'info';
    }
    return 'default';
  };

  const handleTaskUpdate = (task: JobTask) => {
    if (!task.log) return;

    const job = activeJobs.find(j => j.id === task.job_id);
    if (!job) return;

    const logLines = task.log.split('\n').filter(line => line.trim());
    const newEntries: ConsoleLogEntry[] = logLines.map((line, index) => ({
      id: `${task.id}-${Date.now()}-${index}`,
      timestamp: new Date().toLocaleTimeString('en-US', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }),
      jobId: job.id,
      jobType: formatJobType(job.job_type),
      serverId: task.server_id || undefined,
      message: line,
      level: detectLogLevel(line),
      rawLog: line
    }));

    setLogs(prev => {
      const combined = [...prev, ...newEntries];
      return combined.slice(-maxLogs);
    });
  };

  // Fetch active jobs and subscribe to changes
  useEffect(() => {
    if (!session) return;
    
    fetchActiveJobs();
    
    const channel = supabase
      .channel('live-console-jobs')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jobs',
      }, () => {
        fetchActiveJobs();
      })
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  // Subscribe to task log updates
  useEffect(() => {
    if (!session || isPaused || activeJobs.length === 0) return;
    
    const channel = supabase
      .channel('live-console-tasks')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'job_tasks'
      }, (payload) => {
        handleTaskUpdate(payload.new as JobTask);
      })
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, isPaused, activeJobs]);

  const togglePause = () => setIsPaused(prev => !prev);
  
  const clearConsole = () => setLogs([]);
  
  const filterByJob = (jobId: string) => {
    setSelectedJobId(jobId);
  };

  const filteredLogs = selectedJobId === 'all' 
    ? logs 
    : logs.filter(log => log.jobId === selectedJobId);
  
  const isStreaming = activeJobs.length > 0 && !isPaused;
  
  const copyToClipboard = () => {
    const logText = filteredLogs
      .map(l => `[${l.timestamp}] ${l.jobType}: ${l.message}`)
      .join('\n');
    navigator.clipboard.writeText(logText);
  };

  return {
    logs: filteredLogs,
    activeJobs,
    isStreaming,
    isPaused,
    selectedJobId,
    togglePause,
    clearConsole,
    filterByJob,
    copyToClipboard
  };
};
