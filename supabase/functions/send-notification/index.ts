import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const payload: any = await req.json();
    const { jobId, jobType, status, details, isTest, is_test, testMessage, notification_type } = payload;
    
    // Handle both camelCase and snake_case for test notifications
    const isTestNotification = isTest || is_test || false;

    console.log('Processing notification:', { jobId, jobType, status, isTestNotification, notification_type });

    // Get notification settings
    const { data: settings, error: settingsError } = await supabaseClient
      .from('notification_settings')
      .select('*')
      .limit(1)
      .maybeSingle() as { data: NotificationSettings | null; error: any };

    if (settingsError) {
      console.error('Error fetching notification settings:', settingsError);
      throw settingsError;
    }

    if (!settings) {
      console.log('No notification settings configured');
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
          console.log('Cluster safety email sent');
        } catch (error) {
          console.error('Failed to send cluster safety email:', error);
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
          console.log('Cluster safety Teams notification sent');
        } catch (error) {
          console.error('Failed to send Teams notification:', error);
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

    // Check if we should notify for this event (skip for test notifications)
    if (!isTestNotification) {
      const shouldNotify = 
        (status === 'completed' && settings.notify_on_job_complete) ||
        (status === 'failed' && settings.notify_on_job_failed) ||
        (status === 'running' && settings.notify_on_job_started);

      if (!shouldNotify) {
        console.log('Notification disabled for this event type');
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
        console.log('Sending email notification...');
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
        console.error('Email notification failed:', emailError);
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
        console.log('Sending Teams notification...');
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
        console.error('Teams notification failed:', teamsError);
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
    console.error('Error in send-notification function:', error);
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
        const response = decoder.decode(buffer.subarray(0, n));
        console.log('SMTP Response:', response);
      }
    }

    tlsConn.close();
    return { success: true, message: 'Email sent successfully' };
  } catch (error) {
    conn.close();
    throw error;
  }
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
  
  // Build message text
  let messageText = '';
  if (isCritical && mentionText) {
    messageText = `⚠️ **CRITICAL FAILURE** - Immediate attention required!\n\n${mentionText}\n\n`;
  }
  if (details) {
    messageText += details ? `Details: ${JSON.stringify(details, null, 2)}` : '';
  }

  const card = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    "summary": `Job ${status}: ${jobType}`,
    "themeColor": statusColor,
    "title": titleText,
    ...(isCritical && { "importance": "high" }),
    "sections": [
      {
        "activityTitle": `${severityBadge} - ${jobType}`,
        "facts": [
          { "name": "Job ID", "value": jobId },
          { "name": "Status", "value": status },
          { "name": "Type", "value": jobType },
          { "name": "Severity", "value": isCritical ? "CRITICAL" : (status === 'failed' ? "High" : "Normal") },
          { "name": "Timestamp", "value": new Date().toISOString() },
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
