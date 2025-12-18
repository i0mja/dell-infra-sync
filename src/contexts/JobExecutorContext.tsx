import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getJobExecutorStatus, JobExecutorStatusResponse } from '@/lib/job-executor-api';

export interface ExecutorHeartbeat {
  id: string;
  executor_id: string;
  hostname: string | null;
  ip_address: string | null;
  version: string | null;
  last_seen_at: string;
  poll_count: number;
  jobs_processed: number;
  startup_time: string | null;
  last_error: string | null;
  capabilities: string[] | null;
}

export type ExecutorStatus = 'online' | 'idle' | 'offline' | 'unknown';

interface JobExecutorState {
  status: ExecutorStatus;
  heartbeat: ExecutorHeartbeat | null;
  apiStatus: JobExecutorStatusResponse | null;
  isLoading: boolean;
  lastChecked: Date | null;
  checkHealth: () => Promise<boolean>;
  refresh: () => void;
  refreshApiStatus: () => Promise<void>;
}

const JobExecutorContext = createContext<JobExecutorState | undefined>(undefined);

// Polling interval for fallback (60 seconds - only as safety net)
const FALLBACK_POLL_INTERVAL = 60000;

// Thresholds for status calculation (in seconds)
const ONLINE_THRESHOLD = 30;
const IDLE_THRESHOLD = 120;

export function JobExecutorProvider({ children }: { children: React.ReactNode }) {
  const [heartbeat, setHeartbeat] = useState<ExecutorHeartbeat | null>(null);
  const [apiStatus, setApiStatus] = useState<JobExecutorStatusResponse | null>(null);
  const [status, setStatus] = useState<ExecutorStatus>('unknown');
  const [isLoading, setIsLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  
  // Track if we've ever received data
  const hasReceivedData = useRef(false);

  // Fetch heartbeat from database
  const fetchHeartbeat = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('executor_heartbeats')
        .select('*')
        .order('last_seen_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[JobExecutorContext] Error fetching heartbeat:', error);
        return null;
      }

      if (data) {
        hasReceivedData.current = true;
        setHeartbeat(data as ExecutorHeartbeat);
        setLastChecked(new Date());
      }
      
      return data as ExecutorHeartbeat | null;
    } catch (err) {
      console.error('[JobExecutorContext] Heartbeat fetch failed:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch API status from executor's /api/status endpoint
  const refreshApiStatus = useCallback(async () => {
    try {
      const statusResponse = await getJobExecutorStatus();
      setApiStatus(statusResponse);
    } catch (err) {
      console.error('[JobExecutorContext] API status fetch failed:', err);
      setApiStatus(null);
    }
  }, []);

  // Calculate status based on heartbeat timestamp
  const calculateStatus = useCallback((hb: ExecutorHeartbeat | null): ExecutorStatus => {
    if (!hb) return 'unknown';

    const lastSeen = new Date(hb.last_seen_at);
    const now = new Date();
    const diffSeconds = (now.getTime() - lastSeen.getTime()) / 1000;

    if (diffSeconds < ONLINE_THRESHOLD) return 'online';
    if (diffSeconds < IDLE_THRESHOLD) return 'idle';
    return 'offline';
  }, []);

  // Update status whenever heartbeat changes
  useEffect(() => {
    setStatus(calculateStatus(heartbeat));
  }, [heartbeat, calculateStatus]);

  // Check health via API endpoint
  const checkHealth = useCallback(async (): Promise<boolean> => {
    try {
      const statusResponse = await getJobExecutorStatus();
      setApiStatus(statusResponse);
      return statusResponse !== null;
    } catch {
      setApiStatus(null);
      return false;
    }
  }, []);

  // Manual refresh
  const refresh = useCallback(() => {
    fetchHeartbeat();
    refreshApiStatus();
  }, [fetchHeartbeat, refreshApiStatus]);

  // Initial fetch
  useEffect(() => {
    fetchHeartbeat();
    refreshApiStatus();
  }, [fetchHeartbeat, refreshApiStatus]);

  // Set up realtime subscription - PRIMARY source of updates
  useEffect(() => {
    const channel = supabase
      .channel('job-executor-heartbeat-central')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'executor_heartbeats'
        },
        (payload) => {
          // Direct update from realtime - no need to refetch
          if (payload.new && typeof payload.new === 'object') {
            const newHeartbeat = payload.new as ExecutorHeartbeat;
            hasReceivedData.current = true;
            setHeartbeat(newHeartbeat);
            setLastChecked(new Date());
            setIsLoading(false);
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, []);

  // Fallback polling - only as safety net (every 60s)
  useEffect(() => {
    const interval = setInterval(() => {
      // Only poll if we haven't received realtime updates recently
      const now = new Date();
      if (!lastChecked || (now.getTime() - lastChecked.getTime()) > 30000) {
        fetchHeartbeat();
      }
    }, FALLBACK_POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [fetchHeartbeat, lastChecked]);

  // Periodically recalculate status (every 10 seconds) to handle offline detection
  useEffect(() => {
    const interval = setInterval(() => {
      setStatus(calculateStatus(heartbeat));
    }, 10000);

    return () => clearInterval(interval);
  }, [heartbeat, calculateStatus]);

  const value: JobExecutorState = {
    status,
    heartbeat,
    apiStatus,
    isLoading,
    lastChecked,
    checkHealth,
    refresh,
    refreshApiStatus
  };

  return (
    <JobExecutorContext.Provider value={value}>
      {children}
    </JobExecutorContext.Provider>
  );
}

export function useJobExecutor(): JobExecutorState {
  const context = useContext(JobExecutorContext);
  if (context === undefined) {
    throw new Error('useJobExecutor must be used within a JobExecutorProvider');
  }
  return context;
}
