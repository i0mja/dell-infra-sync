import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useIdmSettings } from '@/hooks/useIdmSettings';
import { IdmSessionManager } from '@/components/settings/IdmSessionManager';
import { Loader2, Save } from 'lucide-react';

export function IdmSecurityPolicies() {
  const { settings, loading, saving, saveSettings } = useIdmSettings();

  const [maxFailedAttempts, setMaxFailedAttempts] = useState(settings?.max_failed_attempts || 5);
  const [lockoutDuration, setLockoutDuration] = useState(settings?.lockout_duration_minutes || 30);
  const [sessionTimeout, setSessionTimeout] = useState(settings?.session_timeout_minutes || 480);
  const [failoverBehavior, setFailoverBehavior] = useState(settings?.failover_behavior || 'block_login');
  const [syncEnabled, setSyncEnabled] = useState(settings?.sync_enabled ?? false);
  const [syncInterval, setSyncInterval] = useState(settings?.sync_interval_minutes || 60);

  useEffect(() => {
    if (settings) {
      setMaxFailedAttempts(settings.max_failed_attempts || 5);
      setLockoutDuration(settings.lockout_duration_minutes || 30);
      setSessionTimeout(settings.session_timeout_minutes || 480);
      setFailoverBehavior(settings.failover_behavior || 'block_login');
      setSyncEnabled(settings.sync_enabled ?? false);
      setSyncInterval(settings.sync_interval_minutes || 60);
    }
  }, [settings]);

  const handleSave = async () => {
    await saveSettings({
      max_failed_attempts: maxFailedAttempts,
      lockout_duration_minutes: lockoutDuration,
      session_timeout_minutes: sessionTimeout,
      failover_behavior: failoverBehavior,
      sync_enabled: syncEnabled,
      sync_interval_minutes: syncInterval,
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
      {/* Rate Limiting */}
      <Card>
        <CardHeader>
          <CardTitle>Rate Limiting & Lockouts</CardTitle>
          <CardDescription>Protect against brute force attacks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Max Failed Attempts</Label>
              <Input
                type="number"
                value={maxFailedAttempts}
                onChange={(e) => setMaxFailedAttempts(parseInt(e.target.value))}
              />
              <p className="text-sm text-muted-foreground">Number of failed login attempts before lockout</p>
            </div>
            <div className="space-y-2">
              <Label>Lockout Duration (minutes)</Label>
              <Input
                type="number"
                value={lockoutDuration}
                onChange={(e) => setLockoutDuration(parseInt(e.target.value))}
              />
              <p className="text-sm text-muted-foreground">How long the account remains locked</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Session Management */}
      <Card>
        <CardHeader>
          <CardTitle>Session Management</CardTitle>
          <CardDescription>Configure user session behavior</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Session Timeout (minutes)</Label>
            <Input
              type="number"
              value={sessionTimeout}
              onChange={(e) => setSessionTimeout(parseInt(e.target.value))}
            />
            <p className="text-sm text-muted-foreground">Idle time before automatic logout (default: 480 = 8 hours)</p>
          </div>
        </CardContent>
      </Card>

      {/* Failover Behavior */}
      <Card>
        <CardHeader>
          <CardTitle>Failover Behavior</CardTitle>
          <CardDescription>What happens when FreeIPA is unavailable</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Failover Behavior</Label>
            <Select value={failoverBehavior} onValueChange={setFailoverBehavior}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="block_login">Block Login</SelectItem>
                <SelectItem value="allow_local">Allow Local Auth</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {failoverBehavior === 'block_login'
                ? 'Users cannot log in if FreeIPA is unreachable (most secure)'
                : 'Allow local authentication as fallback if FreeIPA is unreachable'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* User Sync */}
      <Card>
        <CardHeader>
          <CardTitle>User Synchronization</CardTitle>
          <CardDescription>Automatically sync user data from FreeIPA</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-0.5">
              <Label>Enable User Sync</Label>
              <p className="text-sm text-muted-foreground">Periodically sync user information from FreeIPA</p>
            </div>
            <Switch checked={syncEnabled} onCheckedChange={setSyncEnabled} />
          </div>
          {syncEnabled && (
            <div className="space-y-2">
              <Label>Sync Interval (minutes)</Label>
              <Input
                type="number"
                value={syncInterval}
                onChange={(e) => setSyncInterval(parseInt(e.target.value))}
              />
              <p className="text-sm text-muted-foreground">How often to sync user data from FreeIPA</p>
            </div>
          )}
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

      {/* Active Sessions */}
      <Separator className="my-6" />
      <Card>
        <CardHeader>
          <CardTitle>Active IDM Sessions</CardTitle>
          <CardDescription>Manage user sessions and force logouts</CardDescription>
        </CardHeader>
        <CardContent>
          <IdmSessionManager />
        </CardContent>
      </Card>
    </div>
  );
}
