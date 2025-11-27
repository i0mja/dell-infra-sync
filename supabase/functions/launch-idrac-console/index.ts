import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createIdracSession } from '../_shared/idrac-session.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ConsoleRequest {
  server_id: string;
}

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

    // Verify user authentication
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check user role
    const { data: roles } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const hasPermission = roles?.some(r => ['admin', 'operator'].includes(r.role));
    if (!hasPermission) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { server_id } = await req.json() as ConsoleRequest;

    // Fetch server details
    const { data: server, error: serverError } = await supabaseClient
      .from('servers')
      .select('ip_address, idrac_username, idrac_password_encrypted, credential_set_id')
      .eq('id', server_id)
      .single();

    if (serverError || !server) {
      return new Response(JSON.stringify({ error: 'Server not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get credentials
    let username = server.idrac_username || 'root';
    let password = 'calvin'; // default fallback

    if (server.idrac_password_encrypted) {
      // Decrypt password from server
      const { data: decryptResult } = await supabaseClient.functions.invoke('encrypt-credentials', {
        body: { action: 'decrypt', encrypted: server.idrac_password_encrypted }
      });
      if (decryptResult?.decrypted) {
        password = decryptResult.decrypted;
      }
    } else if (server.credential_set_id) {
      // Get from credential set
      const { data: credSet } = await supabaseClient
        .from('credential_sets')
        .select('username, password_encrypted')
        .eq('id', server.credential_set_id)
        .single();

      if (credSet) {
        username = credSet.username;
        if (credSet.password_encrypted) {
          const { data: decryptResult } = await supabaseClient.functions.invoke('encrypt-credentials', {
            body: { action: 'decrypt', encrypted: credSet.password_encrypted }
          });
          if (decryptResult?.decrypted) {
            password = decryptResult.decrypted;
          }
        }
      }
    }

    // Create Redfish session to get auth token
    const session = await createIdracSession(
      server.ip_address,
      username,
      password,
      supabaseClient,
      user.id,
      server_id,
      15000
    );

    if (!session) {
      return new Response(JSON.stringify({ 
        error: 'Failed to create iDRAC session',
        details: 'Could not authenticate with iDRAC. Check credentials and network connectivity.'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Generate console URL with SSO token
    // iDRAC9: /restgui/vconsole/#/consoleHtml5?ip={ip}&authToken={token}
    // iDRAC8: /console?sessionToken={token}
    const consoleUrl = `https://${server.ip_address}/restgui/vconsole/#/consoleHtml5?ip=${server.ip_address}&authToken=${session.token}`;

    // Don't delete the session - it needs to remain active for console access
    // User will have to manually close it or it will timeout after inactivity

    return new Response(JSON.stringify({ 
      success: true,
      console_url: consoleUrl,
      session_location: session.location
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error launching console:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to launch console',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
