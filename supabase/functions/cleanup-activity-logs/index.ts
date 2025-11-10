import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get settings
    const { data: settings, error: settingsError } = await supabase
      .from('activity_settings')
      .select('*')
      .single()

    if (settingsError) throw settingsError

    if (!settings?.auto_cleanup_enabled) {
      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'Auto cleanup is disabled',
          deleted_count: 0
        }), 
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - settings.log_retention_days)

    console.log(`[CLEANUP] Deleting logs older than ${cutoffDate.toISOString()}`)

    // Delete old logs
    const { error: deleteError, count } = await supabase
      .from('idrac_commands')
      .delete({ count: 'exact' })
      .lt('created_at', cutoffDate.toISOString())

    if (deleteError) throw deleteError

    console.log(`[CLEANUP] Deleted ${count} old log entries`)

    // Update last cleanup timestamp
    const { error: updateError } = await supabase
      .from('activity_settings')
      .update({ last_cleanup_at: new Date().toISOString() })
      .eq('id', settings.id)

    if (updateError) throw updateError

    return new Response(
      JSON.stringify({ 
        success: true,
        deleted_count: count || 0,
        cutoff_date: cutoffDate.toISOString(),
        retention_days: settings.log_retention_days
      }), 
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    console.error('[CLEANUP] Error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage 
      }), 
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})
