import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationPayload {
  jobId: string;
  jobType: string;
  status: string;
  details?: any;
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

    const { jobId, jobType, status, details }: NotificationPayload = await req.json();

    console.log('Processing notification for job:', { jobId, jobType, status });

    // Get notification settings
    const { data: settings, error: settingsError } = await supabaseClient
      .from('notification_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

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

    // Check if we should notify for this event
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

    const results: any = { email: null, teams: null };

    // Send email notification
    if (settings.smtp_host && settings.smtp_user && settings.smtp_from_email) {
      try {
        console.log('Sending email notification...');
        const emailResult = await sendEmailNotification(settings, jobId, jobType, status, details);
        results.email = emailResult;
      } catch (emailError: any) {
        console.error('Email notification failed:', emailError);
        results.email = { error: emailError.message };
      }
    }

    // Send Teams notification
    if (settings.teams_webhook_url) {
      try {
        console.log('Sending Teams notification...');
        const teamsResult = await sendTeamsNotification(settings.teams_webhook_url, jobId, jobType, status, details);
        results.teams = teamsResult;
      } catch (teamsError: any) {
        console.error('Teams notification failed:', teamsError);
        results.teams = { error: teamsError.message };
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
  details?: any
): Promise<any> {
  const statusColor = status === 'completed' ? '00FF00' : status === 'failed' ? 'FF0000' : 'FFA500';
  const statusEmoji = status === 'completed' ? '✅' : status === 'failed' ? '❌' : '🔄';

  const card = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    "summary": `Job ${status}: ${jobType}`,
    "themeColor": statusColor,
    "title": `${statusEmoji} Job ${status.toUpperCase()}`,
    "sections": [
      {
        "activityTitle": jobType,
        "facts": [
          { "name": "Job ID", "value": jobId },
          { "name": "Status", "value": status },
          { "name": "Type", "value": jobType },
        ],
        "text": details ? `Details: ${JSON.stringify(details, null, 2)}` : undefined,
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
