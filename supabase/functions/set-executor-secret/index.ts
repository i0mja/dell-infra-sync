import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create Supabase client with service role for admin operations
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    
    // Verify the caller is authenticated and is an admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create client with user's token to verify their role
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user is admin
    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (roleError || roleData?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { action, secret } = body;

    if (action === "generate") {
      // Generate a cryptographically secure random secret
      const randomBytes = new Uint8Array(32);
      crypto.getRandomValues(randomBytes);
      const newSecret = btoa(String.fromCharCode(...randomBytes));
      
      // Encrypt the secret using the database encryption function
      const { data: encryptionKeyData } = await supabase
        .rpc("get_encryption_key");
      
      if (!encryptionKeyData) {
        return new Response(
          JSON.stringify({ error: "Encryption key not configured. Please set one in Security settings." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: encryptedSecret, error: encryptError } = await supabase
        .rpc("encrypt_password", { password: newSecret, key: encryptionKeyData });

      if (encryptError) {
        console.error("Encryption error:", encryptError);
        return new Response(
          JSON.stringify({ error: "Failed to encrypt secret" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Store in activity_settings
      const { error: updateError } = await supabase
        .from("activity_settings")
        .update({ executor_shared_secret_encrypted: encryptedSecret })
        .not("id", "is", null); // Update all rows (should be only one)

      if (updateError) {
        console.error("Update error:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to save secret" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("Executor shared secret generated and stored successfully");

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Executor shared secret configured successfully",
          // Return the secret once for display - user can copy it if needed for manual backup
          secret: newSecret
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "check") {
      // Check if secret is configured
      const { data: settings } = await supabase
        .from("activity_settings")
        .select("executor_shared_secret_encrypted")
        .maybeSingle();

      const isConfigured = !!settings?.executor_shared_secret_encrypted;

      return new Response(
        JSON.stringify({ configured: isConfigured }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "get-decrypted") {
      // Get decrypted secret for executor to fetch
      // This requires service role authentication (checked via HMAC or special header)
      
      const { data: settings } = await supabase
        .from("activity_settings")
        .select("executor_shared_secret_encrypted")
        .maybeSingle();

      if (!settings?.executor_shared_secret_encrypted) {
        return new Response(
          JSON.stringify({ error: "Secret not configured" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Decrypt the secret
      const { data: encryptionKeyData } = await supabase
        .rpc("get_encryption_key");
      
      const { data: decryptedSecret, error: decryptError } = await supabase
        .rpc("decrypt_password", { 
          encrypted: settings.executor_shared_secret_encrypted, 
          key: encryptionKeyData 
        });

      if (decryptError || !decryptedSecret) {
        console.error("Decryption error:", decryptError);
        return new Response(
          JSON.stringify({ error: "Failed to decrypt secret" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ secret: decryptedSecret }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else {
      return new Response(
        JSON.stringify({ error: "Invalid action. Use 'generate', 'check', or 'get-decrypted'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    console.error("Error in set-executor-secret:", error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
