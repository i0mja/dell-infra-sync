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

  const [userSearchBase, setUserSearchBase] = useState(settings?.user_search_base || 'cn=users,cn=accounts');
  const [groupSearchBase, setGroupSearchBase] = useState(settings?.group_search_base || 'cn=groups,cn=accounts');
  const [caCertificate, setCaCertificate] = useState(settings?.ca_certificate || '');

  useEffect(() => {
    if (settings) {
      setUserSearchBase(settings.user_search_base || 'cn=users,cn=accounts');
      setGroupSearchBase(settings.group_search_base || 'cn=groups,cn=accounts');
      setCaCertificate(settings.ca_certificate || '');
    }
  }, [settings]);

  const handleSave = async () => {
    await saveSettings({
      user_search_base: userSearchBase,
      group_search_base: groupSearchBase,
      ca_certificate: caCertificate,
    });
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
      {/* Directory Structure */}
      <Card>
        <CardHeader>
          <CardTitle>Directory Structure</CardTitle>
          <CardDescription>Define where users and groups are located in the LDAP tree</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
