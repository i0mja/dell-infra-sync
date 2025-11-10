import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

interface LogCommandParams {
  supabase: SupabaseClient;
  serverId?: string;
  jobId?: string;
  taskId?: string;
  commandType: string;
  endpoint: string;
  fullUrl: string;
  requestHeaders?: any;
  requestBody?: any;
  statusCode?: number;
  responseTimeMs: number;
  responseBody?: any;
  success: boolean;
  errorMessage?: string;
  initiatedBy?: string;
  source: string;
}

export async function logIdracCommand(params: LogCommandParams) {
  try {
    // Redact sensitive data from request body
    const sanitizedRequestBody = params.requestBody 
      ? JSON.parse(JSON.stringify(params.requestBody).replace(/"password":\s*"[^"]*"/gi, '"password":"[REDACTED]"'))
      : null;

    // Truncate large response bodies
    let sanitizedResponseBody = params.responseBody;
    if (sanitizedResponseBody && JSON.stringify(sanitizedResponseBody).length > 10000) {
      sanitizedResponseBody = { 
        truncated: true, 
        message: 'Response body truncated (>10KB)',
        preview: JSON.stringify(sanitizedResponseBody).substring(0, 1000) + '...'
      };
    }

    const { error } = await params.supabase
      .from('idrac_commands')
      .insert({
        server_id: params.serverId || null,
        job_id: params.jobId || null,
        task_id: params.taskId || null,
        command_type: params.commandType,
        endpoint: params.endpoint,
        full_url: params.fullUrl,
        request_headers: params.requestHeaders || null,
        request_body: sanitizedRequestBody,
        status_code: params.statusCode || null,
        response_time_ms: params.responseTimeMs,
        response_body: sanitizedResponseBody,
        success: params.success,
        error_message: params.errorMessage || null,
        initiated_by: params.initiatedBy || null,
        source: params.source,
      });
    
    if (error) {
      console.error('[IDRAC_LOGGER] Failed to log command:', error);
    }
  } catch (err) {
    console.error('[IDRAC_LOGGER] Exception logging command:', err);
  }
}
