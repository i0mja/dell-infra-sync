import { supabase } from "@/integrations/supabase/client";

export interface DiagnosticsReport {
  timestamp: string;
  environment: {
    userAgent: string;
    timezone: string;
    screenResolution: string;
    viewport: string;
  };
  user: {
    id: string | null;
    email: string | null;
    role: string | null;
    sessionValid: boolean;
  };
  database: {
    connected: boolean;
    error?: string;
    tables: {
      servers: number;
      jobs: number;
      jobTasks: number;
      credentialSets: number;
      idracCommands: number;
      vcenterHosts: number;
    };
  };
  edgeFunctions: {
    [key: string]: {
      status: 'ok' | 'error';
      responseTime?: number;
      error?: string;
    };
  };
  servers: {
    total: number;
    byStatus: {
      online: number;
      offline: number;
      unknown: number;
    };
    recentFailures: Array<{
      ip: string;
      error: string;
      timestamp: string;
    }>;
  };
  jobs: {
    total: number;
    active: number;
    pending: number;
    failed24h: number;
    stuckPending: number;
    stuckRunning: number;
  };
  activityLogs: {
    recentCommands: Array<{
      timestamp: string;
      endpoint: string;
      success: boolean;
      error?: string;
      responseTime?: number;
    }>;
    failedLastHour: number;
  };
  networkDiagnostics: {
    successRate: number;
    avgLatency: number;
    activeConnections: number;
    recentErrors: Array<{
      timestamp: string;
      endpoint: string;
      error: string;
    }>;
  } | null;
  settings: {
    activity: {
      logLevel: string;
      logRetentionDays: number;
      autoCleanup: boolean;
    } | null;
    jobs: {
      retentionDays: number;
      autoCleanup: boolean;
      stalePendingHours: number;
      staleRunningHours: number;
    } | null;
    notifications: {
      smtpConfigured: boolean;
      teamsConfigured: boolean;
    } | null;
    vcenter: {
      configured: boolean;
      lastSync: string | null;
    } | null;
  };
  errors: {
    recent: Array<{
      timestamp: string;
      action: string;
      details: any;
    }>;
  };
}

