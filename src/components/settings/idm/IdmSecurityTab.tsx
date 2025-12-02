import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useIdmSettings } from '@/hooks/useIdmSettings';
import { IdmSessionManager } from '@/components/settings/IdmSessionManager';
import { IdmBreakGlass } from './IdmBreakGlass';
import { Loader2, Save, ChevronDown, Lock, Clock, RefreshCw, ShieldAlert, Users } from 'lucide-react';

export function IdmSecurityTab() {
  const { settings, loading, saving, saveSettings } = useIdmSettings();

  const [maxFailedAttempts, setMaxFailedAttempts] = useState(settings?.max_failed_attempts || 5);
  const [lockoutDuration, setLockoutDuration] = useState(settings?.lockout_duration_minutes || 30);
  const [sessionTimeout, setSessionTimeout] = useState(settings?.session_timeout_minutes || 480);
  const [failoverBehavior, setFailoverBehavior] = useState(settings?.failover_behavior || 'block_login');
  const [syncEnabled, setSyncEnabled] = useState(settings?.sync_enabled ?? false);
  const [syncInterval, setSyncInterval] = useState(settings?.sync_interval_minutes || 60);

  // Collapsible states
  const [rateLimitOpen, setRateLimitOpen] = useState(true);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [failoverOpen, setFailoverOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [breakGlassOpen, setBreakGlassOpen] = useState(false);
  const [activeSessionsOpen, setActiveSessionsOpen] = useState(false);

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
    <div className="space-y-4">
      {/* Rate Limiting */}
      <Collapsible open={rateLimitOpen} onOpenChange={setRateLimitOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Lock className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle className="text-base">Rate Limiting & Lockouts</CardTitle>
                    <CardDescription>Protect against brute force attacks</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{maxFailedAttempts} attempts</Badge>
                  <ChevronDown className={`h-4 w-4 transition-transform ${rateLimitOpen ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              <Separator />
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
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Session Management */}
      <Collapsible open={sessionOpen} onOpenChange={setSessionOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle className="text-base">Session Management</CardTitle>
                    <CardDescription>Configure user session behavior</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{sessionTimeout} min timeout</Badge>
                  <ChevronDown className={`h-4 w-4 transition-transform ${sessionOpen ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              <Separator />
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
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Failover Behavior */}
      <Collapsible open={failoverOpen} onOpenChange={setFailoverOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <RefreshCw className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle className="text-base">Failover Behavior</CardTitle>
                    <CardDescription>What happens when FreeIPA is unavailable</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={failoverBehavior === 'block_login' ? 'default' : 'secondary'}>
                    {failoverBehavior === 'block_login' ? 'Block Login' : 'Allow Local'}
                  </Badge>
                  <ChevronDown className={`h-4 w-4 transition-transform ${failoverOpen ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              <Separator />
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
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* User Sync */}
      <Collapsible open={syncOpen} onOpenChange={setSyncOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle className="text-base">User Synchronization</CardTitle>
                    <CardDescription>Automatically sync user data from FreeIPA</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={syncEnabled ? 'default' : 'secondary'}>
                    {syncEnabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                  <ChevronDown className={`h-4 w-4 transition-transform ${syncOpen ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              <Separator />
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
          </CollapsibleContent>
        </Card>
      </Collapsible>

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

      <Separator className="my-6" />

      {/* Break-Glass Section */}
      <Collapsible open={breakGlassOpen} onOpenChange={setBreakGlassOpen}>
        <Card className="border-destructive/30">
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ShieldAlert className="h-5 w-5 text-destructive" />
                  <div>
                    <CardTitle className="text-base">Break-Glass Administrators</CardTitle>
                    <CardDescription>Emergency local admin accounts that bypass IDM</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">Emergency Access</Badge>
                  <ChevronDown className={`h-4 w-4 transition-transform ${breakGlassOpen ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <Separator className="mb-4" />
              <IdmBreakGlass />
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Active Sessions */}
      <Collapsible open={activeSessionsOpen} onOpenChange={setActiveSessionsOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle className="text-base">Active IDM Sessions</CardTitle>
                    <CardDescription>Manage user sessions and force logouts</CardDescription>
                  </div>
                </div>
                <ChevronDown className={`h-4 w-4 transition-transform ${activeSessionsOpen ? 'rotate-180' : ''}`} />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <Separator className="mb-4" />
              <IdmSessionManager />
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
