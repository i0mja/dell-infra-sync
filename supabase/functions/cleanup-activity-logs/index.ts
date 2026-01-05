import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request body for options
    let preview = false;
    let overrideRetentionDays: number | null = null;
    
    try {
      const body = await req.json();
      preview = body.preview === true;
      if (typeof body.retentionDays === 'number' && body.retentionDays > 0) {
        overrideRetentionDays = body.retentionDays;
      }
    } catch {
      // No body or invalid JSON - use defaults
    }

    console.log(`[cleanup-activity-logs] Starting - preview: ${preview}, overrideRetentionDays: ${overrideRetentionDays}`);

    // Fetch settings
    const { data: settings, error: settingsError } = await supabase
      .from('activity_settings')
      .select('*')
      .maybeSingle();

    if (settingsError) {
      console.error('[cleanup-activity-logs] Error fetching settings:', settingsError);
      throw settingsError;
    }

    // Use override if provided, otherwise use settings
    const retentionDays = overrideRetentionDays || settings?.log_retention_days || 30;
    const autoCleanupEnabled = settings?.auto_cleanup_enabled ?? true;

    // If not preview and auto-cleanup is disabled (and no override), skip
    if (!preview && !autoCleanupEnabled && !overrideRetentionDays) {
      console.log('[cleanup-activity-logs] Auto-cleanup disabled and no override, skipping');
      return new Response(JSON.stringify({
        success: true,
        message: 'Auto-cleanup is disabled',
        deleted: 0,
        preview: false
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoffIso = cutoffDate.toISOString();

    console.log(`[cleanup-activity-logs] Retention: ${retentionDays} days, cutoff: ${cutoffIso}`);

    if (preview) {
      // Preview mode - just count records
      const { count, error: countError } = await supabase
        .from('idrac_commands')
        .select('*', { count: 'exact', head: true })
        .lt('timestamp', cutoffIso);

      if (countError) {
        console.error('[cleanup-activity-logs] Error counting records:', countError);
        throw countError;
      }

      console.log(`[cleanup-activity-logs] Preview: ${count} records would be deleted`);

      return new Response(JSON.stringify({
        success: true,
        preview: true,
        count: count || 0,
        retentionDays,
        cutoffDate: cutoffIso
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Delete old records
    const { data: deleted, error: deleteError } = await supabase
      .from('idrac_commands')
      .delete()
      .lt('timestamp', cutoffIso)
      .select('id');

    if (deleteError) {
      console.error('[cleanup-activity-logs] Error deleting records:', deleteError);
      throw deleteError;
    }

    const deletedCount = deleted?.length || 0;
    console.log(`[cleanup-activity-logs] Deleted ${deletedCount} activity logs`);

    // Update last cleanup timestamp
    if (settings?.id) {
      await supabase
        .from('activity_settings')
        .update({ last_cleanup_at: new Date().toISOString() })
        .eq('id', settings.id);
    }

    return new Response(JSON.stringify({
      success: true,
      preview: false,
      deleted: deletedCount,
      retentionDays,
      cutoffDate: cutoffIso
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: unknown) {
    console.error('[cleanup-activity-logs] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
