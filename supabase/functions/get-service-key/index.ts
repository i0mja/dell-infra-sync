import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
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

    // Check if user has admin role
    const { data: hasAdminRole, error: roleError } = await supabaseAdmin.rpc('has_role', {
      _user_id: userId,
      _role: 'admin'
    });

    if (roleError || !hasAdminRole) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: Admin role required' }), 
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Return the service role key (already retrieved at top of try block)
    return new Response(
      JSON.stringify({ 
        service_role_key: supabaseServiceKey,
        message: 'Copy this key to your Job Executor .env file'
      }), 
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in get-service-key function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }), 
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
