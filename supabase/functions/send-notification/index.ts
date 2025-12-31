import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { verifyExecutorRequest } from "../_shared/hmac-verify.ts";
import { logger } from "../_shared/logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-executor-signature, x-executor-timestamp',
};

interface NotificationPayload {
  jobId?: string;
  jobType?: string;
  status?: string;
  details?: any;
  isTest?: boolean;
  testMessage?: string;
}

interface NotificationSettings {
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  smtp_password?: string;
  smtp_from_email?: string;
  teams_webhook_url?: string;
  notify_on_job_complete?: boolean;
  notify_on_job_failed?: boolean;
  notify_on_job_started?: boolean;
  teams_mention_users?: string;
  mention_on_critical_failures?: boolean;
  critical_job_types?: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse request body first for HMAC verification
    const payload: any = await req.json();
    
    // Verify HMAC signature from Job Executor (skip for internal supabase.functions.invoke calls)
    // Internal calls come from update-job function and don't have executor headers
    const hasExecutorHeaders = req.headers.has('x-executor-signature');
    if (hasExecutorHeaders) {
      const isValid = await verifyExecutorRequest(req, payload);
      if (!isValid) {
        return new Response(
          JSON.stringify({ success: false, error: 'Unauthorized: Invalid request signature' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { jobId, jobType, status, details, isTest, is_test, testMessage, notification_type } = payload;
    
    // Handle both camelCase and snake_case for test notifications
    const isTestNotification = isTest || is_test || false;

    logger.debug('Processing notification request');

    // Get notification settings
    const { data: settings, error: settingsError } = await supabaseClient
      .from('notification_settings')
      .select('*')
      .limit(1)
      .maybeSingle() as { data: NotificationSettings | null; error: any };

    if (settingsError) {
      logger.error('Error fetching notification settings');
      throw settingsError;
    }

    if (!settings) {
      logger.debug('No notification settings configured');
      return new Response(
        JSON.stringify({ message: 'No notification settings configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Handle cluster safety alerts (scheduled checks)
    if (notification_type === 'cluster_safety_alert') {
      const {
        cluster_name,
        safe_to_proceed,
        total_hosts,
        healthy_hosts,
        drs_enabled,
        drs_mode,
        warnings = [],
        status_changed,
        previous_status,
        severity,
        check_timestamp
      } = payload;
      
      const statusEmoji = safe_to_proceed ? '✅' : '🚨';
      const statusText = safe_to_proceed ? 'SAFE' : 'UNSAFE';
      const changeText = status_changed 
        ? `\n⚠️ Status Changed: ${previous_status?.toUpperCase()} → ${statusText}` 
        : '';
      
      // Email notification
      if (settings.smtp_host && settings.smtp_user && settings.smtp_from_email) {
        const subject = `${statusEmoji} Cluster Safety Alert: ${cluster_name} - ${statusText}`;
        const body = `
          <h2>${statusEmoji} Cluster Safety Alert</h2>
          <p><strong>Cluster:</strong> ${cluster_name}</p>
          <p><strong>Status:</strong> ${statusText}${changeText}</p>
          
          <h3>Cluster Details</h3>
          <ul>
            <li><strong>Total Hosts:</strong> ${total_hosts}</li>
            <li><strong>Healthy Hosts:</strong> ${healthy_hosts}</li>
            <li><strong>DRS Enabled:</strong> ${drs_enabled ? 'Yes' : 'No'}</li>
            <li><strong>DRS Mode:</strong> ${drs_mode}</li>
          </ul>
          
          ${warnings.length > 0 ? `
            <h3>⚠️ Warnings</h3>
            <ul>
              ${warnings.map((w: string) => `<li>${w}</li>`).join('')}
            </ul>
          ` : ''}
          
          <p><strong>Recommendation:</strong> ${safe_to_proceed 
            ? 'Cluster is safe for maintenance operations.' 
            : 'Do NOT perform maintenance operations until issues are resolved.'}</p>
          
          <p><small>Check Time: ${new Date(check_timestamp).toLocaleString()}</small></p>
        `;
        
        try {
          await sendEmailNotification(settings, 'cluster-safety', cluster_name, statusText, { body, subject });
          logger.debug('Cluster safety email sent');
        } catch (error) {
          logger.warn('Failed to send cluster safety email');
        }
      }
      
      // Teams notification
      if (settings.teams_webhook_url) {
        const color = safe_to_proceed ? '28a745' : 'dc3545';
        const card = {
          "@type": "MessageCard",
          "@context": "https://schema.org/extensions",
          "themeColor": color,
          "summary": `Cluster Safety Alert: ${cluster_name}`,
          "sections": [{
            "activityTitle": `${statusEmoji} Cluster Safety Alert`,
            "activitySubtitle": cluster_name,
            "facts": [
              { "name": "Status", "value": statusText },
              { "name": "Total Hosts", "value": total_hosts.toString() },
              { "name": "Healthy Hosts", "value": healthy_hosts.toString() },
              { "name": "DRS Enabled", "value": drs_enabled ? 'Yes' : 'No' },
              { "name": "DRS Mode", "value": drs_mode },
              ...(status_changed ? [{ "name": "Status Change", "value": `${previous_status?.toUpperCase()} → ${statusText}` }] : []),
              ...(warnings.length > 0 ? [{ "name": "Warnings", "value": warnings.join('; ') }] : [])
            ],
            "text": safe_to_proceed 
              ? '✅ Cluster is safe for maintenance operations.'
              : '🚨 **Do NOT perform maintenance** until issues are resolved.'
          }]
        };
        
        try {
          const teamsResponse = await fetch(settings.teams_webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(card)
          });
          if (!teamsResponse.ok) throw new Error('Teams webhook failed');
          logger.debug('Cluster safety Teams notification sent');
        } catch (error) {
          logger.warn('Failed to send Teams notification');
        }
      }
      
      // Log the alert
      await supabaseClient.from('notification_logs').insert({
        notification_type: 'cluster_safety_alert',
        status: 'success',
        delivery_details: { cluster_name, status: statusText, severity },
        severity
      });
      
      return new Response(
        JSON.stringify({ success: true, message: 'Cluster safety alert sent' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle SLA violation alerts
    if (notification_type === 'sla_violation_alert') {
      const { alert_type, violations = [], summary } = payload;
      
      const isRPOBreach = alert_type === 'rpo_breach';
      const alertEmoji = isRPOBreach ? '⏱️' : '🧪';
      const alertTitle = isRPOBreach ? 'RPO SLA Violation' : 'Test Reminder Alert';
      const themeColor = isRPOBreach ? 'FF6B35' : 'FFA500';
      
      // Format violations list
      const violationsList = violations.map((v: any) => {
        if (isRPOBreach) {
          return `• **${v.group_name}**: ${v.current_rpo_minutes}min (target: ${v.target_rpo_minutes}min) - ${v.severity}`;
        } else {
          return `• **${v.group_name}**: Never tested or test overdue (reminder: ${v.reminder_days} days)`;
        }
      }).join('\n');
      
      // Email notification
      if (settings.smtp_host && settings.smtp_user && settings.smtp_from_email) {
        const subject = `${alertEmoji} ${alertTitle} - ${violations.length} protection group(s)`;
        const body = `
          <h2>${alertEmoji} ${alertTitle}</h2>
          <p>${summary}</p>
          
          <h3>Affected Protection Groups</h3>
          <ul>
            ${violations.map((v: any) => {
              if (isRPOBreach) {
                return `<li><strong>${v.group_name}</strong>: Current RPO ${v.current_rpo_minutes} minutes (Target: ${v.target_rpo_minutes} minutes) - <span style="color: ${v.severity === 'critical' ? 'red' : 'orange'}">${v.severity.toUpperCase()}</span></li>`;
              } else {
                return `<li><strong>${v.group_name}</strong>: Failover test ${v.last_test_at ? 'overdue' : 'never performed'}</li>`;
              }
            }).join('')}
          </ul>
          
          <p><strong>Action Required:</strong> ${isRPOBreach 
            ? 'Review protection group schedules and ensure replication is functioning correctly.'
            : 'Schedule a failover test to verify DR readiness.'}</p>
        `;
        
        try {
          await sendEmailNotification(settings, 'sla-violation', alert_type, 'alert', { body, subject });
          logger.debug('SLA violation email sent');
        } catch (error) {
          logger.warn('Failed to send SLA violation email');
        }
      }
      
      // Teams notification
      if (settings.teams_webhook_url) {
        const card = {
          "@type": "MessageCard",
          "@context": "https://schema.org/extensions",
          "themeColor": themeColor,
          "summary": `${alertTitle}: ${violations.length} group(s)`,
          "sections": [{
            "activityTitle": `${alertEmoji} ${alertTitle}`,
            "activitySubtitle": summary,
            "facts": violations.slice(0, 10).map((v: any) => ({
              "name": v.group_name,
              "value": isRPOBreach 
                ? `${v.current_rpo_minutes}min / ${v.target_rpo_minutes}min target (${v.severity})`
                : v.last_test_at ? 'Test overdue' : 'Never tested'
            })),
            "text": isRPOBreach 
              ? '⚠️ Review protection group schedules and replication status.'
              : '🧪 Schedule failover tests to verify DR readiness.'
          }]
        };
        
        try {
          const teamsResponse = await fetch(settings.teams_webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(card)
          });
          if (!teamsResponse.ok) throw new Error('Teams webhook failed');
          logger.debug('SLA violation Teams notification sent');
        } catch (error) {
          logger.warn('Failed to send Teams notification');
        }
      }
      
      // Log the alert
      await supabaseClient.from('notification_logs').insert({
        notification_type: 'sla_violation_alert',
        status: 'success',
        delivery_details: { alert_type, violations_count: violations.length },
        severity: violations.some((v: any) => v.severity === 'critical') ? 'critical' : 'warning'
      });
      
      return new Response(
        JSON.stringify({ success: true, message: 'SLA violation alert sent' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if we should notify for this event (skip for test notifications)
    if (!isTestNotification) {
      const shouldNotify = 
        (status === 'completed' && settings.notify_on_job_complete) ||
        (status === 'failed' && settings.notify_on_job_failed) ||
        (status === 'running' && settings.notify_on_job_started);

      if (!shouldNotify) {
        logger.debug('Notification disabled for this event type');
        return new Response(
          JSON.stringify({ message: 'Notification disabled for this event' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }
    }

    // Determine if this is a critical failure
    const isCritical = status === 'failed' && 
                       settings.critical_job_types?.includes(jobType || '') &&
                       !isTestNotification;

    const severity = isCritical ? 'critical' : 
                     status === 'failed' ? 'high' : 
                     'normal';

    const results: any = { email: null, teams: null };

    // Send email notification
    if (settings.smtp_host && settings.smtp_user && settings.smtp_from_email) {
      try {
        logger.debug('Sending email notification');
        const emailResult = await sendEmailNotification(
          settings, 
          jobId || 'test', 
          jobType || 'test', 
          status || 'test', 
          details
        );
        results.email = emailResult;
        
        // Log successful email delivery
        await supabaseClient.from('notification_logs').insert({
          notification_type: 'email',
          job_id: jobId || null,
          status: 'success',
          delivery_details: emailResult,
          is_test: isTestNotification,
          severity
        });
      } catch (emailError: any) {
        logger.warn('Email notification failed');
        results.email = { error: emailError.message };
        
        // Log failed email delivery
        await supabaseClient.from('notification_logs').insert({
          notification_type: 'email',
          job_id: jobId || null,
          status: 'failed',
          error_message: emailError.message,
          delivery_details: { error: emailError.message },
          is_test: isTestNotification,
          severity
        });
      }
    }

    // Send Teams notification
    if (settings.teams_webhook_url) {
      try {
        logger.debug('Sending Teams notification');
        const teamsResult = await sendTeamsNotification(
          settings.teams_webhook_url, 
          jobId || 'test', 
          jobType || 'test', 
          status || 'test', 
          details,
          isTestNotification,
          testMessage,
          isCritical,
          settings.teams_mention_users,
          settings.mention_on_critical_failures
        );
        results.teams = teamsResult;
        
        // Log successful Teams delivery
        await supabaseClient.from('notification_logs').insert({
          notification_type: 'teams',
          job_id: jobId || null,
          status: 'success',
          delivery_details: teamsResult,
          is_test: isTestNotification,
          severity
        });
      } catch (teamsError: any) {
        logger.warn('Teams notification failed');
        results.teams = { error: teamsError.message };
        
        // Log failed Teams delivery
        await supabaseClient.from('notification_logs').insert({
          notification_type: 'teams',
          job_id: jobId || null,
          status: 'failed',
          error_message: teamsError.message,
          delivery_details: { error: teamsError.message },
          is_test: isTestNotification,
          severity
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    logger.error('Error in send-notification function');
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

async function sendEmailNotification(
  settings: any,
  jobId: string,
  jobType: string,
  status: string,
  details?: any
): Promise<any> {
  const statusEmoji = status === 'completed' ? '✅' : status === 'failed' ? '❌' : '🔄';
  const subject = `${statusEmoji} Job ${status.toUpperCase()}: ${jobType}`;
  
  const body = `
Job Notification

Job ID: ${jobId}
Type: ${jobType}
Status: ${status}
${details ? `Details: ${JSON.stringify(details, null, 2)}` : ''}

---
This is an automated notification from your Server Management System.
  `.trim();

  // Using SMTPClient from the Deno standard library
  const encoder = new TextEncoder();
  const conn = await Deno.connect({
    hostname: settings.smtp_host,
    port: settings.smtp_port || 587,
  });

  try {
    // Start TLS handshake for STARTTLS
    const tlsConn = await Deno.startTls(conn, {
      hostname: settings.smtp_host,
    });

    // Simple SMTP conversation
    const commands = [
      `EHLO ${settings.smtp_host}`,
      `AUTH LOGIN`,
      btoa(settings.smtp_user),
      btoa(settings.smtp_password),
      `MAIL FROM:<${settings.smtp_from_email}>`,
      `RCPT TO:<${settings.smtp_user}>`, // Sending to same user for now
      `DATA`,
      `From: ${settings.smtp_from_email}
To: ${settings.smtp_user}
Subject: ${subject}
Content-Type: text/plain; charset=utf-8

${body}
.`,
      `QUIT`,
    ];

    const decoder = new TextDecoder();
    const buffer = new Uint8Array(1024);

    for (const command of commands) {
      await tlsConn.write(encoder.encode(command + '\r\n'));
      const n = await tlsConn.read(buffer);
      if (n) {
        // Don't log SMTP responses - they may contain sensitive info
        logger.debug('SMTP command processed');
      }
    }

    tlsConn.close();
    return { success: true, message: 'Email sent successfully' };
  } catch (error) {
    conn.close();
    throw error;
  }
}

function formatJobType(jobType: string): string {
  const typeMap: Record<string, string> = {
    'test_credentials': 'Credential Test',
    'discovery_scan': 'Discovery Scan',
    'vcenter_sync': 'vCenter Sync',
    'firmware_update': 'Firmware Update',
    'boot_configuration': 'Boot Configuration',
    'power_control': 'Power Control',
    'scan_local_isos': 'ISO Scan',
    'register_iso_url': 'ISO Registration',
    'scp_backup': 'SCP Backup',
    'scp_restore': 'SCP Restore',
    'virtual_media_attach': 'Virtual Media Attach',
    'virtual_media_detach': 'Virtual Media Detach',
    'bios_update': 'BIOS Update',
  };
  return typeMap[jobType] || jobType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatJobDetails(jobType: string, details: any, status: string): { summary: string; facts: Array<{name: string; value: string}> } {
  if (!details) return { summary: '', facts: [] };
  
  const facts: Array<{name: string; value: string}> = [];
  let summary = '';
  
  switch (jobType) {
    case 'test_credentials':
      if (details.success) {
        summary = `✓ Connected to ${details.product || 'iDRAC'} v${details.idrac_version || 'unknown'}`;
        facts.push({ name: 'Product', value: details.product || 'Unknown' });
        facts.push({ name: 'Version', value: details.idrac_version || 'Unknown' });
        facts.push({ name: 'Vendor', value: details.vendor || 'Unknown' });
      } else {
        summary = `✗ Connection failed: ${details.error || details.message || 'Unknown error'}`;
      }
      break;
      
    case 'discovery_scan':
      summary = `Discovered ${details.discovered_count || 0} servers from ${details.scanned_ips || 0} IPs scanned`;
      facts.push({ name: 'Servers Found', value: (details.discovered_count || 0).toString() });
      facts.push({ name: 'IPs Scanned', value: (details.scanned_ips || 0).toString() });
      if (details.auth_failures > 0) {
        facts.push({ name: 'Auth Failures', value: details.auth_failures.toString() });
        if (details.auth_failure_ips?.length > 0) {
          const preview = details.auth_failure_ips.slice(0, 5).join(', ');
          const more = details.auth_failure_ips.length > 5 ? ` (+${details.auth_failure_ips.length - 5} more)` : '';
          facts.push({ name: 'Failed IPs (sample)', value: preview + more });
        }
      }
      break;
      
    case 'vcenter_sync':
      const parts = [];
      if (details.hosts_synced) parts.push(`${details.hosts_synced} hosts`);
      if (details.hosts_new) parts.push(`${details.hosts_new} new`);
      if (details.hosts_updated) parts.push(`${details.hosts_updated} updated`);
      if (details.vms_synced) parts.push(`${details.vms_synced} VMs`);
      if (details.alarms_synced) parts.push(`${details.alarms_synced} alarms`);
      summary = parts.length > 0 ? `Synced: ${parts.join(', ')}` : 'Sync completed';
      
      if (details.hosts_synced !== undefined) facts.push({ name: 'Hosts', value: details.hosts_synced.toString() });
      if (details.hosts_new) facts.push({ name: 'New Hosts', value: details.hosts_new.toString() });
      if (details.hosts_linked) facts.push({ name: 'Linked', value: details.hosts_linked.toString() });
      if (details.clusters_synced !== undefined) facts.push({ name: 'Clusters', value: details.clusters_synced.toString() });
      break;
      
    case 'boot_configuration':
    case 'firmware_update':
    case 'power_control':
    case 'virtual_media_attach':
    case 'virtual_media_detach':
      if (details.success_count !== undefined || details.failed_count !== undefined) {
        facts.push({ name: 'Succeeded', value: (details.success_count || 0).toString() });
        facts.push({ name: 'Failed', value: (details.failed_count || 0).toString() });
      }
      if (status === 'failed' && details.results?.length) {
        const firstError = details.results.find((r: any) => !r.success);
        if (firstError) {
          summary = `❌ ${firstError.server || 'Server'}: ${(firstError.error || 'Unknown error').substring(0, 100)}`;
        }
      } else if (status === 'completed' && details.message) {
        summary = details.message;
      }
      if (details.action) {
        facts.push({ name: 'Action', value: details.action });
      }
      break;
      
    case 'scan_local_isos':
      summary = `Found ${details.found_count || 0} ISO image(s)`;
      if (details.found_count !== undefined) facts.push({ name: 'Total Found', value: details.found_count.toString() });
      if (details.new_count) facts.push({ name: 'New', value: details.new_count.toString() });
      if (details.updated_count) facts.push({ name: 'Updated', value: details.updated_count.toString() });
      break;
      
    case 'register_iso_url':
      if (details.success) {
        summary = `✓ Registered ISO: ${details.filename || 'Unknown'}`;
        if (details.filename) facts.push({ name: 'Filename', value: details.filename });
        if (details.downloaded) facts.push({ name: 'Downloaded', value: 'Yes' });
      } else {
        summary = `✗ Failed: ${details.error || 'Unknown error'}`;
      }
      break;
      
    case 'scp_backup':
    case 'scp_restore':
      if (details.success) {
        summary = `✓ ${jobType === 'scp_backup' ? 'Backup' : 'Restore'} completed`;
        if (details.server) facts.push({ name: 'Server', value: details.server });
        if (details.components) facts.push({ name: 'Components', value: details.components });
      } else {
        summary = `✗ Failed: ${details.error || 'Unknown error'}`;
      }
      break;
      
    default:
      if (details.message) summary = details.message;
      if (details.error) summary = `Error: ${details.error.substring(0, 150)}`;
      if (details.success !== undefined) {
        facts.push({ name: 'Success', value: details.success ? 'Yes' : 'No' });
      }
  }
  
  return { summary, facts };
}

async function sendTeamsNotification(
  webhookUrl: string,
  jobId: string,
  jobType: string,
  status: string,
  details?: any,
  isTest?: boolean,
  testMessage?: string,
  isCritical?: boolean,
  mentionUsers?: string,
  mentionOnCriticalFailures?: boolean
): Promise<any> {
  if (isTest) {
    const card = {
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      "summary": "Test Notification",
      "themeColor": "0078D4",
      "title": "🔔 Test Notification from Server Management System",
      "sections": [
        {
          "activityTitle": "Connection Test",
          "facts": [
            { "name": "Status", "value": "Success" },
            { "name": "Message", "value": testMessage || "Your Teams webhook is configured correctly!" },
            { "name": "Timestamp", "value": new Date().toISOString() },
          ],
        },
      ],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Teams webhook failed: ${response.status} ${errorText}`);
    }

    return { success: true, message: 'Test notification sent successfully' };
  }

  const getSeverityBadge = (status: string, isCritical: boolean) => {
    if (status === 'failed') {
      return isCritical ? '🚨 CRITICAL' : '❌ FAILED';
    }
    if (status === 'completed') return '✅ SUCCESS';
    return '🔄 RUNNING';
  };

  const statusEmoji = status === 'completed' ? '✅' : 
                     status === 'failed' ? (isCritical ? '🚨' : '❌') : 
                     status === 'running' ? '🔄' : '❓';
  
  const statusColor = status === 'completed' ? '28a745' : 
                     status === 'failed' ? (isCritical ? 'FF0000' : 'dc3545') : 
                     status === 'running' ? '007bff' : '6c757d';

  // Build @mention text for critical failures
  let mentionText = '';
  if (isCritical && mentionOnCriticalFailures && mentionUsers) {
    const users = mentionUsers.split(',').map(u => u.trim()).filter(u => u);
    mentionText = users.map(user => `<at>${user}</at>`).join(' ');
  }

  // Regular job notification
  const severityBadge = getSeverityBadge(status, isCritical || false);
  const titleText = isCritical ? `${statusEmoji} CRITICAL: JOB ${status.toUpperCase()}` : `${statusEmoji} Job ${status.toUpperCase()}`;
  
  // Format details nicely based on job type
  const formatted = formatJobDetails(jobType, details, status);
  
  // Build message text
  let messageText = '';
  if (isCritical && mentionText) {
    messageText = `⚠️ **CRITICAL FAILURE** - Immediate attention required!\n\n${mentionText}\n\n`;
  }
  if (formatted.summary) {
    messageText += formatted.summary;
  }

  const readableJobType = formatJobType(jobType);
  const shortJobId = jobId.substring(0, 8) + '...';

  const card = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    "summary": `Job ${status}: ${readableJobType}`,
    "themeColor": statusColor,
    "title": titleText,
    ...(isCritical && { "importance": "high" }),
    "sections": [
      {
        "activityTitle": `${severityBadge} - ${readableJobType}`,
        "facts": [
          { "name": "Job ID", "value": shortJobId },
          { "name": "Type", "value": readableJobType },
          { "name": "Severity", "value": isCritical ? "CRITICAL" : (status === 'failed' ? "High" : "Normal") },
          { "name": "Timestamp", "value": new Date().toLocaleString() },
          ...formatted.facts
        ],
        "text": messageText || undefined,
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Teams webhook failed: ${response.status} ${errorText}`);
  }

  return { success: true, message: 'Teams notification sent successfully' };
}
