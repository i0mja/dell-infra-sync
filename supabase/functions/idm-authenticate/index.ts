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

// Helper function to validate email addresses properly
const isValidEmail = (email: any): email is string => {
  if (!email || typeof email !== 'string') return false;
  // Reject empty strings, "[]", "{}" and other invalid formats
  if (email === '[]' || email === '{}' || email.trim() === '' || email === 'null' || email === 'undefined') return false;
  // Basic email format validation
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

// Extract clean username from various formats
const extractCleanUsername = (username: string, canonicalPrincipal?: string): string => {
  // Prefer canonical_principal if available (e.g., "adm_jalexander@NEOPOST.AD" → "adm_jalexander")
  if (canonicalPrincipal && canonicalPrincipal.includes('@')) {
    return canonicalPrincipal.split('@')[0];
  }
  // Fallback to parsing input username
  if (username.includes('@')) {
    return username.split('@')[0];
  }
  if (username.includes('\\')) {
    return username.split('\\').pop() || username;
  }
  return username;
};

// Construct proper email from authentication result
const constructEmail = (
  cleanUsername: string,
  userAttributes: any,
  authResult: any,
  idmServerHost: string | null
): string => {
  // 1. Try user's actual email from LDAP if valid
  const userEmail = userAttributes?.email || userAttributes?.mail;
  if (isValidEmail(userEmail)) {
    console.log(`[IDM Auth] Using valid user email: ${userEmail}`);
    return userEmail;
  }
  
  // 2. If canonical_principal is already in email format, use it
  const canonicalPrincipal = authResult?.canonical_principal;
  if (canonicalPrincipal && canonicalPrincipal.includes('@')) {
    const email = canonicalPrincipal.toLowerCase();
    console.log(`[IDM Auth] Using canonical_principal as email: ${email}`);
    return email;
  }
  
  // 3. Construct from realm for AD trust users (e.g., adm_jalexander@neopost.ad)
  const realm = authResult?.realm;
  const isAdTrustUser = authResult?.is_ad_trust_user;
  if (isAdTrustUser && realm) {
    const email = `${cleanUsername}@${realm.toLowerCase()}`;
    console.log(`[IDM Auth] Constructed AD trust email: ${email}`);
    return email;
  }
  
  // 4. For native IDM users, use server_host domain (e.g., username@idm.neopost.grp)
  if (idmServerHost) {
    const email = `${cleanUsername}@${idmServerHost.toLowerCase()}`;
    console.log(`[IDM Auth] Constructed IDM email from server_host: ${email}`);
    return email;
  }
  
  // 5. Fallback: construct from realm if available
  if (realm) {
    const email = `${cleanUsername}@${realm.toLowerCase()}`;
    console.log(`[IDM Auth] Constructed email from realm: ${email}`);
    return email;
  }
  
  // 6. Last resort fallback
  const fallbackEmail = `${cleanUsername.replace(/[^a-zA-Z0-9_.-]/g, '_')}@idm.local.invalid`;
  console.log(`[IDM Auth] Using fallback email (should not happen): ${fallbackEmail}`);
  return fallbackEmail;
};

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

    // Find a system/admin user to use as created_by
    console.log('[IDM Auth] Finding system user for job creation...');
    const { data: adminUser } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin')
      .limit(1)
      .single();

    const createdBy = adminUser?.user_id || null;

    // Create authentication job
    console.log('[IDM Auth] Creating authentication job...');
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .insert({
        job_type: 'idm_authenticate',
        created_by: createdBy,
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
        JSON.stringify({ success: false, error: 'Failed to create authentication job: ' + (jobError?.message || 'Unknown error') }),
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

        const userAttributes =
          authResult?.user_attributes ||
          authResult?.user_info ||
          {};

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

        // Extract clean username - prefer canonical_principal from auth result
        const cleanUsername = extractCleanUsername(username, authResult.canonical_principal);
        const idmUid = cleanUsername; // Use clean username as idm_uid
        
        console.log(`[IDM Auth] Clean username: ${cleanUsername}, idm_uid: ${idmUid}`);
        console.log(`[IDM Auth] Auth result - realm: ${authResult.realm}, is_ad_trust: ${authResult.is_ad_trust_user}, canonical: ${authResult.canonical_principal}`);
        
        // Try multiple lookup strategies to find existing user
        let existingProfile = null;
        
        // 1. Try exact idm_uid match (clean username)
        const { data: profileByUid } = await supabase
          .from('profiles')
          .select('id, email, idm_uid')
          .eq('idm_uid', idmUid)
          .single();
        
        if (profileByUid) {
          existingProfile = profileByUid;
          console.log(`[IDM Auth] Found user by idm_uid: ${existingProfile.id}`);
        }
        
        // 2. Try case-insensitive idm_uid match
        if (!existingProfile) {
          const { data: profileByUidICase } = await supabase
            .from('profiles')
            .select('id, email, idm_uid')
            .ilike('idm_uid', idmUid)
            .single();
          
          if (profileByUidICase) {
            existingProfile = profileByUidICase;
            console.log(`[IDM Auth] Found user by case-insensitive idm_uid: ${existingProfile.id}`);
          }
        }
        
        // 3. Try email match with constructed email
        const constructedEmail = constructEmail(cleanUsername, userAttributes, authResult, idmSettings.server_host);
        if (!existingProfile) {
          const { data: profileByEmail } = await supabase
            .from('profiles')
            .select('id, email, idm_uid')
            .eq('email', constructedEmail)
            .single();
          
          if (profileByEmail) {
            existingProfile = profileByEmail;
            console.log(`[IDM Auth] Found user by constructed email: ${existingProfile.id}`);
          }
        }
        
        // 4. Try legacy email formats as fallback
        if (!existingProfile) {
          const legacyEmails = [
            `${cleanUsername}@idm.local`,
            `${cleanUsername}@idm.example.com`,
            `${cleanUsername}@idm.internal`
          ];
          
          for (const legacyEmail of legacyEmails) {
            const { data: profileByLegacy } = await supabase
              .from('profiles')
              .select('id, email, idm_uid')
              .eq('email', legacyEmail)
              .single();
            
            if (profileByLegacy) {
              existingProfile = profileByLegacy;
              console.log(`[IDM Auth] Found user by legacy email ${legacyEmail}: ${existingProfile.id}`);
              break;
            }
          }
        }

        let userId: string;
        let email: string;

        if (existingProfile) {
          // User exists
          console.log(`[IDM Auth] Existing user found: ${existingProfile.id}`);
          userId = existingProfile.id;
          
          // Always use the correctly constructed email
          email = constructedEmail;
          const needsEmailUpdate = existingProfile.email !== constructedEmail;
          
          if (needsEmailUpdate) {
            console.log(`[IDM Auth] Email migration needed: ${existingProfile.email} → ${constructedEmail}`);
          }

          // Update profile with latest IDM info INCLUDING email
          await supabase
            .from('profiles')
            .update({
              email: constructedEmail, // Update email to correct domain
              idm_uid: idmUid, // Update to clean username format
              idm_source: authResult.is_ad_trust_user ? 'ad_trust' : 'freeipa',
              idm_user_dn: authResult.user_dn,
              idm_groups: authResult.groups || [],
              idm_disabled: false,
              idm_mail: isValidEmail(userAttributes.email) ? userAttributes.email : null,
              idm_title: userAttributes.title,
              idm_department: userAttributes.department,
              last_idm_sync: new Date().toISOString()
            })
            .eq('id', userId);
          
          // Update auth.users email if it changed
          if (needsEmailUpdate) {
            console.log(`[IDM Auth] Updating auth.users email for ${userId}`);
            const { error: updateAuthError } = await supabase.auth.admin.updateUserById(userId, {
              email: constructedEmail,
              email_confirm: true
            });
            if (updateAuthError) {
              console.error(`[IDM Auth] Failed to update auth.users email:`, updateAuthError);
            } else {
              console.log(`[IDM Auth] Successfully updated auth.users email to ${constructedEmail}`);
            }
          }

        } else {
          // JIT user provisioning - create new user
          console.log(`[IDM Auth] Creating new user via JIT provisioning`);
          
          // Construct proper email based on realm/domain
          email = constructedEmail;
          const fullName = userAttributes.full_name || userAttributes.displayName || cleanUsername;

          console.log(`[IDM Auth] Creating user with email: ${email}`);

          const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: {
              full_name: fullName,
              idm_uid: idmUid,
              idm_source: authResult.is_ad_trust_user ? 'ad_trust' : 'freeipa'
            }
          });

          if (createError || !newUser.user) {
            // Handle email_exists error - try to find and use existing user
            if (createError?.code === 'email_exists') {
              console.log(`[IDM Auth] Email exists, looking up existing user...`);
              
              const { data: usersData } = await supabase.auth.admin.listUsers();
              const existingUser = usersData?.users?.find(u => u.email === email);
              
              if (existingUser) {
                userId = existingUser.id;
                console.log(`[IDM Auth] Found existing auth user: ${userId}`);
                
                // Update their profile
                await supabase
                  .from('profiles')
                  .update({
                    idm_uid: idmUid,
                    idm_source: authResult.is_ad_trust_user ? 'ad_trust' : 'freeipa',
                    idm_user_dn: authResult.user_dn,
                    idm_groups: authResult.groups || [],
                    idm_disabled: false,
                    idm_mail: isValidEmail(userAttributes.email) ? userAttributes.email : null,
                    idm_title: userAttributes.title,
                    idm_department: userAttributes.department,
                    last_idm_sync: new Date().toISOString()
                  })
                  .eq('id', userId);
              } else {
                console.error('[IDM Auth] Could not find existing user despite email_exists error');
                return new Response(
                  JSON.stringify({ success: false, error: 'User account conflict - please contact administrator' }),
                  { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
              }
            } else {
              console.error('[IDM Auth] Failed to create user:', createError);
              return new Response(
                JSON.stringify({ success: false, error: 'Failed to provision user account: ' + (createError?.message || 'Unknown error') }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
          } else {
            userId = newUser.user.id;

            // Update profile (trigger should have created it)
            await supabase
              .from('profiles')
              .update({
                full_name: fullName,
                idm_uid: idmUid,
                idm_source: authResult.is_ad_trust_user ? 'ad_trust' : 'freeipa',
                idm_user_dn: authResult.user_dn,
                idm_groups: authResult.groups || [],
                idm_disabled: false,
                idm_mail: isValidEmail(userAttributes.email) ? userAttributes.email : null,
                idm_title: userAttributes.title,
                idm_department: userAttributes.department,
                last_idm_sync: new Date().toISOString()
              })
              .eq('id', userId);
          }
        }

        // Map groups to role - FIRST check managed_users table for direct assignment
        console.log('[IDM Auth] Checking managed_users for direct role assignment...');
        const userGroups = authResult.groups || [];
        
        // Normalize username for managed_users lookup
        const normalizedUsername = cleanUsername.toLowerCase();
        
        // Check managed_users table first
        const { data: managedUser } = await supabase
          .from('managed_users')
          .select('*')
          .eq('ad_username', normalizedUsername)
          .eq('is_active', true)
          .single();
        
        let mappedRole = 'viewer'; // Default role
        let roleSource = 'default';
        
        if (managedUser) {
          // Use role from managed_users table
          mappedRole = managedUser.app_role;
          roleSource = 'managed_users';
          console.log(`[IDM Auth] Found managed user entry, using role '${mappedRole}' from managed_users table`);
        } else {
          // Fall back to group mappings
          console.log('[IDM Auth] No managed_users entry, falling back to group mappings...');
          
          const { data: groupMappings } = await supabase
            .from('idm_group_mappings')
            .select('*')
            .eq('is_active', true)
            .order('priority', { ascending: true });

          if (groupMappings && groupMappings.length > 0) {
            for (const mapping of groupMappings) {
              // Improved group matching: normalize both sides for comparison
              const mappingGroupName = (mapping.idm_group_dn || mapping.idm_group_name || '').toLowerCase();
              const normalizedMappingName = mappingGroupName.includes('cn=') 
                ? mappingGroupName.match(/cn=([^,]+)/i)?.[1]?.toLowerCase() || mappingGroupName
                : mappingGroupName.split('\\').pop()?.toLowerCase() || mappingGroupName;
              
              if (userGroups.some((group: string) => {
                const normalizedGroup = group.toLowerCase().includes('cn=')
                  ? group.match(/cn=([^,]+)/i)?.[1]?.toLowerCase() || group.toLowerCase()
                  : group.split('\\').pop()?.toLowerCase() || group.toLowerCase();
                return normalizedGroup === normalizedMappingName || normalizedGroup.includes(normalizedMappingName) || normalizedMappingName.includes(normalizedGroup);
              })) {
                mappedRole = mapping.app_role;
                roleSource = 'group_mapping';
                console.log(`[IDM Auth] Mapped to role '${mappedRole}' via group '${mapping.idm_group_name}'`);
                break;
              }
            }
          }
        }

        console.log(`[IDM Auth] Final role: ${mappedRole} (source: ${roleSource})`);

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
            auth_method: authResult.is_ad_trust_user ? 'ad_trust' : 'freeipa_ldap',
            session_expires_at: sessionExpiresAt.toISOString(),
            ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
          });

        // Generate recovery link to get a token we can verify server-side
        console.log('[IDM Auth] Generating recovery link for session...');
        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
          type: 'recovery',
          email,
        });

        if (linkError || !linkData?.properties?.hashed_token) {
          console.error('[IDM Auth] Failed to generate recovery link:', linkError);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to generate session' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Verify the token server-side to get actual access/refresh tokens
        console.log('[IDM Auth] Verifying token to create session...');
        const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: linkData.properties.hashed_token,
          type: 'recovery',
        });

        if (verifyError || !sessionData?.session) {
          console.error('[IDM Auth] Failed to verify token:', verifyError);
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
            auth_source: authResult.is_ad_trust_user ? 'ad_trust' : 'freeipa',
            auth_method: authResult.is_ad_trust_user ? 'ad_trust' : 'freeipa_ldap',
            idm_user_dn: authResult.user_dn,
            idm_groups_at_login: authResult.groups || [],
            ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
            details: {
              username,
              mapped_role: mappedRole,
              canonical_principal: authResult.canonical_principal,
              realm: authResult.realm
            }
          });

        console.log(`[IDM Auth] Login successful for user ${userId}`);

        return new Response(
          JSON.stringify({
            success: true,
            user_id: userId,
            email,
            idm_uid: idmUid,
            canonical_principal: authResult.canonical_principal || `${idmUid}@${authResult.realm || 'IDM.LOCAL'}`,
            realm: authResult.realm || authResult.ad_domain || 'IDM.LOCAL',
            is_ad_trust_user: authResult.is_ad_trust_user || false,
            role: mappedRole,
            idm_groups: authResult.groups || [],
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_at: Math.floor(sessionExpiresAt.getTime() / 1000)
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (updatedJob.status === 'failed') {
        console.log('[IDM Auth] Job failed');
        const errorMsg = updatedJob.details?.error || 'Authentication failed';

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
            error: errorMsg,
            remaining_attempts: rateLimitCheck?.remaining_attempts ? rateLimitCheck.remaining_attempts - 1 : 4
          }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Job timed out
    console.error('[IDM Auth] Job timed out');
    return new Response(
      JSON.stringify({ success: false, error: 'Authentication timeout - please try again' }),
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
