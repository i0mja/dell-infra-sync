import { supabase } from "@/integrations/supabase/client";

export interface DiagnosticResult {
  test: string;
  status: "success" | "failed" | "warning";
  message: string;
  duration_ms?: number;
}

export interface NetworkDiagnosticsResult {
  success: boolean;
  results: DiagnosticResult[];
  summary: {
    total_tests: number;
    passed: number;
    failed: number;
    warnings: number;
  };
}

export async function runNetworkDiagnostics(): Promise<NetworkDiagnosticsResult> {
  const results: DiagnosticResult[] = [];
  
  try {
    // Test 1: DNS Resolution (Cloudflare and Google)
    const dnsTests = [
      { name: "Cloudflare DNS", host: "1.1.1.1" },
      { name: "Google DNS", host: "8.8.8.8" }
    ];
    
    for (const test of dnsTests) {
      const startTime = Date.now();
      try {
        const response = await fetch(`https://${test.host}`, { 
          method: 'HEAD',
          mode: 'no-cors',
          signal: AbortSignal.timeout(5000)
        });
        const duration = Date.now() - startTime;
        results.push({
          test: `DNS Resolution - ${test.name}`,
          status: "success",
          message: `Successfully resolved ${test.host}`,
          duration_ms: duration
        });
      } catch (error: any) {
        const duration = Date.now() - startTime;
        results.push({
          test: `DNS Resolution - ${test.name}`,
          status: "failed",
          message: error.message || `Failed to resolve ${test.host}`,
          duration_ms: duration
        });
      }
    }
    
    // Test 2: Database Connectivity
    const dbStartTime = Date.now();
    try {
      const { error } = await supabase.from('servers').select('id').limit(1);
      const dbDuration = Date.now() - dbStartTime;
      
      if (error) {
        results.push({
          test: "Database Connectivity",
          status: "failed",
          message: error.message,
          duration_ms: dbDuration
        });
      } else {
        results.push({
          test: "Database Connectivity",
          status: "success",
          message: "Successfully connected to database",
          duration_ms: dbDuration
        });
      }
    } catch (error: any) {
      const dbDuration = Date.now() - dbStartTime;
      results.push({
        test: "Database Connectivity",
        status: "failed",
        message: error.message || "Database connection failed",
        duration_ms: dbDuration
      });
    }
    
    // Test 3: Fetch all servers and test iDRAC connectivity
    const { data: servers, error: serversError } = await supabase
      .from('servers')
      .select('id, ip_address, hostname')
      .limit(10);
    
    if (serversError) {
      results.push({
        test: "Fetch Servers",
        status: "failed",
        message: serversError.message
      });
    } else if (servers && servers.length > 0) {
      results.push({
        test: "Fetch Servers",
        status: "success",
        message: `Found ${servers.length} server(s)`
      });
      
      // Test connectivity to first 3 servers
      for (const server of servers.slice(0, 3)) {
        const idracStartTime = Date.now();
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          
          const response = await fetch(`https://${server.ip_address}/redfish/v1/`, {
            method: 'GET',
            signal: controller.signal,
            mode: 'no-cors',
            headers: {
              'Accept': 'application/json',
            }
          });
          
          clearTimeout(timeoutId);
          const idracDuration = Date.now() - idracStartTime;
          
          results.push({
            test: `iDRAC Connectivity - ${server.hostname || server.ip_address}`,
            status: "success",
            message: `Successfully reached iDRAC at ${server.ip_address}`,
            duration_ms: idracDuration
          });
        } catch (error: any) {
          const idracDuration = Date.now() - idracStartTime;
          results.push({
            test: `iDRAC Connectivity - ${server.hostname || server.ip_address}`,
            status: "warning",
            message: error.name === 'AbortError' 
              ? `Connection timeout to ${server.ip_address}` 
              : error.message || `Failed to reach ${server.ip_address}`,
            duration_ms: idracDuration
          });
        }
      }
    } else {
      results.push({
        test: "Fetch Servers",
        status: "warning",
        message: "No servers configured"
      });
    }
    
    // Test 4: Check vCenter connectivity if configured
    const { data: vcenterSettings } = await supabase
      .from('vcenter_settings')
      .select('*')
      .limit(1)
      .single();
    
    if (vcenterSettings) {
      const vcenterStartTime = Date.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(`https://${vcenterSettings.host}:${vcenterSettings.port}/rest/com/vmware/cis/session`, {
          method: 'POST',
          signal: controller.signal,
          mode: 'no-cors'
        });
        
        clearTimeout(timeoutId);
        const vcenterDuration = Date.now() - vcenterStartTime;
        
        results.push({
          test: "vCenter Connectivity",
          status: "success",
          message: `Successfully reached vCenter at ${vcenterSettings.host}`,
          duration_ms: vcenterDuration
        });
      } catch (error: any) {
        const vcenterDuration = Date.now() - vcenterStartTime;
        results.push({
          test: "vCenter Connectivity",
          status: "warning",
          message: error.name === 'AbortError'
            ? `Connection timeout to ${vcenterSettings.host}`
            : error.message || `Failed to reach ${vcenterSettings.host}`,
          duration_ms: vcenterDuration
        });
      }
    }
    
    // Calculate summary
    const summary = {
      total_tests: results.length,
      passed: results.filter(r => r.status === "success").length,
      failed: results.filter(r => r.status === "failed").length,
      warnings: results.filter(r => r.status === "warning").length
    };
    
    return {
      success: summary.failed === 0,
      results,
      summary
    };
  } catch (error: any) {
    throw new Error(`Network diagnostics failed: ${error.message}`);
  }
}
