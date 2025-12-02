import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useIdmSettings } from '@/hooks/useIdmSettings';
import { AlertCircle, Loader2, Save, TestTube } from 'lucide-react';

export function IdmConnectionSettings() {
  const { settings, loading, saving, saveSettings, testConnection } = useIdmSettings();

  const [authMode, setAuthMode] = useState(settings?.auth_mode || 'local_only');
  const [serverHost, setServerHost] = useState(settings?.server_host || '');
  const [serverPort, setServerPort] = useState(settings?.server_port || 389);
  const [ldapsPort, setLdapsPort] = useState(settings?.ldaps_port || 636);
  const [useLdaps, setUseLdaps] = useState(settings?.use_ldaps ?? true);
  const [verifyCertificate, setVerifyCertificate] = useState(settings?.verify_certificate ?? true);
  const [connectionTimeout, setConnectionTimeout] = useState(settings?.connection_timeout_seconds || 10);
  const [baseDn, setBaseDn] = useState(settings?.base_dn || '');
  const [bindDn, setBindDn] = useState(settings?.bind_dn || '');
  const [bindPassword, setBindPassword] = useState('');

  useEffect(() => {
    if (settings) {
      setAuthMode(settings.auth_mode || 'local_only');
      setServerHost(settings.server_host || '');
      setServerPort(settings.server_port || 389);
      setLdapsPort(settings.ldaps_port || 636);
      setUseLdaps(settings.use_ldaps ?? true);
      setVerifyCertificate(settings.verify_certificate ?? true);
      setConnectionTimeout(settings.connection_timeout_seconds || 10);
      setBaseDn(settings.base_dn || '');
      setBindDn(settings.bind_dn || '');
    }
  }, [settings]);

  const handleSave = async () => {
    const updates: any = {
      auth_mode: authMode,
      server_host: serverHost,
      server_port: serverPort,
      ldaps_port: ldapsPort,
      use_ldaps: useLdaps,
      verify_certificate: verifyCertificate,
      connection_timeout_seconds: connectionTimeout,
      base_dn: baseDn,
      bind_dn: bindDn,
    };

    if (bindPassword) {
      updates.bind_password_encrypted = bindPassword;
    }

    await saveSettings(updates);
    setBindPassword('');
  };

  const handleTestConnection = () => {
    testConnection({
      server_host: serverHost,
      server_port: serverPort,
      ldaps_port: ldapsPort,
      use_ldaps: useLdaps,
      verify_certificate: verifyCertificate,
      base_dn: baseDn,
      user_search_base: settings?.user_search_base,
      group_search_base: settings?.group_search_base,
      bind_dn: bindDn,
      bind_password: bindPassword || undefined,
      ca_certificate: settings?.ca_certificate,
      connection_timeout_seconds: connectionTimeout,
      use_saved_password: !bindPassword && !!settings?.bind_password_encrypted,
    });
  };

  const canTestConnection = serverHost && bindDn && (bindPassword || settings?.bind_password_encrypted) && baseDn;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Authentication Mode */}
      <Card>
        <CardHeader>
          <CardTitle>Authentication Mode</CardTitle>
          <CardDescription>Configure how users authenticate to the application</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Authentication Mode</Label>
            <Select value={authMode} onValueChange={(value: any) => setAuthMode(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local_only">Local Only</SelectItem>
                <SelectItem value="idm_primary">IDM Primary (local fallback)</SelectItem>
                <SelectItem value="idm_fallback">IDM Fallback (local primary)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {authMode === 'local_only' && 'Only local authentication is used'}
              {authMode === 'idm_primary' && 'FreeIPA authentication is primary, with local accounts as backup'}
              {authMode === 'idm_fallback' && 'Local authentication is primary, with FreeIPA as backup'}
            </p>
          </div>

          {authMode !== 'local_only' && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                IDM authentication is enabled. Configure the FreeIPA server settings below.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* FreeIPA Server Configuration */}
      {authMode !== 'local_only' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>FreeIPA Server</CardTitle>
              <CardDescription>Connection settings for your FreeIPA/LDAP server</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Server Host</Label>
                  <Input
                    placeholder="ipa.example.com"
                    value={serverHost}
                    onChange={(e) => setServerHost(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">Hostname or IP address of FreeIPA server</p>
                </div>
                <div className="space-y-2">
                  <Label>Connection Timeout (seconds)</Label>
                  <Input
                    type="number"
                    value={connectionTimeout}
                    onChange={(e) => setConnectionTimeout(parseInt(e.target.value))}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-0.5">
                  <Label>Use LDAPS (Recommended)</Label>
                  <p className="text-sm text-muted-foreground">Encrypt connection with TLS/SSL</p>
                </div>
                <Switch checked={useLdaps} onCheckedChange={setUseLdaps} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>LDAP Port</Label>
                  <Input
                    type="number"
                    value={serverPort}
                    onChange={(e) => setServerPort(parseInt(e.target.value))}
                    disabled={useLdaps}
                  />
                  <p className="text-sm text-muted-foreground">Standard: 389</p>
                </div>
                <div className="space-y-2">
                  <Label>LDAPS Port</Label>
                  <Input
                    type="number"
                    value={ldapsPort}
                    onChange={(e) => setLdapsPort(parseInt(e.target.value))}
                    disabled={!useLdaps}
                  />
                  <p className="text-sm text-muted-foreground">Standard: 636</p>
                </div>
              </div>

              {useLdaps && (
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="space-y-0.5">
                    <Label>Verify SSL Certificate</Label>
                    <p className="text-sm text-muted-foreground">Validate server certificate (requires CA cert)</p>
                  </div>
                  <Switch checked={verifyCertificate} onCheckedChange={setVerifyCertificate} />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Service Account */}
          <Card>
            <CardHeader>
              <CardTitle>Service Account</CardTitle>
              <CardDescription>Credentials for binding to the LDAP directory</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Base DN</Label>
                <Input
                  placeholder="dc=example,dc=com"
                  value={baseDn}
                  onChange={(e) => setBaseDn(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">Root of the LDAP directory tree</p>
              </div>
              <div className="space-y-2">
                <Label>Bind DN</Label>
                <Input
                  placeholder="uid=svc_dsm,cn=users,cn=accounts,dc=example,dc=com"
                  value={bindDn}
                  onChange={(e) => setBindDn(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">Full distinguished name of the service account</p>
              </div>
              <div className="space-y-2">
                <Label>Bind Password</Label>
                <Input
                  type="password"
                  placeholder={settings?.bind_password_encrypted ? '••••••••' : 'Enter password'}
                  value={bindPassword}
                  onChange={(e) => setBindPassword(e.target.value)}
                />
                {settings?.bind_password_encrypted && (
                  <p className="text-sm text-muted-foreground">Password is encrypted. Enter new password to change.</p>
                )}
              </div>

              <Button 
                onClick={handleTestConnection} 
                variant="outline"
                disabled={!canTestConnection}
              >
                <TestTube className="mr-2 h-4 w-4" />
                Test Connection
              </Button>
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Settings
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
