import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AuthenticateRequest {
  username: string;
  password: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { username, password } = await req.json() as AuthenticateRequest;

    console.log(`[IDM Auth] Received authentication request for username: ${username}`);

    // Validate input
    if (!username || !password) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username and password are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check IDM settings
    console.log('[IDM Auth] Checking IDM settings...');
    const { data: idmSettings, error: settingsError } = await supabase
      .from('idm_settings')
      .select('*')
      .single();

    if (settingsError || !idmSettings) {
      console.error('[IDM Auth] IDM settings not found:', settingsError);
      return new Response(
        JSON.stringify({ success: false, error: 'IDM authentication not configured' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (idmSettings.auth_mode === 'local_only') {
      console.log('[IDM Auth] IDM auth disabled (local_only mode)');
      return new Response(
        JSON.stringify({ success: false, error: 'IDM authentication not enabled' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check rate limits
    console.log(`[IDM Auth] Checking rate limits for: ${username}`);
    const { data: rateLimitCheck } = await supabase.rpc('check_auth_rate_limit', {
      p_identifier: username,
      p_identifier_type: 'username',
      p_max_attempts: idmSettings.max_failed_attempts || 5,
      p_lockout_minutes: idmSettings.lockout_duration_minutes || 30
    });

    if (rateLimitCheck?.is_locked) {
      console.log(`[IDM Auth] Account locked: ${username}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Account temporarily locked',
          lockout_remaining_seconds: rateLimitCheck.lockout_remaining_seconds
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create authentication job
    console.log('[IDM Auth] Creating authentication job...');
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .insert({
        job_type: 'idm_authenticate',
        created_by: '00000000-0000-0000-0000-000000000000', // System user
        status: 'pending',
        details: {
          username,
          password, // Will be cleared by Job Executor after use
          source: 'edge_function'
        }
      })
      .select()
      .single();

    if (jobError || !job) {
      console.error('[IDM Auth] Failed to create job:', jobError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to create authentication job' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[IDM Auth] Job created: ${job.id}, polling for completion...`);

    // Poll for job completion (30 seconds max, 500ms interval)
    const maxAttempts = 60;
    const pollInterval = 500;
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      attempts++;

      const { data: updatedJob } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', job.id)
        .single();

      if (!updatedJob) {
        console.error('[IDM Auth] Job disappeared');
        break;
      }

      if (updatedJob.status === 'completed') {
        console.log('[IDM Auth] Job completed successfully');
        const authResult = updatedJob.details?.auth_result;

        if (!authResult?.success) {
          // Record failed attempt
          await supabase.rpc('record_auth_attempt', {
            p_identifier: username,
            p_identifier_type: 'username',
            p_success: false,
            p_max_attempts: idmSettings.max_failed_attempts || 5,
            p_lockout_minutes: idmSettings.lockout_duration_minutes || 30
          });

          return new Response(
            JSON.stringify({
              success: false,
              error: 'Invalid credentials',
              remaining_attempts: rateLimitCheck?.remaining_attempts ? rateLimitCheck.remaining_attempts - 1 : 4
            }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Authentication successful - record it
        await supabase.rpc('record_auth_attempt', {
          p_identifier: username,
          p_identifier_type: 'username',
          p_success: true
        });

        // Check if user exists by idm_uid
        const idmUid = authResult.user_attributes?.uid || username;
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id, email')
          .eq('idm_uid', idmUid)
          .single();

        let userId: string;
        let email: string;

        if (existingProfile) {
          // User exists
          console.log(`[IDM Auth] Existing user found: ${existingProfile.id}`);
          userId = existingProfile.id;
          email = existingProfile.email;

          // Update profile with latest IDM info
          await supabase
            .from('profiles')
            .update({
              idm_source: 'freeipa',
              idm_user_dn: authResult.user_dn,
              idm_groups: authResult.groups || [],
              idm_disabled: false,
              idm_mail: authResult.user_attributes?.email,
              idm_title: authResult.user_attributes?.title,
              idm_department: authResult.user_attributes?.department,
              last_idm_sync: new Date().toISOString()
            })
            .eq('id', userId);

        } else {
          // JIT user provisioning - create new user
          console.log(`[IDM Auth] Creating new user via JIT provisioning`);
          
          email = authResult.user_attributes?.email || `${idmUid}@idm.local`;
          const fullName = authResult.user_attributes?.full_name || idmUid;

          const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: {
              full_name: fullName,
              idm_uid: idmUid,
              idm_source: 'freeipa'
            }
          });

          if (createError || !newUser.user) {
            console.error('[IDM Auth] Failed to create user:', createError);
            return new Response(
              JSON.stringify({ success: false, error: 'Failed to provision user account' }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          userId = newUser.user.id;

          // Update profile (trigger should have created it)
          await supabase
            .from('profiles')
            .update({
              full_name: fullName,
              idm_uid: idmUid,
              idm_source: 'freeipa',
              idm_user_dn: authResult.user_dn,
              idm_groups: authResult.groups || [],
              idm_disabled: false,
              idm_mail: authResult.user_attributes?.email,
              idm_title: authResult.user_attributes?.title,
              idm_department: authResult.user_attributes?.department,
              last_idm_sync: new Date().toISOString()
            })
            .eq('id', userId);
        }

        // Map groups to role using idm_group_mappings
        console.log('[IDM Auth] Mapping groups to role...');
        const userGroups = authResult.groups || [];
        
        const { data: groupMappings } = await supabase
          .from('idm_group_mappings')
          .select('*')
          .eq('is_active', true)
          .order('priority', { ascending: true });

        let mappedRole = 'viewer'; // Default role
        
        if (groupMappings && groupMappings.length > 0) {
          for (const mapping of groupMappings) {
            if (userGroups.some((group: string) => group.toLowerCase().includes(mapping.idm_group_name.toLowerCase()))) {
              mappedRole = mapping.app_role;
              console.log(`[IDM Auth] Mapped to role '${mappedRole}' via group '${mapping.idm_group_name}'`);
              break;
            }
          }
        }

        // Update user role
        await supabase
          .from('user_roles')
          .upsert({
            user_id: userId,
            role: mappedRole
          }, {
            onConflict: 'user_id,role'
          });

        // Create IDM auth session
        const sessionExpiresAt = new Date();
        sessionExpiresAt.setMinutes(sessionExpiresAt.getMinutes() + (idmSettings.session_timeout_minutes || 480));

        await supabase
          .from('idm_auth_sessions')
          .insert({
            user_id: userId,
            idm_uid: idmUid,
            idm_user_dn: authResult.user_dn,
            idm_groups: authResult.groups || [],
            mapped_role: mappedRole,
            auth_method: 'freeipa_ldap',
            session_expires_at: sessionExpiresAt.toISOString(),
            ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
          });

        // Generate session token
        const { data: sessionData, error: sessionError } = await supabase.auth.admin.generateLink({
          type: 'magiclink',
          email,
          options: {
            redirectTo: `${Deno.env.get('SUPABASE_URL')}/auth/v1/verify`
          }
        });

        if (sessionError || !sessionData) {
          console.error('[IDM Auth] Failed to generate session:', sessionError);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to generate session token' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Log to audit
        await supabase
          .from('audit_logs')
          .insert({
            user_id: userId,
            action: 'idm_login',
            auth_source: 'freeipa',
            auth_method: 'freeipa_ldap',
            idm_user_dn: authResult.user_dn,
            idm_groups_at_login: authResult.groups || [],
            ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
            details: {
              username,
              mapped_role: mappedRole
            }
          });

        console.log(`[IDM Auth] Login successful for user ${userId}`);

        return new Response(
          JSON.stringify({
            success: true,
            user_id: userId,
            email,
            role: mappedRole,
            idm_groups: authResult.groups || [],
            access_token: sessionData.properties.action_link.split('access_token=')[1]?.split('&')[0] || '',
            refresh_token: sessionData.properties.action_link.split('refresh_token=')[1]?.split('&')[0] || '',
            expires_at: Math.floor(sessionExpiresAt.getTime() / 1000)
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (updatedJob.status === 'failed') {
        console.error('[IDM Auth] Job failed:', updatedJob.details?.error);
        
        // Record failed attempt
        await supabase.rpc('record_auth_attempt', {
          p_identifier: username,
          p_identifier_type: 'username',
          p_success: false,
          p_max_attempts: idmSettings.max_failed_attempts || 5,
          p_lockout_minutes: idmSettings.lockout_duration_minutes || 30
        });

        return new Response(
          JSON.stringify({
            success: false,
            error: 'Authentication failed',
            remaining_attempts: rateLimitCheck?.remaining_attempts ? rateLimitCheck.remaining_attempts - 1 : 4
          }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Timeout
    console.error('[IDM Auth] Job timeout after 30 seconds');
    return new Response(
      JSON.stringify({ success: false, error: 'Authentication timeout - job executor may be offline' }),
      { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[IDM Auth] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
