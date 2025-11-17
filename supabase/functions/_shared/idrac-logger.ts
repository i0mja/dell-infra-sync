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
  operationType: 'idrac_api' | 'vcenter_api' | 'openmanage_api';
}

export async function logIdracCommand(params: LogCommandParams) {
  try {
    // Get settings to check log level and size limits
    const { data: settings } = await params.supabase
      .from('activity_settings')
      .select('*')
      .single();

    // Check if we should log based on level
    if (settings) {
      if (settings.log_level === 'errors_only' && params.success) {
        return; // Don't log successful commands
      }
      
      if (settings.log_level === 'slow_only' && 
          params.responseTimeMs < settings.slow_command_threshold_ms) {
        return; // Don't log fast commands
      }
    }

    // Redact sensitive data from request headers
    let sanitizedHeaders = params.requestHeaders ? { ...params.requestHeaders } : null;
    if (sanitizedHeaders) {
      if (sanitizedHeaders['Authorization']) {
        sanitizedHeaders['Authorization'] = '[REDACTED]';
      }
      if (sanitizedHeaders['authorization']) {
        sanitizedHeaders['authorization'] = '[REDACTED]';
      }
    }

    // Redact passwords from request body
    let sanitizedRequestBody = params.requestBody ? JSON.parse(JSON.stringify(params.requestBody)) : null;
    if (sanitizedRequestBody?.Password) {
      sanitizedRequestBody.Password = '[REDACTED]';
    }

    // Truncate request body based on size limits
    const maxRequestKb = settings?.max_request_body_kb ?? 100;
    if (sanitizedRequestBody) {
      const reqSize = JSON.stringify(sanitizedRequestBody).length / 1024;
      if (reqSize > maxRequestKb) {
        sanitizedRequestBody = {
          _truncated: true,
          _original_size_kb: Math.round(reqSize),
          _limit_kb: maxRequestKb
        };
      }
    }

    // Truncate response body based on size limits
    let sanitizedResponseBody = params.responseBody;
    const maxResponseKb = settings?.max_response_body_kb ?? 100;
    if (sanitizedResponseBody) {
      const resSize = JSON.stringify(sanitizedResponseBody).length / 1024;
      if (resSize > maxResponseKb) {
        sanitizedResponseBody = {
          _truncated: true,
          _original_size_kb: Math.round(resSize),
          _limit_kb: maxResponseKb
        };
      }
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
        request_headers: sanitizedHeaders,
        request_body: sanitizedRequestBody,
        status_code: params.statusCode || null,
        response_time_ms: params.responseTimeMs,
        response_body: sanitizedResponseBody,
        success: params.success,
        error_message: params.errorMessage || null,
        initiated_by: params.initiatedBy || null,
        source: params.source,
        operation_type: params.operationType,
      });
    
    if (error) {
      console.error('[IDRAC_LOGGER] Failed to log command:', error);
    }
  } catch (err) {
    console.error('[IDRAC_LOGGER] Exception logging command:', err);
  }
}
