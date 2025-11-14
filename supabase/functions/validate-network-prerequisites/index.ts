import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = {
      servers: { tested: 0, reachable: 0, unreachable: 0, errors: [] as any[] },
      vcenter: { configured: false, reachable: false, error: null as string | null },
      dns: { working: true, error: null as string | null },
      overall: { passed: false, criticalFailures: [] as string[] }
    };

    const executionLog: any[] = [];
    const logStep = (step: number, type: string, target: string, method: string, status: 'success' | 'failed' | 'warning', responseTime: number, statusCode?: number, details?: string) => {
      executionLog.push({
        timestamp: new Date().toISOString(),
        step,
        test_type: type,
        target,
        method,
        status,
        response_time_ms: responseTime,
        status_code: statusCode,
        details
      });
    };

    let stepCounter = 0;
    executionLog.push({
      timestamp: new Date().toISOString(),
      step: stepCounter++,
      test_type: 'init',
      target: 'system',
      method: 'INFO',
      status: 'success',
      response_time_ms: 0,
      details: 'Starting network prerequisite validation'
    });

    // Test servers connectivity
    executionLog.push({
      timestamp: new Date().toISOString(),
      step: stepCounter++,
      test_type: 'server_query',
      target: 'database',
      method: 'SELECT',
      status: 'success',
      response_time_ms: 0,
      details: 'Querying servers from database'
    });

    const { data: servers } = await supabaseClient
      .from('servers')
      .select('id, hostname, ip_address')
      .order('hostname');

    if (servers && servers.length > 0) {
      results.servers.tested = servers.length;
      executionLog.push({
        timestamp: new Date().toISOString(),
        step: stepCounter++,
        test_type: 'server_connectivity',
        target: `${servers.length} servers`,
        method: 'INFO',
        status: 'success',
        response_time_ms: 0,
        details: `Found ${servers.length} server(s) to test`
      });

      for (const server of servers) {
        const startTime = Date.now();
        try {
          const testUrl = `https://${server.ip_address}/redfish/v1/`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);

          const response = await fetch(testUrl, {
            method: 'GET',
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
          });
          clearTimeout(timeoutId);
          const responseTime = Date.now() - startTime;

          if (response.ok || response.status === 401) {
            results.servers.reachable++;
            logStep(
              stepCounter++,
              'server_connectivity',
              testUrl,
              'GET',
              'success',
              responseTime,
              response.status,
              `${server.hostname || server.ip_address}: iDRAC reachable (${response.status === 401 ? 'auth required - expected' : 'OK'})`
            );
          } else {
            results.servers.unreachable++;
            results.servers.errors.push({
              server: server.hostname || server.ip_address,
              error: `HTTP ${response.status}`
            });
            logStep(
              stepCounter++,
              'server_connectivity',
              testUrl,
              'GET',
              'failed',
              responseTime,
              response.status,
              `${server.hostname || server.ip_address}: Unexpected status ${response.status}`
            );
          }
        } catch (error) {
          const responseTime = Date.now() - startTime;
          results.servers.unreachable++;
          const errorMsg = error instanceof Error ? error.message : 'Connection failed';
          results.servers.errors.push({
            server: server.hostname || server.ip_address,
            error: errorMsg
          });
          logStep(
            stepCounter++,
            'server_connectivity',
            `https://${server.ip_address}/redfish/v1/`,
            'GET',
            'failed',
            responseTime,
            undefined,
            `${server.hostname || server.ip_address}: ${errorMsg}`
          );
        }
      }

      if (results.servers.unreachable > 0) {
        results.overall.criticalFailures.push(`${results.servers.unreachable} server(s) unreachable`);
      }
    } else {
      executionLog.push({
        timestamp: new Date().toISOString(),
        step: stepCounter++,
        test_type: 'server_connectivity',
        target: 'none',
        method: 'INFO',
        status: 'warning',
        response_time_ms: 0,
        details: 'No servers configured to test'
      });
    }

    // Test vCenter connectivity
    executionLog.push({
      timestamp: new Date().toISOString(),
      step: stepCounter++,
      test_type: 'vcenter_query',
      target: 'database',
      method: 'SELECT',
      status: 'success',
      response_time_ms: 0,
      details: 'Querying vCenter settings'
    });

    const { data: vcenterSettings } = await supabaseClient
      .from('vcenter_settings')
      .select('*')
      .limit(1)
      .single();

    if (vcenterSettings) {
      results.vcenter.configured = true;
      executionLog.push({
        timestamp: new Date().toISOString(),
        step: stepCounter++,
        test_type: 'vcenter_connectivity',
        target: vcenterSettings.host,
        method: 'INFO',
        status: 'success',
        response_time_ms: 0,
        details: `vCenter configured at ${vcenterSettings.host}:${vcenterSettings.port}`
      });

      const startTime = Date.now();
      try {
        const vcenterUrl = `https://${vcenterSettings.host}:${vcenterSettings.port}/api`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(vcenterUrl, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const responseTime = Date.now() - startTime;

        results.vcenter.reachable = response.ok || response.status === 401;
        if (!results.vcenter.reachable) {
          results.vcenter.error = `HTTP ${response.status}`;
          results.overall.criticalFailures.push('vCenter unreachable');
          logStep(
            stepCounter++,
            'vcenter_connectivity',
            vcenterUrl,
            'GET',
            'failed',
            responseTime,
            response.status,
            `vCenter unreachable: HTTP ${response.status}`
          );
        } else {
          logStep(
            stepCounter++,
            'vcenter_connectivity',
            vcenterUrl,
            'GET',
            'success',
            responseTime,
            response.status,
            `vCenter reachable (${response.status === 401 ? 'auth required - expected' : 'OK'})`
          );
        }
      } catch (error) {
        const responseTime = Date.now() - startTime;
        const errorMsg = error instanceof Error ? error.message : 'Connection failed';
        results.vcenter.error = errorMsg;
        results.overall.criticalFailures.push('vCenter unreachable');
        logStep(
          stepCounter++,
          'vcenter_connectivity',
          `https://${vcenterSettings.host}:${vcenterSettings.port}/api`,
          'GET',
          'failed',
          responseTime,
          undefined,
          `vCenter unreachable: ${errorMsg}`
        );
      }
    } else {
      executionLog.push({
        timestamp: new Date().toISOString(),
        step: stepCounter++,
        test_type: 'vcenter_connectivity',
        target: 'none',
        method: 'INFO',
        status: 'warning',
        response_time_ms: 0,
        details: 'No vCenter configured'
      });
    }

    // Test DNS resolution
    executionLog.push({
      timestamp: new Date().toISOString(),
      step: stepCounter++,
      test_type: 'dns_resolution',
      target: '1.1.1.1',
      method: 'HEAD',
      status: 'success',
      response_time_ms: 0,
      details: 'Testing DNS resolution with Cloudflare DNS'
    });

    const dnsStartTime = Date.now();
    try {
      await fetch('https://1.1.1.1/', { method: 'HEAD', signal: AbortSignal.timeout(3000) });
      const dnsResponseTime = Date.now() - dnsStartTime;
      logStep(
        stepCounter++,
        'dns_resolution',
        'https://1.1.1.1/',
        'HEAD',
        'success',
        dnsResponseTime,
        200,
        'DNS resolution working'
      );
    } catch (error) {
      const dnsResponseTime = Date.now() - dnsStartTime;
      results.dns.working = false;
      results.dns.error = 'DNS resolution may be impaired';
      logStep(
        stepCounter++,
        'dns_resolution',
        'https://1.1.1.1/',
        'HEAD',
        'failed',
        dnsResponseTime,
        undefined,
        'DNS resolution failed'
      );
    }

    results.overall.passed = results.overall.criticalFailures.length === 0;

    executionLog.push({
      timestamp: new Date().toISOString(),
      step: stepCounter++,
      test_type: 'completion',
      target: 'system',
      method: 'INFO',
      status: results.overall.passed ? 'success' : 'failed',
      response_time_ms: 0,
      details: results.overall.passed ? 'All prerequisite tests passed' : `Tests completed with ${results.overall.criticalFailures.length} critical failure(s)`
    });

    return new Response(JSON.stringify({ results, executionLog }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Validation error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
