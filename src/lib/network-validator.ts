import { supabase } from "@/integrations/supabase/client";

interface ValidationResults {
  servers: { tested: number; passed: number; failed: number };
  vcenter: { tested: boolean; passed: boolean };
  dns: { tested: boolean; passed: boolean };
  overallStatus: 'passed' | 'failed' | 'partial';
}

interface ExecutionLogEntry {
  step: string;
  status: 'success' | 'error';
  message: string;
  timestamp: string;
}

interface ValidationResponse {
  results: ValidationResults;
  executionLog: ExecutionLogEntry[];
}

export async function validateNetworkPrerequisites(): Promise<ValidationResponse> {
  try {
    // Call the edge function instead of direct browser fetch
    // This avoids CORS issues with iDRAC, vCenter, and external URLs
    const { data, error } = await supabase.functions.invoke('validate-network-prerequisites');
    
    if (error) {
      return {
        results: {
          servers: { tested: 0, passed: 0, failed: 0 },
          vcenter: { tested: false, passed: false },
          dns: { tested: false, passed: false },
          overallStatus: 'failed',
        },
        executionLog: [
          { 
            step: 'init', 
            status: 'error', 
            message: `Edge function error: ${error.message}`, 
            timestamp: new Date().toISOString() 
          }
        ]
      };
    }
    
    return data;
  } catch (error: any) {
    return {
      results: {
        servers: { tested: 0, passed: 0, failed: 0 },
        vcenter: { tested: false, passed: false },
        dns: { tested: false, passed: false },
        overallStatus: 'failed',
      },
      executionLog: [
        { 
          step: 'error', 
          status: 'error', 
          message: `Validation failed: ${error.message}`, 
          timestamp: new Date().toISOString() 
        }
      ]
    };
  }
}

export async function getNetworkDiagnostics() {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get activity settings
    const { data: settings } = await supabase
      .from('activity_settings')
      .select('*')
      .maybeSingle();

    // Get recent errors
    const { data: recentErrors } = await supabase
      .from('idrac_commands')
      .select('*')
      .eq('success', false)
      .gte('timestamp', yesterday.toISOString())
      .order('timestamp', { ascending: false })
      .limit(10);

    // Get active jobs count
    const { count: activeJobsCount } = await supabase
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .in('status', ['pending', 'running']);

    // Get average latency for successful commands
    const { data: latencyData } = await supabase
      .from('idrac_commands')
      .select('response_time_ms')
      .eq('success', true)
      .gte('timestamp', yesterday.toISOString())
      .not('response_time_ms', 'is', null);

    let avgLatency = 0;
    if (latencyData && latencyData.length > 0) {
      const sum = latencyData.reduce((acc, cmd) => acc + (cmd.response_time_ms || 0), 0);
      avgLatency = Math.round(sum / latencyData.length);
    }

    // Get success rate
    const { count: totalCommands } = await supabase
      .from('idrac_commands')
      .select('*', { count: 'exact', head: true })
      .gte('timestamp', yesterday.toISOString());

    const { count: successfulCommands } = await supabase
      .from('idrac_commands')
      .select('*', { count: 'exact', head: true })
      .eq('success', true)
      .gte('timestamp', yesterday.toISOString());

    let successRate = 0;
    if (totalCommands && totalCommands > 0) {
      successRate = Math.round((successfulCommands || 0) / totalCommands * 100);
    }

    return {
      activeJobs: activeJobsCount || 0,
      recentErrors: recentErrors || [],
      avgLatency,
      successRate,
      settings: settings || null,
    };
  } catch (error) {
    console.error('Failed to fetch network diagnostics:', error);
    throw error;
  }
}
