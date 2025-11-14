import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logIdracCommand } from "../_shared/idrac-logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TestRequest {
  ip_address: string;
  username?: string;
  password?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Verify user authentication
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse request body
    const { ip_address, username = 'root', password = 'calvin' } = await req.json() as TestRequest;

    if (!ip_address) {
      return new Response(JSON.stringify({ error: 'IP address is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Testing connection to iDRAC at ${ip_address}`);

    // Test connection to iDRAC
    const startTime = Date.now();
    const redfishUrl = `https://${ip_address}/redfish/v1/`;
    const authHeader = `Basic ${btoa(`${username}:${password}`)}`;

    try {
      const response = await fetch(redfishUrl, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
        // @ts-ignore - Deno-specific option to bypass SSL verification for self-signed certs
        insecure: true,
      });

      const responseTime = Date.now() - startTime;
      let data = null;
      try {
        data = await response.json();
      } catch (e) {
        // Response body may not be JSON
      }

      // Log the command
      await logIdracCommand({
        supabase: supabaseClient,
        commandType: 'GET',
        endpoint: '/redfish/v1/',
        fullUrl: redfishUrl,
        requestHeaders: { 'Accept': 'application/json' },
        statusCode: response.status,
        responseTimeMs: responseTime,
        responseBody: data,
        success: response.ok,
        errorMessage: response.ok ? undefined : `HTTP ${response.status}`,
        initiatedBy: user.id,
        source: 'edge_function',
      });

      if (!response.ok) {
        let errorMessage = '';
        if (response.status === 401) {
          errorMessage = 'Authentication failed - Invalid credentials';
        } else {
          errorMessage = `iDRAC returned status ${response.status}`;
        }

        // Update server connection status in database
        const { error: updateError } = await supabaseClient
          .from('servers')
          .update({
            last_connection_test: new Date().toISOString(),
            connection_status: 'offline',
            connection_error: errorMessage,
          })
          .eq('ip_address', ip_address);

        if (updateError) {
          console.error('Failed to update server connection status:', updateError);
        }

        return new Response(JSON.stringify({ 
          success: false,
          error: errorMessage,
          response_time_ms: responseTime,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Extract iDRAC version if available
      const idracVersion = data?.RedfishVersion || 'Unknown';

      // Update server connection status in database
      const { error: updateError } = await supabaseClient
        .from('servers')
        .update({
          last_connection_test: new Date().toISOString(),
          connection_status: 'online',
          connection_error: null,
          last_seen: new Date().toISOString(),
        })
        .eq('ip_address', ip_address);

      if (updateError) {
        console.error('Failed to update server connection status:', updateError);
      }

      return new Response(JSON.stringify({ 
        success: true,
        response_time_ms: responseTime,
        idrac_version: idracVersion,
        message: `Successfully connected to iDRAC at ${ip_address}`,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      
      let errorMessage = 'Connection failed';
      if (error.name === 'TimeoutError') {
        errorMessage = 'Connection timeout - iDRAC not responding';
      } else if (error.message.includes('network')) {
        errorMessage = 'Network error - Unable to reach iDRAC';
      } else {
        errorMessage = error.message || 'Unknown connection error';
      }

      // Log the failed command
      await logIdracCommand({
        supabase: supabaseClient,
        commandType: 'GET',
        endpoint: '/redfish/v1/',
        fullUrl: redfishUrl,
        requestHeaders: { 'Accept': 'application/json' },
        responseTimeMs: responseTime,
        success: false,
        errorMessage,
        initiatedBy: user.id,
        source: 'edge_function',
      });

      // Update server connection status in database
      const { error: updateError } = await supabaseClient
        .from('servers')
        .update({
          last_connection_test: new Date().toISOString(),
          connection_status: 'offline',
          connection_error: errorMessage,
        })
        .eq('ip_address', ip_address);

      if (updateError) {
        console.error('Failed to update server connection status:', updateError);
      }

      return new Response(JSON.stringify({ 
        success: false,
        error: errorMessage,
        response_time_ms: responseTime,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error: any) {
    console.error('Error in test-idrac-connection:', error);
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
