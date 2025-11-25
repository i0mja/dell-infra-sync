import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ApiCall {
  id: string;
  timestamp: string;
  command_type: string;
  endpoint: string;
  full_url: string;
  request_headers: any;
  request_body: any;
  status_code: number | null;
  response_time_ms: number | null;
  response_body: any;
  success: boolean;
  error_message: string | null;
  operation_type: string;
  server_id: string | null;
}

export const useJobApiStream = (jobId: string | null) => {
  const [apiCalls, setApiCalls] = useState<ApiCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(true);

  useEffect(() => {
    if (!jobId) return;

    const fetchInitialCalls = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('idrac_commands')
          .select('*')
          .eq('job_id', jobId)
          .order('timestamp', { ascending: true });

        if (error) throw error;
        setApiCalls(data || []);
      } catch (error) {
        console.error('Error fetching API calls:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchInitialCalls();

    // Subscribe to new API calls
    const channel = supabase
      .channel(`job-api-stream-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'idrac_commands',
          filter: `job_id=eq.${jobId}`
        },
        (payload) => {
          if (isLive) {
            setApiCalls((prev) => [...prev, payload.new as ApiCall]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, isLive]);

  const toggleLive = () => setIsLive(!isLive);
  
  const clearCalls = () => setApiCalls([]);

  const copyAllToClipboard = () => {
    const text = apiCalls.map(call => 
      `[${new Date(call.timestamp).toLocaleTimeString()}] ${call.command_type} ${call.endpoint} - ${call.status_code || 'N/A'}`
    ).join('\n');
    navigator.clipboard.writeText(text);
  };

  return {
    apiCalls,
    loading,
    isLive,
    toggleLive,
    clearCalls,
    copyAllToClipboard
  };
};
