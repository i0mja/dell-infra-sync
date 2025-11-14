import { supabase } from "@/integrations/supabase/client";

export interface SendNotificationParams {
  job_id?: string;
  event_type: 'job_started' | 'job_completed' | 'job_failed' | 'test';
  job_type?: string;
  details?: any;
  is_test?: boolean;
}

export interface SendNotificationResult {
  success: boolean;
  error?: string;
  delivery_details?: any;
}

export async function sendNotification(params: SendNotificationParams): Promise<SendNotificationResult> {
  try {
    // Fetch notification settings
    const { data: settings, error: settingsError } = await supabase
      .from('notification_settings')
      .select('*')
      .limit(1)
      .single();

    if (settingsError || !settings) {
      return {
        success: false,
        error: "Notification settings not configured"
      };
    }

    // Check if notifications are enabled for this event type
    const shouldNotify = (
      (params.event_type === 'job_started' && settings.notify_on_job_started) ||
      (params.event_type === 'job_completed' && settings.notify_on_job_complete) ||
      (params.event_type === 'job_failed' && settings.notify_on_job_failed) ||
      params.is_test
    );

    if (!shouldNotify && !params.is_test) {
      return {
        success: true,
        delivery_details: { skipped: true, reason: "Notifications disabled for this event type" }
      };
    }

    const deliveryDetails: any = {};

    // Determine if this is a critical job
    const isCritical = settings.critical_job_types?.includes(params.job_type || '');
    const shouldMention = isCritical && settings.mention_on_critical_failures && params.event_type === 'job_failed';

    // Send Teams notification if configured
    if (settings.teams_webhook_url) {
      try {
        const teamsMessage = buildTeamsMessage(params, shouldMention ? settings.teams_mention_users : null);
        
        const response = await fetch(settings.teams_webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(teamsMessage)
        });

        if (!response.ok) {
          throw new Error(`Teams webhook returned ${response.status}`);
        }

        deliveryDetails.teams = {
          status: 'sent',
          timestamp: new Date().toISOString()
        };
      } catch (error: any) {
        deliveryDetails.teams = {
          status: 'failed',
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }
    }

    // Send email notification if configured
    if (settings.smtp_host && settings.smtp_user && settings.smtp_from_email) {
      // Note: Email sending requires a backend service (SMTP relay)
      // For now, we'll just log that email would be sent
      deliveryDetails.email = {
        status: 'queued',
        note: 'Email sending requires SMTP relay configuration',
        timestamp: new Date().toISOString()
      };
    }

    // Log notification delivery
    await supabase.from('notification_logs').insert({
      job_id: params.job_id || null,
      notification_type: settings.teams_webhook_url ? 'teams' : 'email',
      status: deliveryDetails.teams?.status === 'sent' ? 'sent' : 'failed',
      delivery_details: deliveryDetails,
      error_message: deliveryDetails.teams?.error || null,
      is_test: params.is_test || false,
      severity: isCritical ? 'critical' : 'normal'
    });

    return {
      success: true,
      delivery_details: deliveryDetails
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}

function buildTeamsMessage(params: SendNotificationParams, mentionUsers: string | null): any {
  const { event_type, job_type, details } = params;
  
  let title = '';
  let color = '0078D4'; // Blue
  let text = '';

  switch (event_type) {
    case 'job_started':
      title = `🚀 Job Started: ${job_type}`;
      color = '0078D4'; // Blue
      text = `A new ${job_type} job has been started.`;
      break;
    case 'job_completed':
      title = `✅ Job Completed: ${job_type}`;
      color = '92C353'; // Green
      text = `The ${job_type} job has completed successfully.`;
      break;
    case 'job_failed':
      title = `❌ Job Failed: ${job_type}`;
      color = 'E81123'; // Red
      text = `The ${job_type} job has failed.`;
      if (mentionUsers) {
        text = `<at>${mentionUsers}</at> ${text}`;
      }
      break;
    case 'test':
      title = '🔔 Test Notification';
      color = '0078D4'; // Blue
      text = 'This is a test notification from iDRAC Manager.';
      break;
  }

  const message: any = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    "themeColor": color,
    "title": title,
    "text": text,
    "sections": []
  };

  if (details) {
    message.sections.push({
      "facts": Object.entries(details).map(([key, value]) => ({
        "name": key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        "value": String(value)
      }))
    });
  }

  if (mentionUsers) {
    message.entities = [{
      "type": "mention",
      "text": `<at>${mentionUsers}</at>`,
      "mentioned": {
        "id": mentionUsers,
        "name": mentionUsers
      }
    }];
  }

  return message;
}

export async function testNotification(): Promise<SendNotificationResult> {
  return sendNotification({
    event_type: 'test',
    is_test: true,
    details: {
      message: 'Test notification sent successfully',
      timestamp: new Date().toISOString()
    }
  });
}
