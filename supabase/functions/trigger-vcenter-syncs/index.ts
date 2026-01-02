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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    console.log('[trigger-vcenter-syncs] Checking for vCenters due for sync...');

    // Query vCenters where next_sync_at <= now() AND sync_enabled = true
    const { data: dueVCenters, error: queryError } = await supabaseAdmin
      .from('vcenters')
      .select('id, name, sync_interval_minutes')
      .eq('sync_enabled', true)
      .lte('next_sync_at', new Date().toISOString());

    if (queryError) {
      console.error('[trigger-vcenter-syncs] Query error:', queryError);
      throw queryError;
    }

    if (!dueVCenters || dueVCenters.length === 0) {
      console.log('[trigger-vcenter-syncs] No vCenters due for sync');
      return new Response(
        JSON.stringify({ triggered: 0, message: 'No vCenters due for sync' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[trigger-vcenter-syncs] Found ${dueVCenters.length} vCenter(s) due for sync`);

    let triggeredCount = 0;
    const skipped: string[] = [];

    for (const vc of dueVCenters) {
      // Check for existing pending/running sync for this vCenter
      const { data: existingJobs, error: checkError } = await supabaseAdmin
        .from('jobs')
        .select('id')
        .eq('job_type', 'vcenter_sync')
        .in('status', ['pending', 'running'])
        .contains('details', { vcenter_id: vc.id });

      if (checkError) {
        console.error(`[trigger-vcenter-syncs] Error checking existing jobs for ${vc.name}:`, checkError);
        continue;
      }

      if (existingJobs && existingJobs.length > 0) {
        console.log(`[trigger-vcenter-syncs] Skipping ${vc.name} - sync already in progress`);
        skipped.push(vc.name);
        continue;
      }

      // Create sync job (silent - no notifications)
      const { error: insertError } = await supabaseAdmin.from('jobs').insert({
        job_type: 'vcenter_sync',
        status: 'pending',
        target_scope: { vcenter_ids: [vc.id] },
        details: {
          vcenter_id: vc.id,
          vcenter_name: vc.name,
          triggered_by: 'scheduled',
          silent: true
        }
      });

      if (insertError) {
        console.error(`[trigger-vcenter-syncs] Error creating job for ${vc.name}:`, insertError);
        continue;
      }

      // Immediately update next_sync_at to prevent double-triggering
      // The trigger will also update this when last_sync changes, but this prevents race conditions
      const nextSyncAt = new Date(Date.now() + vc.sync_interval_minutes * 60 * 1000).toISOString();
      const { error: updateError } = await supabaseAdmin
        .from('vcenters')
        .update({ next_sync_at: nextSyncAt })
        .eq('id', vc.id);

      if (updateError) {
        console.error(`[trigger-vcenter-syncs] Error updating next_sync_at for ${vc.name}:`, updateError);
      }

      console.log(`[trigger-vcenter-syncs] Triggered sync for ${vc.name}, next sync at ${nextSyncAt}`);
      triggeredCount++;
    }

    const result = {
      triggered: triggeredCount,
      skipped: skipped.length,
      skippedNames: skipped,
      message: `Triggered ${triggeredCount} sync(s), skipped ${skipped.length} (already running)`
    };

    console.log('[trigger-vcenter-syncs] Complete:', result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[trigger-vcenter-syncs] Error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});