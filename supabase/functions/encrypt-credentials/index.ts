import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EncryptCredentialsRequest {
  credential_set_id?: string;
  server_id?: string;
  vcenter_id?: string;
  vcenter_settings_id?: string;
  openmanage_settings_id?: string;
  username?: string;
  password: string;
  type: 'credential_set' | 'server' | 'vcenter' | 'openmanage' | 'activity_settings';
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
    // Since verify_jwt=true, we know the JWT is already valid
    let userId: string;
    try {
      const token = authHeader.replace('Bearer ', '');
      if (!token) {
        throw new Error('No token provided');
      }
      
      // Decode JWT to get user ID (JWT is already verified by Deno)
      const payload = JSON.parse(atob(token.split('.')[1]));
      userId = payload.sub;
      
      if (!userId) {
        throw new Error('Invalid token payload');
      }
    } catch (error) {
      console.error('Token extraction failed:', error);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create admin client for role check
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Check user has admin or operator role
    const { data: roleData } = await supabaseAdmin.rpc('get_user_role', { _user_id: userId });
    
    if (!roleData || !['admin', 'operator'].includes(roleData)) {
      return new Response(
        JSON.stringify({ error: 'Permission denied. Admin or operator role required.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const request: EncryptCredentialsRequest = await req.json();

    // Validate input
    if (!request.password || !request.type) {
      return new Response(
        JSON.stringify({ error: 'password and type are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (request.password.length > 255) {
      return new Response(
        JSON.stringify({ error: 'password must be less than 255 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get encryption key (using supabaseAdmin already created above)
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from('activity_settings')
      .select('encryption_key')
      .limit(1)
      .single();

    if (settingsError || !settings?.encryption_key) {
      console.error('Failed to get encryption key:', settingsError);
      return new Response(
        JSON.stringify({ error: 'Encryption system not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Encrypt password using database function
    const { data: encryptedData, error: encryptError } = await supabaseAdmin
      .rpc('encrypt_password', {
        password: request.password,
        key: settings.encryption_key
      });

    if (encryptError || !encryptedData) {
      console.error('Encryption failed:', encryptError);
      return new Response(
        JSON.stringify({ error: 'Failed to encrypt password' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update the appropriate table with encrypted password
    let updateResult;
    
    switch (request.type) {
      case 'credential_set':
        if (!request.credential_set_id) {
          return new Response(
            JSON.stringify({ error: 'credential_set_id required for credential_set type' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        updateResult = await supabaseAdmin
          .from('credential_sets')
          .update({ password_encrypted: encryptedData })
          .eq('id', request.credential_set_id);
        break;

      case 'server':
        if (!request.server_id) {
          return new Response(
            JSON.stringify({ error: 'server_id required for server type' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        updateResult = await supabaseAdmin
          .from('servers')
          .update({
            idrac_username: request.username,
            idrac_password_encrypted: encryptedData
          })
          .eq('id', request.server_id);
        break;

      case 'vcenter':
        // Support both new vcenters table and legacy vcenter_settings
        if (request.vcenter_id) {
          updateResult = await supabaseAdmin
            .from('vcenters')
            .update({ password_encrypted: encryptedData })
            .eq('id', request.vcenter_id);
        } else if (request.vcenter_settings_id) {
          // Legacy support
          updateResult = await supabaseAdmin
            .from('vcenter_settings')
            .update({ password: encryptedData })
            .eq('id', request.vcenter_settings_id);
        } else {
          return new Response(
            JSON.stringify({ error: 'vcenter_id or vcenter_settings_id required for vcenter type' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        break;

      case 'openmanage':
        if (!request.openmanage_settings_id) {
          return new Response(
            JSON.stringify({ error: 'openmanage_settings_id required for openmanage type' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        updateResult = await supabaseAdmin
          .from('openmanage_settings')
          .update({ password: encryptedData })
          .eq('id', request.openmanage_settings_id);
        break;

      case 'activity_settings':
        // Get the activity_settings ID first (singleton table)
        const { data: settingsData, error: settingsError } = await supabaseAdmin
          .from('activity_settings')
          .select('id')
          .limit(1)
          .single();
        
        if (settingsError || !settingsData) {
          console.error('Failed to get activity_settings:', settingsError);
          return new Response(
            JSON.stringify({ error: 'Activity settings not found' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        updateResult = await supabaseAdmin
          .from('activity_settings')
          .update({ scp_share_password_encrypted: encryptedData })
          .eq('id', settingsData.id);
        break;

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid type' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    if (updateResult.error) {
      console.error('Failed to update record:', updateResult.error);
      return new Response(
        JSON.stringify({ error: 'Failed to store encrypted password' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Password encrypted and stored successfully' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in encrypt-credentials:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
