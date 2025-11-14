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

    const diagnostics = {
      activeConnections: 0,
      recentErrors: [] as any[],
      avgLatency: 0,
      successRate: 0,
      timestamp: new Date().toISOString()
    };

    // Get recent iDRAC command statistics (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: recentCommands } = await supabaseClient
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
          error: cmd.error_message
        }));
    }

    // Count active/recent jobs as a proxy for active connections
    const { count: activeJobs } = await supabaseClient
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .in('status', ['pending', 'running']);

    diagnostics.activeConnections = activeJobs || 0;

    return new Response(JSON.stringify(diagnostics), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Diagnostics error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
