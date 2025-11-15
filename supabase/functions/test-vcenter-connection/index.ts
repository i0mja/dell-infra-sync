import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TestRequest {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  verify_ssl?: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';

    // Extract JWT token and decode to get user ID
    let userId: string;
    try {
      const token = authHeader.replace('Bearer ', '');
      if (!token) throw new Error('No token provided');
      
      const payload = JSON.parse(atob(token.split('.')[1]));
      userId = payload.sub;
      
      if (!userId) throw new Error('Invalid token payload');
    } catch (error) {
      console.error('Token extraction failed:', error);
      return new Response(
        JSON.stringify({ error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create admin client for role check
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Check if user is admin
    const { data: hasAdminRole } = await supabaseAdmin.rpc('has_role', {
      _user_id: userId,
      _role: 'admin'
    });

    if (!hasAdminRole) {
      throw new Error('Unauthorized: Admin role required');
    }

    const requestData: TestRequest = await req.json();
    
    // Get vCenter settings from database if not provided
    let host = requestData.host;
    let port = requestData.port;
    let username = requestData.username;
    let password = requestData.password;
    let verify_ssl = requestData.verify_ssl;

    if (!host) {
      const { data: settings, error: settingsError } = await supabaseAdmin
        .from('vcenter_settings')
        .select('*')
        .single();

      if (settingsError || !settings) {
        throw new Error('vCenter settings not configured');
      }

      host = settings.host;
      port = settings.port;
      username = settings.username;
      password = settings.password;
      verify_ssl = settings.verify_ssl;
    }

    const startTime = Date.now();
    const vcenterUrl = `https://${host}:${port}/api/session`;

    console.log(`Testing vCenter connection to ${host}:${port}`);

    // Test connection with 10-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(vcenterUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${username}:${password}`),
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      if (response.ok) {
        console.log(`vCenter connection successful (${responseTime}ms)`);

        // Try to get version info
        let version = undefined;
        try {
          const sessionId = await response.text();
          const versionResponse = await fetch(`https://${host}:${port}/api/appliance/system/version`, {
            headers: {
              'vmware-api-session-id': sessionId.replace(/"/g, ''),
            },
          });
          
          if (versionResponse.ok) {
            const versionData = await versionResponse.json();
            version = versionData.value?.version || versionData.version;
          }
        } catch (versionError) {
          console.log('Could not fetch version:', versionError);
        }

        // Update last connection test timestamp
        await supabaseAdmin
          .from('vcenter_settings')
          .update({ last_sync: new Date().toISOString() })
          .eq('host', host);

        return new Response(
          JSON.stringify({
            success: true,
            response_time_ms: responseTime,
            version,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      } else {
        const errorText = await response.text();
        console.error(`vCenter connection failed: ${response.status} - ${errorText}`);
        
        return new Response(
          JSON.stringify({
            success: false,
            response_time_ms: responseTime,
            error: `Connection failed: ${response.status} ${response.statusText}`,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;
      
      let errorMessage = 'Connection failed';
      if (fetchError.name === 'AbortError') {
        errorMessage = 'Connection timeout (10s)';
      } else if (fetchError.message.includes('certificate')) {
        errorMessage = 'SSL certificate error';
      } else if (fetchError.message.includes('ECONNREFUSED')) {
        errorMessage = 'Connection refused';
      } else {
        errorMessage = fetchError.message;
      }

      console.error(`vCenter connection error: ${errorMessage}`);

      return new Response(
        JSON.stringify({
          success: false,
          response_time_ms: responseTime,
          error: errorMessage,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (error: any) {
    console.error('Error in test-vcenter-connection:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: error.message.includes('Unauthorized') ? 403 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
