import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user's token
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify caller is admin
    const { data: { user: caller }, error: authError } = await userClient.auth.getUser();
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if caller is admin
    const { data: callerRole } = await userClient
      .from('user_roles')
      .select('role')
      .eq('user_id', caller.id)
      .single();

    if (callerRole?.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Only admins can delete users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const { user_id } = await req.json();
    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prevent self-deletion
    if (user_id === caller.id) {
      return new Response(
        JSON.stringify({ error: 'You cannot delete your own account' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create admin client for deletion operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get user info before deletion (for audit log)
    const { data: userProfile } = await adminClient
      .from('profiles')
      .select('email, full_name')
      .eq('id', user_id)
      .single();

    // 1. Update audit_logs to SET NULL on user_id (preserve logs)
    await adminClient
      .from('audit_logs')
      .update({ user_id: null })
      .eq('user_id', user_id);

    // 2. Update jobs to SET NULL on created_by (preserve job history)
    const { error: jobsError } = await adminClient
      .from('jobs')
      .update({ created_by: null })
      .eq('created_by', user_id);

    if (jobsError) {
      console.error('Error updating jobs:', jobsError);
      return new Response(
        JSON.stringify({ error: 'Failed to update job references', details: jobsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Delete from idm_auth_sessions
    await adminClient
      .from('idm_auth_sessions')
      .delete()
      .eq('user_id', user_id);

    // 4. Delete from user_roles
    const { error: rolesError } = await adminClient
      .from('user_roles')
      .delete()
      .eq('user_id', user_id);

    if (rolesError) {
      console.error('Error deleting user roles:', rolesError);
    }

    // 5. Delete from profiles
    const { error: profileError } = await adminClient
      .from('profiles')
      .delete()
      .eq('id', user_id);

    if (profileError) {
      console.error('Error deleting profile:', profileError);
      return new Response(
        JSON.stringify({ error: 'Failed to delete user profile', details: profileError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6. Delete from auth.users using admin API
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(user_id);

    if (authDeleteError) {
      console.error('Error deleting auth user:', authDeleteError);
      // Profile already deleted, log this but don't fail completely
    }

    // 7. Log the deletion
    await adminClient.from('audit_logs').insert({
      action: 'user_deleted',
      user_id: caller.id,
      auth_source: 'local',
      auth_method: 'admin_action',
      ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null,
      details: {
        deleted_user_id: user_id,
        deleted_user_email: userProfile?.email,
        deleted_user_name: userProfile?.full_name,
      },
    });

    console.log(`User ${user_id} deleted by admin ${caller.id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'User deleted successfully',
        deleted_user: {
          id: user_id,
          email: userProfile?.email,
          full_name: userProfile?.full_name,
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in delete-user function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
