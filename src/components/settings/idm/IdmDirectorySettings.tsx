import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useIdmSettings } from '@/hooks/useIdmSettings';
import { Loader2, Save } from 'lucide-react';

export function IdmDirectorySettings() {
  const { settings, loading, saving, saveSettings } = useIdmSettings();

  const [baseDn, setBaseDn] = useState(settings?.base_dn || '');
  const [userSearchBase, setUserSearchBase] = useState(settings?.user_search_base || 'cn=users,cn=accounts');
  const [groupSearchBase, setGroupSearchBase] = useState(settings?.group_search_base || 'cn=groups,cn=accounts');
  const [bindDn, setBindDn] = useState(settings?.bind_dn || '');
  const [bindPassword, setBindPassword] = useState('');
  const [caCertificate, setCaCertificate] = useState(settings?.ca_certificate || '');

  useEffect(() => {
    if (settings) {
      setBaseDn(settings.base_dn || '');
      setUserSearchBase(settings.user_search_base || 'cn=users,cn=accounts');
      setGroupSearchBase(settings.group_search_base || 'cn=groups,cn=accounts');
      setBindDn(settings.bind_dn || '');
      setCaCertificate(settings.ca_certificate || '');
    }
  }, [settings]);

  const handleSave = async () => {
    const updates: any = {
      base_dn: baseDn,
      user_search_base: userSearchBase,
      group_search_base: groupSearchBase,
      bind_dn: bindDn,
      ca_certificate: caCertificate,
    };

    if (bindPassword) {
      updates.bind_password_encrypted = bindPassword;
    }

    await saveSettings(updates);
    setBindPassword('');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* LDAP Structure */}
      <Card>
        <CardHeader>
          <CardTitle>LDAP Directory Structure</CardTitle>
          <CardDescription>Define the LDAP directory tree structure</CardDescription>
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
            <Label>User Search Base</Label>
            <Input
              placeholder="cn=users,cn=accounts"
              value={userSearchBase}
              onChange={(e) => setUserSearchBase(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">Relative to Base DN where users are located</p>
          </div>
          <div className="space-y-2">
            <Label>Group Search Base</Label>
            <Input
              placeholder="cn=groups,cn=accounts"
              value={groupSearchBase}
              onChange={(e) => setGroupSearchBase(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">Relative to Base DN where groups are located</p>
          </div>
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
        </CardContent>
      </Card>

      {/* CA Certificate */}
      {settings?.use_ldaps && settings?.verify_certificate && (
        <Card>
          <CardHeader>
            <CardTitle>CA Certificate</CardTitle>
            <CardDescription>PEM-formatted certificate authority certificate for LDAPS verification</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="-----BEGIN CERTIFICATE-----&#10;..."
              value={caCertificate}
              onChange={(e) => setCaCertificate(e.target.value)}
              rows={10}
              className="font-mono text-sm"
            />
            <p className="text-sm text-muted-foreground mt-2">
              Paste the full PEM certificate chain for your FreeIPA CA
            </p>
          </CardContent>
        </Card>
      )}

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
    </div>
  );
}
