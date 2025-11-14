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

    // Test servers connectivity
    const { data: servers } = await supabaseClient
      .from('servers')
      .select('id, hostname, ip_address')
      .order('hostname');

    if (servers && servers.length > 0) {
      results.servers.tested = servers.length;

      for (const server of servers) {
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

          if (response.ok || response.status === 401) {
            results.servers.reachable++;
          } else {
            results.servers.unreachable++;
            results.servers.errors.push({
              server: server.hostname || server.ip_address,
              error: `HTTP ${response.status}`
            });
          }
        } catch (error) {
          results.servers.unreachable++;
          results.servers.errors.push({
            server: server.hostname || server.ip_address,
            error: error instanceof Error ? error.message : 'Connection failed'
          });
        }
      }

      if (results.servers.unreachable > 0) {
        results.overall.criticalFailures.push(`${results.servers.unreachable} server(s) unreachable`);
      }
    }

    // Test vCenter connectivity
    const { data: vcenterSettings } = await supabaseClient
      .from('vcenter_settings')
      .select('*')
      .limit(1)
      .single();

    if (vcenterSettings) {
      results.vcenter.configured = true;

      try {
        const vcenterUrl = `https://${vcenterSettings.host}:${vcenterSettings.port}/api`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(vcenterUrl, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        results.vcenter.reachable = response.ok || response.status === 401;
        if (!results.vcenter.reachable) {
          results.vcenter.error = `HTTP ${response.status}`;
          results.overall.criticalFailures.push('vCenter unreachable');
        }
      } catch (error) {
        results.vcenter.error = error instanceof Error ? error.message : 'Connection failed';
        results.overall.criticalFailures.push('vCenter unreachable');
      }
    }

    // Test DNS resolution
    try {
      await fetch('https://1.1.1.1/', { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    } catch (error) {
      results.dns.working = false;
      results.dns.error = 'DNS resolution may be impaired';
    }

    results.overall.passed = results.overall.criticalFailures.length === 0;

    return new Response(JSON.stringify(results), {
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
