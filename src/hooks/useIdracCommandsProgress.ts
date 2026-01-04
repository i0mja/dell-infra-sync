import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface RecentCommand {
  id: string;
  timestamp: string;
  time: string;
  endpoint: string;
  endpointLabel: string;
  category: string;
  duration: string;
  durationMs: number;
  statusCode: number | null;
  success: boolean;
  serverIp?: string;
}

export interface CategoryStats {
  category: string;
  totalCalls: number;
  totalDurationMs: number;
  allSuccess: boolean;
  latestTime: string;
  commands: RecentCommand[];
}

/**
 * Get category for an endpoint (for grouping)
 */
function getEndpointCategory(endpoint: string): string {
  const lower = endpoint.toLowerCase();
  if (lower.includes('/server_drives') || lower.includes('/server_nics')) return 'DB Sync';
  if (lower.includes('/storage') || lower.includes('/drives') || lower.includes('/volumes') || lower.includes('/controllers')) return 'Storage';
  if (lower.includes('/networkadapters') || lower.includes('/networkports') || lower.includes('/networkdevicefunctions') || lower.includes('/ethernetinterfaces')) return 'NICs';
  if (lower.includes('/bios')) return 'BIOS';
  if (lower.includes('/thermal') || lower.includes('/temperatures')) return 'Thermal';
  if (lower.includes('/power')) return 'Power';
  if (lower.includes('/managers') || lower.includes('idrac')) return 'iDRAC';
  if (lower.includes('/systems')) return 'System';
  if (lower.includes('/chassis')) return 'Chassis';
  return 'Other';
}

/**
 * Translate a Redfish endpoint to a human-readable label
 */
function getEndpointLabel(endpoint: string): string {
  // Common Redfish endpoint patterns
  const patterns: Array<{ pattern: RegExp; label: string }> = [
    // DB sync operations
    { pattern: /\/server_drives.*upsert/i, label: 'Save Drives' },
    { pattern: /\/server_nics.*upsert/i, label: 'Save NICs' },
    // Storage operations
    { pattern: /\/Storage\/[^/]+\/Volumes/i, label: 'Volumes' },
    { pattern: /\/Volumes/i, label: 'Volumes' },
    { pattern: /\/Drives\/[^/]+/i, label: 'Drive Details' },
    { pattern: /\/Drives/i, label: 'Drives' },
    { pattern: /\/Controllers\/[^/]+/i, label: 'Controller' },
    { pattern: /\/Controllers/i, label: 'Controllers' },
    { pattern: /\/Storage\/[^?]+\?\$expand/i, label: 'Storage Controller' },
    { pattern: /\/Storage\/[^/]+/i, label: 'Storage Controller' },
    { pattern: /\/Storage\?\$expand/i, label: 'Storage' },
    { pattern: /\/Storage$/i, label: 'Storage' },
    // System operations
    { pattern: /\/Systems\/[^/]+\/Bios/i, label: 'BIOS' },
    { pattern: /\/Systems\/[^/]+$/i, label: 'System' },
    // Network operations
    { pattern: /\/NetworkDeviceFunctions\?\$expand/i, label: 'NIC Functions' },
    { pattern: /\/NetworkDeviceFunctions\/[^/]+/i, label: 'NIC Function' },
    { pattern: /\/NetworkDeviceFunctions/i, label: 'NIC Functions' },
    { pattern: /\/NetworkPorts/i, label: 'NIC Ports' },
    { pattern: /\/NetworkAdapters\?\$expand/i, label: 'NICs' },
    { pattern: /\/NetworkAdapters\/[^/]+/i, label: 'NIC Adapter' },
    { pattern: /\/NetworkAdapters/i, label: 'NICs' },
    { pattern: /\/EthernetInterfaces/i, label: 'Ethernet' },
    // Other hardware
    { pattern: /\/Systems\/[^/]+\/Processors/i, label: 'CPUs' },
    { pattern: /\/Systems\/[^/]+\/Memory/i, label: 'Memory' },
    { pattern: /\/Chassis\/[^/]+\/Thermal/i, label: 'Thermal' },
    { pattern: /\/Chassis\/[^/]+\/Power/i, label: 'Power' },
    { pattern: /\/Chassis\/[^/]+$/i, label: 'Chassis' },
    // iDRAC operations
    { pattern: /\/Managers\/[^/]+\/Attributes/i, label: 'iDRAC Config' },
    { pattern: /\/Managers\/[^/]+\/EthernetInterfaces/i, label: 'iDRAC Network' },
    { pattern: /\/Managers\/[^/]+$/i, label: 'iDRAC Info' },
    { pattern: /\/UpdateService/i, label: 'Firmware' },
    { pattern: /\/Dell\/Managers.*Export/i, label: 'SCP Export' },
    { pattern: /\/TaskService\/Tasks/i, label: 'Task Status' },
    // Error cases
    { pattern: /_fetch_storage_drives/i, label: 'Storage Error' },
    { pattern: /_fetch_network_adapters/i, label: 'NICs Error' },
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

function formatCommand(cmd: any): RecentCommand {
  const timestamp = new Date(cmd.timestamp);
  const time = timestamp.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
  
  const durationMs = cmd.response_time_ms ?? 0;
  const duration = durationMs > 0 ? `${durationMs}ms` : '—';
  
  // Treat 'idrac_api_fallback' operations as successful (expected $expand failures that trigger fallback)
  const isFallbackAttempt = cmd.operation_type === 'idrac_api_fallback';
  const effectiveSuccess = isFallbackAttempt ? true : cmd.success;

  return {
    id: cmd.id,
    timestamp: cmd.timestamp,
    time,
    endpoint: cmd.endpoint,
    endpointLabel: getEndpointLabel(cmd.endpoint),
    category: getEndpointCategory(cmd.endpoint),
    duration,
    durationMs,
    statusCode: cmd.status_code,
    success: effectiveSuccess,
    serverIp: extractServerIp(cmd.full_url),
  };
}

export function useIdracCommandsProgress(jobId: string | null, enabled: boolean = true) {
  const [recentCommands, setRecentCommands] = useState<RecentCommand[]>([]);
  const [lastCommandTime, setLastCommandTime] = useState<string | null>(null);
  const [activeServerIp, setActiveServerIp] = useState<string | null>(null);
  const [totalCommands, setTotalCommands] = useState(0);

  // Group commands by category
  const categoryStats = useMemo((): CategoryStats[] => {
    const categories = new Map<string, CategoryStats>();
    
    for (const cmd of recentCommands) {
      const existing = categories.get(cmd.category);
      if (existing) {
        existing.totalCalls++;
        existing.totalDurationMs += cmd.durationMs;
        existing.allSuccess = existing.allSuccess && cmd.success;
        if (cmd.time > existing.latestTime) {
          existing.latestTime = cmd.time;
        }
        existing.commands.push(cmd);
      } else {
        categories.set(cmd.category, {
          category: cmd.category,
          totalCalls: 1,
          totalDurationMs: cmd.durationMs,
          allSuccess: cmd.success,
          latestTime: cmd.time,
          commands: [cmd],
        });
      }
    }
    
    // Sort by latest time descending
    return Array.from(categories.values()).sort((a, b) => 
      b.latestTime.localeCompare(a.latestTime)
    );
  }, [recentCommands]);

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
        .select('id, timestamp, endpoint, full_url, status_code, response_time_ms, success, operation_type')
        .eq('job_id', jobId)
        .order('timestamp', { ascending: false })
        .limit(50);

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
            // Keep only last 50
            return updated.slice(-50);
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
    categoryStats,
    lastCommandTime,
    activeServerIp,
    totalCommands,
  };
}
