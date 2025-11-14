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

async function logValidationStep(
  step: string,
  status: 'success' | 'error',
  message: string,
  serverId?: string
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    await supabase.from('idrac_commands').insert({
      server_id: serverId || null,
      command_type: step,
      endpoint: '/',
      full_url: 'validation',
      status_code: status === 'success' ? 200 : 500,
      response_time_ms: 0,
      success: status === 'success',
      error_message: status === 'error' ? message : null,
      initiated_by: user?.id,
      source: 'network_prerequisites',
    });
  } catch (error) {
    console.error('Failed to log validation step:', error);
  }
}

export async function validateNetworkPrerequisites(): Promise<ValidationResponse> {
  const executionLog: ExecutionLogEntry[] = [];
  const results: ValidationResults = {
    servers: { tested: 0, passed: 0, failed: 0 },
    vcenter: { tested: false, passed: false },
    dns: { tested: false, passed: false },
    overallStatus: 'passed',
  };
  
  const addLog = (step: string, status: 'success' | 'error', message: string) => {
    executionLog.push({ step, status, message, timestamp: new Date().toISOString() });
  };
  
  try {
    addLog('init', 'success', 'Starting network prerequisites validation');
    
    // Test server connectivity
    const { data: servers } = await supabase
      .from('servers')
      .select('id, hostname, ip_address')
      .order('hostname');
    
    if (servers && servers.length > 0) {
      addLog('servers_found', 'success', `Found ${servers.length} servers to test`);
      
      for (const server of servers) {
        results.servers.tested++;
        const testUrl = `https://${server.ip_address}/redfish/v1/`;
        
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          
          const response = await fetch(testUrl, {
            method: 'GET',
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          
          if (response.ok || response.status === 401) {
            results.servers.passed++;
            addLog('server_test', 'success', `✓ ${server.hostname || server.ip_address}: Reachable`);
            await logValidationStep('network_validation_server', 'success', 'Server reachable', server.id);
          } else {
            results.servers.failed++;
            addLog('server_test', 'error', `✗ ${server.hostname || server.ip_address}: HTTP ${response.status}`);
            await logValidationStep('network_validation_server', 'error', `HTTP ${response.status}`, server.id);
          }
        } catch (error: any) {
          results.servers.failed++;
          const errorMsg = error.name === 'AbortError' ? 'Timeout' : error.message;
          addLog('server_test', 'error', `✗ ${server.hostname || server.ip_address}: ${errorMsg}`);
          await logValidationStep('network_validation_server', 'error', errorMsg, server.id);
        }
      }
    } else {
      addLog('servers_found', 'success', 'No servers configured to test');
    }
    
    // Test vCenter connectivity
    const { data: vcenterSettings } = await supabase
      .from('vcenter_settings')
      .select('*')
      .maybeSingle();
    
    if (vcenterSettings) {
      results.vcenter.tested = true;
      const vcenterUrl = `https://${vcenterSettings.host}:${vcenterSettings.port}/api`;
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(vcenterUrl, {
          method: 'GET',
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok || response.status === 401) {
          results.vcenter.passed = true;
          addLog('vcenter_test', 'success', `✓ vCenter (${vcenterSettings.host}): Reachable`);
          await logValidationStep('network_validation_vcenter', 'success', 'vCenter reachable');
        } else {
          addLog('vcenter_test', 'error', `✗ vCenter: HTTP ${response.status}`);
          await logValidationStep('network_validation_vcenter', 'error', `HTTP ${response.status}`);
        }
      } catch (error: any) {
        const errorMsg = error.name === 'AbortError' ? 'Timeout' : error.message;
        addLog('vcenter_test', 'error', `✗ vCenter: ${errorMsg}`);
        await logValidationStep('network_validation_vcenter', 'error', errorMsg);
      }
    } else {
      addLog('vcenter_test', 'success', 'vCenter not configured (skipped)');
    }
    
    // Test DNS resolution
    results.dns.tested = true;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('https://1.1.1.1/', {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      results.dns.passed = true;
      addLog('dns_test', 'success', '✓ DNS Resolution: Working');
      await logValidationStep('network_validation_dns', 'success', 'DNS working');
    } catch (error: any) {
      const errorMsg = error.name === 'AbortError' ? 'Timeout' : error.message;
      addLog('dns_test', 'error', `✗ DNS Resolution: ${errorMsg}`);
      await logValidationStep('network_validation_dns', 'error', errorMsg);
    }
    
    // Determine overall status
    const hasFailures = results.servers.failed > 0 || 
                       (results.vcenter.tested && !results.vcenter.passed) ||
                       (results.dns.tested && !results.dns.passed);
    
    const hasSuccesses = results.servers.passed > 0 || 
                        results.vcenter.passed || 
                        results.dns.passed;
    
    if (hasFailures && hasSuccesses) {
      results.overallStatus = 'partial';
      addLog('complete', 'success', 'Validation complete with some failures');
    } else if (hasFailures) {
      results.overallStatus = 'failed';
      addLog('complete', 'error', 'Validation failed');
    } else {
      results.overallStatus = 'passed';
      addLog('complete', 'success', 'All validation checks passed');
    }
    
    return { results, executionLog };
  } catch (error: any) {
    addLog('error', 'error', `Validation error: ${error.message}`);
    results.overallStatus = 'failed';
    return { results, executionLog };
  }
}

export async function getNetworkDiagnostics() {
  try {
    const diagnostics = {
      activeConnections: 0,
      recentErrors: [] as any[],
      avgLatency: 0,
      successRate: 0,
      timestamp: new Date().toISOString(),
    };
    
    // Get recent iDRAC command statistics (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: recentCommands } = await supabase
      .from('idrac_commands')
      .select('success, response_time_ms, error_message, created_at, endpoint')
      .gte('created_at', oneDayAgo)
      .order('created_at', { ascending: false });
    
    if (recentCommands && recentCommands.length > 0) {
      // Calculate success rate
      const successCount = recentCommands.filter(cmd => cmd.success).length;
      diagnostics.successRate = Math.round((successCount / recentCommands.length) * 100);
      
      // Calculate average latency
      const validLatencies = recentCommands
        .filter(cmd => cmd.response_time_ms !== null)
        .map(cmd => cmd.response_time_ms);
      
      if (validLatencies.length > 0) {
        diagnostics.avgLatency = Math.round(
          validLatencies.reduce((sum, val) => sum + val, 0) / validLatencies.length
        );
      }
      
      // Get recent errors (last 10)
      diagnostics.recentErrors = recentCommands
        .filter(cmd => !cmd.success)
        .slice(0, 10)
        .map(cmd => ({
          timestamp: cmd.created_at,
          endpoint: cmd.endpoint,
          error: cmd.error_message,
        }));
    }
    
    // Count active/recent jobs as a proxy for active connections
    const { count: activeJobs } = await supabase
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .in('status', ['pending', 'running']);
    
    diagnostics.activeConnections = activeJobs || 0;
    
    return diagnostics;
  } catch (error: any) {
    throw new Error(`Failed to fetch diagnostics: ${error.message}`);
  }
}
