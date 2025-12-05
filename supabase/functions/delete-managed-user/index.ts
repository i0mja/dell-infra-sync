import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Create admin client with service role key for auth.admin operations
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Get the authorization header to verify the caller
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the caller is authenticated and is an admin
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if caller has admin role (handle multiple role rows)
    const { data: callerRoles } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', caller.id);

    const hasAdminRole = callerRoles?.some(r => r.role === 'admin');

    if (!hasAdminRole) {
      return new Response(
        JSON.stringify({ error: 'Admin role required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const { managed_user_id, complete_removal = true } = await req.json();

    if (!managed_user_id) {
      return new Response(
        JSON.stringify({ error: 'managed_user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the managed user record
    const { data: managedUser, error: fetchError } = await supabaseAdmin
      .from('managed_users')
      .select('*')
      .eq('id', managed_user_id)
      .single();

    if (fetchError || !managedUser) {
      return new Response(
        JSON.stringify({ error: 'Managed user not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing deletion for managed user: ${managedUser.ad_username}@${managedUser.ad_domain}`);

    let userRolesDeleted = false;
    let profileDeleted = false;
    let authUserDeleted = false;
    let profileId: string | null = null;

    if (complete_removal) {
      // Find the corresponding profile by matching idm_uid to ad_username (case-insensitive)
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, email, idm_uid, idm_user_dn')
        .or(`idm_uid.ilike.${managedUser.ad_username},idm_uid.ilike.${managedUser.ad_username}@%`);

      // Find the best match
      const matchedProfile = profiles?.find(p => {
        const idmUid = (p.idm_uid || '').toLowerCase();
        const adUsername = managedUser.ad_username.toLowerCase();
        return idmUid === adUsername || 
               idmUid.startsWith(`${adUsername}@`) ||
               idmUid === `${adUsername}@${managedUser.ad_domain.toLowerCase()}`;
      });

      if (matchedProfile) {
        profileId = matchedProfile.id;
        console.log(`Found matching profile: ${matchedProfile.email} (${matchedProfile.id})`);

        // Step 1: Delete user_roles first (to avoid FK constraint issues)
        const { error: deleteRolesError } = await supabaseAdmin
          .from('user_roles')
          .delete()
          .eq('user_id', matchedProfile.id);

        if (deleteRolesError) {
          console.error(`Failed to delete user_roles: ${deleteRolesError.message}`);
        } else {
          console.log(`Deleted user_roles for user ${matchedProfile.id}`);
          userRolesDeleted = true;
        }

        // Step 2: Delete profile (before auth.users to avoid cascade issues)
        const { error: deleteProfileError } = await supabaseAdmin
          .from('profiles')
          .delete()
          .eq('id', matchedProfile.id);

        if (deleteProfileError) {
          console.error(`Failed to delete profile: ${deleteProfileError.message}`);
        } else {
          console.log(`Deleted profile for user ${matchedProfile.id}`);
          profileDeleted = true;
        }

        // Step 3: Delete the auth user (should now work without constraint issues)
        const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(matchedProfile.id);

        if (deleteAuthError) {
          console.error(`Failed to delete auth user: ${deleteAuthError.message}`);
          // Continue anyway - profile and roles are already cleaned up
        } else {
          console.log(`Deleted auth user ${matchedProfile.id}`);
          authUserDeleted = true;
        }
      } else {
        console.log(`No matching profile found for ${managedUser.ad_username} - user may not have logged in yet`);
      }
    }

    // Delete from managed_users table
    const { error: deleteError } = await supabaseAdmin
      .from('managed_users')
      .delete()
      .eq('id', managed_user_id);

    if (deleteError) {
      console.error(`Failed to delete managed user: ${deleteError.message}`);
      return new Response(
        JSON.stringify({ error: `Failed to delete managed user: ${deleteError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log to audit_logs
    await supabaseAdmin.from('audit_logs').insert({
      action: 'user_deleted',
      user_id: caller.id,
      details: {
        managed_user_id,
        ad_username: managedUser.ad_username,
        ad_domain: managedUser.ad_domain,
        display_name: managedUser.display_name,
        complete_removal,
        user_roles_deleted: userRolesDeleted,
        profile_deleted: profileDeleted,
        auth_user_deleted: authUserDeleted,
        profile_id: profileId,
      },
    });

    console.log(`Successfully deleted managed user ${managedUser.ad_username}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: complete_removal && authUserDeleted
          ? 'User completely removed from system'
          : complete_removal && profileDeleted
            ? 'User profile and roles removed (auth user may have been previously deleted)'
            : complete_removal && !profileDeleted
              ? 'Authorization removed (user had not logged in yet)'
              : 'Authorization removed',
        details: {
          managed_user_deleted: true,
          user_roles_deleted: userRolesDeleted,
          profile_deleted: profileDeleted,
          auth_user_deleted: authUserDeleted,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in delete-managed-user:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
