import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProvisionRequest {
  username: string;
  user_dn: string;
  user_info: {
    uid?: string;
    full_name?: string;
    email?: string;
    title?: string;
    department?: string;
  };
  groups: string[];
  is_ad_trust_user?: boolean;
  ad_domain?: string;
  realm?: string;
  canonical_principal?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data = await req.json() as ProvisionRequest;
    const { username, user_dn, user_info, groups, is_ad_trust_user, ad_domain, realm, canonical_principal } = data;

    console.log(`[IDM Provision] Provisioning user: ${username}`);

    // Validate input
    if (!username) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get IDM settings for session timeout
    const { data: idmSettings } = await supabase
      .from('idm_settings')
      .select('session_timeout_minutes, max_failed_attempts, lockout_duration_minutes')
      .single();

    const sessionTimeoutMinutes = idmSettings?.session_timeout_minutes || 480;

    // Check if user exists by idm_uid
    // Extract clean username (remove domain/realm if present)
    const cleanUsername = username.includes('@') 
      ? username.split('@')[0] 
      : username.includes('\\') 
        ? username.split('\\').pop() || username
        : username;
    
    const idmUid = user_info?.uid || cleanUsername;
    console.log(`[IDM Provision] Clean username: ${cleanUsername}, idmUid: ${idmUid}`);
    
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('idm_uid', idmUid)
      .single();

    let userId: string;
    let email: string;

    if (existingProfile) {
      // User exists - update profile
      console.log(`[IDM Provision] Existing user found: ${existingProfile.id}`);
      userId = existingProfile.id;
      email = existingProfile.email;

      // Update profile with latest IDM info
      await supabase
        .from('profiles')
        .update({
          idm_source: is_ad_trust_user ? 'ad_trust' : 'freeipa',
          idm_user_dn: user_dn,
          idm_groups: groups || [],
          idm_disabled: false,
          idm_mail: user_info?.email,
          idm_title: user_info?.title,
          idm_department: user_info?.department,
          last_idm_sync: new Date().toISOString()
        })
        .eq('id', userId);

    } else {
      // JIT user provisioning - create new user
      console.log(`[IDM Provision] Creating new user via JIT provisioning`);
      
      // Generate a valid email for Supabase Auth
      // Use user_info.email if valid, otherwise create synthetic email with .local TLD
      let generatedEmail = user_info?.email;
      if (!generatedEmail || !generatedEmail.includes('@') || generatedEmail.endsWith('.grp')) {
        // Create synthetic email that Supabase will accept
        generatedEmail = `${cleanUsername}@idm.local`;
      }
      email = generatedEmail;
      console.log(`[IDM Provision] Using email for provisioning: ${email}`);
      
      const fullName = user_info?.full_name || cleanUsername;

      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          idm_uid: idmUid,
          idm_source: is_ad_trust_user ? 'ad_trust' : 'freeipa'
        }
      });

      if (createError || !newUser.user) {
        console.error('[IDM Provision] Failed to create user:', createError);
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
          idm_source: is_ad_trust_user ? 'ad_trust' : 'freeipa',
          idm_user_dn: user_dn,
          idm_groups: groups || [],
          idm_disabled: false,
          idm_mail: user_info?.email,
          idm_title: user_info?.title,
          idm_department: user_info?.department,
          last_idm_sync: new Date().toISOString()
        })
        .eq('id', userId);
    }

    // Map groups to role using idm_group_mappings
    console.log('[IDM Provision] Mapping groups to role...');
    
    const { data: groupMappings } = await supabase
      .from('idm_group_mappings')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: true });

    let mappedRole = 'viewer'; // Default role
    
    if (groupMappings && groupMappings.length > 0) {
      for (const mapping of groupMappings) {
        // Improved group matching: normalize both sides for comparison
        const mappingGroupName = (mapping.idm_group_dn || mapping.idm_group_name || '').toLowerCase();
        const normalizedMappingName = mappingGroupName.includes('cn=') 
          ? mappingGroupName.match(/cn=([^,]+)/i)?.[1]?.toLowerCase() || mappingGroupName
          : mappingGroupName.split('\\').pop()?.toLowerCase() || mappingGroupName;
        
        if (groups?.some((group: string) => {
          const normalizedGroup = group.toLowerCase().includes('cn=')
            ? group.match(/cn=([^,]+)/i)?.[1]?.toLowerCase() || group.toLowerCase()
            : group.split('\\').pop()?.toLowerCase() || group.toLowerCase();
          return normalizedGroup === normalizedMappingName || normalizedGroup.includes(normalizedMappingName) || normalizedMappingName.includes(normalizedGroup);
        })) {
          mappedRole = mapping.app_role;
          console.log(`[IDM Provision] Mapped to role '${mappedRole}' via group '${mapping.idm_group_name}'`);
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
    sessionExpiresAt.setMinutes(sessionExpiresAt.getMinutes() + sessionTimeoutMinutes);

    await supabase
      .from('idm_auth_sessions')
      .insert({
        user_id: userId,
        idm_uid: idmUid,
        idm_user_dn: user_dn,
        idm_groups: groups || [],
        mapped_role: mappedRole,
        auth_method: is_ad_trust_user ? 'ad_trust' : 'freeipa_ldap',
        session_expires_at: sessionExpiresAt.toISOString(),
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
      });

    // Generate recovery link to get a token we can verify server-side
    console.log('[IDM Provision] Generating recovery link for session...');
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
    });

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error('[IDM Provision] Failed to generate recovery link:', linkError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to generate session' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the token server-side to get actual access/refresh tokens
    console.log('[IDM Provision] Verifying token to create session...');
    const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'recovery',
    });

    if (verifyError || !sessionData?.session) {
      console.error('[IDM Provision] Failed to verify token:', verifyError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to create session' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Now we have actual tokens!
    const accessToken = sessionData.session.access_token;
    const refreshToken = sessionData.session.refresh_token;

    // Log to audit
    await supabase
      .from('audit_logs')
      .insert({
        user_id: userId,
        action: 'idm_login',
        auth_source: is_ad_trust_user ? 'ad_trust' : 'freeipa',
        auth_method: is_ad_trust_user ? 'ad_trust' : 'freeipa_ldap',
        idm_user_dn: user_dn,
        idm_groups_at_login: groups || [],
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
        details: {
          username,
          mapped_role: mappedRole,
          canonical_principal,
          realm,
          is_ad_trust_user
        }
      });

    console.log(`[IDM Provision] Provisioning successful for user ${userId}`);

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        email,
        idm_uid: idmUid,
        canonical_principal: canonical_principal || `${idmUid}@${realm || 'IDM.LOCAL'}`,
        realm: realm || 'IDM.LOCAL',
        is_ad_trust_user: is_ad_trust_user || false,
        role: mappedRole,
        idm_groups: groups || [],
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: Math.floor(sessionExpiresAt.getTime() / 1000)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[IDM Provision] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
