import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return new Response(
        JSON.stringify({ success: false, error: 'Email and password are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check rate limiting for break-glass attempts (stricter than normal)
    const rateLimitResult = await supabaseClient.rpc('check_auth_rate_limit', {
      p_identifier: email,
      p_identifier_type: 'break_glass_email',
      p_max_attempts: 3, // Only 3 attempts
      p_lockout_minutes: 60 // 1 hour lockout
    });

    if (rateLimitResult.data?.is_locked) {
      await supabaseClient.rpc('record_auth_attempt', {
        p_identifier: email,
        p_identifier_type: 'break_glass_email',
        p_success: false,
        p_max_attempts: 3,
        p_lockout_minutes: 60
      });

      return new Response(
        JSON.stringify({
          success: false,
          error: 'Account locked due to too many failed attempts',
          lockout_remaining_seconds: rateLimitResult.data.lockout_remaining_seconds
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find active break-glass admin
    const { data: admin, error: adminError } = await supabaseClient
      .from('break_glass_admins')
      .select('*')
      .eq('email', email)
      .eq('is_active', true)
      .maybeSingle();

    if (adminError || !admin) {
      await supabaseClient.rpc('record_auth_attempt', {
        p_identifier: email,
        p_identifier_type: 'break_glass_email',
        p_success: false,
        p_max_attempts: 3,
        p_lockout_minutes: 60
      });

      return new Response(
        JSON.stringify({ success: false, error: 'Invalid credentials or account not active' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Hash password with SHA-256 (matches useBreakGlassAdmins.ts)
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Verify password
    if (passwordHash !== admin.password_hash) {
      await supabaseClient.rpc('record_auth_attempt', {
        p_identifier: email,
        p_identifier_type: 'break_glass_email',
        p_success: false,
        p_max_attempts: 3,
        p_lockout_minutes: 60
      });

      return new Response(
        JSON.stringify({ success: false, error: 'Invalid credentials' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Success - update usage stats
    await supabaseClient
      .from('break_glass_admins')
      .update({
        use_count: (admin.use_count || 0) + 1,
        last_used_at: new Date().toISOString()
      })
      .eq('id', admin.id);

    // Record successful auth attempt
    await supabaseClient.rpc('record_auth_attempt', {
      p_identifier: email,
      p_identifier_type: 'break_glass_email',
      p_success: true,
      p_max_attempts: 3,
      p_lockout_minutes: 60
    });

    // Find or create Supabase user profile
    let userId: string | null = null;
    const { data: existingProfile } = await supabaseClient
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingProfile) {
      userId = existingProfile.id;
    } else {
      // Create new Supabase Auth user (break-glass admin always gets admin role)
      const { data: authData, error: authError } = await supabaseClient.auth.admin.createUser({
        email: email,
        password: crypto.randomUUID(), // Random password - won't be used
        email_confirm: true,
        user_metadata: {
          full_name: admin.full_name,
          break_glass: true
        }
      });

      if (authError || !authData.user) {
        throw new Error(`Failed to create user: ${authError?.message}`);
      }

      userId = authData.user.id;

      // Create profile
      await supabaseClient
        .from('profiles')
        .insert({
          id: userId,
          email: email,
          full_name: admin.full_name
        });

      // Assign admin role
      await supabaseClient
        .from('user_roles')
        .insert({
          user_id: userId,
          role: 'admin'
        });
    }

    // Create admin session for the user
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: crypto.randomUUID(), // Won't work, but we'll use admin override
    });

    // Instead, use admin to create session
    const { data: adminSession, error: adminSessionError } = await supabaseClient.auth.admin.generateLink({
      type: 'recovery',
      email: email,
    });

    if (adminSessionError) {
      throw new Error('Failed to generate session');
    }

    // Parse the hashed_token from the link
    const urlParams = new URL(adminSession.properties.action_link).searchParams;
    const hashedToken = urlParams.get('token');

    if (!hashedToken) {
      throw new Error('No token in recovery link');
    }

    // Use hashed token to create session
    const { data: verifyData, error: verifyError } = await supabaseClient.auth.verifyOtp({
      type: 'recovery',
      token_hash: hashedToken,
      email: email,
    });

    if (verifyError || !verifyData.session) {
      throw new Error('Failed to create session');
    }

    // Create audit log entry
    await supabaseClient
      .from('audit_logs')
      .insert({
        user_id: userId,
        action: 'break_glass_login',
        auth_source: 'break_glass',
        auth_method: 'password',
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
        details: {
          admin_id: admin.id,
          admin_email: email,
          use_count: (admin.use_count || 0) + 1
        }
      });

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: userId,
          email: email,
          full_name: admin.full_name,
          role: 'admin',
          break_glass: true
        },
        access_token: verifyData.session.access_token,
        refresh_token: verifyData.session.refresh_token
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Break-glass authentication error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