export async function generateDiagnosticsReport(): Promise<DiagnosticsReport> {
  const report: DiagnosticsReport = {
    timestamp: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screenResolution: `${screen.width}x${screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    },
    user: {
      id: null,
      email: null,
      role: null,
      sessionValid: false,
    },
    database: {
      connected: false,
      tables: {
        servers: 0,
        jobs: 0,
        jobTasks: 0,
        credentialSets: 0,
        idracCommands: 0,
        vcenterHosts: 0,
      },
    },
    edgeFunctions: {},
    servers: {
      total: 0,
      byStatus: {
        online: 0,
        offline: 0,
        unknown: 0,
      },
      recentFailures: [],
    },
    jobs: {
      total: 0,
      active: 0,
      pending: 0,
      failed24h: 0,
      stuckPending: 0,
      stuckRunning: 0,
    },
    activityLogs: {
      recentCommands: [],
      failedLastHour: 0,
    },
    networkDiagnostics: null,
    settings: {
      activity: null,
      jobs: null,
      notifications: null,
      vcenter: null,
    },
    errors: {
      recent: [],
    },
  };

  // 1. Check user session
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (user && !userError) {
      report.user.id = user.id;
      report.user.email = user.email || null;
      report.user.sessionValid = true;

      // Get user role
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();
      
      report.user.role = roleData?.role || null;
    }
  } catch (error) {
    console.error('Error checking user session:', error);
  }

  // 2. Database health check - table counts
  try {
    const [
      serversResult,
      jobsResult,
      jobTasksResult,
      credentialsResult,
      idracResult,
      vcenterResult,
    ] = await Promise.all([
      supabase.from('servers').select('*', { count: 'exact', head: true }),
      supabase.from('jobs').select('*', { count: 'exact', head: true }),
      supabase.from('job_tasks').select('*', { count: 'exact', head: true }),
      supabase.from('credential_sets').select('*', { count: 'exact', head: true }),
      supabase.from('idrac_commands').select('*', { count: 'exact', head: true }),
      supabase.from('vcenter_hosts').select('*', { count: 'exact', head: true }),
    ]);

    report.database.connected = true;
    report.database.tables.servers = serversResult.count || 0;
    report.database.tables.jobs = jobsResult.count || 0;
    report.database.tables.jobTasks = jobTasksResult.count || 0;
    report.database.tables.credentialSets = credentialsResult.count || 0;
    report.database.tables.idracCommands = idracResult.count || 0;
    report.database.tables.vcenterHosts = vcenterResult.count || 0;
  } catch (error: any) {
    report.database.error = error.message;
  }

  // 3. Test edge functions
  const edgeFunctions = [
    // 'test-idrac-connection', // REMOVED - now using Job Executor
    'refresh-server-info',
    'preview-server-info',
    'network-diagnostics',
    'create-job',
  ];

  await Promise.all(
    edgeFunctions.map(async (funcName) => {
      const startTime = Date.now();
      try {
        const { data, error } = await supabase.functions.invoke(funcName, {
          body: { test: true },
        });
        const responseTime = Date.now() - startTime;
        
        if (error) {
          report.edgeFunctions[funcName] = {
            status: 'error',
            responseTime,
            error: error.message,
          };
        } else {
          report.edgeFunctions[funcName] = {
            status: 'ok',
            responseTime,
          };
        }
      } catch (error: any) {
        report.edgeFunctions[funcName] = {
          status: 'error',
          responseTime: Date.now() - startTime,
          error: error.message,
        };
      }
    })
  );

  // 4. Server status
  try {
    const { data: servers } = await supabase
      .from('servers')
      .select('connection_status, connection_error, ip_address, last_connection_test');

    if (servers) {
      report.servers.total = servers.length;
      report.servers.byStatus.online = servers.filter(s => s.connection_status === 'online').length;
      report.servers.byStatus.offline = servers.filter(s => s.connection_status === 'offline').length;
      report.servers.byStatus.unknown = servers.filter(s => !s.connection_status || s.connection_status === 'unknown').length;

      report.servers.recentFailures = servers
        .filter(s => s.connection_status === 'offline' && s.connection_error)
        .slice(0, 5)
        .map(s => ({
          ip: s.ip_address,
          error: s.connection_error || 'Unknown error',
          timestamp: s.last_connection_test || 'Unknown',
        }));
    }
  } catch (error) {
    console.error('Error fetching server status:', error);
  }

  // 5. Job status
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: jobs } = await supabase
      .from('jobs')
      .select('status, created_at, started_at');

    if (jobs) {
      report.jobs.total = jobs.length;
      report.jobs.active = jobs.filter(j => j.status === 'running').length;
      report.jobs.pending = jobs.filter(j => j.status === 'pending').length;
      report.jobs.failed24h = jobs.filter(j => j.status === 'failed' && j.created_at >= oneDayAgo).length;
      report.jobs.stuckPending = jobs.filter(j => j.status === 'pending' && j.created_at < twentyFourHoursAgo).length;
      report.jobs.stuckRunning = jobs.filter(j => j.status === 'running' && j.started_at && j.started_at < fortyEightHoursAgo).length;
    }
  } catch (error) {
    console.error('Error fetching job status:', error);
  }

  // 6. Activity logs
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: recentCommands } = await supabase
      .from('idrac_commands')
      .select('timestamp, endpoint, success, error_message, response_time_ms')
      .order('timestamp', { ascending: false })
      .limit(20);

    if (recentCommands) {
      report.activityLogs.recentCommands = recentCommands.map(cmd => ({
        timestamp: cmd.timestamp,
        endpoint: cmd.endpoint,
        success: cmd.success,
        error: cmd.error_message || undefined,
        responseTime: cmd.response_time_ms || undefined,
      }));
    }

    const { count: failedCount } = await supabase
      .from('idrac_commands')
      .select('*', { count: 'exact', head: true })
      .eq('success', false)
      .gte('timestamp', oneHourAgo);

    report.activityLogs.failedLastHour = failedCount || 0;
  } catch (error) {
    console.error('Error fetching activity logs:', error);
  }

  // 7. Network diagnostics
  try {
    const { data: netDiag, error } = await supabase.functions.invoke('network-diagnostics');
    if (!error && netDiag) {
      report.networkDiagnostics = {
        successRate: netDiag.successRate || 0,
        avgLatency: netDiag.avgLatency || 0,
        activeConnections: netDiag.activeConnections || 0,
        recentErrors: netDiag.recentErrors || [],
      };
    }
  } catch (error) {
    console.error('Error fetching network diagnostics:', error);
  }

  // 8. System settings
  try {
    const [activitySettings, notificationSettings, vcenterSettings] = await Promise.all([
      supabase.from('activity_settings').select('log_level, log_retention_days, auto_cleanup_enabled, job_retention_days, job_auto_cleanup_enabled, stale_pending_hours, stale_running_hours').maybeSingle(),
      supabase.from('notification_settings').select('smtp_host, teams_webhook_url').maybeSingle(),
      supabase.from('vcenter_settings').select('host, last_sync').maybeSingle(),
    ]);

    if (activitySettings.data) {
      report.settings.activity = {
        logLevel: activitySettings.data.log_level,
        logRetentionDays: activitySettings.data.log_retention_days,
        autoCleanup: activitySettings.data.auto_cleanup_enabled,
      };
      report.settings.jobs = {
        retentionDays: activitySettings.data.job_retention_days || 90,
        autoCleanup: activitySettings.data.job_auto_cleanup_enabled || false,
        stalePendingHours: activitySettings.data.stale_pending_hours || 24,
        staleRunningHours: activitySettings.data.stale_running_hours || 48,
      };
    }

    if (notificationSettings.data) {
      report.settings.notifications = {
        smtpConfigured: !!notificationSettings.data.smtp_host,
        teamsConfigured: !!notificationSettings.data.teams_webhook_url,
      };
    }

    if (vcenterSettings.data) {
      report.settings.vcenter = {
        configured: !!vcenterSettings.data.host,
        lastSync: vcenterSettings.data.last_sync,
      };
    }
  } catch (error) {
    console.error('Error fetching settings:', error);
  }

  // 9. Recent errors from audit logs
  try {
    const { data: auditLogs } = await supabase
      .from('audit_logs')
      .select('timestamp, action, details')
      .order('timestamp', { ascending: false })
      .limit(10);

    if (auditLogs) {
      report.errors.recent = auditLogs.map(log => ({
        timestamp: log.timestamp,
        action: log.action,
        details: log.details,
      }));
    }
  } catch (error) {
    console.error('Error fetching audit logs:', error);
  }

  return report;
}

export function formatDiagnosticsAsMarkdown(report: DiagnosticsReport): string {
  let markdown = `# System Diagnostics Report\n`;
  markdown += `Generated: ${new Date(report.timestamp).toLocaleString()}\n\n`;

  // Environment
  markdown += `## Environment\n`;
  markdown += `- **Browser**: ${report.environment.userAgent}\n`;
  markdown += `- **Timezone**: ${report.environment.timezone}\n`;
  markdown += `- **Screen**: ${report.environment.screenResolution}\n`;
  markdown += `- **Viewport**: ${report.environment.viewport}\n\n`;

  // User
  markdown += `## User\n`;
  markdown += `- **Email**: ${report.user.email || 'Not authenticated'}\n`;
  markdown += `- **Role**: ${report.user.role || 'N/A'}\n`;
  markdown += `- **Session**: ${report.user.sessionValid ? '✓ Valid' : '✗ Invalid'}\n\n`;

  // Database
  markdown += `## Database Status\n`;
  markdown += `- **Connected**: ${report.database.connected ? '✓ Yes' : '✗ No'}\n`;
  if (report.database.error) {
    markdown += `- **Error**: ${report.database.error}\n`;
  }
  markdown += `\n### Table Counts\n`;
  markdown += `- Servers: ${report.database.tables.servers}\n`;
  markdown += `- Jobs: ${report.database.tables.jobs}\n`;
  markdown += `- Job Tasks: ${report.database.tables.jobTasks}\n`;
  markdown += `- Credential Sets: ${report.database.tables.credentialSets}\n`;
  markdown += `- iDRAC Commands: ${report.database.tables.idracCommands}\n`;
  markdown += `- vCenter Hosts: ${report.database.tables.vcenterHosts}\n\n`;

  // Edge Functions
  markdown += `## Edge Functions Status\n`;
  Object.entries(report.edgeFunctions).forEach(([name, status]) => {
    const icon = status.status === 'ok' ? '✓' : '✗';
    const time = status.responseTime ? ` (${status.responseTime}ms)` : '';
    const error = status.error ? ` - ${status.error}` : '';
    markdown += `- ${icon} **${name}**${time}${error}\n`;
  });
  markdown += `\n`;

  // Servers
  markdown += `## Servers\n`;
  markdown += `- **Total**: ${report.servers.total}\n`;
  markdown += `- **Online**: ${report.servers.byStatus.online}\n`;
  markdown += `- **Offline**: ${report.servers.byStatus.offline}\n`;
  markdown += `- **Unknown**: ${report.servers.byStatus.unknown}\n`;
  if (report.servers.recentFailures.length > 0) {
    markdown += `\n### Recent Failures\n`;
    report.servers.recentFailures.forEach(failure => {
      markdown += `- ${failure.ip}: ${failure.error} (${failure.timestamp})\n`;
    });
  }
  markdown += `\n`;

  // Jobs
  markdown += `## Jobs\n`;
  markdown += `- **Total**: ${report.jobs.total}\n`;
  markdown += `- **Active**: ${report.jobs.active}\n`;
  markdown += `- **Pending**: ${report.jobs.pending}\n`;
  markdown += `- **Failed (24h)**: ${report.jobs.failed24h}\n`;
  markdown += `- **Stuck Pending**: ${report.jobs.stuckPending}\n`;
  markdown += `- **Stuck Running**: ${report.jobs.stuckRunning}\n\n`;

  // Activity Logs
  markdown += `## Activity Logs\n`;
  markdown += `- **Failed commands (last hour)**: ${report.activityLogs.failedLastHour}\n`;
  if (report.activityLogs.recentCommands.length > 0) {
    markdown += `\n### Recent Commands (Last 20)\n`;
    report.activityLogs.recentCommands.slice(0, 10).forEach(cmd => {
      const icon = cmd.success ? '✓' : '✗';
      const time = cmd.responseTime ? ` (${cmd.responseTime}ms)` : '';
      const error = cmd.error ? ` - ${cmd.error}` : '';
      markdown += `- ${icon} ${cmd.endpoint}${time}${error} - ${new Date(cmd.timestamp).toLocaleTimeString()}\n`;
    });
  }
  markdown += `\n`;

  // Network Diagnostics
  if (report.networkDiagnostics) {
    markdown += `## Network Diagnostics\n`;
    markdown += `- **Success Rate**: ${report.networkDiagnostics.successRate}%\n`;
    markdown += `- **Avg Latency**: ${report.networkDiagnostics.avgLatency}ms\n`;
    markdown += `- **Active Connections**: ${report.networkDiagnostics.activeConnections}\n`;
    if (report.networkDiagnostics.recentErrors.length > 0) {
      markdown += `\n### Recent Errors\n`;
      report.networkDiagnostics.recentErrors.slice(0, 5).forEach(err => {
        markdown += `- ${err.endpoint}: ${err.error} (${new Date(err.timestamp).toLocaleTimeString()})\n`;
      });
    }
    markdown += `\n`;
  }

  // Settings
  markdown += `## System Settings\n`;
  if (report.settings.activity) {
    markdown += `### Activity Monitor\n`;
    markdown += `- Log Level: ${report.settings.activity.logLevel}\n`;
    markdown += `- Log Retention: ${report.settings.activity.logRetentionDays} days\n`;
    markdown += `- Auto Cleanup: ${report.settings.activity.autoCleanup ? 'Enabled' : 'Disabled'}\n`;
  }
  if (report.settings.jobs) {
    markdown += `\n### Jobs\n`;
    markdown += `- Retention: ${report.settings.jobs.retentionDays} days\n`;
    markdown += `- Auto Cleanup: ${report.settings.jobs.autoCleanup ? 'Enabled' : 'Disabled'}\n`;
    markdown += `- Stale Pending Threshold: ${report.settings.jobs.stalePendingHours}h\n`;
    markdown += `- Stale Running Threshold: ${report.settings.jobs.staleRunningHours}h\n`;
  }
  if (report.settings.notifications) {
    markdown += `\n### Notifications\n`;
    markdown += `- SMTP: ${report.settings.notifications.smtpConfigured ? 'Configured' : 'Not configured'}\n`;
    markdown += `- Teams: ${report.settings.notifications.teamsConfigured ? 'Configured' : 'Not configured'}\n`;
  }
  if (report.settings.vcenter) {
    markdown += `\n### vCenter\n`;
    markdown += `- Status: ${report.settings.vcenter.configured ? 'Configured' : 'Not configured'}\n`;
    if (report.settings.vcenter.lastSync) {
      markdown += `- Last Sync: ${new Date(report.settings.vcenter.lastSync).toLocaleString()}\n`;
    }
  }
  markdown += `\n`;

  // Recent Errors
  if (report.errors.recent.length > 0) {
    markdown += `## Recent Errors (Audit Log)\n`;
    report.errors.recent.slice(0, 5).forEach(err => {
      markdown += `- [${new Date(err.timestamp).toLocaleString()}] ${err.action}\n`;
      if (err.details) {
        markdown += `  Details: ${JSON.stringify(err.details, null, 2)}\n`;
      }
    });
  }

  return markdown;
}
