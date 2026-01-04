import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface RecentCommand {
  id: string;
  timestamp: string;
  time: string;
  endpoint: string;
  endpointLabel: string;
  duration: string;
  statusCode: number | null;
  success: boolean;
  serverIp?: string;
}

/**
 * Translate a Redfish endpoint to a human-readable label
 */
function getEndpointLabel(endpoint: string): string {
  // Common Redfish endpoint patterns
  const patterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\/Systems\/[^/]+\/Storage/i, label: 'Storage' },
    { pattern: /\/Systems\/[^/]+\/Bios/i, label: 'BIOS' },
    { pattern: /\/Systems\/[^/]+\/NetworkAdapters/i, label: 'NICs' },
    { pattern: /\/Systems\/[^/]+\/EthernetInterfaces/i, label: 'Ethernet' },
    { pattern: /\/Systems\/[^/]+\/Processors/i, label: 'CPUs' },
    { pattern: /\/Systems\/[^/]+\/Memory/i, label: 'Memory' },
    { pattern: /\/Systems\/[^/]+$/i, label: 'System' },
    { pattern: /\/Chassis\/[^/]+\/Thermal/i, label: 'Thermal' },
    { pattern: /\/Chassis\/[^/]+\/Power/i, label: 'Power' },
    { pattern: /\/Chassis\/[^/]+\/NetworkAdapters/i, label: 'NICs' },
    { pattern: /\/Chassis\/[^/]+$/i, label: 'Chassis' },
    { pattern: /\/Managers\/[^/]+\/Attributes/i, label: 'iDRAC Config' },
    { pattern: /\/Managers\/[^/]+\/EthernetInterfaces/i, label: 'iDRAC Network' },
    { pattern: /\/Managers\/[^/]+$/i, label: 'iDRAC Info' },
    { pattern: /\/UpdateService/i, label: 'Firmware' },
    { pattern: /\/Dell\/Managers.*Export/i, label: 'SCP Export' },
    { pattern: /\/TaskService\/Tasks/i, label: 'Task Status' },
    { pattern: /\/Drives/i, label: 'Drives' },
    { pattern: /\/Volumes/i, label: 'Volumes' },
    { pattern: /\/Controllers/i, label: 'Controllers' },
  ];

  for (const { pattern, label } of patterns) {
    if (pattern.test(endpoint)) {
      return label;
    }
  }

  // Fallback: extract last meaningful segment
  const segments = endpoint.split('/').filter(Boolean);
  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    // Clean up common patterns
    if (last.includes('System.Embedded')) return 'System';
    if (last.includes('Chassis')) return 'Chassis';
    return last.slice(0, 20);
  }

  return 'API Call';
}

/**
 * Extract server IP from full URL
 */
function extractServerIp(fullUrl: string): string | undefined {
  const match = fullUrl.match(/https?:\/\/(\d+\.\d+\.\d+\.\d+)/);
  return match?.[1];
}

export function useIdracCommandsProgress(jobId: string | null, enabled: boolean = true) {
  const [recentCommands, setRecentCommands] = useState<RecentCommand[]>([]);
  const [lastCommandTime, setLastCommandTime] = useState<string | null>(null);
  const [activeServerIp, setActiveServerIp] = useState<string | null>(null);
  const [totalCommands, setTotalCommands] = useState(0);

  useEffect(() => {
    if (!jobId || !enabled) {
      setRecentCommands([]);
      setTotalCommands(0);
      return;
    }

    // Fetch initial recent commands
    const fetchRecent = async () => {
      const { data, error } = await supabase
        .from('idrac_commands')
        .select('id, timestamp, endpoint, full_url, status_code, response_time_ms, success')
        .eq('job_id', jobId)
        .order('timestamp', { ascending: false })
        .limit(10);

      if (!error && data) {
        const formatted = data.reverse().map(cmd => formatCommand(cmd));
        setRecentCommands(formatted);
        setTotalCommands(data.length);
        if (formatted.length > 0) {
          const latest = formatted[formatted.length - 1];
          setLastCommandTime(latest.time);
          setActiveServerIp(latest.serverIp || null);
        }
      }
    };

    fetchRecent();

    // Subscribe to new commands
    const channel = supabase
      .channel(`idrac-commands-progress-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'idrac_commands',
          filter: `job_id=eq.${jobId}`
        },
        (payload) => {
          const cmd = payload.new as any;
          const formatted = formatCommand(cmd);
          
          setRecentCommands(prev => {
            const updated = [...prev, formatted];
            // Keep only last 10
            return updated.slice(-10);
          });
          
          setLastCommandTime(formatted.time);
          setActiveServerIp(formatted.serverIp || null);
          setTotalCommands(prev => prev + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, enabled]);

  return {
    recentCommands,
    lastCommandTime,
    activeServerIp,
    totalCommands,
  };
}

function formatCommand(cmd: any): RecentCommand {
  const timestamp = new Date(cmd.timestamp);
  const time = timestamp.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
  
  const duration = cmd.response_time_ms != null 
    ? `${cmd.response_time_ms}ms` 
    : '—';

  return {
    id: cmd.id,
    timestamp: cmd.timestamp,
    time,
    endpoint: cmd.endpoint,
    endpointLabel: getEndpointLabel(cmd.endpoint),
    duration,
    statusCode: cmd.status_code,
    success: cmd.success,
    serverIp: extractServerIp(cmd.full_url),
  };
}

