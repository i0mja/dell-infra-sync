import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useIdmSettings } from '@/hooks/useIdmSettings';
import { useIdmGroupMappings } from '@/hooks/useIdmGroupMappings';
import { useIdmSessions } from '@/hooks/useIdmSessions';
import { CheckCircle2, AlertCircle, Loader2, TestTube, RefreshCw, Clock, Users, Shield } from 'lucide-react';

export function IdmOverview() {
  const { settings, loading, testConnection, triggerSync } = useIdmSettings();
  const { mappings } = useIdmGroupMappings();
  const { sessions } = useIdmSessions();

  const handleTestConnection = () => {
    if (!settings) return;
    testConnection({
      server_host: settings.server_host,
      server_port: settings.server_port,
      ldaps_port: settings.ldaps_port,
      use_ldaps: settings.use_ldaps,
      verify_certificate: settings.verify_certificate,
      base_dn: settings.base_dn,
      user_search_base: settings.user_search_base,
      group_search_base: settings.group_search_base,
      bind_dn: settings.bind_dn,
      ca_certificate: settings.ca_certificate,
      connection_timeout_seconds: settings.connection_timeout_seconds,
      use_saved_password: true,
    });
  };

  const activeSessions = sessions.filter(s => s.is_active).length;
  const isConfigured = settings?.server_host && settings?.bind_dn && settings?.bind_password_encrypted;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Authentication Mode</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">
                {settings?.auth_mode === 'local_only' && 'Local Only'}
                {settings?.auth_mode === 'idm_primary' && 'IDM Primary'}
                {settings?.auth_mode === 'idm_fallback' && 'IDM Fallback'}
              </span>
              <Badge variant={settings?.auth_mode !== 'local_only' ? 'default' : 'secondary'}>
                {settings?.auth_mode !== 'local_only' ? 'IDM Enabled' : 'Disabled'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Connection Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">
                {isConfigured ? 'Configured' : 'Not Configured'}
              </span>
              {isConfigured ? (
                <CheckCircle2 className="h-6 w-6 text-green-500" />
              ) : (
                <AlertCircle className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Last Sync</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">
                {settings?.last_sync_at
                  ? new Date(settings.last_sync_at).toLocaleDateString()
                  : 'Never'}
              </span>
              {settings?.last_sync_status === 'success' ? (
                <CheckCircle2 className="h-6 w-6 text-green-500" />
              ) : settings?.last_sync_status ? (
                <AlertCircle className="h-6 w-6 text-destructive" />
              ) : (
                <Clock className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      {settings?.auth_mode !== 'local_only' && (
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Test connection and sync user data</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-3">
            <Button
              onClick={handleTestConnection}
              variant="outline"
              disabled={!isConfigured}
            >
              <TestTube className="mr-2 h-4 w-4" />
              Test Connection
            </Button>
            <Button
              onClick={triggerSync}
              variant="outline"
              disabled={!isConfigured}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Sync Users Now
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Configuration Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration Summary</CardTitle>
          <CardDescription>Current IDM settings overview</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings?.auth_mode === 'local_only' ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                IDM authentication is disabled. Switch to "IDM Primary" or "IDM Fallback" mode in the Connection tab to enable FreeIPA integration.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Server:</span>
                  <span className="ml-2 font-medium">
                    {settings?.server_host || 'Not configured'}
                    {settings?.use_ldaps ? `:${settings?.ldaps_port}` : `:${settings?.server_port}`}
                    {settings?.use_ldaps && ' (LDAPS)'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Base DN:</span>
                  <span className="ml-2 font-medium">{settings?.base_dn || 'Not configured'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Active Sessions:</span>
                  <span className="font-medium">{activeSessions}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Group Mappings:</span>
                  <span className="font-medium">{mappings.length} configured</span>
                </div>
              </div>

              {settings?.last_sync_error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Last Sync Error:</strong> {settings.last_sync_error}
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Setup Checklist */}
      {settings?.auth_mode && settings.auth_mode !== 'local_only' && (
        <Card>
          <CardHeader>
            <CardTitle>Setup Checklist</CardTitle>
            <CardDescription>Ensure IDM is properly configured</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span>Select authentication mode</span>
            </div>
            <div className="flex items-center gap-3">
              {settings?.server_host && settings?.bind_dn ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
              )}
              <span>Configure FreeIPA connection</span>
            </div>
            <div className="flex items-center gap-3">
              {settings?.server_host && settings?.bind_dn ? (
                <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
              ) : (
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
              )}
              <span>Test connection</span>
            </div>
            <div className="flex items-center gap-3">
              {mappings.length > 0 ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
              )}
              <span>Configure group-to-role mappings</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
